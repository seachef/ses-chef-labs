"""Publish one sanitized public JSON file, with fixed destination and optimistic CAS.

No database, balances, wallets, trading, credential creation, branch creation,
force push, file deletion, input-derived URL, or publication retry is supported.
The only external mutation is one GitHub Contents PUT to TARGET_PATH/DATA_BRANCH.
"""
import base64, datetime as dt, hashlib, json, os, pathlib, re, subprocess, sys, urllib.error, urllib.parse, urllib.request
REPOSITORY='seachef/ses-chef-labs'
DATA_BRANCH='neptune-research-data'
TARGET_PATH='public/research-feed.json'
API='https://api.github.com/repos/'+REPOSITORY
MAX_BYTES=65536
MAX_API_BYTES=262144
MAX_REPOSITORY_KIB=131072  # Independent public-feed stop; current repo ~32,028 KiB.
PROTOCOL='neptune-public-research-feed-v1'

class PublishError(Exception): pass
class UncertainPublish(PublishError): pass
class Conflict(PublishError): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise PublishError('GitHub redirect refused')

def unique(pairs):
 out={}
 for k,v in pairs:
  if k in out:raise PublishError('duplicate JSON key')
  out[k]=v
 return out

def parse(raw,limit=MAX_BYTES):
 if not isinstance(raw,bytes) or not 1<=len(raw)<=limit:raise PublishError('payload byte bound')
 try:return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:(x for x in ()).throw(PublishError('nonfinite JSON')))
 except (UnicodeError,ValueError,RecursionError) as e:raise PublishError('invalid JSON') from e

def timestamp(v):
 if not isinstance(v,str) or len(v)>40:raise PublishError('timestamp required')
 try:x=dt.datetime.fromisoformat(v.replace('Z','+00:00'))
 except ValueError as e:raise PublishError('invalid timestamp') from e
 if x.tzinfo is None:raise PublishError('timezone required')
 return x

def header(raw,now=None,source_commit=None,run_id=None,fresh=True):
 j=parse(raw);now=now or dt.datetime.now(dt.timezone.utc)
 if not isinstance(j,dict) or j.get('protocol')!=PROTOCOL or not isinstance(j.get('run'),dict):raise PublishError('wrong feed protocol')
 r=j['run'];start=timestamp(r.get('started_at'));end=timestamp(r.get('completed_at'))
 if end<start or end-start>dt.timedelta(minutes=5):raise PublishError('run interval')
 if fresh and (end>now+dt.timedelta(seconds=5) or end<now-dt.timedelta(minutes=10)):raise PublishError('publication is stale or future')
 if source_commit is not None and r.get('source_commit')!=source_commit:raise PublishError('source commit mismatch')
 if run_id is not None and str(r.get('workflow_run_id'))!=str(run_id):raise PublishError('workflow run mismatch')
 return j,end

def decode_output(encoded,digest):
 if not isinstance(encoded,str) or not 1<=len(encoded)<=87400 or not re.fullmatch('[a-f0-9]{64}',digest or ''):raise PublishError('missing or oversized job output')
 try:raw=base64.b64decode(encoded,validate=True)
 except Exception as e:raise PublishError('invalid base64 job output') from e
 if len(raw)>MAX_BYTES or hashlib.sha256(raw).hexdigest()!=digest:raise PublishError('job output integrity mismatch')
 return raw

def git_blob_sha(raw):return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()

class GitHub:
 def __init__(self,token):
  if not token:raise PublishError('GitHub token unavailable')
  self.token=token;self.opener=urllib.request.build_opener(NoRedirect());self.puts=0
 def call(self,method,suffix,body=None):
  # Only these three read destinations and this one write destination exist.
  allowed_get={'', '/branches/'+DATA_BRANCH, '/contents/'+TARGET_PATH+'?ref='+DATA_BRANCH}
  if method=='GET' and suffix not in allowed_get:raise PublishError('read target not allowed')
  if method=='PUT' and (suffix!='/contents/'+TARGET_PATH or body.get('branch')!=DATA_BRANCH or set(body)-{'message','content','branch','sha'}):raise PublishError('write target not allowed')
  if method not in ('GET','PUT'):raise PublishError('method not allowed')
  if method=='PUT':
   self.puts+=1
   if self.puts!=1:raise PublishError('publication retry forbidden')
  req=urllib.request.Request(API+suffix,data=None if body is None else json.dumps(body,separators=(',',':')).encode(),method=method,headers={'Authorization':'Bearer '+self.token,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'neptune-public-research-publisher/1'})
  try:
   with self.opener.open(req,timeout=25) as response:
    raw=response.read(MAX_API_BYTES+1);status=response.status
   return status,parse(raw,MAX_API_BYTES)
  except urllib.error.HTTPError as e:
   if method=='GET' and e.code==404:return 404,None
   if method=='PUT' and e.code in(409,422):raise Conflict('feed changed or update rejected; no retry') from e
   if method=='PUT' and e.code>=500:raise UncertainPublish('GitHub write returned server error; inspect outcome before retry') from e
   raise PublishError('GitHub '+method+' failed: HTTP '+str(e.code)) from e
  except Exception as e:
   if isinstance(e,PublishError):raise
   if method=='PUT':raise UncertainPublish('publication outcome unknown; inspect feed and run before any retry') from e
   raise PublishError('GitHub read unavailable') from e

