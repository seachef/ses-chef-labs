-- LOCAL REVIEW PROPOSAL ONLY. No grants, owner seed, scheduling or activation.
-- Invoker-only owner request control; core/collector acknowledge requests server-side.
create table public.neptune_paper_v2_control (
 id text primary key check(id='neptune-paper-v2'),owner_id uuid not null,
 enabled boolean not null default false,epoch bigint not null default 0 check(epoch>=0),
 changed_at timestamptz not null default clock_timestamp()
);
alter table public.neptune_paper_v2_control enable row level security;
revoke all on public.neptune_paper_v2_control from public,anon,authenticated,service_role;
create policy neptune_owner_control_read on public.neptune_paper_v2_control for select to authenticated using ((select auth.uid())=owner_id);
create policy neptune_owner_control_update on public.neptune_paper_v2_control for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create function public.neptune_v2_control_epoch() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then raise exception 'Immutable control identity';end if;
 new.epoch:=old.epoch+1;new.changed_at:=clock_timestamp();return new;
end$$;
create trigger neptune_control_epoch before update on public.neptune_paper_v2_control for each row execute function public.neptune_v2_control_epoch();
revoke all on function public.neptune_v2_control_epoch() from public,anon,authenticated,service_role;
create function neptune_v2_private.initialize_owner_control(owner uuid) returns void language plpgsql security invoker set search_path='' as $$begin
 if owner is null or not exists(select 1 from public.paper_control where id=1 and owner_id=owner) then raise exception 'Existing verified paper owner required';end if;
 insert into public.neptune_paper_v2_control(id,owner_id,enabled) values('neptune-paper-v2',owner,false);
end$$;
create function neptune_v2_private.sync_control() returns void language plpgsql security invoker set search_path='' as $$
declare c public.neptune_paper_v2_control;ac neptune_v2_private.account;s jsonb;ack text:='applied';
begin
 select * into c from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 if not found then return;end if;
 select * into ac from neptune_v2_private.account where id=c.id for update;if not found then return;end if;s:=ac.state;
 if (s->>'control_epoch')::bigint is distinct from c.epoch then
 if c.enabled and coalesce((s->>'capacity_paused')::boolean,false) then ack:='rejected_capacity';
 else perform neptune_v2_private.set_enabled(c.enabled);end if;
 update neptune_v2_private.account set state=state||jsonb_build_object('control_epoch',c.epoch,'control_ack_at',clock_timestamp(),'control_ack_status',ack) where id=c.id;
 end if;
 perform neptune_v2_private.publish_control_ack();
end$$;
create function neptune_v2_private.publish_control_ack() returns void language plpgsql security invoker set search_path='' as $$begin
 update public.neptune_paper_v2_status p set payload=p.payload||jsonb_build_object('control',jsonb_build_object('requested_enabled',c.enabled,'requested_epoch',c.epoch,'ack_epoch',(a.state->>'control_epoch')::bigint,'enabled',coalesce((a.state->>'enabled')::boolean,false),'ack_status',a.state->>'control_ack_status','ack_at',a.state->>'control_ack_at'))
 from public.neptune_paper_v2_control c,neptune_v2_private.account a where p.id=c.id and a.id=c.id;
end$$;

