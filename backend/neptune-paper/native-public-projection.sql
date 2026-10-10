-- Read-only public projection. Scanner owns all root accounting mutations.
-- Load after native ledger, economics and scanner helpers. No grants or live writes.
create or replace function neptune_v2_private.native_public_projection(report jsonb,books jsonb,fx jsonb,quote_fx jsonb,at_time timestamptz) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb:=report;inv record;row jsonb;positions jsonb:='[]';balances jsonb;recent jsonb;specialists jsonb;rows jsonb:='[]';p jsonb;b jsonb;m jsonb;spec jsonb;source jsonb;source_id text;rules jsonb;
 mark numeric;price numeric;legacy_mark numeric:=0;native_mark numeric:=0;legacy_ok boolean:=true;native_ok boolean:=true;can_mark boolean;dust boolean;fees_ok boolean;pending boolean;ready boolean;exposure numeric;agent text;asset_key text;
begin
 if at_time is null then raise exception 'Captured projection time required';end if;
 can_mark:=coalesce(neptune_v2_private.fresh(report#>>'{account,valuation_at}',at_time,90),false);
 -- Source identity is resolved from immutable observation evidence, never from a display label.
 select case when count(*)=1 then min(id) end into source_id from neptune_v2_private.observations where at=at_time;
 if source_id is not null then source:=neptune_v2_private.resolve_observation(source_id);end if;
 for inv in select i.*,a.accounting,f.payload fill_payload from neptune_v2_private.native_inventory i
 join neptune_v2_private.native_fill_attribution a on a.fill_id=i.last_fill_id join neptune_v2_private.fills f on f.id=a.fill_id where i.qty>0 order by i.asset loop
 spec:=neptune_v2_private.native_spec(inv.asset);b:=books->inv.asset;mark:=null;
 select payload into p from neptune_v2_private.positions where asset=inv.asset;
 rules:=coalesce(p->'verified_entry_rules',inv.fill_payload->'verified_entry_rules');
 select value into m from jsonb_array_elements(coalesce(source->'markets','[]')) where value->>'asset'=inv.asset;
 dust:=coalesce(inv.qty<inv.qty_step and inv.accounting->>'verified_fee_dust'='true' and inv.cost_base>0 and inv.accounting->>'inventory_cycle_id' is not null,false);
 if can_mark and dust then mark:=0;
 elsif can_mark and spec is not null and neptune_v2_private.native_identity(inv.asset,m->'metadata',at_time) and b=neptune_v2_private.book(m,at_time) and not(b?'error') then
 price:=neptune_v2_private.instrument_depth(inv.asset,b->'bids',inv.qty,'sell',rules);
 mark:=neptune_v2_private.instrument_value(inv.asset,inv.qty,price,'sell',rules,fx,quote_fx,at_time);
 end if;
 if mark is null then native_ok:=false;else native_mark:=native_mark+mark;end if;
 row:=jsonb_build_object('asset',inv.asset,'agent_id',inv.agent_id,'venue',spec->>'venue','base',spec->>'base','quote_currency',spec->>'quote','owned_qty',inv.qty,'sellable_qty',floor(inv.qty/inv.qty_step)*inv.qty_step,'dust_qty',inv.qty-floor(inv.qty/inv.qty_step)*inv.qty_step,'qty_step',inv.qty_step,'cost_base',inv.cost_base,'initial_risk_base',inv.risk_base,'mark_base',mark,'position_status',case when inv.qty<inv.qty_step then 'dust_held' else 'open' end,'verified_fee_dust',dust,'valuation_basis',case when dust then 'non_executable_conservative_floor' else 'native_executable_depth_net_fees_and_adverse_fx' end,'liquidation_floor_base',case when dust then 0 end,'conservative_risk_base',case when dust then inv.cost_base else inv.risk_base end,'inventory_cycle_id',inv.accounting->>'inventory_cycle_id','last_fill_id',inv.last_fill_id);
 positions:=positions||jsonb_build_array(row);
 end loop;
 if jsonb_array_length(positions)<>(select count(*) from neptune_v2_private.native_inventory where qty>0) then native_ok:=false;end if;
 select coalesce(jsonb_agg(jsonb_build_object('agent_id',x.agent_id,'currency',x.currency,'amount',x.amount,'mark_base',null) order by x.agent_id,x.currency),'[]') into balances from
 (select a.agent_id,r.currency,sum(r.amount) amount from neptune_v2_private.native_receivables r join neptune_v2_private.native_fill_attribution a on a.fill_id=r.exit_fill_id where not exists(select 1 from neptune_v2_private.native_settlement_attribution s where s.exit_fill_id=r.exit_fill_id) group by a.agent_id,r.currency) x;
 if jsonb_array_length(balances)>0 then native_ok:=false;end if;
 -- Compute legacy independently: never derive this subtotal by subtracting native values from root equity.
 for p in select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0 and neptune_v2_private.native_spec(asset) is null loop
 b:=books->(p->>'asset');mark:=null;
 if can_mark and b is not null and not(b?'error') and neptune_v2_private.fresh(b->>'at',at_time,30) then
 price:=neptune_v2_private.instrument_depth(p->>'asset',b->'bids',(p->>'qty')::numeric,'sell',p);
 mark:=neptune_v2_private.instrument_value(p->>'asset',(p->>'qty')::numeric,price,'sell',p,fx,quote_fx,at_time);
 end if;
 if mark is null then legacy_ok:=false;else legacy_mark:=legacy_mark+mark;end if;
 end loop;
 select coalesce(jsonb_agg(x.row order by x.at desc,x.id desc),'[]') into recent from (
 select f.id,f.at,jsonb_build_object('id',f.id,'at',f.at,'asset',a.asset,'venue',f.payload->>'venue','side',a.side,'quote_currency',a.currency,'gross_qty',a.gross_qty,'fee_qty',a.fee_qty,'fee_quote',a.fee_quote,'fee_currency',f.payload->>'fee_currency','net_inventory_delta',a.inventory_delta,'net_quote_delta',a.net_quote,'cash_delta_base',case when s.id is not null then s.payload->'cash_delta_base' else f.payload->'cash_delta_base' end,'fee_base',case when s.id is not null then s.payload->'fee_base' else f.payload->'fee_base' end,'fx_cost_base',case when s.id is not null then s.payload->'fx_cost_base' else f.payload->'fx_cost_base' end,'position_status',a.accounting->>'position_status','settlement_status',case when s.id is not null then 'settled' else f.payload->>'settlement_status' end,'at_fill_settlement_status',f.payload->>'settlement_status','settled_at',case when s.id is not null then s.at end) row
 from neptune_v2_private.native_fill_attribution a join neptune_v2_private.fills f on f.id=a.fill_id left join neptune_v2_private.native_settlement_attribution sa on sa.exit_fill_id=f.id left join neptune_v2_private.settlements s on s.id=sa.settlement_id and s.exit_fill_id=sa.exit_fill_id where f.at<=at_time order by f.at desc,f.id desc limit 50) x;
 fees_ok:=jsonb_array_length(balances)=0 and coalesce(neptune_v2_private.num(report#>>'{account,unsettled_usd}')=0,false);
 r:=jsonb_set(r,'{account}',(r->'account')||jsonb_build_object('valuation_scope','combined_native_v1','fees_complete',fees_ok,'recorded_fees',coalesce(neptune_v2_private.num(r#>>'{account,fees}'),neptune_v2_private.num(r#>>'{account,recorded_fees}')),'recorded_fx_costs',coalesce(neptune_v2_private.num(r#>>'{account,fx_costs}'),neptune_v2_private.num(r#>>'{account,recorded_fx_costs}')),'fees',case when fees_ok then coalesce(neptune_v2_private.num(r#>>'{account,fees}'),neptune_v2_private.num(r#>>'{account,recorded_fees}')) end,'fx_costs',case when fees_ok then coalesce(neptune_v2_private.num(r#>>'{account,fx_costs}'),neptune_v2_private.num(r#>>'{account,recorded_fx_costs}')) end));
 if not(can_mark and native_ok and legacy_ok) or abs(coalesce(neptune_v2_private.num(r#>>'{account,equity}'),-1)-coalesce(neptune_v2_private.num(r#>>'{account,cash}'),-2)-legacy_mark-native_mark)>.000001 then
 r:=jsonb_set(r,'{account}',(r->'account')||jsonb_build_object('equity',null,'unrealized_pnl',null,'valuation_at',null));can_mark:=false;
 r:=r||jsonb_build_object('status',case when r->>'status'='running' then 'data_missing' else r->>'status' end,'scan_complete',false);
 r:=jsonb_set(r,'{risk}',coalesce(r->'risk','{}')||jsonb_build_object('entry_paused',true,'pause_reason',coalesce(r#>>'{risk,pause_reason}','combined_valuation_unavailable')));
 end if;
 r:=r||jsonb_build_object('history_schema_version',3,'history_reader_min_version',3,'native_paper',jsonb_build_object('version',1,'mode','PAPER','observed_at',at_time,'valuation_at',case when can_mark and native_ok and legacy_ok then report#>'{account,valuation_at}' end,'valuation_complete',can_mark and native_ok and legacy_ok,'history_complete',false,'legacy_mark_base',case when legacy_ok then legacy_mark end,'positions',positions,'pending_quote_balances',balances,'recent_fills',recent));
 specialists:=neptune_v2_private.specialist_projection(r);
 for row in select value from jsonb_array_elements(specialists->'accounts') loop
 agent:=row->>'id';
 if agent in ('binance','hyperliquid') and specialists->>'allocation_status'='allocated' then
 asset_key:=case when agent='binance' then 'binance:SOLUSDT' else 'hyperliquid:@107' end;b:=books->asset_key;
 select value into m from jsonb_array_elements(coalesce(source->'markets','[]')) where value->>'asset'=asset_key;
 ready:=coalesce(neptune_v2_private.native_identity(asset_key,m->'metadata',at_time) and b=neptune_v2_private.book(m,at_time) and not(b?'error') and neptune_v2_private.native_quote_conversion(neptune_v2_private.instrument_currency(asset_key),1,'buy',quote_fx->(neptune_v2_private.instrument_currency(asset_key)||'/USD'),at_time) is not null and fx->>'base'='USD' and fx->>'quote'='AUD' and fx->>'source'='Frankfurter ECB reference' and neptune_v2_private.num(fx->>'rate') between .25 and 5 and neptune_v2_private.fresh(fx->>'at',at_time,345600) and neptune_v2_private.fresh(fx->>'fetched_at',at_time,3600),false);
 if report#>>'{native_feed,feed_terminal}'='true' or report#>array['native_feed','provider_blocked',agent] is not null then ready:=false;end if;
 pending:=exists(select 1 from jsonb_array_elements(balances) v where v->>'agent_id'=agent);
 select case when pending or not can_mark or exists(select 1 from jsonb_array_elements(positions) v where v->>'agent_id'=agent and v->'mark_base'='null'::jsonb) then null else coalesce(sum((v->>'mark_base')::numeric),0) end into exposure from jsonb_array_elements(positions) v where v->>'agent_id'=agent;
 row:=row||jsonb_build_object('exposure_base',exposure,'costs_base',case when not pending then row->'costs_base' end,'realized_pnl',case when not pending then row->'realized_pnl' end,'source_venue',agent,'execution_kind','native_spot_paper','readiness_reason',case when report#>>'{native_feed,feed_terminal}'='true' then 'Native feed frozen: '||coalesce(report#>>'{native_feed,reason}','bounded collector unavailable') when report#>array['native_feed','provider_blocked',agent] is not null then 'Provider unavailable: '||coalesce(report#>>array['native_feed','provider_blocked',agent,'reason'],'public feed blocked') when ready then 'Exact native spot instrument and public conversion evidence verified; paper simulation only' else 'Awaiting verified exact native spot and conversion evidence' end,'status',case when report->>'status' in ('stopped','paused','error','storage_paused') then 'stopped' when ready and r->>'status'='running' and r->>'scan_complete'='true' and neptune_v2_private.fresh(r->>'scan_at',at_time,90) and exists(select 1 from neptune_v2_private.account a where a.id='neptune-paper-v2' and a.state->>'enabled'='true') then 'paper_active' else 'waiting_for_data' end,'evidence_at',case when ready then at_time end);
 end if;
 if agent='binance' and not coalesce((neptune_v2_private.native_activation_policy()->'native_entry_venues')?agent,false) then
 row:=row||jsonb_build_object('status','stopped','readiness_reason','Disabled by owner. No Binance collection or new entries; existing virtual allocation and history retained.','evidence_at',null);
 end if;rows:=rows||jsonb_build_array(row);
 end loop;
 r:=r||jsonb_build_object('native_model',neptune_v2_private.native_model()||jsonb_build_object('activation',neptune_v2_private.native_activation_policy(),'binance_taker_pct',0.1,'hyperliquid_spot_taker_pct',0.07,'fees_are_modeled',true,'hyperliquid_buy_fee_currency_basis','official-documentation-supported received-asset inference','synthetic_conversion_excludes_transfers',true),'cost_model',coalesce(r->'cost_model','{}'::jsonb)||jsonb_build_object('scope','Kraken USD spot only; native model reported separately'));
 return r||jsonb_build_object('specialist_accounts',specialists||jsonb_build_object('observed_at',at_time,'accounts',rows));
end$$;

-- Daily native cash-flow recognition requires immutable attribution.
create or replace function neptune_v2_private.perth_daily_performance(report jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n timestamptz:=clock_timestamp();d date:=(n at time zone 'Australia/Perth')::date;mark neptune_v2_private.perth_daily_marks;
 v numeric:=neptune_v2_private.num(report#>>'{account,equity}');t timestamptz:=neptune_v2_private.ts(report#>>'{account,valuation_at}');rev bigint;
 good boolean;unknown_flow boolean:=false;reason text;out jsonb;
begin
 select revision into rev from neptune_v2_private.account where id='neptune-paper-v2';
 good:=coalesce(report->>'mode'='PAPER' and report->>'currency'='AUD' and v>=0 and v<1000000000 and neptune_v2_private.fresh(t::text,n,90) and (t at time zone 'Australia/Perth')::date=d,false);
 if good and v>0 then
 insert into neptune_v2_private.perth_daily_marks values(d,t,v,(select coalesce(max(seq),0) from public.neptune_paper_v2_history),rev) on conflict(day) do nothing;
 end if;
 select * into mark from neptune_v2_private.perth_daily_marks where day=d;
 if mark.day is not null then
 -- Existing engine supports no external cash movement. Recognize only exact
 -- source fill/settlement ledger deltas. Unknown rows block return, never assume
 -- a deposit is profit or silently set its cash-flow adjustment to zero.
 select exists(select 1 from public.neptune_paper_v2_history h join neptune_v2_private.cash_ledger l on h.kind='cash_ledger' and h.id=l.id
 where h.seq>mark.history_seq and not exists(select 1 from neptune_v2_private.fills f where f.id=l.fill_id and f.cash_delta=l.delta)
 and not exists(select 1 from neptune_v2_private.settlements st where neptune_v2_private.native_spec(st.payload->>'asset') is null and l.id=md5('settlecash'||st.exit_fill_id) and (st.payload->>'cash_delta_base')::numeric=l.delta)
 and not exists(select 1 from neptune_v2_private.native_settlement_attribution sa join neptune_v2_private.settlements st on st.id=sa.settlement_id and st.exit_fill_id=sa.exit_fill_id join neptune_v2_private.native_receivables nr on nr.exit_fill_id=sa.exit_fill_id join neptune_v2_private.native_fill_attribution na on na.fill_id=sa.exit_fill_id join neptune_v2_private.fills nf on nf.id=na.fill_id where na.side='sell' and na.cash_delta is null and nf.cash_delta is null and nr.currency=na.currency and nr.amount=na.net_quote and st.at>nf.at and l.delta>0 and st.payload->>'asset'=na.asset and l.id=md5('native-settle-cash'||sa.exit_fill_id) and l.fill_id is null and l.at=st.at and st.payload->>'settlement_status'='settled' and st.payload->>'observation_id'=sa.observation_id and st.payload->>'quote_currency'=nr.currency and (st.payload->>'quote_amount')::numeric=nr.amount and (st.payload->>'cash_delta_base')::numeric=l.delta)) into unknown_flow;
 end if;
 reason:=case when mark.day is null then 'Awaiting first valid equity observation today' when not good then 'Current equity observation missing or stale' when t<mark.at then 'Observation predates daily baseline' when unknown_flow then 'Unclassified cash movement; daily return unavailable' end;
 out:=jsonb_build_object('timezone','Australia/Perth','day',d,'coverage','since_first_observation','baseline_at',mark.at,'baseline_equity',mark.equity,
 'source_revision',rev,'observed_at',case when good then t end,'current_equity',case when good then v end,
 'status',case when reason is null then 'available' else 'unavailable' end,'reason',reason,
 'net_external_flows',case when mark.day is not null and not unknown_flow then 0 end,
 'net_pnl',case when reason is null then v-mark.equity end,'pct',case when reason is null then (v-mark.equity)/mark.equity*100 end);
 return out;
end$$;
revoke all on function neptune_v2_private.native_public_projection(jsonb,jsonb,jsonb,jsonb,timestamptz),neptune_v2_private.perth_daily_performance(jsonb) from public,anon,authenticated,service_role;
