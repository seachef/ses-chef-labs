"""Run the bounded scout once after honoring persisted public provider refusals."""
import argparse,datetime as dt,email.utils,json,os,pathlib,signal,subprocess,sys,threading
import scout
import publish_feed as pub
import admission
PROVIDERS=('kraken','hyperliquid')
CODES={None,'http_401','http_402','http_403','http_418','http_451','http_429','invalid_retry_after'}
def empty_state():return {p:{'blocked_until':None,'permanent':False,'reason_code':None,'refused_at':None} for p in PROVIDERS}
def validate_state(state):
 if not isinstance(state,dict) or set(state)!=set(PROVIDERS):raise ValueError('provider state required')
 for p,s in state.items():
  if not isinstance(s,dict) or set(s)!={'blocked_until','permanent','reason_code','refused_at'} or type(s['permanent']) is not bool or s['reason_code'] not in CODES:raise ValueError('provider state invalid')
  for k in ['blocked_until','refused_at']:
   if s[k] is not None:pub.timestamp(s[k])
  if s['reason_code'] is None and (s['permanent'] or s['blocked_until'] is not None or s['refused_at'] is not None):raise ValueError('unbound block')
  if s['reason_code'] is not None and s['refused_at'] is None:raise ValueError('missing refusal time')
  if s['reason_code'] in {'http_401','http_402','http_403','http_418','http_451','invalid_retry_after'} and not s['permanent']:raise ValueError('weakened permanent block')
  if s['reason_code']=='http_429' and s['blocked_until'] is None:raise ValueError('missing cooldown')
 return state

def prior_state(client,validator,return_checkpoint=False):
 status,branch=client.call('GET','/branches/'+pub.DATA_BRANCH)
 if status!=200 or branch.get('name')!=pub.DATA_BRANCH:raise pub.PublishError('reviewed data branch missing')
 sha,raw,end=pub.existing_file(client)
 if raw is None:return (empty_state(),None) if return_checkpoint else empty_state()
 validator(raw)
 feed=pub.parse(raw);state=validate_state(feed['provider_status'])
 return (state,feed['run']) if return_checkpoint else state

def is_blocked(state,provider,now):
 s=state[provider]
 return s['permanent'] or (s['blocked_until'] is not None and pub.timestamp(s['blocked_until'])>now)

def update_state(prior,captures):
 state=json.loads(json.dumps(validate_state(prior)))
 for cap in sorted(captures,key=lambda c:c.get('response_observed_at','')):
  p=cap.get('provider');status=cap.get('status')
  if p not in PROVIDERS or status not in(401,402,403,418,451,429):continue
  at=pub.timestamp(cap['response_observed_at']);old=state[p]
  if old['permanent']:continue
  if status in(401,402,403,418,451):state[p]={'blocked_until':None,'permanent':True,'reason_code':'http_'+str(status),'refused_at':at.isoformat()};continue
  until=at+dt.timedelta(minutes=15);retry=cap.get('headers',{}).get('retry-after')
  try:
   if retry is not None:
    if retry.isdigit() and len(retry)<=8:until=max(until,at+dt.timedelta(seconds=int(retry)))
    else:
     t=email.utils.parsedate_to_datetime(retry)
     if t.tzinfo is None:raise ValueError('Retry-After timezone')
     until=max(until,t)
   if old['blocked_until'] is not None:until=max(until,pub.timestamp(old['blocked_until']))
   state[p]={'blocked_until':until.isoformat(),'permanent':False,'reason_code':'http_429','refused_at':at.isoformat()}
  except Exception:state[p]={'blocked_until':None,'permanent':True,'reason_code':'invalid_retry_after','refused_at':at.isoformat()}
 return validate_state(state)

def strict_validate(raw):
 p=subprocess.run(['node',str(pathlib.Path(__file__).with_name('validate-feed.mjs')),'-','--allow-expired'],input=raw,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
 if p.returncode!=0:raise pub.PublishError('prior public feed schema invalid; no requests sent')

def save_state(out,state):
 temporary=out/'rate-state.tmp';temporary.write_text(json.dumps(validate_state(state),sort_keys=True,separators=(',',':'))+'\n');os.replace(temporary,out/'rate-state.json')

def failed_report(out,started,recovery_id=None):
 report={'protocol':scout.PROTOCOL,'mode':'read_only_run_once','run_outcome':'recovery_needed' if recovery_id else 'failed','recovery_required_run_id':recovery_id,'started_at':started,'completed_at':scout.stamp(),'continuous_runtime':False,'ai_workers_running':0,'execution_enabled':False,'sources':{'collector':{'status':'blocked','reason':'collector_failed'}},'coverage':{},'leads':[],'screened_identities':0,'prefilter_pass_count':0,'shortlist_count':0,'qualified_buy_count':0,'source_captures':[],'limitations':['Collection failed; coverage is unavailable. Provider refusals remain in force.']}
 scout.save_output(out,report,[])

def collect_child(out):
 state=validate_state(json.loads((out/'rate-state.json').read_text()));now=dt.datetime.now(dt.timezone.utc);OriginalBudget=scout.Budget;state_lock=threading.Lock()
 class PersistentBudget(OriginalBudget):
  def __init__(self):
   super().__init__()
   for p in PROVIDERS:
    if is_blocked(state,p,now):self.blocked[p]='prior_'+str(state[p]['reason_code'])
  def observe(self,provider,status,headers):
   nonlocal state
   super().observe(provider,status,headers)
   if status in(418,451):
    with self.lock:self.blocked[provider]='HTTP '+str(status)
   if status in(401,402,403,418,451,429):
    with state_lock:
     state=update_state(state,[{'provider':provider,'status':status,'response_observed_at':scout.stamp(),'headers':headers}]);save_state(out,state)
 scout.Budget=PersistentBudget
 try:
  report,markets=scout.run(out,False);report['run_outcome']='completed';scout.save_output(out,report,markets)
 finally:scout.Budget=OriginalBudget

def run_child(out,timeout=180):
 # A killable process gives a total wall-clock deadline even under slow HTTP trickle.
 # The read-only GitHub credential is intentionally unavailable to the collector child.
 env={k:v for k,v in os.environ.items() if k not in {'GH_READ_TOKEN','GH_TOKEN','GITHUB_TOKEN','FEED_BASE64','FEED_SHA256'}}
 child=subprocess.Popen([sys.executable,str(pathlib.Path(__file__).resolve()),'--collect-child','--out',str(out)],env=env,start_new_session=True)
 try:return child.wait(timeout=timeout)==0
 except subprocess.TimeoutExpired:
  os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5);return False

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--collect-child',action='store_true');args=parser.parse_args();out=pathlib.Path(args.out)
 if args.collect_child:
  collect_child(out);return
 if out.exists():raise ValueError('fresh unique output folder required')
 state,checkpoint=prior_state(pub.GitHub(os.environ.get('GH_READ_TOKEN','')),strict_validate,True)
 out.mkdir(parents=True,exist_ok=False);save_state(out,state);started=scout.stamp()
 recovery_id=admission.check(checkpoint)
 if recovery_id:
  failed_report(out,started,recovery_id);return
 try:ok=run_child(out)
 except Exception:ok=False
 # State is read only after the child has terminated; atomic replace prevents partial JSON.
 validate_state(json.loads((out/'rate-state.json').read_text()))
 if not ok:failed_report(out,started)
if __name__=='__main__':
 try:main()
 except (pub.PublishError,ValueError) as e:print(str(e),file=sys.stderr);sys.exit(1)