-- Sanitized fictional-paper history, never raw observations or owner identity.
create table public.neptune_paper_v2_history (
 seq bigint generated always as identity primary key,kind text not null,id text not null,at timestamptz not null,
 payload jsonb not null check(octet_length(payload::text)<=16384),source_hash text not null,config_hash text not null,
 unique(kind,id),check(kind in ('decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger'))
);
alter table public.neptune_paper_v2_history enable row level security;
revoke all on public.neptune_paper_v2_history from public,anon,authenticated,service_role;
create policy neptune_public_history_read on public.neptune_paper_v2_history for select to anon,authenticated using(true);
create trigger immutable_rows before update or delete on public.neptune_paper_v2_history for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on public.neptune_paper_v2_history for each statement execute function neptune_v2_private.immutable();
create function neptune_v2_private.mirror_history() returns trigger language plpgsql security invoker set search_path='' as $$
declare raw jsonb;clean jsonb;build neptune_v2_private.build_metadata;
begin
 if tg_table_schema<>'neptune_v2_private' or tg_table_name not in ('decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger') then raise exception 'Invalid history source';end if;
 select * into build from neptune_v2_private.build_metadata order by id desc limit 1;if not found then raise exception 'Reviewed source metadata required';end if;
 raw:=case when tg_table_name in ('cash_ledger','usd_ledger') then to_jsonb(new) else to_jsonb(new)->'payload' end;
 if tg_table_name='order_events' then raw:=raw||jsonb_build_object('order_id',to_jsonb(new)->'order_id','status',to_jsonb(new)->'status');end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into clean from jsonb_each(raw) where key=any(array[
 'venue','market_type','specialist_id','id','at','asset','action','side','price','qty','quote_currency','reason','source','observation_id','risk_base','stop','target','invalidation','confidence','result','config_version','config_hash','source_hash','origin_order_id','origin_decision_id','decision_id','order_id','initial_risk_base','fx','fx_source','fx_at','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','settlement_status','fx_rate_date','fx_retrieved_at','fx_applied_rate','fx_cost_base','closed_at','settled_at','entry_fill_id','exit_fill_id','pnl_base','net_r','status','usd_amount','fill_id','delta','balance']);
 insert into public.neptune_paper_v2_history(kind,id,at,payload,source_hash,config_hash) values(tg_table_name,new.id,new.at,clean,coalesce(clean->>'source_hash',build.source_hash),coalesce(clean->>'config_hash',build.config_hash));return new;
end$$;
do $$declare t text;begin foreach t in array array['decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger'] loop
 execute format('create trigger mirror_paper_history after insert on neptune_v2_private.%I for each row execute function neptune_v2_private.mirror_history()',t);
end loop;end$$;
revoke all on all functions in schema neptune_v2_private from public,anon,authenticated,service_role;
-- Separately reviewed minimum permissions, NOT executed here:
-- authenticated SELECT(id,enabled,epoch,changed_at), UPDATE(enabled) on control;
-- anon/authenticated SELECT on sanitized history and status. No private schema USAGE/function grant.

-- LOCAL REVIEW CANDIDATE ONLY. No grants, new credentials, schedules or activation.
-- Installs no hooks/triggers on existing engine tables. Explicit call sites required.
create table neptune_v2_private.specialist_checkpoint (
 id integer primary key check(id=1), source_revision bigint not null,
 history_seq bigint not null, initial_cash numeric(30,12) not null,
 legacy_realized numeric(30,12) not null, cash numeric(30,12) not null,
 allocated_at timestamptz not null default clock_timestamp()
);
create table neptune_v2_private.specialist_accounts (
 id text primary key, ordinal integer unique not null, nominal_initial_cash numeric(30,12) not null,
 opening_cash numeric(30,12) not null, cash numeric(30,12) not null check(cash>=0),
 unsettled_usd numeric(30,12) not null default 0 check(unsettled_usd>=0),
 realized_pnl numeric(30,12) not null default 0,
 costs_base numeric(30,12) not null default 0 check(costs_base>=0)
);
create table neptune_v2_private.specialist_fill_attribution (
 fill_id text primary key references neptune_v2_private.fills(id),
 agent_id text not null references neptune_v2_private.specialist_accounts(id),
 entry_fill_id text not null references neptune_v2_private.fills(id),
 asset text not null, qty numeric(30,12) not null check(qty>0), cost_base numeric(30,12) not null,
 side text not null check(side in ('buy','sell')),
 cash_delta numeric(30,12), net_usd numeric(30,12) not null
);
create table neptune_v2_private.specialist_settlement_attribution (
 settlement_id text primary key references neptune_v2_private.settlements(id),
 exit_fill_id text unique not null references neptune_v2_private.specialist_fill_attribution(fill_id)
);
-- Same invoker/private access pattern as existing engine; no access expansion.
do $$ declare t text;begin
 foreach t in array array['specialist_checkpoint','specialist_accounts','specialist_fill_attribution','specialist_settlement_attribution'] loop
 execute format('alter table neptune_v2_private.%I enable row level security',t);
 execute format('revoke all on neptune_v2_private.%I from public,anon,authenticated,service_role',t);
 end loop;
 foreach t in array array['specialist_checkpoint','specialist_fill_attribution','specialist_settlement_attribution'] loop
 execute format('create trigger immutable_rows before update or delete on neptune_v2_private.%I for each row execute function neptune_v2_private.immutable()',t);
 execute format('create trigger immutable_table before truncate on neptune_v2_private.%I for each statement execute function neptune_v2_private.immutable()',t);
 end loop;
