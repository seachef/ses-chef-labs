-- Local integration helpers. No scheduler or external mutation installed.
create function neptune_v2_private.instrument_depth(asset text,levels jsonb,qty numeric,side text,m jsonb) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare p numeric;step numeric;
begin
 if neptune_v2_private.native_spec(asset) is null then return neptune_v2_private.depth_price(levels,qty,side,(m->>'tick_size')::numeric);end if;
 step:=neptune_v2_private.num(m->>'qty_step');if step is null or step<=0 then return null;end if;
 if side='sell' then qty:=floor(qty/step)*step;end if;if qty<=0 then return null;end if;
 p:=neptune_v2_private.depth_price(levels,qty,side,.000000000001);
 return neptune_v2_private.native_price(asset,p,side,m);
end$$;
create function neptune_v2_private.instrument_value(asset text,qty numeric,price numeric,side text,m jsonb,fx jsonb,quote_fx jsonb,n timestamptz) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare e jsonb;step numeric;rate numeric;currency text;
begin
 if price is null or qty is null or qty<=0 then return null;end if;
 if neptune_v2_private.native_spec(asset) is null then
 rate:=neptune_v2_private.num(fx->>'rate');if rate is null then return null;end if;
 return price*qty*case when side='buy' then 1.008*rate*1.0025 else .992*rate*.9975 end;
 end if;
 step:=neptune_v2_private.num(m->>'qty_step');if step is null or step<=0 then return null;end if;
 if side='sell' then
 qty:=floor(qty/step)*step;
 if qty<(m->>'min_qty')::numeric or qty*price<(m->>'min_cost')::numeric then return null;end if;
 end if;
 currency:=neptune_v2_private.native_spec(asset)->>'quote';
 e:=neptune_v2_private.native_economics(asset,side,qty,neptune_v2_private.native_price(asset,price,side,m),m,fx,quote_fx->(currency||'/USD'),n,side='sell');
 return abs((e->>'cash_delta_base')::numeric);
