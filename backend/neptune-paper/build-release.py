from pathlib import Path
import re,hashlib,json
r=Path(__file__).resolve().parent;base=r/'test/fixtures/build5'
files=['schema.sql','core.sql','owner-access.sql','collector.sql','native-economics.sql','native-ledger.sql','native-order-rules.sql','native-scanner-helpers.sql','native-public-projection.sql','native-collector.sql','transport-observation.sql','collector-integration.sql','native-audit.sql','config.json','native-config.json']
missing=[f for f in files if not (r/f).exists()]
if missing:raise SystemExit('Awaiting '+str(missing))
hashes={f:hashlib.sha256((r/f).read_bytes()).hexdigest() for f in files};digest=hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest()
manifest={'version':1,'build':6,'base_source_hash':'1e1907c0fca5ffcd54a2f25e957b081be4815e097dbbbaf9073e97951c7fb5af','source_hash':digest,'files':hashes,'native_model_hash':hashes['native-config.json'],'hash_method':'SHA256 of UTF-8 compact JSON sorted file-name to SHA256 mapping'}
(r/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
functions=lambda t:re.findall(r'create (?:or replace )?function\s+.*?\$\$;',t,re.S|re.I)
baseline={}
for fn in ['core.sql','owner-access.sql','collector.sql']:
 for src in functions((base/fn).read_text()):
  name=re.search(r'function\s+([\w.]+)',src,re.I).group(1);body=src.split('$$')[1];baseline[name]=hashlib.md5(body.encode()).hexdigest()
s="""-- Reviewed additive native paper upgrade. No activation, reallocation, reset or cron changes.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
select id from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
select id from neptune_v2_private.account where id='neptune-paper-v2' for update;
do $$declare ac neptune_v2_private.account;begin
 if (select source_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '1e1907c0fca5ffcd54a2f25e957b081be4815e097dbbbaf9073e97951c7fb5af' then raise exception 'Exact reviewed build5 required';end if;
 select * into ac from neptune_v2_private.account where id='neptune-paper-v2';
 if (select enabled from public.neptune_paper_v2_control where id=ac.id) or coalesce((ac.state->>'enabled')::boolean,true) then raise exception 'Existing owner Stop and acknowledgement required';end if;
 if (ac.state->>'control_epoch')::bigint is distinct from (select epoch from public.neptune_paper_v2_control where id=ac.id) then raise exception 'Owner Stop epoch not acknowledged';end if;
 if exists(select 1 from neptune_v2_private.positions where (payload->>'qty')::numeric>0) or ac.state->'pending' is distinct from '{}'::jsonb or ac.state->'receivables' is distinct from '{}'::jsonb or coalesce((select sum(delta) from neptune_v2_private.usd_ledger),0)<>0 then raise exception 'Flat settled pool required; never force a sale for migration';end if;
 if not exists(select 1 from neptune_v2_private.specialist_checkpoint) or (select count(*) from neptune_v2_private.specialist_accounts)<>5 then raise exception 'Existing five-account allocation required';end if;
 if (select config_hash from neptune_v2_private.build_metadata order by id desc limit 1) is distinct from '00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8' then raise exception 'Unexpected predecessor config';end if;
 if ac.cash is distinct from (select sum(delta) from neptune_v2_private.cash_ledger) then raise exception 'Root cash ledger mismatch';end if;
 if (ac.state->>'realized')::numeric is distinct from ((select legacy_realized from neptune_v2_private.specialist_checkpoint)+(select sum(realized_pnl) from neptune_v2_private.specialist_accounts)) then raise exception 'Root specialist realized mismatch';end if;
 perform neptune_v2_private.specialist_reconcile();
"""
# Existing access drift requires separate review; do not silently repair it.
s+=""" if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where n.nspname='neptune_v2_private' and x.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) or exists(select 1 from pg_class p join pg_namespace n on n.oid=p.relnamespace cross join lateral aclexplode(coalesce(p.relacl,acldefault('r',p.relowner))) x where n.nspname='neptune_v2_private' and x.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) or exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x where n.nspname='neptune_v2_private' and x.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Existing private ACL drift requires separate review';end if;
"""
for name,h in sorted(baseline.items()):
 schema,proc=name.split('.')
 s+=f" if (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='{schema}' and p.proname='{proc}') is distinct from '{h}' then raise exception 'Unexpected predecessor {name}';end if;\n"
s+="""end$$;
create temporary table native_cutover_preserved on commit drop as select to_jsonb(a) account_row,(select to_jsonb(c) from public.neptune_paper_v2_control c where c.id=a.id) control_row,(select jsonb_agg(to_jsonb(s) order by s.id) from neptune_v2_private.specialist_accounts s) specialists,(select count(*) from public.neptune_paper_v2_history) history_count,(select count(*) from neptune_v2_private.cash_ledger) cash_count,(select coalesce(jsonb_agg(to_jsonb(p) order by p.asset),'[]') from neptune_v2_private.positions p) positions,(select to_jsonb(p) from public.neptune_paper_v2_status p where p.id=a.id) public_status,(select to_jsonb(f) from neptune_v2_private.feed_control f where f.id) legacy_feed from neptune_v2_private.account a where a.id='neptune-paper-v2';
alter table neptune_v2_private.positions drop constraint positions_asset_check;
alter table neptune_v2_private.positions add constraint positions_asset_check check(asset in ('ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD','binance:SOLUSDT','hyperliquid:@107'));
"""
# Bodies may reference later helpers, but no invocation happens until all definitions commit.
s+='\n'.join(re.sub(r'^create (?:or replace )?function','create or replace function',f,flags=re.I) for f in functions((r/'core.sql').read_text()))+'\n'
# Install only the reviewed equality guard from owner-access; never replay its schema/control setup.
ack=[f for f in functions((r/'owner-access.sql').read_text()) if re.search(r'function\s+neptune_v2_private\.publish_control_ack\s*\(',f,re.I)]
if len(ack)!=1:raise SystemExit('Expected one publish_control_ack body')
s+='\n-- Reviewed owner-access function only\n'+re.sub(r'^create (?:or replace )?function','create or replace function',ack[0],flags=re.I)+'\n'
for fn in ['native-economics.sql','native-ledger.sql','native-order-rules.sql','native-scanner-helpers.sql','native-public-projection.sql','native-collector.sql','transport-observation.sql','collector-integration.sql','native-audit.sql']:s+='\n-- '+fn+'\n'+(r/fn).read_text()+'\n'
s+="""-- Configure disabled native collector; existing owner Resume synchronizes enabled state.
do $$begin
 if not coalesce((select contract_verified and not terminal from neptune_v2_private.feed_control where id),false) then raise exception 'Existing reviewed collector transport required';end if;
 if (select pending_epoch from neptune_v2_private.feed_control where id) is not null then raise exception 'Pending legacy batch must drain under acknowledged Stop';end if;
 if (select coalesce(sum(pg_total_relation_size(c.oid)),0) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','m') and (n.nspname in ('neptune_v2_private','neptune_mv_private') or (n.nspname='public' and c.relname in ('neptune_paper_v2_status','neptune_paper_v2_history','neptune_paper_v2_control'))))>=32*1024*1024 then raise exception 'Insufficient bounded audit headroom';end if;
 if exists(select 1 from (values('id','bigint'),('status_code','integer'),('content_type','text'),('headers','jsonb'),('content','text'),('timed_out','boolean'),('error_msg','text'),('created','timestamp with time zone')) e(name,type_name) where not exists(select 1 from pg_attribute a where a.attrelid='net._http_response'::regclass and a.attname=e.name and a.atttypid=e.type_name::regtype and a.attnum>0 and not a.attisdropped)) then raise exception 'Trusted pg_net response contract mismatch';end if;
 if not exists(select 1 from neptune_v2_private.feed_control f join cron.job j on j.jobid=f.job_id where f.id and j.jobname='neptune-v2-feed-guard' and j.username=f.job_owner and j.database=f.job_database and j.active and j.command='set statement_timeout=''8s''; select neptune_v2_private.feed_tick();') then raise exception 'Existing unchanged bounded feed guard required';end if;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net' and p.proname='http_get' and p.prorettype='bigint'::regtype and array['url','params','headers','timeout_milliseconds']::text[]<@p.proargnames) or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net' and p.proname='http_post' and p.prorettype='bigint'::regtype and array['url','body','params','headers','timeout_milliseconds']::text[]<@p.proargnames) then raise exception 'Reviewed pg_net transport signature missing';end if;
end$$;
insert into neptune_mv_private.control(id,enabled,contract_verified,started_at) values(true,false,true,clock_timestamp());
revoke all on schema neptune_v2_private,neptune_mv_private from public,anon,authenticated,service_role;
revoke all on all tables in schema neptune_v2_private,neptune_mv_private from public,anon,authenticated,service_role;
revoke all on all functions in schema neptune_v2_private,neptune_mv_private from public,anon,authenticated,service_role;
do $$begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname in ('neptune_v2_private','neptune_mv_private') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Private function client ACL detected';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname in ('neptune_v2_private','neptune_mv_private') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Private relation client ACL detected';end if;
 if exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname in ('neptune_v2_private','neptune_mv_private') and a.grantee in (0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Private schema client ACL detected';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('neptune_v2_private','neptune_mv_private') and (p.prosecdef or not coalesce('search_path=""'=any(p.proconfig),false))) then raise exception 'Private invoker/search path contract failed';end if;
 if exists(select 1 from native_cutover_preserved p join neptune_v2_private.account a on a.id='neptune-paper-v2' where p.account_row is distinct from to_jsonb(a) or p.control_row is distinct from (select to_jsonb(c) from public.neptune_paper_v2_control c where c.id=a.id) or p.specialists is distinct from (select jsonb_agg(to_jsonb(s) order by s.id) from neptune_v2_private.specialist_accounts s) or p.history_count<>(select count(*) from public.neptune_paper_v2_history) or p.cash_count<>(select count(*) from neptune_v2_private.cash_ledger) or p.positions is distinct from (select coalesce(jsonb_agg(to_jsonb(x) order by x.asset),'[]') from neptune_v2_private.positions x) or p.public_status is distinct from (select to_jsonb(x) from public.neptune_paper_v2_status x where x.id=a.id) or p.legacy_feed is distinct from (select to_jsonb(x) from neptune_v2_private.feed_control x where x.id)) then raise exception 'Migration altered accounting/control/history';end if;
 perform neptune_v2_private.native_scan_reconcile();
end$$;
"""
s+=f"insert into neptune_v2_private.build_metadata(id,source_hash,config_hash,recorded_at) values(6,'{digest}','00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',clock_timestamp());\ncommit;\n"
(r/'ATOMIC-NATIVE-UPGRADE.sql').write_text(s)
manifest['upgrade_sha256']=hashlib.sha256(s.encode()).hexdigest()
(r/'MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(digest)