end$$;
create function neptune_v2_private.allocate_specialists() returns void language plpgsql security invoker set search_path='' as $$
declare ac neptune_v2_private.account;ctl public.neptune_paper_v2_control;cashunits numeric;q numeric;remainder integer;k text;i integer:=0;
begin
 select * into ctl from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if not found then raise exception 'Existing account required';end if;
 if exists(select 1 from neptune_v2_private.specialist_checkpoint) then return;end if;
 if ac.currency<>'AUD' or ac.initial_cash<>10000 or ac.cash::text in ('NaN','Infinity','-Infinity') then raise exception 'Unexpected source pool';end if;
 if coalesce((ac.state->>'enabled')::boolean,true) or coalesce(ctl.enabled,true) then raise exception 'Stop and acknowledge existing engine before allocation';end if;
 if exists(select 1 from neptune_v2_private.positions where (payload->>'qty')::numeric<>0)
 or coalesce(ac.state->'pending','{}')<>'{}'::jsonb or coalesce(ac.state->'receivables','{}')<>'{}'::jsonb
 or coalesce((select sum(delta) from neptune_v2_private.usd_ledger),0)<>0 then raise exception 'Flat, no pending orders and settled USD required';end if;
 if ac.cash is distinct from (select sum(delta) from neptune_v2_private.cash_ledger)
 or ac.cash is distinct from ac.initial_cash+(ac.state->>'realized')::numeric then raise exception 'Legacy ledger/PnL must reconcile';end if;
 if exists(select 1 from neptune_v2_private.specialist_accounts) then raise exception 'Partial prior allocation';end if;
 insert into neptune_v2_private.specialist_checkpoint(id,source_revision,history_seq,initial_cash,legacy_realized,cash)
 values(1,ac.revision,(select coalesce(max(seq),0) from public.neptune_paper_v2_history),ac.initial_cash,(ac.state->>'realized')::numeric,ac.cash);
 cashunits:=ac.cash*1000000000000;q:=floor(cashunits/5);remainder:=mod(cashunits,5)::integer;
 foreach k in array array['solana','base','ethereum','hyperliquid','binance'] loop
 insert into neptune_v2_private.specialist_accounts(id,ordinal,nominal_initial_cash,opening_cash,cash)
 values(k,i,2000,(q+case when i<remainder then 1 else 0 end)/1000000000000,(q+case when i<remainder then 1 else 0 end)/1000000000000);i:=i+1;
 end loop;
 -- Never touches source cash, state, positions, history, observations or controls.
end$$;
-- Existing Kraken spot universe mapping ONLY. These are research specialisms,
-- not claims that Kraken fills occurred on either blockchain.
create function neptune_v2_private.specialist_for_asset(asset text) returns text language sql immutable security invoker set search_path='' as $$
 select case when asset='SOL/USD' then 'solana' when asset in ('ETH/USD','LINK/USD','AAVE/USD','UNI/USD') then 'ethereum' else null end
