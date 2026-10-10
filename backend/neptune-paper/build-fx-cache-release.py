"""Build the standalone build6 -> build7 overlay without rewriting historical pins."""
from pathlib import Path
import hashlib,json,re
r=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
base=json.loads((r/'MANIFEST.json').read_text())
assert base['build']==6 and base['source_hash']=='027544eb165e7b705302b4a48ad6fdc7d58602bb6ff3852829ad57f9982501be'
for f,h in base['files'].items():assert sha((r/f).read_bytes())==h,f
assert sha((r/'ATOMIC-NATIVE-UPGRADE.sql').read_bytes())==base['upgrade_sha256']
old=re.search(r'create or replace function neptune_v2_private\.feed_work\(\)[\s\S]*?\$\$;', (r/'collector-integration.sql').read_text()).group()
new=(r/'fx-cache-age.sql').read_text()
oldbody=old.split('$$')[1];newbody=new.split('$$')[1]
oldline="cache_age_limit:=case when req.kind in ('metadata','fx') then 3600 when req.kind='bars' then 60 else 5 end;"
newline="-- Daily ECB reference caching follows the existing 96h reference-date policy.\n     -- fetched_at stays the conservative receipt bound; live-market/metadata limits are unchanged.\n     cache_age_limit:=case when req.kind='fx' then 345600 when req.kind='metadata' then 3600 when req.kind='bars' then 60 else 5 end;"
assert oldbody.replace(oldline,newline)==newbody
files={**base['files'],'fx-cache-age.sql':sha(new.encode())}
digest=sha(json.dumps(files,sort_keys=True,separators=(',',':')).encode())
oldmd5=hashlib.md5(oldbody.encode()).hexdigest();newmd5=hashlib.md5(newbody.encode()).hexdigest()
patch=f"""-- Guarded routine daily-reference cache compatibility fix; build6 -> build7.
-- Existing running/stopped state, epoch, receipts, quarantines and data remain unchanged.
-- Only existing feed_work definition and append-only build metadata are modified.
begin;
set local lock_timeout='5s';set local statement_timeout='15s';
select 1 from public.neptune_paper_v2_control where id='neptune-paper-v2' for update;
select 1 from neptune_v2_private.account where id='neptune-paper-v2' for update;
do $$begin
 if (select count(*) from public.neptune_paper_v2_control where id='neptune-paper-v2')<>1 or (select count(*) from neptune_v2_private.account where id='neptune-paper-v2')<>1 then raise exception 'Existing control/account singleton required';end if;
 if not exists(select 1 from neptune_v2_private.build_metadata where id=6 and source_hash='{base['source_hash']}' and config_hash='{base['files']['config.json']}') or (select id from neptune_v2_private.build_metadata order by id desc limit 1)<>6 then raise exception 'Exact reviewed build6 metadata required';end if;
 if (select md5(prosrc) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) is distinct from '{oldmd5}' then raise exception 'Exact reviewed build6 feed_work required';end if;
 if (select prosecdef or not coalesce('search_path=""'=any(proconfig),false) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) then raise exception 'Existing invoker/search_path contract required';end if;
 if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='neptune_v2_private.feed_work()'::regprocedure and a.grantee in(0,(select oid from pg_roles where rolname='anon'),(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then raise exception 'Existing feed_work client access drift';end if;
end$$;
{new}
do $$begin
 if (select md5(prosrc) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) is distinct from '{newmd5}' then raise exception 'Replacement body mismatch';end if;
 if (select prosecdef or not coalesce('search_path=""'=any(proconfig),false) from pg_proc where oid='neptune_v2_private.feed_work()'::regprocedure) then raise exception 'Replacement security contract mismatch';end if;
end$$;
insert into neptune_v2_private.build_metadata(id,source_hash,config_hash,recorded_at) values(7,'{digest}','{base['files']['config.json']}',clock_timestamp());
commit;
"""
(r/'UPGRADE-FX-CACHE.sql').write_text(patch)
m={'version':1,'build':7,'base_build':6,'base_source_hash':base['source_hash'],'source_hash':digest,'files':files,'hash_method':base['hash_method'],'overlay_file':'fx-cache-age.sql','install_file':'UPGRADE-FX-CACHE.sql','install_sha256':sha(patch.encode()),'base_manifest_sha256':sha((r/'MANIFEST.json').read_bytes()),'historical_native_upgrade_sha256':base['upgrade_sha256'],'config_hash':base['files']['config.json'],'predecessor_feed_work_body_sha256':sha(oldbody.encode()),'predecessor_feed_work_body_md5':oldmd5,'feed_work_body_sha256':sha(newbody.encode()),'feed_work_body_md5':newmd5,'policy':{'daily_ecb_http_cache_age_and_date_max_seconds':345600,'reference_date_max_seconds':345600,'metadata_http_cache_max_seconds':3600,'bars_http_cache_max_seconds':60,'legacy_market_http_cache_max_seconds':5,'native_stablecoin_http_cache_max_seconds':5,'local_fx_retrieval_max_seconds':3600,'conservative_receipt_max_seconds':30}}
(r/'FX-CACHE-MANIFEST.json').write_text(json.dumps(m,indent=2)+'\n')
print(json.dumps({k:m[k] for k in ['source_hash','install_sha256','predecessor_feed_work_body_md5','feed_work_body_md5']},indent=2))
