-- Uninstalled bounded worker-cache candidate. Requires exact owner-authorized release approval.
begin;
set local lock_timeout='250ms';
set local statement_timeout='10s';
do $gate$ declare actual text;expected_runtime text;begin
 if current_setting('neptune.worker_cache_release_approved',true) is distinct from 'on' then raise exception 'Explicit reviewed worker-cache release approval required';end if;
 if to_regnamespace('neptune_work_cache_private') is not null or to_regclass('neptune_v2_private.work_events') is not null or exists(select 1 from pg_attribute where attrelid='public.neptune_paper_v2_status'::regclass and attname='team_work' and not attisdropped) then raise exception 'Cache or original bridge exists; no reinstall or destructive conversion';end if;
 if exists(select 1 from pg_trigger where tgrelid='public.neptune_paper_v2_status'::regclass and not tgisinternal and tgname<>'neptune_research_v1') then raise exception 'Unexpected status trigger';end if;
 select md5(catalog::text) into actual from (select jsonb_build_object(
 'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname) from pg_namespace where nspname in ('neptune_v2_private','neptune_mv_private')),
 'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(proowner),'acl',proacl::text) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('neptune_v2_private','neptune_mv_private') or n.nspname='public' and p.proname like 'neptune_v2_%'),
 'tables',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',relkind,'owner',pg_get_userbyid(relowner),'acl',relacl::text,'rls',relrowsecurity,'force_rls',relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'notnull',attnotnull,'identity',attidentity,'generated',attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(pg_get_constraintdef(x.oid) order by conname) from pg_constraint x where conrelid=c.oid),
 'indexes',(select jsonb_agg(pg_get_indexdef(indexrelid) order by pg_get_indexdef(indexrelid)) from pg_index where indrelid=c.oid),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by tgname) from pg_trigger t where tgrelid=c.oid and not tgisinternal and tgname<>'neptune_work_cache_overlay'),
 'policies',(select jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,'roles',(select jsonb_agg(pg_get_userbyid(x) order by pg_get_userbyid(x)) from unnest(polroles) x),'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) from pg_policy where polrelid=c.oid)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','m','S') and (n.nspname in ('neptune_v2_private','neptune_mv_private') or n.nspname='public' and c.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control')))) as catalog
) c;
 select v.runtime into expected_runtime from (values ('ebb947a07dd579e567cdf84b97b2b3ae','027544eb165e7b705302b4a48ad6fdc7d58602bb6ff3852829ad57f9982501be')) v(catalog,runtime) where v.catalog=actual;
 if expected_runtime is null then raise exception 'Exact reviewed native027544 plus research catalog required; native must install first: %',actual;end if;
 if (select source_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from expected_runtime then raise exception 'Predecessor metadata mismatch';end if;
 if (select config_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8' then raise exception 'Config identity mismatch';end if;
 if (select pg_get_userbyid(relowner) from pg_class where oid='public.neptune_paper_v2_status'::regclass) is distinct from current_user then raise exception 'Existing owner role required';end if;
 if (select count(*) from public.neptune_paper_v2_status)<>1 or not exists(select 1 from public.neptune_paper_v2_status where id='neptune-paper-v2') then raise exception 'Exact status row required';end if;
 end $gate$;
-- DERIVED operational cache only. No financial/audit retention changes.
-- Same existing public row and SELECT audience; no grants, endpoint or engine-body changes.
alter table public.neptune_paper_v2_status add column team_work jsonb;
create schema neptune_work_cache_private;
revoke all on schema neptune_work_cache_private from public,anon,authenticated,service_role;
create function neptune_work_cache_private.now_at() returns timestamptz language sql volatile security invoker set search_path='' as $$select clock_timestamp()$$;
create function neptune_work_cache_private.payload_valid(p jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare n timestamptz:=neptune_work_cache_private.now_at();observed timestamptz;eid uuid;sid uuid;actor uuid;run uuid;handoff uuid;k text;step text;state text;role text;task text;sessionseq integer;runseq integer;candidate text;src jsonb;result jsonb;clean jsonb;bytes bigint;counted integer;rowid text;hash text;v text;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>4096 then raise exception 'Invalid work envelope';end if;
 if exists(select 1 from jsonb_object_keys(p) key where key<>all(array['id','session_id','session_seq','kind','observed_at','actor_id','role','run_id','run_seq','state','task','step','source','candidate_sha256','result','handoff_from_run_id'])) then raise exception 'Unknown work field';end if;
 if not(p ?& array['id','session_id','session_seq','kind','observed_at','actor_id','role','run_id','run_seq','state','task','step','source','candidate_sha256','result','handoff_from_run_id']) then raise exception 'Missing work field';end if;
 if jsonb_typeof(p->'id') is distinct from 'string' or jsonb_typeof(p->'session_id') is distinct from 'string' or p->>'id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or p->>'session_id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'Invalid work ID';end if;
 eid:=(p->>'id')::uuid;sid:=(p->>'session_id')::uuid;
 if jsonb_typeof(p->'session_seq') is distinct from 'number' or p->>'session_seq' !~ '^(0|[1-9][0-9]{0,9})$' then raise exception 'Invalid session sequence';end if;sessionseq:=(p->>'session_seq')::integer;
 if sessionseq>1000000000 then raise exception 'Sequence bound';end if;
 if jsonb_typeof(p->'observed_at') is distinct from 'string' or p->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then raise exception 'Invalid observation time';end if;observed:=(p->>'observed_at')::timestamptz;
 if observed>n then raise exception 'Future work observation';end if;
 k:=p->>'kind';step:=p->>'step';state:=p->>'state';role:=p->>'role';task:=p->>'task';candidate:=p->>'candidate_sha256';src:=p->'source';result:=p->'result';
 if k is null or k not in ('session_opened','publisher_heartbeat','session_closed','worker_event') then raise exception 'Invalid work kind';end if;
 if candidate is not null and (jsonb_typeof(p->'candidate_sha256') is distinct from 'string' or candidate !~ '^[a-f0-9]{64}$') then raise exception 'Invalid candidate digest';end if;
 if k<>'worker_event' then
  if step is distinct from (case k when 'session_opened' then 'session_started' when 'publisher_heartbeat' then 'publisher_heartbeat' else 'session_closed' end) or exists(select 1 from jsonb_each(p) e where e.key=any(array['actor_id','role','run_id','run_seq','state','task','source','candidate_sha256','result','handoff_from_run_id']) and e.value<>'null'::jsonb) then raise exception 'Session event contains worker fields';end if;
 else
  if p->>'actor_id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or p->>'run_id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' or jsonb_typeof(p->'actor_id') is distinct from 'string' or jsonb_typeof(p->'run_id') is distinct from 'string' then raise exception 'Invalid worker identity';end if;
  actor:=(p->>'actor_id')::uuid;run:=(p->>'run_id')::uuid;
  if role not in ('builder','tester','reviewer') or role is null or state not in ('running','blocked','completed','failed') or state is null or task not in ('team_work','frontend','backend','public_feeds','paper_engine','accessibility') or task is null then raise exception 'Invalid worker classification';end if;
  if step is null or step not in ('task_started','status_observed','source_inspected','source_changed','tests_started','tests_passed','tests_failed','review_started','review_passed','review_changes_requested','waiting_for_review','blocked','task_completed','task_failed') then raise exception 'Invalid worker step';end if;
  if jsonb_typeof(p->'run_seq') is distinct from 'number' or p->>'run_seq' !~ '^(0|[1-9][0-9]{0,9})$' then raise exception 'Invalid run sequence';end if;runseq:=(p->>'run_seq')::integer;
  if runseq>1000000000 then raise exception 'Sequence bound';end if;
  if p->'handoff_from_run_id'<>'null'::jsonb then if jsonb_typeof(p->'handoff_from_run_id') is distinct from 'string' or p->>'handoff_from_run_id' !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then raise exception 'Invalid handoff ID';end if;handoff:=(p->>'handoff_from_run_id')::uuid;end if;
  if src<>'null'::jsonb then
   if jsonb_typeof(src) is distinct from 'object' or not(src ?& array['repository','scope','path','function_name','commit','file_sha256','snippet_sha256']) or (select count(*) from jsonb_object_keys(src))<>7 then raise exception 'Invalid source fields';end if;
   if src->>'repository' is distinct from 'seachef/ses-chef-labs' or src->>'scope' is null or src->>'scope' not in ('published_reference','candidate') then raise exception 'Invalid source repository or scope';end if;
   if jsonb_typeof(src->'path') is distinct from 'string' or length(src->>'path')>160 or src->>'path' !~ '^(preview/research-desk/[a-z0-9-]+\.(mjs|html|css)|backend/neptune-paper/[a-z0-9-]+\.(sql|json|py)|backend/neptune-paper/test/[a-z0-9-]+\.test\.mjs)$' then raise exception 'Invalid public source path';end if;
   if jsonb_typeof(src->'function_name') is distinct from 'string' or length(src->>'function_name')>100 or src->>'function_name' !~ '^[a-zA-Z_][a-zA-Z0-9_.]*$' then raise exception 'Invalid source function';end if;
   if jsonb_typeof(src->'file_sha256') is distinct from 'string' or src->>'file_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid source digest';end if;
   if src->>'scope'='published_reference' and (jsonb_typeof(src->'commit') is distinct from 'string' or src->>'commit' !~ '^[a-f0-9]{40}$') or src->>'scope'='candidate' and src->'commit'<>'null'::jsonb then raise exception 'Invalid source commit';end if;
   if src->'snippet_sha256'<>'null'::jsonb and (jsonb_typeof(src->'snippet_sha256') is distinct from 'string' or src->>'snippet_sha256' !~ '^[a-f0-9]{64}$') then raise exception 'Invalid snippet digest';end if;
  end if;
  if step='source_changed' and (src='null'::jsonb or candidate is null or src->>'scope'<>'candidate') then raise exception 'Changed source requires candidate identity';end if;
  if result<>'null'::jsonb then
   if jsonb_typeof(result) is distinct from 'object' or not(result ?& array['kind','verdict','target_sha256','artifact_sha256','command_id','passed','failed','exit_code']) or (select count(*) from jsonb_object_keys(result))<>8 then raise exception 'Invalid result fields';end if;
   if state not in ('completed','failed') or (step in ('tests_passed','review_passed','review_changes_requested') and state<>'completed') or (step='tests_failed' and state<>'failed') then raise exception 'Outcome requires terminal worker state';end if;
   if candidate is null or result->>'target_sha256' is distinct from candidate or jsonb_typeof(result->'artifact_sha256') is distinct from 'string' or result->>'artifact_sha256' !~ '^[a-f0-9]{64}$' then raise exception 'Result candidate mismatch';end if;
   if result->>'kind'='test' then
    if step not in ('tests_passed','tests_failed') or result->>'verdict' is distinct from (case step when 'tests_passed' then 'passed' else 'failed' end) or result->>'command_id' is null or result->>'command_id' not in ('frontend_tests','backend_tests','bridge_tests','syntax_checks') then raise exception 'Invalid test classification';end if;
    foreach v in array array['passed','failed'] loop if jsonb_typeof(result->v) is distinct from 'number' or result->>v !~ '^(0|[1-9][0-9]{0,5})$' then raise exception 'Invalid test count';end if;end loop;
    if jsonb_typeof(result->'exit_code') is distinct from 'number' or result->>'exit_code' !~ '^(0|[1-9][0-9]{0,9})$' or (result->>'exit_code')::integer>255 then raise exception 'Invalid test exit';end if;
    if step='tests_passed' and ((result->>'failed')::integer<>0 or (result->>'exit_code')::integer<>0) or step='tests_failed' and (result->>'exit_code')::integer=0 then raise exception 'Contradictory test outcome';end if;
   elsif result->>'kind'='review' then
    if role<>'reviewer' or step not in ('review_passed','review_changes_requested') or result->>'verdict' is distinct from (case step when 'review_passed' then 'passed' else 'changes_requested' end) or result->'command_id'<>'null'::jsonb or result->'passed'<>'null'::jsonb or result->'failed'<>'null'::jsonb or result->'exit_code'<>'null'::jsonb then raise exception 'Invalid review outcome';end if;
   else raise exception 'Invalid result kind';end if;
  elsif step in ('tests_passed','tests_failed','review_passed','review_changes_requested') then raise exception 'Outcome needs evidence';end if;
  if state='blocked' and step not in ('blocked','waiting_for_review') or state='failed' and step not in ('task_failed','tests_failed') or state='completed' and step not in ('task_completed','tests_passed','review_passed','review_changes_requested') or state='running' and step in ('blocked','waiting_for_review','task_completed','task_failed') then raise exception 'Contradictory worker state';end if;
 end if;
 return true;
exception when others then return false;
end$$;
revoke all on function neptune_work_cache_private.payload_valid(jsonb) from public,anon,authenticated,service_role;


create table neptune_work_cache_private.publisher (
 id boolean primary key default true check(id), generation bigint not null default 0 check(generation>=0), revision bigint not null default 0 check(revision>=0),
 session_id uuid, state text not null default 'absent' check(state in ('absent','open','closed')),
 observed_at timestamptz, received_at timestamptz, last_id uuid, last_hash text, changes bigint not null default 0, recent_seq bigint not null default 0
);
insert into neptune_work_cache_private.publisher(id) values(true);
create table neptune_work_cache_private.workers (
 slot integer primary key check(slot between 1 and 6), session_generation bigint not null default 0, run_generation bigint not null default 0, revision bigint not null default 0,
 actor_id uuid, run_id uuid, state text check(state in ('running','blocked','completed','failed')), observed_at timestamptz, received_at timestamptz,
 last_id uuid, last_hash text, payload jsonb check(payload is null or jsonb_typeof(payload)='object' and octet_length(payload::text)<=4096)
);
insert into neptune_work_cache_private.workers(slot) select generate_series(1,6);
create table neptune_work_cache_private.recent (
 slot integer primary key check(slot between 0 and 7), event_number bigint, session_generation bigint, run_generation bigint, worker_slot integer,
 received_at timestamptz, payload_sha256 text, payload jsonb check(payload is null or jsonb_typeof(payload)='object' and octet_length(payload::text)<=4096)
);
insert into neptune_work_cache_private.recent(slot) select generate_series(0,7);
create table neptune_work_cache_private.snapshot (
 id boolean primary key default true check(id), revision bigint not null default -1, payload jsonb check(payload is null or jsonb_typeof(payload)='object' and octet_length(payload::text)<=16384)
);
insert into neptune_work_cache_private.snapshot(id) values(true);

create function neptune_work_cache_private.headroom() returns bigint language sql volatile security invoker set search_path='' as $$
select coalesce(sum(case when c.relkind='S' then pg_relation_size(c.oid) else pg_total_relation_size(c.oid) end),0)::bigint
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','m','S') and
(n.nspname in ('neptune_v2_private','neptune_mv_private','neptune_work_cache_private') or n.nspname='public' and c.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control'))$$;
create function neptune_work_cache_private.admit() returns void language plpgsql security invoker set search_path='' as $$begin
 if (select coalesce(sum(pg_total_relation_size(c.oid)),0) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='neptune_work_cache_private' and c.relkind in ('r','m'))>=512*1024 then raise exception 'Worker cache physical reserve exhausted';end if;
 if neptune_work_cache_private.headroom()>=30*1024*1024 then raise exception 'Worker cache shared headroom unavailable';end if;
end$$;

create function neptune_work_cache_private.publisher_update(p jsonb, expected_generation bigint, expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare a neptune_work_cache_private.publisher; n timestamptz:=neptune_work_cache_private.now_at(); h text; k text; ob timestamptz; gen bigint; rev bigint;
begin
 if expected_generation is null or expected_revision is null or expected_generation<0 or expected_revision<0 or not neptune_work_cache_private.payload_valid(p) or p->>'kind'='worker_event' then raise exception 'Invalid publisher update';end if;
 h:=encode(sha256(convert_to(p::text,'UTF8')),'hex');k:=p->>'kind';ob:=(p->>'observed_at')::timestamptz;
 select * into strict a from neptune_work_cache_private.publisher where id for update;
 n:=neptune_work_cache_private.now_at();
 if a.last_id=(p->>'id')::uuid then
  if a.last_hash=h and ((k='session_opened' and expected_generation=a.generation-1 and expected_revision=0) or (k<>'session_opened' and expected_generation=a.generation and expected_revision=a.revision-1)) then return jsonb_build_object('duplicate',true,'generation',a.generation,'revision',a.revision);end if;
  raise exception 'Conflicting publisher retry';
 end if;
 if expected_generation<>a.generation or (k<>'session_opened' and expected_revision<>a.revision) or (k='session_opened' and expected_revision<>0) then raise exception 'Publisher fence conflict';end if;
 if ob<n-interval '60 seconds' or ob>n then raise exception 'Publisher observation not fresh';end if;
 if k='session_opened' then
  if (p->>'session_seq')::bigint<>0 or a.state='open' and n<=least(a.observed_at,a.received_at)+interval '60 seconds' or a.session_id=(p->>'session_id')::uuid then raise exception 'Session start conflict';end if;
  gen:=a.generation+1;rev:=0;
 else
  if a.state<>'open' or p->>'session_id'<>a.session_id::text or n>least(a.observed_at,a.received_at)+interval '60 seconds' or ob<=a.observed_at or (p->>'session_seq')::bigint<>a.revision+1 then raise exception 'Publisher expired, reordered or closed';end if;
  gen:=a.generation;rev:=a.revision+1;
 end if;
 perform neptune_work_cache_private.admit();
 update neptune_work_cache_private.publisher set generation=gen,revision=rev,session_id=(p->>'session_id')::uuid,state=case when k='session_closed' then 'closed' else 'open' end,observed_at=ob,received_at=n,last_id=(p->>'id')::uuid,last_hash=h,changes=changes+1,recent_seq=recent_seq+case when k='publisher_heartbeat' then 0 else 1 end where id returning * into a;
 if k<>'publisher_heartbeat' then update neptune_work_cache_private.recent set event_number=a.recent_seq,session_generation=gen,run_generation=null,worker_slot=null,received_at=n,payload_sha256=h,payload=p where slot=(a.recent_seq%8)::integer;end if;
 perform neptune_work_cache_private.admit();
 return jsonb_build_object('duplicate',false,'generation',gen,'revision',rev);
end$$;

create function neptune_work_cache_private.worker_update(worker_slot integer,p jsonb, expected_session_generation bigint, expected_run_generation bigint, expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare a neptune_work_cache_private.publisher; w neptune_work_cache_private.workers; other neptune_work_cache_private.workers; n timestamptz:=neptune_work_cache_private.now_at(); h text; ob timestamptz; starting boolean; gen bigint; rev bigint;
begin
 if worker_slot is null or worker_slot not between 1 and 6 or expected_session_generation is null or expected_run_generation is null or expected_revision is null or expected_session_generation<1 or expected_run_generation<0 or expected_revision<0 or not neptune_work_cache_private.payload_valid(p) or p->>'kind'<>'worker_event' or (p->>'session_seq')::integer<>0 then raise exception 'Invalid worker update';end if;
 h:=encode(sha256(convert_to(p::text,'UTF8')),'hex');ob:=(p->>'observed_at')::timestamptz;starting:=p->>'step'='task_started';
 select * into strict a from neptune_work_cache_private.publisher where id for update;
 n:=neptune_work_cache_private.now_at();
 select * into strict w from neptune_work_cache_private.workers where slot=worker_slot for update;
 if expected_session_generation<>a.generation or p->>'session_id'<>a.session_id::text then raise exception 'Session generation fenced';end if;
 if w.last_id=(p->>'id')::uuid then
  if w.last_hash=h and w.session_generation=a.generation and ((starting and expected_run_generation=w.run_generation-1 and expected_revision=0) or (not starting and expected_run_generation=w.run_generation and expected_revision=w.revision-1)) then return jsonb_build_object('duplicate',true,'session_generation',a.generation,'run_generation',w.run_generation,'revision',w.revision);end if;
  raise exception 'Conflicting worker retry';
 end if;
 if a.state<>'open' or n<a.observed_at or n<a.received_at or n>least(a.observed_at,a.received_at)+interval '60 seconds' then raise exception 'Publisher absent or expired';end if;
 if ob<n-interval '60 seconds' or ob>n then raise exception 'Worker observation not fresh';end if;
 if expected_run_generation<>w.run_generation or (not starting and expected_revision<>w.revision) or (starting and expected_revision<>0) then raise exception 'Worker revision fenced';end if;
 if starting then
  if p->>'state'<>'running' or (p->>'run_seq')::integer<>0 or p->>'run_id'=w.run_id::text or w.session_generation=a.generation and w.state not in ('completed','failed') and n<=least(w.observed_at,w.received_at)+interval '60 seconds' then raise exception 'Worker start conflict';end if;
  if exists(select 1 from neptune_work_cache_private.workers x where x.slot<>worker_slot and x.session_generation=a.generation and (x.actor_id=(p->>'actor_id')::uuid or x.run_id=(p->>'run_id')::uuid)) then raise exception 'Worker identity already assigned';end if;
  if p->>'handoff_from_run_id' is not null then
   select * into other from neptune_work_cache_private.workers x where x.session_generation=a.generation and x.run_id=(p->>'handoff_from_run_id')::uuid;
   if other.run_id is null or other.state<>'completed' or other.actor_id=(p->>'actor_id')::uuid or p->>'candidate_sha256' is null or other.payload->>'candidate_sha256' is distinct from p->>'candidate_sha256' then raise exception 'Unconfirmed handoff';end if;
  end if;
  gen:=w.run_generation+1;rev:=0;
 else
  if w.session_generation<>a.generation or w.run_id is null or p->>'run_id'<>w.run_id::text or p->>'actor_id'<>w.actor_id::text or p->>'role'<>w.payload->>'role' or p->>'task'<>w.payload->>'task' or w.state in ('completed','failed') or ob<=w.observed_at or (p->>'run_seq')::bigint<>w.revision+1 or p->>'handoff_from_run_id' is not null then raise exception 'Worker expired, terminal, reordered or identity conflict';end if;
  if p->>'candidate_sha256' is distinct from w.payload->>'candidate_sha256' and p->>'step'<>'source_changed' then raise exception 'Candidate changed without source transition';end if;
  gen:=w.run_generation;rev:=w.revision+1;
 end if;
 perform neptune_work_cache_private.admit();
 update neptune_work_cache_private.workers set session_generation=a.generation,run_generation=gen,revision=rev,actor_id=(p->>'actor_id')::uuid,run_id=(p->>'run_id')::uuid,state=p->>'state',observed_at=ob,received_at=n,last_id=(p->>'id')::uuid,last_hash=h,payload=p where slot=worker_slot;
 update neptune_work_cache_private.publisher set changes=changes+1,recent_seq=recent_seq+case when p->>'step'='status_observed' then 0 else 1 end where id returning * into a;
 if p->>'step'<>'status_observed' then update neptune_work_cache_private.recent set event_number=a.recent_seq,session_generation=a.generation,run_generation=gen,worker_slot=worker_update.worker_slot,received_at=n,payload_sha256=h,payload=p where slot=(a.recent_seq%8)::integer;end if;
 perform neptune_work_cache_private.admit();
 return jsonb_build_object('duplicate',false,'session_generation',a.generation,'run_generation',gen,'revision',rev);
end$$;

create function neptune_work_cache_private.publish() returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='250ms' as $$
declare a neptune_work_cache_private.publisher; s neptune_work_cache_private.snapshot; out jsonb; workers jsonb; events jsonb; t timestamptz;
begin
 -- Consistent order: publisher, then status. Ordinary engine writes never touch cache rows.
 select * into strict a from neptune_work_cache_private.publisher where id for update;
 perform 1 from public.neptune_paper_v2_status where id='neptune-paper-v2' for update;
 if not found then raise exception 'Status row unavailable';end if;
 select * into strict s from neptune_work_cache_private.snapshot where id for update;
 if s.revision=a.changes then return jsonb_build_object('changed',false,'revision',s.revision);end if;
 perform neptune_work_cache_private.admit();
 select coalesce(jsonb_agg(w.payload||jsonb_build_object('slot',w.slot,'session_generation',w.session_generation,'run_generation',w.run_generation,'revision',w.revision,'received_at',to_char(w.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'payload_sha256',w.last_hash) order by w.slot),'[]'::jsonb),max(w.received_at) into workers,t from neptune_work_cache_private.workers w where w.session_generation=a.generation and w.payload is not null;
 select coalesce(jsonb_agg(r.payload||jsonb_build_object('event_number',r.event_number,'session_generation',r.session_generation,'run_generation',r.run_generation,'slot',r.worker_slot,'received_at',to_char(r.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'payload_sha256',r.payload_sha256) order by r.event_number),'[]'::jsonb) into events from neptune_work_cache_private.recent r where r.session_generation=a.generation and r.payload is not null;
 out:=jsonb_build_object('version',2,'bridge_version','team-work-cache-v2','origin','assistant_observed','snapshot_revision',a.changes,'content_at',to_char(greatest(a.received_at,t) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'session_id',a.session_id,'session_generation',a.generation,'session_revision',a.revision,'session_state',a.state,'publisher_observed_at',to_char(a.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'publisher_received_at',to_char(a.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'workers',workers,'events',events,'history_complete',false,'limits',jsonb_build_object('worker_fresh_ms',60000,'publisher_fresh_ms',60000,'worker_display_ms',21600000,'recent_display_ms',3600000,'worker_slots',6,'recent_slots',8));
 while octet_length(out::text)>6144 and jsonb_array_length(out->'events')>0 loop out:=jsonb_set(out,'{events}',(out->'events')-0);end loop;
 if octet_length(out::text)>16384 then raise exception 'Worker projection capacity';end if;
 update neptune_work_cache_private.snapshot set revision=a.changes,payload=out where id;
 update public.neptune_paper_v2_status set team_work=out where id='neptune-paper-v2';
 perform neptune_work_cache_private.admit();
 return jsonb_build_object('changed',true,'revision',a.changes);
end$$;

alter table neptune_work_cache_private.publisher enable row level security;
alter table neptune_work_cache_private.workers enable row level security;
alter table neptune_work_cache_private.recent enable row level security;
alter table neptune_work_cache_private.snapshot enable row level security;
revoke all on all tables in schema neptune_work_cache_private from public,anon,authenticated,service_role;
revoke all on all functions in schema neptune_work_cache_private from public,anon,authenticated,service_role;

commit;
