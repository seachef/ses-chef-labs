-- LOCAL-ONLY CANDIDATE. No extension creation, seed, grants, cron registration or activation.
-- Requires core.sql first. Existing pg_net/pg_cron contracts require separate live review.
create table neptune_v2_private.feed_control (
 id boolean primary key default true check(id),
 started_at timestamptz not null,
 contract_verified boolean not null default false,
 job_id bigint not null, job_owner text not null, job_database text not null,
 ticks bigint not null default 0, batches bigint not null default 0,
 bytes_seen bigint not null default 0, last_epoch bigint, last_dispatch_at timestamptz, pending_epoch bigint, pending_control_epoch bigint,
 pending_at timestamptz, terminal boolean not null default false,
 metadata_cache jsonb, fx_cache jsonb,
 check(coalesce(octet_length(metadata_cache::text),0)<=16384),
 check(coalesce(octet_length(fx_cache::text),0)<=4096)
);
create table neptune_v2_private.feed_requests (
 epoch bigint not null, kind text not null check(kind in ('metadata','fx','depth','bars','trade')),
 asset text not null, request_id bigint unique, sent_at timestamptz not null,
 request_url text not null check(length(request_url)<=256),
 primary key(epoch,kind,asset)
);
create table neptune_v2_private.feed_events (
 epoch bigint primary key, at timestamptz not null, outcome text not null,
 response_bytes bigint not null, snapshot_hash text, missing_responses boolean not null default false, check(length(outcome)<=32)
);
create trigger immutable_rows before update or delete on neptune_v2_private.feed_requests for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.feed_requests for each statement execute function neptune_v2_private.immutable();
create trigger immutable_rows before update or delete on neptune_v2_private.feed_events for each row execute function neptune_v2_private.immutable();
create trigger immutable_table before truncate on neptune_v2_private.feed_events for each statement execute function neptune_v2_private.immutable();
alter table neptune_v2_private.feed_control enable row level security;
alter table neptune_v2_private.feed_requests enable row level security;
alter table neptune_v2_private.feed_events enable row level security;

create function neptune_v2_private.feed_url(kind text,asset text) returns text language plpgsql immutable security invoker set search_path='' as $$
begin
 if kind='metadata' and asset='' then return 'https://api.kraken.com/0/public/AssetPairs?pair=ETHUSD,SOLUSD,AVAXUSD,LINKUSD,AAVEUSD,UNIUSD&assetVersion=1';end if;
 if kind='fx' and asset='' then return 'https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=AUD';end if;
 if asset is null or not(asset=any(neptune_v2_private.universe())) then return null;end if;
 return case kind when 'depth' then 'https://api.kraken.com/0/public/Depth?pair='||replace(asset,'/','')||'&count=10&assetVersion=1'
 when 'bars' then 'https://api.kraken.com/0/public/OHLC?pair='||replace(asset,'/','')||'&interval=15&assetVersion=1'
 when 'trade' then 'https://api.kraken.com/0/public/Trades?pair='||replace(asset,'/','')||'&count=1&assetVersion=1' end;
end$$;

