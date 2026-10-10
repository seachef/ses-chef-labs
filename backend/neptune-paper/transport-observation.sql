-- pg_net 0.20.4 created is worker-transaction start, not precise HTTP receipt.
-- Persist the first database observation AFTER reading each visible response.
-- No endpoint calls, grants, response-table changes, or mutable receipt restamping.
create table neptune_mv_private.response_observations(
 request_id bigint primary key,
 origin text not null check(origin in('legacy','native')),
 epoch bigint not null,
 sent_at timestamptz not null,
 batch_started_at timestamptz,
 sample_lower_bound timestamptz,
 first_observed_at timestamptz not null,
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 response_sha256 text not null check(response_sha256 ~ '^[a-f0-9]{64}$'),
 -- Invalid intervals are retained too, so a rejected future/null timestamp cannot mature on retry.
 check((sample_lower_bound is null)=(batch_started_at is null)),
 check(sample_lower_bound is null or sample_lower_bound=greatest(sent_at,batch_started_at))
);
alter table neptune_mv_private.response_observations enable row level security;
create trigger immutable before update or delete on neptune_mv_private.response_observations for each row execute function neptune_mv_private.immutable();
create trigger immutable_truncate before truncate on neptune_mv_private.response_observations for each statement execute function neptune_mv_private.immutable();

create function neptune_mv_private.observe_response(source_origin text,response_id bigint) returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare request_row jsonb;response_row net._http_response;seen neptune_mv_private.response_observations;
 ep bigint;sent timestamptz;lower_time timestamptz;observed timestamptz;request_hash text;response_hash text;
begin
 if source_origin='legacy' then
  select to_jsonb(q),q.epoch,q.sent_at into request_row,ep,sent from neptune_v2_private.feed_requests q where q.request_id=response_id;
 elsif source_origin='native' then
  select to_jsonb(q),q.epoch,q.sent_at into request_row,ep,sent from neptune_mv_private.requests q where q.request_id=response_id;
 else return null;end if;
 if request_row is null then return null;end if;
 select * into response_row from net._http_response where id=response_id;
 if not found then return null;end if;
 -- This clock is deliberately after the response SELECT, not at function entry.
 observed:=clock_timestamp();
 lower_time:=case when response_row.created is not null then greatest(sent,response_row.created) end;
 request_hash:=encode(sha256(convert_to(request_row::text,'UTF8')),'hex');
 response_hash:=encode(sha256(convert_to(to_jsonb(response_row)::text,'UTF8')),'hex');
 insert into neptune_mv_private.response_observations(request_id,origin,epoch,sent_at,batch_started_at,sample_lower_bound,first_observed_at,request_sha256,response_sha256)
 values(response_id,source_origin,ep,sent,response_row.created,lower_time,observed,request_hash,response_hash)
 on conflict(request_id) do nothing;
 select * into seen from neptune_mv_private.response_observations where request_id=response_id;
 if seen.origin is distinct from source_origin or seen.epoch is distinct from ep or seen.sent_at is distinct from sent
 or seen.batch_started_at is distinct from response_row.created or seen.sample_lower_bound is distinct from lower_time
 or seen.request_sha256 is distinct from request_hash or seen.response_sha256 is distinct from response_hash
 or seen.first_observed_at>observed or seen.batch_started_at is null or seen.sample_lower_bound is null
 or seen.sample_lower_bound>seen.first_observed_at then return null;end if;
 return jsonb_build_object('response',to_jsonb(response_row),'sample_lower_bound',seen.sample_lower_bound,
 'batch_started_at',seen.batch_started_at,'first_observed_at',seen.first_observed_at,
 'response_sha256',seen.response_sha256,'request_sha256',seen.request_sha256,
 'wire_received_at',null,'timestamp_basis','pg_net_batch_start_to_first_database_observation');
end$$;

create function neptune_mv_private.observe_pending(source_origin text,batch_epoch bigint) returns void language plpgsql volatile security invoker set search_path='' as $$
declare response_id bigint;
begin
 if batch_epoch is null then return;end if;
 if source_origin='legacy' then
  for response_id in select q.request_id from neptune_v2_private.feed_requests q where q.epoch=batch_epoch and q.request_id is not null order by case when q.kind='metadata' then 0 else 1 end,q.kind,q.asset loop
   perform neptune_mv_private.observe_response(source_origin,response_id);
  end loop;
 elsif source_origin='native' then
  for response_id in select q.request_id from neptune_mv_private.requests q where q.epoch=batch_epoch and q.request_id is not null order by case when q.kind='metadata' then 0 else 1 end,q.kind,q.venue loop
   perform neptune_mv_private.observe_response(source_origin,response_id);
  end loop;
 end if;
end$$;
revoke all on table neptune_mv_private.response_observations from public,anon,authenticated,service_role;
revoke all on function neptune_mv_private.observe_response(text,bigint),neptune_mv_private.observe_pending(text,bigint) from public,anon,authenticated,service_role;