$$;
create function neptune_v2_private.specialist_entry_budget(asset text) returns numeric language sql stable security invoker set search_path='' as $$
 select least(opening_cash,cash) from neptune_v2_private.specialist_accounts where id=neptune_v2_private.specialist_for_asset(asset)
$$;
create function neptune_v2_private.specialist_reconcile() returns void language plpgsql security invoker set search_path='' as $$
begin
 if (select sum(cash) from neptune_v2_private.specialist_accounts) is distinct from (select cash from neptune_v2_private.account where id='neptune-paper-v2') then raise exception 'Specialist cash reconciliation failed';end if;
 if (select sum(unsettled_usd) from neptune_v2_private.specialist_accounts) is distinct from coalesce((select sum(delta) from neptune_v2_private.usd_ledger),0) then raise exception 'Specialist USD reconciliation failed';end if;
end$$;
-- Call immediately after existing execute_fill source cash/USD ledger insert.
-- Source values are selected by ID, never supplied as economic fields by a client.
create function neptune_v2_private.specialist_book_fill(source_fill_id text) returns void language plpgsql security invoker set search_path='' as $$
declare f neptune_v2_private.fills;lot neptune_v2_private.specialist_fill_attribution;a text;cost numeric;entry_id text;fee numeric;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if not exists(select 1 from neptune_v2_private.specialist_checkpoint) then raise exception 'Allocation required';end if;
 if exists(select 1 from neptune_v2_private.specialist_fill_attribution where fill_id=source_fill_id) then return;end if;
 select * into f from neptune_v2_private.fills where id=source_fill_id;if not found then raise exception 'Authoritative fill missing';end if;
 if f.payload->>'quote_currency' is distinct from 'USD' or f.payload->>'venue' is distinct from 'Kraken' or f.payload->>'market_type' is distinct from 'spot' or f.payload->>'specialist_id' is distinct from neptune_v2_private.specialist_for_asset(f.payload->>'asset') then raise exception 'Exact Kraken spot USD specialist identity required';end if;
 if not exists(select 1 from public.neptune_paper_v2_history h,neptune_v2_private.specialist_checkpoint c where h.kind='fills' and h.id=f.id and h.seq>c.history_seq) then raise exception 'Cannot reattribute historical fill';end if;
 if f.payload->>'side'='buy' then
 a:=neptune_v2_private.specialist_for_asset(f.payload->>'asset');
 if a is null or f.cash_delta is null or f.cash_delta>=0 then raise exception 'Unsupported or unsettled entry';end if;
 if (f.payload->>'initial_risk_base') is null or (f.payload->>'initial_risk_base')::numeric<=0 or (f.payload->>'initial_risk_base')::numeric>neptune_v2_private.specialist_entry_budget(f.payload->>'asset')*.0025 then raise exception 'Specialist entry risk ceiling';end if;
 if -f.cash_delta>neptune_v2_private.specialist_entry_budget(f.payload->>'asset')*.1 then raise exception 'Specialist capital ceiling';end if;
 if exists(select 1 from neptune_v2_private.specialist_fill_attribution b where b.side='buy' and b.asset=f.payload->>'asset' and not exists(select 1 from neptune_v2_private.specialist_fill_attribution e where e.side='sell' and e.entry_fill_id=b.fill_id)) then raise exception 'Duplicate global asset exposure';end if;
 cost:=-f.cash_delta;entry_id:=f.id;
 else
 select b.* into lot from neptune_v2_private.specialist_fill_attribution b where b.side='buy' and b.asset=f.payload->>'asset' and not exists(select 1 from neptune_v2_private.specialist_fill_attribution e where e.side='sell' and e.entry_fill_id=b.fill_id);
 if not found or lot.qty is distinct from (f.payload->>'qty')::numeric then raise exception 'Full authoritative position required';end if;
 a:=lot.agent_id;cost:=lot.cost_base;entry_id:=lot.fill_id;
 end if;
 insert into neptune_v2_private.specialist_fill_attribution values(f.id,a,entry_id,f.payload->>'asset',(f.payload->>'qty')::numeric,cost,f.payload->>'side',f.cash_delta,(f.payload->>'net_usd')::numeric);
 if f.cash_delta is not null and ((f.payload->>'fee_base') is null or (f.payload->>'fx_cost_base') is null) then raise exception 'Settled cost provenance missing';end if;
 fee:=case when f.cash_delta is null then 0 else (f.payload->>'fee_base')::numeric+(f.payload->>'fx_cost_base')::numeric end;
 update neptune_v2_private.specialist_accounts set cash=cash+coalesce(f.cash_delta,0),
 unsettled_usd=unsettled_usd+case when f.cash_delta is null then (f.payload->>'net_usd')::numeric else 0 end,
 realized_pnl=realized_pnl+case when f.payload->>'side'='sell' and f.cash_delta is not null then f.cash_delta-cost else 0 end,
 costs_base=costs_base+fee where id=a;
 perform neptune_v2_private.specialist_reconcile();
