-- Isolated candidate. Load after existing schema/core/owner-access and native-economics.
-- No grants, no publication, no seed, no external writes.
create table neptune_v2_private.native_quote_ledger (
 id text primary key, fill_id text not null references neptune_v2_private.fills(id),
 settlement_id text references neptune_v2_private.settlements(id),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 currency text not null check(currency in ('USDT','USDC')),
 at timestamptz not null, kind text not null check(kind in ('purchase_conversion','trade','fee','proceeds_conversion')),
 delta numeric not null check(delta<>0 and abs(delta)<=1000000000),
 unique(fill_id,kind)
);
create table neptune_v2_private.native_inventory (
 asset text primary key check(asset in ('binance:SOLUSDT','hyperliquid:@107')),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 canonical_exposure text not null unique check(canonical_exposure in ('SOL','HYPE')),
 qty numeric not null check(qty>=0 and qty<1000000000000),
 cost_base numeric(30,12) not null check(cost_base>=0),
 risk_base numeric(30,12) not null check(risk_base>=0),
 qty_step numeric not null check(qty_step>0),
 last_fill_id text not null references neptune_v2_private.fills(id)
);
create table neptune_v2_private.native_fill_attribution (
 fill_id text primary key references neptune_v2_private.fills(id),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 asset text not null, currency text not null check(currency in ('USDT','USDC')),
 side text not null check(side in ('buy','sell')),
 gross_qty numeric not null check(gross_qty>0), inventory_delta numeric not null,
 gross_quote numeric not null check(gross_quote>0), fee_qty numeric not null check(fee_qty>=0), fee_quote numeric not null check(fee_quote>=0),
 net_quote numeric not null, cost_base numeric(30,12) not null check(cost_base>=0),
 risk_base numeric(30,12) not null check(risk_base>=0), cash_delta numeric(30,12),
 accounting jsonb not null
);
create table neptune_v2_private.native_receivables (
 exit_fill_id text primary key references neptune_v2_private.native_fill_attribution(fill_id),
 currency text not null check(currency in ('USDT','USDC')),
 amount numeric not null check(amount>0), at timestamptz not null
);
create table neptune_v2_private.native_settlement_attribution (
 exit_fill_id text primary key references neptune_v2_private.native_receivables(exit_fill_id),
 settlement_id text not null unique references neptune_v2_private.settlements(id),
 observation_id text not null references neptune_v2_private.observations(id)
);
do $$declare t text;begin
 foreach t in array array['native_quote_ledger','native_inventory','native_fill_attribution','native_receivables','native_settlement_attribution'] loop
 execute format('alter table neptune_v2_private.%I enable row level security',t);
 execute format('revoke all on neptune_v2_private.%I from public,anon,authenticated,service_role',t);
 if t<>'native_inventory' then
 execute format('create trigger immutable_rows before update or delete on neptune_v2_private.%I for each row execute function neptune_v2_private.immutable()',t);
 execute format('create trigger immutable_table before truncate on neptune_v2_private.%I for each statement execute function neptune_v2_private.immutable()',t);
 end if;end loop;
end$$;

create function neptune_v2_private.native_signed_num(v text) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;begin
 if v is null or length(v)>48 or v !~ '^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$' then return null;end if;
 n:=v::numeric;if abs(n)>1e12 then return null;end if;return n;
 exception when others then return null;end$$;

create function neptune_v2_private.native_reconcile() returns void language plpgsql security invoker set search_path='' as $$
begin
 perform neptune_v2_private.specialist_reconcile();
 if exists(
 select 1 from (select agent_id,currency,sum(delta) amount from neptune_v2_private.native_quote_ledger group by agent_id,currency) l
 full join (select a.agent_id,r.currency,sum(r.amount) amount from neptune_v2_private.native_receivables r join neptune_v2_private.native_fill_attribution a on a.fill_id=r.exit_fill_id
 where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id) group by a.agent_id,r.currency) r
 using(agent_id,currency) where coalesce(l.amount,0)<>coalesce(r.amount,0)) then raise exception 'Native currency reconciliation failed';end if;
 if exists(select 1 from neptune_v2_private.native_inventory i full join
 (select a.asset,sum(a.inventory_delta) qty,sum(case when a.side='buy' then a.cost_base else -a.cost_base end) cost_base,sum(case when a.side='buy' then a.risk_base else -a.risk_base end) risk_base from neptune_v2_private.native_fill_attribution a group by a.asset) a using(asset)
 where coalesce(i.qty,0)<>coalesce(a.qty,0) or coalesce(i.cost_base,0)<>coalesce(a.cost_base,0) or coalesce(i.risk_base,0)<>coalesce(a.risk_base,0)) then raise exception 'Native inventory reconciliation failed';end if;
