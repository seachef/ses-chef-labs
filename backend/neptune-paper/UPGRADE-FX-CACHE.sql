-- Guarded routine daily-reference cache compatibility fix; build6 -> build7.
-- Existing running/stopped state, epoch, receipts, quarantines and data remain unchanged.
-- Only existing feed_work definition and append-only build metadata are modified.
begin;
set local lock_timeout='5s';set local statement_timeout='15s';
select 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
select 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
do $$begin
 if (select count(*) from public.neptune_paper_v2_control where id='neptune-paper-v2')<>1 or (select count(*) from neptune_v2_private.account where id='neptune-paper-v2')<>1 then raise exception 'Existing control/account singleton required';end if;
 if not exists(select 1 from neptune_v2_private.build_metadata where id=6 and source_hash='027544eb165e7b705302b4a48ad6fdc7d58602bb6ff3852829ad57f9982501be' and config_hash='00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8') or (select id from neptune_v2_private.build_metadata order by id desc limit 1)<>6 then raise exception 'Exact reviewed build6 metadata required';end if;
 if (select md5(prosrc) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) is distinct from 'd4db40c9cf7fb86e06e4e6289f61b563' then raise exception 'Exact reviewed build6 feed_work required';end if;
 if (select prosecdef or not coalesce('search_path=""'=any(proconfig),false) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) then raise exception 'Existing invoker/search_path contract required';end if;
 if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='neptune_v2_private.feed_work()'::regprocedure and a.grantee in(0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Existing feed_work client access drift';end if;
end$$;
-- Build7 overlay on exact build6: daily ECB HTTP Age/Date policy only.
-- No invocation, activation, credentials, grants, receipt rewriting or account changes.
create or replace function neptune_v2_private.feed_work() returns void language plpgsql security invoker set search_path='' as $$
declare c neptune_v2_private.feed_control;ac neptune_v2_private.account;n timestamptz:=clock_timestamp();epoch bigint;req record;resp record;
 markets jsonb:='{}';m jsonb;parsed jsonb;fx jsonb;meta jsonb;scan jsonb;arr jsonb:='[]';a text;k text;url text;rid bigint;evidence jsonb;httpdate text;httpage text;cache_age_limit int;rawbytes bigint:=0;outcome text:='processed';ready int;expected int;ownbytes bigint;logbytes bigint;logrows bigint;legacy_arr jsonb;native_tick jsonb;native_snapshot jsonb;native_state jsonb;native_control neptune_mv_private.control;native_ready int;native_expected int;provider text;receipt jsonb;lower_time timestamptz;observed_time timestamptz;
begin
 -- Global lock order: owner control, account, collector state.
 perform neptune_v2_private.sync_control();
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 select * into c from neptune_v2_private.feed_control where id for update;
 if not found then return;end if;
 -- Preserve lock order: owner/account/legacy-feed/native-feed. Only synchronize existing control.
 select * into native_control from neptune_mv_private.control where id for update;
 update neptune_mv_private.control set enabled=coalesce((ac.state->>'enabled')::boolean,false) and not terminal where id and enabled is distinct from (coalesce((ac.state->>'enabled')::boolean,false) and not terminal);
 -- Check absolute and attempted-work limits BEFORE any response parse/network work.
 update neptune_v2_private.feed_control set ticks=ticks+1 where id;
 select coalesce(sum(pg_total_relation_size(cl.oid)),0) into ownbytes from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where cl.relkind in ('r','m') and (ns.nspname in ('neptune_v2_private','neptune_mv_private') or (ns.nspname='public' and cl.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control')));
 select count(*),coalesce(sum(pg_column_size(j)),0) into logrows,logbytes from cron.job_run_details j where j.jobid=c.job_id;
 if ownbytes>=33554432 then update neptune_v2_private.account set state=state||jsonb_build_object('entry_capacity_paused',true) where id='neptune-paper-v2';end if;
 if c.terminal or n<c.started_at or ownbytes>=41943040 or logrows>=32000 or logbytes>=16777216 or coalesce((ac.state->>'capacity_paused')::boolean,false) then update neptune_mv_private.control set terminal=true,enabled=false,reason='parent_capacity_or_terminal' where id;perform neptune_v2_private.feed_stop();return;end if;
 if not c.contract_verified then perform neptune_v2_private.feed_stop();return;end if;
 if c.pending_epoch is not null and c.pending_control_epoch is distinct from (ac.state->>'control_epoch')::bigint then
  select count(*) into expected from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch;
  select count(*) into ready from neptune_v2_private.feed_requests q join net._http_response r on r.id=q.request_id where q.epoch=c.pending_epoch;
  insert into neptune_v2_private.feed_events values(c.pending_epoch,n,'control_changed',0,null,ready<expected);
  update neptune_v2_private.feed_control set pending_epoch=null,pending_control_epoch=null,pending_at=null where id;
  c.pending_epoch:=null;
 end if;
 if not coalesce((ac.state->>'enabled')::boolean,false) then return;end if;
 -- Capture already-visible responses before either side's partial-batch early return.
 perform neptune_mv_private.observe_pending('legacy',c.pending_epoch);
 select * into native_control from neptune_mv_private.control where id;
 if found then perform neptune_mv_private.observe_pending('native',native_control.pending_epoch);end if;
 n:=clock_timestamp();
 if c.pending_epoch is not null then
  select count(*) into expected from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch;
  select count(*) into ready from neptune_v2_private.feed_requests q join net._http_response r on r.id=q.request_id where q.epoch=c.pending_epoch;
  if ready=expected or n>=c.pending_at+interval '15 seconds' then
   -- Native requests are queued before legacy, so their deadline cannot exceed this one.
   select * into native_control from neptune_mv_private.control where id;
   if found and native_control.pending_epoch is not null and not native_control.terminal then
    select count(*) into native_expected from neptune_mv_private.requests nr where nr.epoch=native_control.pending_epoch;
    select count(*) into native_ready from neptune_mv_private.requests nr join net._http_response rs on rs.id=nr.request_id where nr.epoch=native_control.pending_epoch;
    if native_ready<native_expected and n<native_control.pending_at+interval '15 seconds' and n<c.pending_at+interval '15 seconds' then return;end if;
   end if;
   perform neptune_v2_private.shared_provider_preflight(c.pending_epoch,n);
   native_tick:=neptune_mv_private.tick((ac.state->>'control_epoch')::bigint);
   native_snapshot:=native_tick->'snapshot';native_state:=neptune_v2_private.native_feed_state()||coalesce(native_tick-'snapshot','{}'::jsonb);
   meta:=c.metadata_cache;fx:=c.fx_cache;
   foreach a in array neptune_v2_private.legacy_feed_universe() loop markets:=markets||jsonb_build_object(a,jsonb_build_object('asset',a));end loop;
   for req in select * from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch order by kind,asset loop
    begin
     receipt:=neptune_mv_private.observe_response('legacy',req.request_id);
     if receipt is null then continue;end if;
     select * into resp from jsonb_populate_record(null::net._http_response,receipt->'response');
     lower_time:=(receipt->>'sample_lower_bound')::timestamptz;observed_time:=(receipt->>'first_observed_at')::timestamptz;
     if observed_time>n then continue;end if;
     provider:=case req.kind when 'fx' then 'frankfurter' else 'kraken' end;
     if exists(select 1 from neptune_mv_private.control where id and provider_blocked?provider) then continue;end if;
     rawbytes:=rawbytes+coalesce(octet_length(resp.content),0);
     if resp.status_code<>200 or coalesce(resp.timed_out,false) or resp.error_msg is not null or lower_time<req.sent_at or lower_time>req.sent_at+interval '10 seconds' or lower_time>n or lower_time< n-interval '30 seconds' or observed_time<lower_time or coalesce(resp.content_type,'') not ilike 'application/json%' then continue;end if;
     -- Daily ECB reference caching follows the existing 96h reference-date policy.
     -- fetched_at stays the conservative receipt bound; live-market/metadata limits are unchanged.
     cache_age_limit:=case when req.kind='fx' then 345600 when req.kind='metadata' then 3600 when req.kind='bars' then 60 else 5 end;
     httpdate:=coalesce(resp.headers->>'date',resp.headers->>'Date');httpage:=coalesce(resp.headers->>'age',resp.headers->>'Age');
     if httpdate is not null and (neptune_v2_private.ts(httpdate) is null or neptune_v2_private.ts(httpdate)<req.sent_at-make_interval(secs=>cache_age_limit) or neptune_v2_private.ts(httpdate)>observed_time+interval '5 seconds') then continue;end if;
     if httpage is not null and (neptune_v2_private.num(httpage) is null or neptune_v2_private.num(httpage)>cache_age_limit) then continue;end if;
     parsed:=neptune_v2_private.feed_parse_bounded(req.kind,req.asset,resp.content,lower_time,n,observed_time);
     if parsed is null then continue;end if;
     evidence:=jsonb_build_object('source',req.request_url,'request_id',req.request_id,'sent_at',req.sent_at,'received_at',lower_time,'received_at_basis','conservative_sample_lower_bound','batch_started_at',resp.created,'first_observed_at',observed_time,'wire_received_at',null,'request_sha256',receipt->>'request_sha256','response_sha256',receipt->>'response_sha256','http_date',httpdate,'http_age',httpage,'body_sha256',encode(sha256(convert_to(resp.content,'UTF8')),'hex'));
     if req.kind='metadata' then
      foreach a in array neptune_v2_private.legacy_feed_universe() loop if parsed?a then parsed:=jsonb_set(parsed,array[a],parsed->a||jsonb_build_object('feed_evidence',evidence));end if;end loop;
     elsif req.kind='fx' then parsed:=parsed||jsonb_build_object('feed_evidence',evidence);
     else markets:=jsonb_set(markets,array[req.asset,'feed_evidence'],coalesce(markets#>array[req.asset,'feed_evidence'],'{}'::jsonb)||jsonb_build_object(req.kind,evidence));end if;
     if req.kind='metadata' then meta:=parsed;update neptune_v2_private.feed_control set metadata_cache=parsed where id;elsif req.kind='fx' then fx:=parsed;update neptune_v2_private.feed_control set fx_cache=parsed where id;else markets:=jsonb_set(markets,array[req.asset],markets->req.asset||parsed);end if;
    exception when others then null;end;
   end loop;
   update neptune_v2_private.feed_control set bytes_seen=bytes_seen+rawbytes,pending_epoch=null,pending_control_epoch=null,pending_at=null where id;
   foreach a in array neptune_v2_private.legacy_feed_universe() loop m:=markets->a;if meta?a then m:=m||jsonb_build_object('metadata',meta->a);end if;arr:=arr||jsonb_build_array(m);end loop;
   -- Exactly one trusted scan. Native preflight already applied before legacy parsing.
   legacy_arr:=arr;
   if native_snapshot is not null and native_snapshot<>'null'::jsonb and (native_snapshot->>'owner_epoch')::bigint=(ac.state->>'control_epoch')::bigint then
    arr:=arr||coalesce(native_snapshot->'markets','[]'::jsonb);
   end if;
   if native_state#>'{provider_blocked}'?'frankfurter' then fx:=null;end if;
   scan:=jsonb_build_object('at',clock_timestamp(),'markets',arr,'fx',fx,'quote_fx',coalesce(native_snapshot->'quote_fx','{}'::jsonb),'native_feed',native_state);
   if jsonb_array_length(arr)>8 or octet_length(scan::text)>131072 then
    -- Oversized native evidence cannot suppress bounded legacy protective exits.
    native_state:=native_state||jsonb_build_object('snapshot_rejected',true,'feed_terminal',true,'entry_capacity_paused',true,'reason','native_snapshot_oversize');
    scan:=jsonb_build_object('at',clock_timestamp(),'markets',legacy_arr,'fx',fx,'quote_fx','{}'::jsonb,'native_feed',native_state);outcome:='native_snapshot_oversize';
   end if;
   if octet_length(scan::text)>131072 then outcome:='snapshot_oversize';else
    begin perform neptune_v2_private.process_scan(scan);exception when others then outcome:='core_rejected';end;
   end if;
   insert into neptune_v2_private.feed_events values(c.pending_epoch,n,outcome,rawbytes,md5(scan::text),ready<expected);
   if exists(select 1 from neptune_v2_private.account where id='neptune-paper-v2' and coalesce((state->>'capacity_paused')::boolean,false)) then perform neptune_v2_private.feed_stop();return;end if;
  else return;end if;
 end if;
 epoch:=floor(extract(epoch from n)/60)::bigint;
 -- Persistent epoch survives Stop/Resume; never dispatch twice within one minute.
 if c.last_epoch is not null and (epoch<=c.last_epoch or n<c.last_dispatch_at+interval '60 seconds') then return;end if;
 -- An unresolved older request cannot silently accumulate across batches.
 if exists(select 1 from neptune_v2_private.feed_events where feed_events.epoch=c.last_epoch and missing_responses) then perform neptune_v2_private.shared_provider_preflight(c.last_epoch,n);end if;
 -- Consume owner-fenced abandoned native data only; never discard a current-owner snapshot.
 select * into native_control from neptune_mv_private.control where id;
 if found and native_control.pending_epoch is not null and native_control.pending_owner_epoch is distinct from (ac.state->>'control_epoch')::bigint then
  perform neptune_mv_private.collect((ac.state->>'control_epoch')::bigint);
 end if;
 select * into native_control from neptune_mv_private.control where id;
 if found and native_control.pending_epoch is null then
  -- At this point tick cannot consume a snapshot; it can only dispatch the parallel native batch.
  native_tick:=neptune_mv_private.tick((ac.state->>'control_epoch')::bigint);
 end if;
 n:=clock_timestamp();epoch:=floor(extract(epoch from n)/60)::bigint;
 update neptune_v2_private.feed_control set last_epoch=epoch,last_dispatch_at=n,pending_epoch=epoch,pending_control_epoch=(ac.state->>'control_epoch')::bigint,pending_at=n,batches=batches+1 where id;
 foreach k in array array['metadata','fx','depth','bars','trade'] loop
  provider:=case k when 'fx' then 'frankfurter' else 'kraken' end;
  if exists(select 1 from neptune_mv_private.control where id and provider_blocked?provider) then continue;end if;
  if k='metadata' and neptune_v2_private.fresh(c.metadata_cache#>>'{ETH/USD,at}',n,3600) then continue;end if;
  if k='fx' and neptune_v2_private.fresh(c.fx_cache->>'fetched_at',n,900) then continue;end if;
  foreach a in array (case when k in ('metadata','fx') then array[''] else neptune_v2_private.legacy_feed_universe() end) loop
   rid:=null;url:=neptune_v2_private.feed_url(k,a);
   if k='bars' then url:=url||'&since='||((epoch*60/900)*900-86400)::text;end if;
   begin
    rid:=net.http_get(url:=url,params:='{}'::jsonb,headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=5000);
   exception when others then null;end;
   insert into neptune_v2_private.feed_requests values(epoch,k,a,rid,n,url);
  end loop;
 end loop;
end$$;

do $$begin
 if (select md5(prosrc) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) is distinct from 'c1d0d2f30eefa4e949b83cde7918fc1b' then raise exception 'Replacement body mismatch';end if;
 if (select prosecdef or not coalesce('search_path=""'=any(proconfig),false) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) then raise exception 'Replacement security contract mismatch';end if;
end$$;
insert into neptune_v2_private.build_metadata(id,source_hash,config_hash,recorded_at) values(7,'3442f60da93c2b51c584471fd999d21a9c2aacd43b9d43158b5867b1f5d6955b','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',clock_timestamp());
commit;