end$$;
-- Call after BOTH existing settlement cash_ledger and negative usd_ledger inserts.
create function neptune_v2_private.specialist_book_settlement(source_settlement_id text) returns void language plpgsql security invoker set search_path='' as $$
declare st neptune_v2_private.settlements;f neptune_v2_private.specialist_fill_attribution;
begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 if exists(select 1 from neptune_v2_private.specialist_settlement_attribution where settlement_id=source_settlement_id) then return;end if;
 select * into st from neptune_v2_private.settlements where id=source_settlement_id;if not found then raise exception 'Authoritative settlement missing';end if;
 select * into f from neptune_v2_private.specialist_fill_attribution where fill_id=st.exit_fill_id and side='sell' and cash_delta is null;
 if not found or (st.payload->>'usd_amount')::numeric is distinct from f.net_usd then raise exception 'Pending USD attribution mismatch';end if;
 if st.payload->>'fx_cost_base' is null or st.payload->>'fx' is null or (select payload->>'fee_usd' from neptune_v2_private.fills where id=f.fill_id) is null then raise exception 'Settlement cost provenance missing';end if;
 insert into neptune_v2_private.specialist_settlement_attribution values(st.id,f.fill_id);
 update neptune_v2_private.specialist_accounts set cash=cash+(st.payload->>'cash_delta_base')::numeric,
 unsettled_usd=unsettled_usd-f.net_usd,realized_pnl=realized_pnl+(st.payload->>'cash_delta_base')::numeric-f.cost_base,
 costs_base=costs_base+(st.payload->>'fx_cost_base')::numeric+(select (payload->>'fee_usd')::numeric from neptune_v2_private.fills where id=f.fill_id)*(st.payload->>'fx')::numeric where id=f.agent_id;
 perform neptune_v2_private.specialist_reconcile();