end$$;

-- Root cash and its source cash_ledger row must already be recorded by execute_native_fill.
-- This hook books native specialist ownership exactly once from the immutable fill.
-- Does NOT mutate account.state; scanner merges returned root state counters once.
create function neptune_v2_private.native_book_fill(source_fill_id text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare f neptune_v2_private.fills;inv neptune_v2_private.native_inventory;spec jsonb;v jsonb;r jsonb;res jsonb;
 agent text;currency text;side text;asset_key text;cost numeric;heldcost numeric;heldrisk numeric;risk numeric;qty numeric;delta numeric;grossq numeric;feeq numeric;feeb numeric;netq numeric;step numeric;pnl numeric;fees numeric;fxcost numeric;budget numeric;remaining numeric;cycle_id text;previous_id text;exit_reason text;sold_all boolean:=false;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if not exists(select 1 from neptune_v2_private.specialist_checkpoint) then raise exception 'Allocation required';end if;
 select accounting into r from neptune_v2_private.native_fill_attribution where fill_id=source_fill_id;
 if found then return r||'{"replay":true}'::jsonb;end if;
 select * into f from neptune_v2_private.fills where id=source_fill_id;if not found then raise exception 'Authoritative native fill missing';end if;
 v:=f.payload;asset_key:=v->>'asset';spec:=neptune_v2_private.native_spec(asset_key);agent:=spec->>'agent';currency:=spec->>'quote';side:=v->>'side';
 if spec is null or v->>'venue' is distinct from spec->>'venue' or v->>'market_type' is distinct from 'spot' or v->>'specialist_id' is distinct from agent or v->>'quote_currency' is distinct from currency or side is null or side not in ('buy','sell') then raise exception 'Exact native spot identity required';end if;
 if not exists(select 1 from public.neptune_paper_v2_history h,neptune_v2_private.specialist_checkpoint c where h.kind in ('fills','native_fills') and h.id=f.id and h.seq>c.history_seq) then raise exception 'Cannot reattribute historical native fill';end if;
 qty:=neptune_v2_private.num(v->>'gross_qty');delta:=neptune_v2_private.native_signed_num(v->>'net_inventory_delta');grossq:=neptune_v2_private.num(v->>'gross_quote');feeq:=neptune_v2_private.num(v->>'fee_quote');feeb:=neptune_v2_private.num(v->>'fee_qty');netq:=neptune_v2_private.native_signed_num(v->>'net_quote_delta');step:=neptune_v2_private.num(v->>'qty_step');
 if qty is null or qty<=0 or delta is null or grossq is null or grossq<=0 or feeq is null or feeq<0 or feeb is null or feeb<0 or netq is null or step is null or step<=0 or mod(qty,step)<>0 then raise exception 'Invalid native quantities';end if;
 if (side='buy' and (delta<>qty-feeb or delta<=0 or feeq<>0 or netq<>-grossq or v->>'fee_currency' is distinct from spec->>'base'))
 or (side='sell' and (delta<>-qty or feeb<>0 or netq<>grossq-feeq or netq<=0 or v->>'fee_currency' is distinct from currency)) then raise exception 'Native gross/net/fee mismatch';end if;
 if f.cash_delta is distinct from neptune_v2_private.native_signed_num(v->>'cash_delta_base') then raise exception 'Source cash mismatch';end if;
 if f.cash_delta is not null then
 if neptune_v2_private.native_conversion_consumed(f.observation_id,currency,side) then raise exception 'Native conversion depth already consumed for observation side/currency';end if;
 if not exists(select 1 from neptune_v2_private.cash_ledger l where l.fill_id=f.id and l.delta=f.cash_delta) then raise exception 'Source cash ledger missing';end if;
 fees:=neptune_v2_private.num(v->>'fee_base');fxcost:=neptune_v2_private.num(v->>'fx_cost_base');
 if fees is null or fees<0 or fxcost is null or fxcost<0 or v->>'settlement_status' is distinct from 'settled' then raise exception 'Settled native provenance missing';end if;
 else fees:=0;fxcost:=0;if side<>'sell' or v->>'settlement_status' is distinct from 'pending_native_conversion' or exists(select 1 from neptune_v2_private.cash_ledger where fill_id=f.id) then raise exception 'Only native sell proceeds may pend';end if;end if;
 if exists(select 1 from neptune_v2_private.usd_ledger where fill_id=f.id) then raise exception 'Native proceeds must never enter USD ledger';end if;
 select * into inv from neptune_v2_private.native_inventory where native_inventory.asset=asset_key;
 previous_id:=case when coalesce(inv.qty,0)>0 then inv.last_fill_id end;
 cycle_id:=case when coalesce(inv.qty,0)>0 then (select accounting->>'inventory_cycle_id' from neptune_v2_private.native_fill_attribution where fill_id=inv.last_fill_id) else f.id end;
 if side='buy' then
 budget:=(select least(cash,opening_cash) from neptune_v2_private.specialist_accounts where id=agent);
 risk:=neptune_v2_private.num(v->>'initial_risk_base');cost:=-f.cash_delta;
 if cost is null or cost<=0 or budget is null or cost>budget*.1 or risk is null or risk<=0 or risk>budget*.0025 then raise exception 'Native specialist budget/risk ceiling';end if;
 -- An existing dust residual can be aggregated only within its exact instrument/owner.
 if inv.asset is not null and (inv.agent_id<>agent or inv.qty>=inv.qty_step) then raise exception 'Duplicate native exposure';end if;
 if exists(select 1 from neptune_v2_private.positions p where (p.payload->>'qty')::numeric>0 and p.asset<>asset_key and (case when p.asset='SOL/USD' then 'SOL' when p.asset='binance:SOLUSDT' then 'SOL' when p.asset='hyperliquid:@107' then 'HYPE' else p.asset end)=spec->>'exposure') then raise exception 'Duplicate canonical exposure';end if;
 remaining:=coalesce(inv.qty,0)+delta;heldcost:=coalesce(inv.cost_base,0)+cost;heldrisk:=coalesce(inv.risk_base,0)+risk;
 if remaining<step then raise exception 'Native received inventory must contain a sellable lot';end if;
 else
 if inv.asset is null or inv.agent_id<>agent or qty>inv.qty or step<>inv.qty_step then raise exception 'Native inventory oversell or lot mismatch';end if;
 cost:=case when qty=inv.qty then inv.cost_base else floor(inv.cost_base*qty/inv.qty*1e12)/1e12 end;
 risk:=case when qty=inv.qty then inv.risk_base else floor(inv.risk_base*qty/inv.qty*1e12)/1e12 end;
 remaining:=inv.qty-qty;heldcost:=inv.cost_base-cost;heldrisk:=inv.risk_base-risk;
 sold_all:=qty=floor(inv.qty/step)*step;
 select payload->>'reason' into exit_reason from neptune_v2_private.orders where id=f.order_id;
 if remaining>0 and remaining<step and (not sold_all or exit_reason is null or exit_reason not in ('protective_stop','net_r_target')) then raise exception 'Dust requires complete sellable inventory exit with source reason';end if;
 end if;
 pnl:=case when side='sell' and f.cash_delta is not null then f.cash_delta-cost end;
 r:=jsonb_build_object('fill_id',f.id,'asset',asset_key,'specialist_id',agent,'side',side,'quote_currency',currency,'qty_remaining',remaining,'cost_remaining',heldcost,'risk_remaining',heldrisk,
 'sellable_inventory',floor(remaining/step)*step,'dust_inventory',remaining-floor(remaining/step)*step,'cost_base',cost,'initial_risk_base',risk,'cost_basis_method','weighted_average_pro_rata_floor12_residual_retained','previous_native_fill_id',previous_id,'inventory_cycle_id',cycle_id,'sold_entire_sellable_inventory',sold_all,'exit_reason',exit_reason,'verified_fee_dust',side='sell' and remaining>0 and remaining<step and sold_all,'pnl_base',pnl,'fee_base',fees,'fx_cost_base',fxcost,'position_status',case when remaining=0 then 'closed' when remaining<step then 'dust_held' else 'open' end,'replay',false);
 insert into neptune_v2_private.native_fill_attribution values(f.id,agent,asset_key,currency,side,qty,delta,grossq,feeb,feeq,netq,cost,risk,f.cash_delta,r);
 insert into neptune_v2_private.native_inventory values(asset_key,agent,spec->>'exposure',remaining,heldcost,heldrisk,step,f.id)
 on conflict(asset) do update set qty=excluded.qty,cost_base=excluded.cost_base,risk_base=excluded.risk_base,qty_step=excluded.qty_step,last_fill_id=excluded.last_fill_id;
 if side='buy' then
 insert into neptune_v2_private.native_quote_ledger values(md5('native-acquire'||f.id),f.id,null,agent,currency,f.at,'purchase_conversion',grossq);
 insert into neptune_v2_private.native_quote_ledger values(md5('native-trade'||f.id),f.id,null,agent,currency,f.at,'trade',-grossq);
 else
 insert into neptune_v2_private.native_quote_ledger values(md5('native-trade'||f.id),f.id,null,agent,currency,f.at,'trade',grossq);
 if feeq>0 then insert into neptune_v2_private.native_quote_ledger values(md5('native-fee'||f.id),f.id,null,agent,currency,f.at,'fee',-feeq);end if;
 if f.cash_delta is not null then insert into neptune_v2_private.native_quote_ledger values(md5('native-convert'||f.id),f.id,null,agent,currency,f.at,'proceeds_conversion',-netq);
 else insert into neptune_v2_private.native_receivables values(f.id,currency,netq,f.at);end if;
 res:=r||jsonb_build_object('id',md5('native-result'||f.id),'exit_fill_id',f.id,'at',f.at,'closed_at',case when remaining=0 then f.at end,'status',case when f.cash_delta is null then 'pending_native_conversion' else 'settled' end,'net_r',case when risk>0 then pnl/risk end);
 insert into neptune_v2_private.results values(res->>'id',f.id,f.at,res);
 end if;
 update neptune_v2_private.specialist_accounts set cash=cash+coalesce(f.cash_delta,0),realized_pnl=realized_pnl+coalesce(pnl,0),costs_base=costs_base+fees+fxcost where id=agent;
 perform neptune_v2_private.native_reconcile();return r;
end$$;

-- One conversion per exact immutable observation/currency/side. This conservative
-- bound prevents replaying the same visible depth for independent fills/settlements.
create function neptune_v2_private.native_conversion_consumed(source_observation_id text,currency_code text,conversion_side text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from neptune_v2_private.native_fill_attribution a join neptune_v2_private.fills f on f.id=a.fill_id
 where f.observation_id=source_observation_id and a.currency=currency_code and a.side=conversion_side and a.cash_delta is not null)
 or (conversion_side='sell' and exists(select 1 from neptune_v2_private.native_settlement_attribution a join neptune_v2_private.native_receivables r on r.exit_fill_id=a.exit_fill_id where a.observation_id=source_observation_id and r.currency=currency_code))
$$;

-- Exact pending native amount is converted from stored public evidence, never caller amounts.
create function neptune_v2_private.native_settle(source_exit_fill_id text,source_observation_id text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a neptune_v2_private.native_fill_attribution;rec neptune_v2_private.native_receivables;ob neptune_v2_private.observations;f neptune_v2_private.fills;ac neptune_v2_private.account;
 result jsonb;conversion jsonb;fx jsonb;rate numeric;applied numeric;usd numeric;cashdelta numeric;pnl numeric;fxcost numeric;fee numeric;sid text;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 select s.payload into result from neptune_v2_private.native_settlement_attribution x join neptune_v2_private.settlements s on s.id=x.settlement_id where x.exit_fill_id=source_exit_fill_id;
 if found then return result||'{"replay":true}'::jsonb;end if;
 select * into rec from neptune_v2_private.native_receivables where exit_fill_id=source_exit_fill_id;if not found then raise exception 'Pending native receivable missing';end if;
 select * into a from neptune_v2_private.native_fill_attribution where fill_id=source_exit_fill_id;
 select * into f from neptune_v2_private.fills where id=source_exit_fill_id;
 select * into ob from neptune_v2_private.observations where id=source_observation_id;
 if not found then raise exception 'Settlement observation missing';end if;
 if ac.currency<>'AUD' or ob.at<=rec.at or not neptune_v2_private.fresh(ob.at::text,clock_timestamp(),30) then return null;end if;
 if a.side<>'sell' or a.cash_delta is not null or rec.currency<>a.currency or rec.amount<>a.net_quote then raise exception 'Pending native source mismatch';end if;
 if neptune_v2_private.native_conversion_consumed(ob.id,rec.currency,'sell') then return null;end if;
 conversion:=neptune_v2_private.native_quote_conversion(rec.currency,rec.amount,'sell',ob.payload#>array['quote_fx',rec.currency||'/USD'],ob.at);
 fx:=ob.payload->'fx';rate:=neptune_v2_private.num(fx->>'rate');
 if conversion is null or not coalesce(fx->>'base'='USD' and fx->>'quote'='AUD' and fx->>'source'='Frankfurter ECB reference' and rate between .25 and 5 and neptune_v2_private.fresh(fx->>'at',ob.at,345600) and neptune_v2_private.fresh(fx->>'fetched_at',ob.at,3600),false) then return null;end if;
 usd:=(conversion->>'usd_amount')::numeric;applied:=rate*.9975;cashdelta:=floor(usd*applied*1e12)/1e12;pnl:=cashdelta-a.cost_base;
 fee:=a.fee_quote*(conversion->>'raw_usd_per_quote')::numeric*rate;
 fxcost:=(conversion->>'adverse_cost_usd')::numeric*rate+usd*(rate-applied);
 -- Cash/PnL counters use the same scale as the source account, preserving exact reconciliation.
 fee:=round(fee,12);fxcost:=round(fxcost,12);
 if cashdelta>1000000000 or ac.cash+cashdelta>1000000000 or fee>1000000000 or fxcost>1000000000 then return null;end if;
 sid:=md5('native-settlement'||source_exit_fill_id);
 result:=jsonb_build_object('id',sid,'exit_fill_id',source_exit_fill_id,'observation_id',source_observation_id,'at',ob.at,'settled_at',ob.at,'asset',a.asset,'venue',f.payload->>'venue','market_type','spot','specialist_id',a.agent_id,
 'quote_currency',rec.currency,'quote_amount',rec.amount,'quote_conversion',conversion,'usd_amount',usd,'fx',rate,'fx_source',fx->>'source','fx_at',fx->>'at','fx_rate_date',fx->>'rate_date','fx_retrieved_at',fx->>'fetched_at','fx_applied_rate',applied,
 'cash_delta_base',cashdelta,'cost_base',a.cost_base,'pnl_base',pnl,'fee_base',fee,'fx_cost_base',fxcost,'status','settled','settlement_status','settled','replay',false,
 'cost_basis_method',a.accounting->>'cost_basis_method','previous_native_fill_id',a.accounting->'previous_native_fill_id','inventory_cycle_id',a.accounting->'inventory_cycle_id','position_status',a.accounting->>'position_status','qty_remaining',a.accounting->'qty_remaining','closed_at',case when a.accounting->>'position_status'='closed' then f.at end,
 'native_model_version',neptune_v2_private.native_model()->>'version','native_model_hash',neptune_v2_private.native_model()->>'hash','exit_native_model_hash',f.payload->>'native_model_hash','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1),'config_hash',(select config_hash from neptune_v2_private.build_metadata order by id desc limit 1),'exit_source_hash',f.payload->>'source_hash','exit_config_hash',f.payload->>'config_hash');
 insert into neptune_v2_private.settlements values(sid,source_exit_fill_id,ob.at,result);
 update neptune_v2_private.account set cash=cash+cashdelta where id=ac.id;
 insert into neptune_v2_private.cash_ledger values(md5('native-settle-cash'||source_exit_fill_id),null,ob.at,cashdelta,ac.cash+cashdelta);
 insert into neptune_v2_private.native_quote_ledger values(md5('native-convert'||source_exit_fill_id),source_exit_fill_id,sid,a.agent_id,rec.currency,ob.at,'proceeds_conversion',-rec.amount);
 insert into neptune_v2_private.native_settlement_attribution values(source_exit_fill_id,sid,source_observation_id);
 update neptune_v2_private.specialist_accounts set cash=cash+cashdelta,realized_pnl=realized_pnl+pnl,costs_base=costs_base+fee+fxcost where id=a.agent_id;
 insert into neptune_v2_private.results values(md5('native-settle-result'||source_exit_fill_id),source_exit_fill_id,ob.at,result||jsonb_build_object('id',md5('native-settle-result'||source_exit_fill_id),'net_r',case when a.risk_base>0 then pnl/a.risk_base end));
 perform neptune_v2_private.native_reconcile();return result;
end$$;

create function neptune_v2_private.native_projection() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'native_positions',coalesce((select jsonb_agg(jsonb_build_object('asset',i.asset,'specialist_id',i.agent_id,'canonical_exposure',i.canonical_exposure,'qty',i.qty,'cost_base',i.cost_base,'initial_risk_base',i.risk_base,'qty_step',i.qty_step,'verified_fee_dust',coalesce((la.accounting->>'verified_fee_dust')::boolean,false),'valuation_basis',case when i.qty<i.qty_step and la.accounting->>'verified_fee_dust'='true' then 'non_executable_conservative_floor' end,'liquidation_floor_base',case when i.qty<i.qty_step and la.accounting->>'verified_fee_dust'='true' then 0 end,'conservative_risk_base',case when i.qty<i.qty_step then i.cost_base else i.risk_base end,'inventory_cycle_id',la.accounting->>'inventory_cycle_id','last_fill_id',i.last_fill_id,'cost_basis_method',la.accounting->>'cost_basis_method','sellable_inventory',floor(i.qty/i.qty_step)*i.qty_step,'dust_inventory',i.qty-floor(i.qty/i.qty_step)*i.qty_step,'status',case when i.qty<i.qty_step then 'dust_held' else 'open' end) order by i.asset) from neptune_v2_private.native_inventory i join neptune_v2_private.native_fill_attribution la on la.fill_id=i.last_fill_id where i.qty>0),'[]'::jsonb),
 'pending_native_proceeds',coalesce((select jsonb_agg(jsonb_build_object('exit_fill_id',r.exit_fill_id,'asset',a.asset,'specialist_id',a.agent_id,'currency',r.currency,'amount',r.amount,'cost_base',a.cost_base,'closed_at',case when a.accounting->>'position_status'='closed' then r.at end,'status','pending_native_conversion') order by r.at,r.exit_fill_id) from neptune_v2_private.native_receivables r join neptune_v2_private.native_fill_attribution a on a.fill_id=r.exit_fill_id where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id)),'[]'::jsonb))
$$;
revoke all on function neptune_v2_private.native_conversion_consumed(text,text,text),neptune_v2_private.native_signed_num(text),neptune_v2_private.native_reconcile(),neptune_v2_private.native_book_fill(text),neptune_v2_private.native_settle(text,text),neptune_v2_private.native_projection() from public,anon,authenticated,service_role;
