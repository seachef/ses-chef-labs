-- Additive synthetic public audit candidate. No grants, credentials, private data or activation.
-- Load after native-ledger.sql. Apply atomically before native runtime starts.
-- Existing history sequence, access policy and immutable rows stay unchanged.
do $$begin if exists(select 1 from neptune_v2_private.fills where payload->>'asset' in ('binance:SOLUSDT','hyperliquid:@107')) or exists(select 1 from neptune_v2_private.native_fill_attribution) then raise exception 'Install native audit before first native activity; historical backfill requires separate review';end if;end$$;
alter table public.neptune_paper_v2_history drop constraint neptune_paper_v2_history_kind_check;
alter table public.neptune_paper_v2_history add constraint neptune_paper_v2_history_kind_check check(kind=any(array['decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger','native_decisions','native_orders','native_fills','native_results','native_settlements','native_order_events','native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution']));
create function neptune_v2_private.native_audit_project(raw jsonb) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare clean jsonb; c jsonb;begin
 raw:=raw||coalesce(raw->'accounting','{}'::jsonb);
 c:=raw->'quote_conversion';
 if jsonb_typeof(c)='object' then
 select raw||coalesce(jsonb_object_agg('conversion_'||key,value),'{}'::jsonb) into raw from jsonb_each(c);
 end if;
 select coalesce(jsonb_object_agg(key,case when key=any(array['price','qty','risk_base','stop','target','initial_risk_base','fx','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','fx_applied_rate','fx_cost_base','pnl_base','net_r','usd_amount','delta','balance','amount','gross_qty','gross_quote','fee_qty','fee_quote','fee_rate','net_inventory_delta','net_quote_delta','inventory_delta','net_quote','cost_base','risk_remaining','cost_remaining','qty_remaining','qty_step','dust_inventory','sellable_inventory','quote_amount','conversion_amount','conversion_usd_amount','conversion_adverse_cost_usd','conversion_raw_usd_per_quote','conversion_applied_usd_per_quote','cash_delta','liquidation_floor_base','conservative_risk_base']) and value<>'null'::jsonb then to_jsonb(value#>>'{}') else value end),'{}'::jsonb) into clean
 from jsonb_each(raw) where key=any(array['venue','market_type','specialist_id','id','at','asset','action','side','price','qty','quote_currency','reason','source','observation_id','risk_base','stop','target','invalidation','confidence','result','config_version','config_hash','source_hash','native_model_version','native_model_hash','exit_native_model_hash','origin_order_id','origin_decision_id','decision_id','order_id','initial_risk_base','fx','fx_source','fx_at','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','settlement_status','fx_rate_date','fx_retrieved_at','fx_applied_rate','fx_cost_base','closed_at','settled_at','entry_fill_id','exit_fill_id','pnl_base','net_r','status','usd_amount','fill_id','delta','balance','schema_version','agent_id','currency','ledger_kind','amount','settlement_id','gross_qty','gross_quote','fee_qty','fee_quote','fee_currency','fee_rate','fee_model','fee_denomination_basis','order_model','net_inventory_delta','net_quote_delta','inventory_delta','net_quote','cost_base','risk_remaining','cost_remaining','qty_remaining','qty_step','dust_inventory','sellable_inventory','position_status','canonical_exposure','quote_amount','conversion_at','conversion_model','conversion_amount','conversion_source','conversion_currency','conversion_usd_amount','conversion_timestamp_basis','conversion_adverse_cost_usd','conversion_raw_usd_per_quote','conversion_applied_usd_per_quote','cash_delta','exit_source_hash','exit_config_hash','previous_native_fill_id','inventory_cycle_id','cost_basis_method','sold_entire_sellable_inventory','exit_reason','verified_fee_dust','valuation_basis','liquidation_floor_base','conservative_risk_base','last_fill_id']) and jsonb_typeof(value) in ('string','number','boolean','null');
 return clean||'{"schema_version":3}'::jsonb;
end$$;
create or replace function neptune_v2_private.mirror_history() returns trigger language plpgsql security invoker set search_path='' as $$
declare raw jsonb;clean jsonb;build neptune_v2_private.build_metadata;
begin
 if tg_table_schema<>'neptune_v2_private' or tg_table_name not in ('decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger') then raise exception 'Invalid history source';end if;
 select * into build from neptune_v2_private.build_metadata order by id desc limit 1;if not found then raise exception 'Reviewed source metadata required';end if;
 raw:=case when tg_table_name in ('cash_ledger','usd_ledger') then to_jsonb(new) else to_jsonb(new)->'payload' end;
 if tg_table_name='order_events' then raw:=raw||jsonb_build_object('order_id',to_jsonb(new)->'order_id','status',to_jsonb(new)->'status');end if;
 if tg_table_name='order_events' and raw->>'asset' is null then
 raw:=raw||coalesce((select jsonb_build_object('asset',payload->>'asset','venue',payload->>'venue','quote_currency',payload->>'quote_currency','specialist_id',payload->>'specialist_id') from neptune_v2_private.orders where id=to_jsonb(new)->>'order_id' and payload->>'asset' in ('binance:SOLUSDT','hyperliquid:@107')),'{}'::jsonb);
 end if;
 if raw->>'asset' in ('binance:SOLUSDT','hyperliquid:@107') then
 clean:=neptune_v2_private.native_audit_project(raw||jsonb_build_object('id',new.id,'at',new.at));
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash)
 values('native_'||tg_table_name,new.id,new.at,clean,coalesce(clean->>'source_hash',build.source_hash),coalesce(clean->>'config_hash',build.config_hash));return new;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into clean from jsonb_each(raw) where key=any(array[
 'venue','market_type','specialist_id','id','at','asset','action','side','price','qty','quote_currency','reason','source','observation_id','risk_base','stop','target','invalidation','confidence','result','config_version','config_hash','source_hash','native_model_version','native_model_hash','exit_native_model_hash','origin_order_id','origin_decision_id','decision_id','order_id','initial_risk_base','fx','fx_source','fx_at','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','settlement_status','fx_rate_date','fx_retrieved_at','fx_applied_rate','fx_cost_base','closed_at','settled_at','entry_fill_id','exit_fill_id','pnl_base','net_r','status','usd_amount','fill_id','delta','balance']);
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash) values(tg_table_name,new.id,new.at,clean,coalesce(clean->>'source_hash',build.source_hash),coalesce(clean->>'config_hash',build.config_hash));return new;
end$$;
create function neptune_v2_private.mirror_native_audit() returns trigger language plpgsql security invoker set search_path='' as $$
declare raw jsonb:=to_jsonb(new);clean jsonb;eid text;t timestamptz;fid text;f neptune_v2_private.fills;build neptune_v2_private.build_metadata;
begin
 if tg_table_schema<>'neptune_v2_private' or tg_table_name not in ('native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution') then raise exception 'Invalid native audit source';end if;
 fid:=coalesce(raw->>'fill_id',raw->>'exit_fill_id');
 select * into f from neptune_v2_private.fills where id=fid;
 if not found or f.payload->>'asset' not in ('binance:SOLUSDT','hyperliquid:@107') then raise exception 'Native audit authoritative fill missing';end if;
 eid:=coalesce(raw->>'id',raw->>'fill_id',raw->>'exit_fill_id');
 t:=coalesce((raw->>'at')::timestamptz,f.at);
 if tg_table_name='native_settlement_attribution' then select at into t from neptune_v2_private.settlements where id=raw->>'settlement_id';end if;
 raw:=raw||jsonb_build_object('id',eid,'at',t,'asset',f.payload->>'asset','venue',f.payload->>'venue','quote_currency',f.payload->>'quote_currency','market_type','spot','specialist_id',f.payload->>'specialist_id','ledger_kind',raw->>'kind','native_model_version',f.payload->>'native_model_version','native_model_hash',f.payload->>'native_model_hash');
 clean:=neptune_v2_private.native_audit_project(raw);
 select * into build from neptune_v2_private.build_metadata order by id desc limit 1;if not found then raise exception 'Reviewed source metadata required';end if;
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash) values(tg_table_name,eid,t,clean,coalesce(f.payload->>'source_hash',build.source_hash),coalesce(f.payload->>'config_hash',build.config_hash));
 return new;
end$$;
do $$declare t text;begin foreach t in array array['native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution'] loop
 execute format('create trigger mirror_native_history after insert on neptune_v2_private.%I for each row execute function neptune_v2_private.mirror_native_audit()',t);
end loop;end$$;
revoke all on function neptune_v2_private.native_audit_project(jsonb),neptune_v2_private.mirror_native_audit() from public,anon,authenticated,service_role;