end$$;
-- Explicit projection call only; this function publishes nothing itself.
create function neptune_v2_private.specialist_projection(report jsonb default null) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare projected_at timestamptz:=clock_timestamp();ac neptune_v2_private.account;rows jsonb;allocated boolean;
begin
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2';
 allocated:=exists(select 1 from neptune_v2_private.specialist_checkpoint);
 if allocated then perform neptune_v2_private.specialist_reconcile();
 if (select sum(realized_pnl) from neptune_v2_private.specialist_accounts)+(select legacy_realized from neptune_v2_private.specialist_checkpoint) is distinct from (ac.state->>'realized')::numeric then raise exception 'Specialist PnL reconciliation failed';end if;end if;
 select jsonb_agg(jsonb_build_object('id',k,'nominal_initial_cash',2000,'cash',a.cash,'reserved_cash',case when allocated then 0 end,
 'available_cash',a.cash,'unsettled_usd',a.unsettled_usd,'realized_pnl',case when a.unsettled_usd=0 then a.realized_pnl end,
 'costs_base',case when a.unsettled_usd=0 then a.costs_base end,'costs_basis','recorded trading fees and FX adverse allowance; slippage embedded in fill prices',
 'exposure_base',case when allocated and not exists(select 1 from neptune_v2_private.specialist_fill_attribution b where b.agent_id=k and b.side='buy' and not exists(select 1 from neptune_v2_private.specialist_fill_attribution e where e.entry_fill_id=b.fill_id and e.side='sell')) then 0 end,
 'source_venue',case when k in ('solana','ethereum') then 'Kraken public spot' end,
 'execution_kind',case when allocated and k in ('solana','ethereum') then 'spot_paper' else 'research_only' end,
 'readiness_reason',case when not allocated then 'Allocation pending' when k in ('solana','ethereum') then 'Native-asset research using Kraken spot; not on-chain execution' else 'Venue execution and full costs not yet verified' end,
 'status',case when not allocated or k not in ('solana','ethereum') then 'research_only' when not coalesce((ac.state->>'enabled')::boolean,false) then 'stopped' when report->>'status'='running' and report->>'scan_complete'='true' and neptune_v2_private.fresh(report->>'scan_at',projected_at,90) then 'paper_active' else 'waiting_for_data' end,'evidence_at',case when k in ('solana','ethereum') then report->>'scan_at' end) order by n) into rows
 from unnest(array['solana','base','ethereum','hyperliquid','binance']) with ordinality as x(k,n)
 left join neptune_v2_private.specialist_accounts a on a.id=k;
 return jsonb_build_object('version',1,'mode','PAPER','currency','AUD','initial_cash',10000,'total_cash',ac.cash,
 'source_revision',ac.revision,'observed_at',projected_at,'allocation_status',case when allocated then 'allocated' else 'pending' end,'accounts',rows);
end$$;
do $$ declare p record;begin
 for p in select oid::regprocedure as sig from pg_proc where pronamespace='neptune_v2_private'::regnamespace and (proname like 'specialist_%' or proname='allocate_specialists') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',p.sig);
 end loop;
end$$;

-- Additive first-observed Perth-day baseline. Never rewrites UTC risk state.
-- This is NOT a midnight reconstruction or a historical return series.
create table neptune_v2_private.perth_daily_marks (
 day date primary key, at timestamptz not null, equity numeric(30,12) not null check(equity>0 and equity<1000000000),
 history_seq bigint not null, source_revision bigint not null
);
alter table neptune_v2_private.perth_daily_marks enable row level security;
revoke all on neptune_v2_private.perth_daily_marks from public,anon,authenticated,service_role;
create trigger immutable_rows before update or delete on neptune_v2_private.perth_daily_marks for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.perth_daily_marks for each statement execute function neptune_v2_private.immutable();
create function neptune_v2_private.perth_daily_performance(report jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 and not exists(select 1 from neptune_v2_private.settlements st where l.id=md5('settlecash'||st.exit_fill_id) and (st.payload->>'cash_delta_base')::numeric=l.delta)) into unknown_flow;
 end if;
 reason:=case when mark.day is null then 'Awaiting first valid equity observation today' when not good then 'Current equity observation missing or stale' when t<mark.at then 'Observation predates daily baseline' when unknown_flow then 'Unclassified cash movement; daily return unavailable' end;
 out:=jsonb_build_object('timezone','Australia/Perth','day',d,'coverage','since_first_observation','baseline_at',mark.at,'baseline_equity',mark.equity,
 'source_revision',rev,'observed_at',case when good then t end,'current_equity',case when good then v end,
 'status',case when reason is null then 'available' else 'unavailable' end,'reason',reason,
 'net_external_flows',case when mark.day is not null and not unknown_flow then 0 end,
 'net_pnl',case when reason is null then v-mark.equity end,'pct',case when reason is null then (v-mark.equity)/mark.equity*100 end);
 return out;
end$$;
revoke all on function neptune_v2_private.perth_daily_performance(jsonb) from public,anon,authenticated,service_role;