def existing_file(client):
 status,obj=client.call('GET','/contents/'+TARGET_PATH+'?ref='+DATA_BRANCH)
 if status==404:return None,None,None
 if status!=200 or obj.get('type')!='file' or obj.get('path')!=TARGET_PATH or obj.get('encoding')!='base64' or not isinstance(obj.get('size'),int) or obj['size']>MAX_BYTES:raise PublishError('existing target invalid')
 try:raw=base64.b64decode(obj['content'].replace('\n',''),validate=True)
 except Exception as e:raise PublishError('existing content invalid') from e
 if obj.get('sha')!=git_blob_sha(raw) or obj['size']!=len(raw):raise PublishError('existing blob binding mismatch')
 j,end=header(raw,fresh=False)
 return obj['sha'],raw,end

def publish(client,raw,source_commit,run_id,validator,now=None):
 if not re.fullmatch('[a-f0-9]{40}',source_commit or '') or not re.fullmatch('[0-9]{1,20}',str(run_id)):raise PublishError('run provenance invalid')
 new,end=header(raw,now,source_commit,run_id);validator(raw)
 status,repo=client.call('GET','')
 if status!=200 or repo.get('full_name')!=REPOSITORY or repo.get('private') is not False or repo.get('archived') is not False or repo.get('default_branch')!='main':raise PublishError('repository preflight failed')
 if not isinstance(repo.get('size'),int) or repo['size']>=MAX_REPOSITORY_KIB:raise PublishError('public repository size guard')
 status,branch=client.call('GET','/branches/'+DATA_BRANCH)
 if status!=200 or branch.get('name')!=DATA_BRANCH or not re.fullmatch('[a-f0-9]{40}',branch.get('commit',{}).get('sha','')):raise PublishError('reviewed data branch missing')
 old_sha,old_raw,old_end=existing_file(client)
 if old_raw==raw:return {'status':'unchanged','path':TARGET_PATH,'branch':DATA_BRANCH}
 if old_raw is not None and int(parse(old_raw)['run']['workflow_run_id'])>=int(run_id):return {'status':'immutable_run_preserved','path':TARGET_PATH,'branch':DATA_BRANCH}
 if old_end is not None and old_end>=end:return {'status':'newer_or_equal_feed_preserved','path':TARGET_PATH,'branch':DATA_BRANCH}
 body={'message':'Update public NEPTUNE research feed','content':base64.b64encode(raw).decode(),'branch':DATA_BRANCH}
 if old_sha is not None:body['sha']=old_sha
 # Contents API compares this file's blob SHA, retaining unrelated latest branch changes.
 status,result=client.call('PUT','/contents/'+TARGET_PATH,body)
 if status not in(200,201) or result.get('content',{}).get('path')!=TARGET_PATH or result['content'].get('sha')!=git_blob_sha(raw) or not re.fullmatch('[a-f0-9]{40}',result.get('commit',{}).get('sha','')):raise UncertainPublish('publication receipt invalid; no retry')
 try:verified_sha,verified_raw,verified_end=existing_file(client)
 except Exception as e:raise UncertainPublish('write accepted but verification unavailable; no retry') from e
 if verified_raw!=raw:raise UncertainPublish('published feed changed before verification; no retry')
 return {'status':'published_verified','path':TARGET_PATH,'branch':DATA_BRANCH,'commit':result['commit']['sha'],'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}

def main():
 raw=decode_output(os.environ.get('FEED_BASE64',''),os.environ.get('FEED_SHA256',''))
 source=os.environ.get('SOURCE_COMMIT','');run_id=os.environ.get('WORKFLOW_RUN_ID','')
 # Trusted validator comes from the same approved checkout, never the output/artifact.
 def validator(data):
  p=subprocess.run(['node',str(pathlib.Path(__file__).with_name('validate-feed.mjs')),'-'],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20,check=False)
  if p.returncode!=0:raise PublishError('strict public schema validation failed')
 if os.environ.get('GITHUB_REPOSITORY')!=REPOSITORY or os.environ.get('GITHUB_REF')!='refs/heads/main' or os.environ.get('GITHUB_EVENT_NAME') not in('schedule','workflow_dispatch'):raise PublishError('workflow origin invalid')
 result=publish(GitHub(os.environ.get('GH_TOKEN','')),raw,source,run_id,validator)
 print(json.dumps(result,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except PublishError as e:print(str(e),file=sys.stderr);sys.exit(1)
