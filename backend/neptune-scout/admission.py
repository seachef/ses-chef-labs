"""Fail closed after an unaccounted scheduled run, without Actions token permissions."""
import os,re
import urllib.request
import publish_feed as pub
RUNS_URL=pub.API+'/actions/workflows/neptune-public-scout.yml/runs?branch=main&per_page=10'

def public_runs():
 # Public repository metadata only. No token is sent and URL is never caller-derived.
 req=urllib.request.Request(RUNS_URL,headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'neptune-public-research-admission/1'})
 with urllib.request.build_opener(pub.NoRedirect()).open(req,timeout=25) as r:
  if r.status!=200:raise pub.PublishError('workflow history unavailable')
  result=pub.parse(r.read(pub.MAX_API_BYTES+1),pub.MAX_API_BYTES)
 if not isinstance(result.get('workflow_runs'),list) or len(result['workflow_runs'])>10:raise pub.PublishError('workflow history bound')
 return result['workflow_runs']

def decision(runs,current_id,attempt,checkpoint,recovery_input='',event='schedule'):
 """Return None for admission or exact run ID that requires explicit recovery."""
 if not re.fullmatch(r'[0-9]{1,20}',current_id or ''):raise pub.PublishError('current run identity invalid')
 recovery=checkpoint.get('recovery_required_run_id') if checkpoint else None
 current=[r for r in runs if str(r.get('id'))==current_id]
 if len(current)!=1:return recovery or current_id
 cur=current[0]
 if cur.get('head_branch')!='main' or cur.get('event') not in('schedule','workflow_dispatch') or not isinstance(cur.get('run_number'),int):return recovery or current_id
 relevant=[r for r in runs if r.get('head_branch')=='main' and r.get('event') in('schedule','workflow_dispatch') and isinstance(r.get('run_number'),int) and r['run_number']<cur['run_number']]
 prior=max(relevant,key=lambda r:r['run_number']) if relevant else None
 blocked=recovery
 if attempt!='1':blocked=blocked or current_id
 if prior is None and cur['run_number']!=1:blocked=blocked or current_id
 if prior is not None:
  if prior['run_number']!=cur['run_number']-1:blocked=blocked or current_id
  pid=str(prior.get('id',''))
  if not re.fullmatch(r'[0-9]{1,20}',pid):return recovery or current_id
  if prior.get('status')!='completed' or prior.get('conclusion')!='success' or checkpoint is None or checkpoint.get('workflow_run_id')!=pid:blocked=blocked or pid
 if prior is None and cur['run_number']==1 and checkpoint is not None and checkpoint.get('status')!='initializing':blocked=blocked or current_id
 if blocked and event=='workflow_dispatch' and recovery_input==blocked:
  # Operator must inspect this exact predecessor first. Provider blocks are unchanged.
  return None
 return blocked

def check(checkpoint):
 current=os.environ.get('GITHUB_RUN_ID','');attempt=os.environ.get('GITHUB_RUN_ATTEMPT','1');recovery=os.environ.get('RECOVERY_FROM_RUN_ID','')
 try:return decision(public_runs(),current,attempt,checkpoint,recovery,os.environ.get('GITHUB_EVENT_NAME',''))
 except Exception:
  return (checkpoint or {}).get('recovery_required_run_id') or current or '0'