end$$;
create function neptune_v2_private.net_owned_after_fee(asset text,grossqty numeric,m jsonb) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare rate numeric;d integer;
begin
 if neptune_v2_private.native_spec(asset) is null then return grossqty;end if;
 rate:=(neptune_v2_private.native_spec(asset)->>'fee_rate')::numeric;d:=(m#>>'{fee_qty_decimals,base}')::integer;
 return grossqty-ceil(grossqty*rate*power(10::numeric,d))/power(10::numeric,d);
end$$;
create function neptune_v2_private.canonical_exposure(asset text) returns text language sql immutable security invoker set search_path='' as $$select coalesce(neptune_v2_private.native_spec(asset)->>'exposure',split_part(asset,'/',1))$$;
-- Native executor only called AFTER strategy, source-book, sizing and venue-rule gates.
create function neptune_v2_private.execute_native_fill(obs text,at_time timestamptz,asset text,ord jsonb,qty numeric,price numeric) returns jsonb language plpgsql security invoker set search_path='' as $$
declare evidence jsonb;m jsonb;rules jsonb;f jsonb;fid text;accounting jsonb;delta numeric;cash numeric;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if at_time<=(ord->>'at')::timestamptz then raise exception 'Later observation required';end if;
 evidence:=neptune_v2_private.resolve_observation(obs);select value into m from jsonb_array_elements(evidence->'markets') where value->>'asset'=asset;
 if ord->>'side'='buy' then rules:=m->'metadata';else select payload->'verified_entry_rules' into rules from neptune_v2_private.positions where positions.asset=execute_native_fill.asset;end if;
 f:=neptune_v2_private.native_economics(asset,ord->>'side',qty,price,rules,evidence->'fx',case when neptune_v2_private.native_conversion_consumed(obs,neptune_v2_private.native_spec(asset)->>'quote',ord->>'side') then null else evidence#>array['quote_fx',(neptune_v2_private.native_spec(asset)->>'quote')||'/USD'] end,at_time,ord->>'side'='sell');
 if f is null then raise exception 'Prevalidated native economics unavailable';end if;
 select account.cash into cash from neptune_v2_private.account where id='neptune-paper-v2';
 if ord->>'side'='sell' and cash+coalesce((f->>'cash_delta_base')::numeric,0)>1000000000 then f:=neptune_v2_private.native_economics(asset,'sell',qty,price,rules,null,null,at_time,true);end if;
 fid:=md5('fill'||(ord->>'id'));
 f:=f||jsonb_build_object('id',fid,'order_id',ord->>'id','decision_id',ord->>'decision_id','observation_id',obs,'at',at_time,'side',ord->>'side','qty',qty,'qty_step',rules->'qty_step','verified_entry_rules',rules,'initial_risk_base',ord->'verified_risk_base','config_version','neptune-native-candidate-1','config_hash','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8','source_hash',(select source_hash from neptune_v2_private.build_metadata order by id desc limit 1));
 delta:=(f->>'cash_delta_base')::numeric;
 insert into neptune_v2_private.fills values(fid,ord->>'id',obs,at_time,delta,f);
 insert into neptune_v2_private.order_events values(md5('filled'||fid),ord->>'id',obs,at_time,'filled',jsonb_build_object('fill_id',fid,'decision_id',ord->>'decision_id'));
 if delta is not null then
 update neptune_v2_private.account set cash=account.cash+delta where id='neptune-paper-v2' returning account.cash into cash;
 insert into neptune_v2_private.cash_ledger values(md5('cash'||fid),fid,at_time,delta,cash);
 end if;
 accounting:=neptune_v2_private.native_book_fill(fid);
 return f||jsonb_build_object('accounting',accounting);
end$$;
revoke all on function neptune_v2_private.instrument_depth(text,jsonb,numeric,text,jsonb),neptune_v2_private.instrument_value(text,numeric,numeric,text,jsonb,jsonb,jsonb,timestamptz),neptune_v2_private.net_owned_after_fee(text,numeric,jsonb),neptune_v2_private.canonical_exposure(text),neptune_v2_private.execute_native_fill(text,timestamptz,text,jsonb,numeric,numeric) from public,anon,authenticated,service_role;
create function neptune_v2_private.instrument_metadata_ok(m jsonb,a text,n timestamptz) returns boolean language plpgsql stable security invoker set search_path='' as $$begin
 if neptune_v2_private.native_spec(a) is null then return neptune_v2_private.metadata_ok(m,a,n);end if;
 return neptune_v2_private.native_identity(a,m->'metadata',n);
end$$;
create function neptune_v2_private.instrument_currency(a text) returns text language sql immutable security invoker set search_path='' as $$select coalesce(neptune_v2_private.native_spec(a)->>'quote','USD')$$;
create or replace function neptune_v2_private.specialist_for_asset(asset text) returns text language sql immutable security invoker set search_path='' as $$select coalesce(neptune_v2_private.native_spec(asset)->>'agent',case when asset='SOL/USD' then 'solana' when asset in ('ETH/USD','LINK/USD','AAVE/USD','UNI/USD') then 'ethereum' end)$$;
create function neptune_v2_private.native_target(asset text,book jsonb,stop numeric,m jsonb,fx jsonb,qfx jsonb,n timestamptz,grossqty numeric default 1) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare debit numeric;risk numeric;goal numeric;owned numeric;lo numeric;hi numeric;mid numeric;value numeric;price numeric;i integer;
begin
 price:=neptune_v2_private.instrument_depth(asset,book->'asks',grossqty,'buy',m);debit:=neptune_v2_private.instrument_value(asset,grossqty,price,'buy',m,fx,qfx,n);owned:=neptune_v2_private.net_owned_after_fee(asset,grossqty,m);
 risk:=debit-neptune_v2_private.instrument_value(asset,owned,stop*.9975,'sell',m,fx,qfx,n);if debit is null or risk is null or risk<=0 then return null;end if;goal:=debit+2*risk;
 lo:=(book->>'ask')::numeric;hi:=lo*2;
 for i in 1..20 loop value:=neptune_v2_private.instrument_value(asset,owned,hi*.9975,'sell',m,fx,qfx,n);if value is null then return null;end if;exit when value>=goal;hi:=hi*2;if hi>10000000 then return null;end if;end loop;
 if value<goal then return null;end if;
 for i in 1..50 loop mid:=(lo+hi)/2;value:=neptune_v2_private.instrument_value(asset,owned,mid*.9975,'sell',m,fx,qfx,n);if value is null then return null;end if;if value>=goal then hi:=mid;else lo:=mid;end if;end loop;
 return neptune_v2_private.native_price(asset,hi*1.000001,'buy',m);
end$$;
create function neptune_v2_private.native_pending_count() returns bigint language sql stable security invoker set search_path='' as $$select count(*) from neptune_v2_private.native_receivables r where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id)$$;
-- Audit-verified dust remains economic exposure despite its active-slot exception.
create function neptune_v2_private.native_dust_cost() returns numeric language sql stable security invoker set search_path='' as $$select coalesce(sum(i.cost_base),0) from neptune_v2_private.native_inventory i join neptune_v2_private.native_fill_attribution la on la.fill_id=i.last_fill_id where i.qty>0 and i.qty<i.qty_step and la.accounting->>'verified_fee_dust'='true' and not exists(select 1 from neptune_v2_private.positions p where p.asset=i.asset and (p.payload->>'qty')::numeric>0)$$;
revoke all on function neptune_v2_private.instrument_metadata_ok(jsonb,text,timestamptz),neptune_v2_private.instrument_currency(text),neptune_v2_private.native_target(text,jsonb,numeric,jsonb,jsonb,jsonb,timestamptz,numeric),neptune_v2_private.native_pending_count(),neptune_v2_private.native_dust_cost() from public,anon,authenticated,service_role;
-- Explicit eligibility proxy, NOT observed historical USD turnover.
-- 96 completed bars give a native-quote lower bound sum(baseVolume*barLow).
-- Normalize that bound with current adverse stablecoin/USD bid evidence.
create function neptune_v2_private.instrument_volume_reference(m jsonb,a text,qfx jsonb,n timestamptz) returns numeric language plpgsql stable security invoker set search_path='' as $$
declare bars jsonb;v jsonb;total numeric:=0;countbars integer:=0;conversion jsonb;t numeric;
begin
 if neptune_v2_private.native_spec(a) is null then return neptune_v2_private.num(m->>'volume_24h_usd');end if;
 if jsonb_typeof(m->'bars') is distinct from 'array' then return null;end if;
 for v in select value from jsonb_array_elements(m->'bars') order by (value->>'t')::numeric desc limit 96 loop
 t:=neptune_v2_private.num(v->>'t');if t is null or to_timestamp(t/1000)+interval '15 minutes'>n or neptune_v2_private.num(v->>'v') is null or neptune_v2_private.num(v->>'l') is null then return null;end if;
 total:=total+(v->>'v')::numeric*(v->>'l')::numeric;countbars:=countbars+1;
 end loop;
 if countbars<>96 then return null;end if;
 conversion:=neptune_v2_private.native_quote_conversion(neptune_v2_private.instrument_currency(a),1,'sell',qfx->(neptune_v2_private.instrument_currency(a)||'/USD'),n);
 return total*(conversion->>'applied_usd_per_quote')::numeric;
exception when others then return null;
end$$;
create function neptune_v2_private.instrument_quote_reference(a text,amount numeric,qfx jsonb,n timestamptz) returns numeric language plpgsql stable security invoker set search_path='' as $$declare c jsonb;begin
 if neptune_v2_private.native_spec(a) is null then return amount;end if;
 c:=neptune_v2_private.native_quote_conversion(neptune_v2_private.instrument_currency(a),1,'sell',qfx->(neptune_v2_private.instrument_currency(a)||'/USD'),n);
 return amount*(c->>'applied_usd_per_quote')::numeric;
end$$;
create function neptune_v2_private.native_scan_reconcile() returns void language plpgsql security invoker set search_path='' as $$begin
 perform neptune_v2_private.native_reconcile();
 if exists(select 1 from neptune_v2_private.native_inventory i left join neptune_v2_private.native_fill_attribution a on a.fill_id=i.last_fill_id left join neptune_v2_private.fills f on f.id=i.last_fill_id where
 a.fill_id is null or i.agent_id is distinct from neptune_v2_private.native_spec(i.asset)->>'agent' or i.canonical_exposure is distinct from neptune_v2_private.canonical_exposure(i.asset)
 or i.agent_id is distinct from a.agent_id or i.asset is distinct from a.asset or i.qty_step is distinct from neptune_v2_private.num(f.payload->>'qty_step')) then raise exception 'Native immutable instrument identity mismatch';end if;
 if exists(select 1 from neptune_v2_private.native_inventory i join neptune_v2_private.native_fill_attribution a on a.fill_id=i.last_fill_id where i.qty>0 and not exists(select 1 from neptune_v2_private.positions p where p.asset=i.asset and neptune_v2_private.num(p.payload->>'qty')=i.qty and neptune_v2_private.num(p.payload->>'cost_base')=i.cost_base and neptune_v2_private.num(p.payload->>'initial_risk_base')=i.risk_base and p.payload->>'quote_currency'=neptune_v2_private.instrument_currency(i.asset) and p.payload->>'venue'=neptune_v2_private.native_spec(i.asset)->>'venue' and neptune_v2_private.num(p.payload#>>'{verified_entry_rules,qty_step}')=i.qty_step and neptune_v2_private.native_identity(i.asset,p.payload->'verified_entry_rules',clock_timestamp(),false))
 and not(i.qty<i.qty_step and a.accounting->>'verified_fee_dust'='true')) then raise exception 'Unmatched ordinary native inventory';end if;
 if exists(select 1 from neptune_v2_private.positions p where neptune_v2_private.native_spec(p.asset) is not null and neptune_v2_private.num(p.payload->>'qty')>0 and not exists(select 1 from neptune_v2_private.native_inventory i where i.asset=p.asset and i.qty=neptune_v2_private.num(p.payload->>'qty'))) then raise exception 'Native position without inventory';end if;
end$$;
revoke all on function neptune_v2_private.instrument_volume_reference(jsonb,text,jsonb,timestamptz),neptune_v2_private.instrument_quote_reference(text,numeric,jsonb,timestamptz),neptune_v2_private.native_scan_reconcile() from public,anon,authenticated,service_role;
-- Reserve a full lot's value for conservative received-fee/dust quantization.
-- Exact full-size risk is independently rechecked after this initial sizing.
create function neptune_v2_private.native_size(budget numeric,unitdebit numeric,unitrisk numeric,unitloss numeric,m jsonb,dustcost numeric default 0) returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare step numeric:=neptune_v2_private.num(m->>'qty_step');risk_cash numeric;notional_cash numeric;
begin
 if budget is null or budget<=0 or unitdebit is null or unitdebit<=0 or unitrisk is null or unitrisk<=0 or unitloss is null or unitloss<0 or step is null or step<=0 then return 0;end if;
 risk_cash:=greatest(0,budget*.0025-unitdebit*step*1.0025-dustcost);
 notional_cash:=greatest(0,budget*.1-unitdebit*step*.1-dustcost);
 return floor(least(risk_cash/(unitrisk+.0025*unitloss),notional_cash/(unitdebit+.1*unitloss))/step)*step;
end$$;
revoke all on function neptune_v2_private.native_size(numeric,numeric,numeric,numeric,jsonb,numeric) from public,anon,authenticated,service_role;
-- Persisted rules may bridge a metadata outage, never override fresh contradictory rules.
create function neptune_v2_private.native_rule_conflict(a text,current_rules jsonb,n timestamptz) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare held jsonb;k text;begin
 if neptune_v2_private.native_spec(a) is null or current_rules is null then return false;end if;
 select payload->'verified_entry_rules' into held from neptune_v2_private.positions where asset=a and neptune_v2_private.num(payload->>'qty')>0;
 if held is null then return false;end if;
 if neptune_v2_private.ts(current_rules->>'at')>n then return true;end if;
 if not neptune_v2_private.fresh(current_rules->>'at',n,86400) then return false;end if;
 if not neptune_v2_private.native_identity(a,current_rules,n) then return true;end if;
 foreach k in array array['venue','venue_id','instrument','asset','base','quote','status','kind','min_qty','max_qty','min_cost','qty_step','qty_decimals','price_decimals','tick_size','fee_qty_decimals','rules','instrument_identity'] loop
 if current_rules->k is distinct from held->k then return true;end if;end loop;
 return false;
end$$;
revoke all on function neptune_v2_private.native_rule_conflict(text,jsonb,timestamptz) from public,anon,authenticated,service_role;