create function neptune_v2_private.feed_parse(kind text,asset text,body text,received timestamptz,cutoff timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare j jsonb;r jsonb;v jsonb;p jsonb;out jsonb:='{}';arr jsonb:='[]';side text;t numeric;oldest timestamptz;updates jsonb:='{}';times jsonb;dt timestamptz;rate numeric;vol numeric:=0;cnt int:=0;previous numeric;a text;
begin
 if body is null or octet_length(body)>(case kind when 'bars' then 131072 when 'metadata' then 32768 when 'depth' then 32768 else 4096 end) or received>cutoff or received<cutoff-interval '30 seconds' then return null;end if;
 j:=body::jsonb;
 if kind='fx' then
  if jsonb_typeof(j)<>'array' or jsonb_array_length(j)<>1 then return null;end if;j:=j->0;
  if j->>'base' is distinct from 'USD' or j->>'quote' is distinct from 'AUD' or coalesce(j->>'date','')!~'^\d{4}-\d{2}-\d{2}$' then return null;end if;
  dt:=((j->>'date')||'T00:00:00Z')::timestamptz;rate:=neptune_v2_private.num(j->>'rate');
  if dt>cutoff or dt<cutoff-interval '96 hours' or rate is null or rate not between .1 and 10 then return null;end if;
  return jsonb_build_object('base','USD','quote','AUD','rate',rate,'rate_date',j->>'date','at',dt,'fetched_at',received,'source','Frankfurter ECB reference');
 end if;
 if j->'error' is distinct from '[]'::jsonb or jsonb_typeof(j->'result') is distinct from 'object' then return null;end if;
 r:=j->'result';
 if kind='metadata' then
  foreach a in array neptune_v2_private.universe() loop
   p:=r->a;
   if p->>'wsname'=a and p->>'altname'=replace(a,'/','') and p->>'base'=split_part(a,'/',1) and p->>'quote'='USD' and p->>'aclass_base'='currency' and p->>'aclass_quote'='currency' and p->>'status'='online' and p->>'lot'='unit' and neptune_v2_private.num(p->>'lot_multiplier')=1 and neptune_v2_private.num(p->>'ordermin')>0 and neptune_v2_private.num(p->>'costmin')>0 and neptune_v2_private.num(p->>'tick_size')>0 and neptune_v2_private.num(p->>'lot_decimals') between 0 and 12 and neptune_v2_private.num(p->>'lot_decimals')=floor(neptune_v2_private.num(p->>'lot_decimals')) then
    out:=out||jsonb_build_object(a,jsonb_build_object('asset',a,'venue','Kraken','kind','spot','quote','USD','status','online','at',received,'source','https://api.kraken.com/0/public/AssetPairs','min_qty',neptune_v2_private.num(p->>'ordermin'),'min_cost',neptune_v2_private.num(p->>'costmin'),'qty_decimals',neptune_v2_private.num(p->>'lot_decimals'),'tick_size',neptune_v2_private.num(p->>'tick_size')));
   end if;
  end loop;return out;
 end if;
 if asset is null or not(asset=any(neptune_v2_private.universe())) then return null;end if;p:=r->asset;
 if kind='depth' then
  foreach side in array array['bids','asks'] loop
   if jsonb_typeof(p->side) is distinct from 'array' or jsonb_array_length(p->side) not between 1 and 10 then return null;end if;arr:='[]';times:='[]';
   for v in select value from jsonb_array_elements(p->side) loop
    if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>3 then return null;end if;
    t:=neptune_v2_private.num(v->>2);if t is null or t<0 or t>extract(epoch from cutoff) then return null;end if;
    dt:=to_timestamp(t::double precision);
    -- Kraken level timestamps are last modifications, not snapshot observation times.
    oldest:=least(oldest,dt);times:=times||jsonb_build_array(dt);
    arr:=arr||jsonb_build_array(jsonb_build_array(neptune_v2_private.num(v->>0),neptune_v2_private.num(v->>1)));
   end loop;if jsonb_array_length(arr)=0 then return null;end if;out:=out||jsonb_build_object(side,arr);updates:=updates||jsonb_build_object(side,times);
  end loop;
  out:=out||jsonb_build_object('at',received,'timestamp_basis','http_response_observed','level_updated_at',updates,'oldest_level_update_at',oldest);
  if neptune_v2_private.book(jsonb_build_object('book',out,'received_at',received),cutoff)?'error' then return null;end if;
  return jsonb_build_object('book',out,'received_at',received);
 elsif kind='trade' then
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)<>1 or jsonb_array_length(p->0)<>7 or coalesce(neptune_v2_private.num(p#>>'{0,0}'),0)<=0 or coalesce(neptune_v2_private.num(p#>>'{0,1}'),0)<=0 then return null;end if;
  t:=neptune_v2_private.num(p#>>'{0,2}');-- Preserve genuine last-trade evidence; the unchanged core60s gate controls entry eligibility.
  if t is null or t<0 or t>extract(epoch from cutoff) then return null;end if;
  return jsonb_build_object('trade_at',to_timestamp(t::double precision));
 elsif kind='bars' then
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 23 and 720 then return null;end if;
  -- Retain only the final 96 completed intervals; never use Kraken's current mutable bar.
  for v in select value from jsonb_array_elements(p) loop
   if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>8 then return null;end if;
   t:=neptune_v2_private.num(v->>0);if t is null or t<>floor(t) or mod(t,900)<>0 then return null;end if;
   if t+900>extract(epoch from cutoff) then continue;end if;
   if t<floor(extract(epoch from cutoff)/900)*900-86400 then continue;end if;
   if previous is not null and t<>previous+900 then return null;end if;previous:=t;
   arr:=arr||jsonb_build_array(jsonb_build_object('t',t*1000,'o',neptune_v2_private.num(v->>1),'h',neptune_v2_private.num(v->>2),'l',neptune_v2_private.num(v->>3),'c',neptune_v2_private.num(v->>4),'v',neptune_v2_private.num(v->>6)));
   if neptune_v2_private.num(v->>5) is null or neptune_v2_private.num(v->>6) is null then return null;end if;
   vol:=vol+neptune_v2_private.num(v->>5)*neptune_v2_private.num(v->>6);cnt:=cnt+1;
  end loop;
  if neptune_v2_private.bars(jsonb_build_object('bars',arr),cutoff)?'error' then return null;end if;
  select jsonb_agg(value order by ord) into arr from jsonb_array_elements(arr) with ordinality e(value,ord) where ord>jsonb_array_length(arr)-22;
  return jsonb_build_object('bars',arr,'volume_24h_usd',case when cnt=96 then vol else null end);
 end if;return null;
exception when others then return null;
end$$;

create function neptune_v2_private.feed_stop() returns void language plpgsql security invoker set search_path='' as $$
declare c neptune_v2_private.feed_control;begin
 perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
 select * into c from neptune_v2_private.feed_control where id;
 update neptune_v2_private.feed_control set terminal=true where id;
 update neptune_v2_private.account set state=state||'{"enabled":false,"capacity_paused":true}'::jsonb where id='neptune-paper-v2';
 begin perform neptune_v2_private.publish_terminal('capacity_paused','Bounded public-feed experiment ended; history retained and virtual exposure frozen');perform neptune_v2_private.publish_control_ack();exception when query_canceled or others then null;end;
 -- All identifiers must match. Never remove foreign jobs and never purge logs/data.
 if exists(select 1 from cron.job where jobid=c.job_id and jobname='neptune-v2-feed-guard' and username=c.job_owner and database=c.job_database and command='set statement_timeout=''8s''; select neptune_v2_private.feed_tick();') then
  begin perform cron.alter_job(c.job_id,active:=false);exception when others then
   begin perform cron.unschedule(c.job_id);exception when others then null;end;
  end;
 end if;
end$$;

create function neptune_v2_private.feed_work() returns void language plpgsql security invoker set search_path='' as $$
declare c neptune_v2_private.feed_control;ac neptune_v2_private.account;n timestamptz:=clock_timestamp();epoch bigint;req record;resp record;
 markets jsonb:='{}';m jsonb;parsed jsonb;fx jsonb;meta jsonb;scan jsonb;arr jsonb:='[]';a text;k text;url text;rid bigint;evidence jsonb;httpdate text;httpage text;cache_age_limit int;rawbytes bigint:=0;outcome text:='processed';ready int;expected int;ownbytes bigint;logbytes bigint;logrows bigint;
begin
 -- Global lock order: owner control, account, collector state.
 perform neptune_v2_private.sync_control();
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2' for update;
 select * into c from neptune_v2_private.feed_control where id for update;
 if not found then return;end if;
 -- Check absolute and attempted-work limits BEFORE any response parse/network work.
 update neptune_v2_private.feed_control set ticks=ticks+1 where id;
 select coalesce(sum(pg_total_relation_size(cl.oid)),0) into ownbytes from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where cl.relkind in ('r','m') and (ns.nspname='neptune_v2_private' or (ns.nspname='public' and cl.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control')));
 select count(*),coalesce(sum(pg_column_size(j)),0) into logrows,logbytes from cron.job_run_details j where j.jobid=c.job_id;
 if ownbytes>=33554432 then update neptune_v2_private.account set state=state||jsonb_build_object('entry_capacity_paused',true) where id='neptune-paper-v2';end if;
 if c.terminal or n<c.started_at or ownbytes>=41943040 or logrows>=32000 or logbytes>=16777216 or coalesce((ac.state->>'capacity_paused')::boolean,false) then perform neptune_v2_private.feed_stop();return;end if;
 if not c.contract_verified then perform neptune_v2_private.feed_stop();return;end if;
 if c.pending_epoch is not null and c.pending_control_epoch is distinct from (ac.state->>'control_epoch')::bigint then
  select count(*) into expected from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch;
  select count(*) into ready from neptune_v2_private.feed_requests q join net._http_response r on r.id=q.request_id where q.epoch=c.pending_epoch;
  insert into neptune_v2_private.feed_events values(c.pending_epoch,n,'control_changed',0,null,ready<expected);
  update neptune_v2_private.feed_control set pending_epoch=null,pending_control_epoch=null,pending_at=null where id;
  c.pending_epoch:=null;
 end if;
 if not coalesce((ac.state->>'enabled')::boolean,false) then return;end if;
 if c.pending_epoch is not null then
  select count(*) into expected from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch;
  select count(*) into ready from neptune_v2_private.feed_requests q join net._http_response r on r.id=q.request_id where q.epoch=c.pending_epoch;
  if ready=expected or n>=c.pending_at+interval '15 seconds' then
   meta:=c.metadata_cache;fx:=c.fx_cache;
   foreach a in array neptune_v2_private.universe() loop markets:=markets||jsonb_build_object(a,jsonb_build_object('asset',a));end loop;
   for req in select * from neptune_v2_private.feed_requests where feed_requests.epoch=c.pending_epoch order by kind,asset loop
    begin
     select * into resp from net._http_response where id=req.request_id;
     if not found then continue;end if;
     rawbytes:=rawbytes+coalesce(octet_length(resp.content),0);
     if resp.status_code<>200 or coalesce(resp.timed_out,false) or resp.error_msg is not null or resp.created<req.sent_at or resp.created>n or resp.created< n-interval '30 seconds' or coalesce(resp.content_type,'') not ilike 'application/json%' then continue;end if;
     cache_age_limit:=case when req.kind in ('metadata','fx') then 3600 when req.kind='bars' then 60 else 5 end;
     httpdate:=coalesce(resp.headers->>'date',resp.headers->>'Date');httpage:=coalesce(resp.headers->>'age',resp.headers->>'Age');
     if httpdate is not null and (neptune_v2_private.ts(httpdate) is null or neptune_v2_private.ts(httpdate)<req.sent_at-make_interval(secs=>cache_age_limit) or neptune_v2_private.ts(httpdate)>n+interval '5 seconds') then continue;end if;
     if httpage is not null and (neptune_v2_private.num(httpage) is null or neptune_v2_private.num(httpage)>cache_age_limit) then continue;end if;
     parsed:=neptune_v2_private.feed_parse(req.kind,req.asset,resp.content,resp.created,n);
     if parsed is null then continue;end if;
     evidence:=jsonb_build_object('source',req.request_url,'request_id',req.request_id,'sent_at',req.sent_at,'received_at',resp.created,'http_date',httpdate,'http_age',httpage,'body_sha256',encode(sha256(convert_to(resp.content,'UTF8')),'hex'));
     if req.kind='metadata' then
      foreach a in array neptune_v2_private.universe() loop if parsed?a then parsed:=jsonb_set(parsed,array[a],parsed->a||jsonb_build_object('feed_evidence',evidence));end if;end loop;
     elsif req.kind='fx' then parsed:=parsed||jsonb_build_object('feed_evidence',evidence);
     else markets:=jsonb_set(markets,array[req.asset,'feed_evidence'],coalesce(markets#>array[req.asset,'feed_evidence'],'{}'::jsonb)||jsonb_build_object(req.kind,evidence));end if;
     if req.kind='metadata' then meta:=parsed;update neptune_v2_private.feed_control set metadata_cache=parsed where id;elsif req.kind='fx' then fx:=parsed;update neptune_v2_private.feed_control set fx_cache=parsed where id;else markets:=jsonb_set(markets,array[req.asset],markets->req.asset||parsed);end if;
    exception when others then null;end;
   end loop;
   update neptune_v2_private.feed_control set bytes_seen=bytes_seen+rawbytes,pending_epoch=null,pending_control_epoch=null,pending_at=null where id;
   foreach a in array neptune_v2_private.universe() loop m:=markets->a;if meta?a then m:=m||jsonb_build_object('metadata',meta->a);end if;arr:=arr||jsonb_build_array(m);end loop;
   scan:=jsonb_build_object('at',n,'markets',arr,'fx',fx);
   if octet_length(scan::text)>65536 then outcome:='snapshot_oversize';else
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
 if exists(select 1 from neptune_v2_private.feed_events where feed_events.epoch=c.last_epoch and missing_responses) and exists(select 1 from neptune_v2_private.feed_requests q where q.epoch=c.last_epoch and q.request_id is not null and not exists(select 1 from net._http_response r where r.id=q.request_id)) then perform neptune_v2_private.feed_stop();return;end if;
 update neptune_v2_private.feed_control set last_epoch=epoch,last_dispatch_at=n,pending_epoch=epoch,pending_control_epoch=(ac.state->>'control_epoch')::bigint,pending_at=n,batches=batches+1 where id;
 foreach k in array array['metadata','fx','depth','bars','trade'] loop
  if k='metadata' and neptune_v2_private.fresh(c.metadata_cache#>>'{ETH/USD,at}',n,3600) then continue;end if;
  if k='fx' and neptune_v2_private.fresh(c.fx_cache->>'fetched_at',n,900) then continue;end if;
  foreach a in array (case when k in ('metadata','fx') then array[''] else neptune_v2_private.universe() end) loop
   rid:=null;url:=neptune_v2_private.feed_url(k,a);
   if k='bars' then url:=url||'&since='||((epoch*60/900)*900-86400)::text;end if;
   begin
    rid:=net.http_get(url:=url,params:='{}'::jsonb,headers:='{"Accept":"application/json"}'::jsonb,timeout_milliseconds:=5000);
   exception when others then null;end;
   insert into neptune_v2_private.feed_requests values(epoch,k,a,rid,n,url);
  end loop;
 end loop;
end$$;
-- Wrapper catches parse/runtime errors and statement cancellations; exceptions roll back
-- the failing work subtransaction, then persist terminal state outside that subtransaction.
create function neptune_v2_private.feed_tick() returns void language plpgsql security invoker set search_path='' as $$
begin
 begin perform neptune_v2_private.feed_work();
 exception when query_canceled or others then
  perform 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
 perform 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
  update neptune_v2_private.feed_control set terminal=true,ticks=ticks+1 where id;
  update neptune_v2_private.account set state=state||'{"enabled":false,"capacity_paused":true}'::jsonb where id='neptune-paper-v2';
  perform neptune_v2_private.feed_stop();
 end;
end$$;
revoke all on all tables in schema neptune_v2_private from public,anon,authenticated,service_role;
revoke all on all functions in schema neptune_v2_private from public,anon,authenticated,service_role;
