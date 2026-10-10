import {validatePublicFeed} from './public-scout-contract-v1/public-feed.mjs';

// Public research only. This transport has no order, quote or worker API.
export const PUBLIC_SCOUT_URL='https://raw.githubusercontent.com/seachef/ses-chef-labs/neptune-research-data/public/research-feed.json';
export const PUBLIC_SCOUT_LIMITS=Object.freeze({bytes:65536,timeout_ms:8000,poll_ms:60000,history_ms:3600000,history_records:40});
const snapshots=new WeakSet();
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const fail=code=>{throw Object.assign(Error(code),{publicCode:code});};
const clone=value=>JSON.parse(JSON.stringify(value));

async function boundedResponse(response,signal){
 if(!response?.ok)fail('unavailable');
 if(response.redirected||response.url&&response.url!==PUBLIC_SCOUT_URL)fail('untrusted_source');
 const length=response.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>PUBLIC_SCOUT_LIMITS.bytes))fail('response_too_large');
 const type=(response.headers?.get('content-type')??'').split(';')[0].trim().toLowerCase();
 if(!['application/json','text/plain'].includes(type))fail('invalid_content_type');
 const reader=response.body?.getReader?.();if(!reader)fail('unbounded_response');
 let size=0;const chunks=[];
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  for(;;){if(signal.aborted)fail('timeout');const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))fail('invalid_encoding');size+=value.byteLength;
   if(size>PUBLIC_SCOUT_LIMITS.bytes)fail('response_too_large');chunks.push(value);
  }
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(all);}catch{fail('invalid_encoding');}
 }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});}
}

export function createPublicScoutFeed({fetch:fetcher=globalThis.fetch,now=()=>Date.now(),onChange=()=>{},setTimeout:delay=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout}={}){
 let latest=null,status='waiting',error=null,lastAttempt=-Infinity,clockFence=-Infinity,disposed=false,epoch=0,pending=null,controller=null;
 let activity=[];
 function time(){const value=now();if(!Number.isFinite(value))fail('clock_unavailable');if(value<clockFence)fail('clock_rollback');clockFence=value;return value;}
 function snapshot(){
  let current;try{current=time();}catch{current=clockFence;status='unavailable';error='clock_unavailable';}
  activity=activity.filter(record=>current-Date.parse(record.at)<=PUBLIC_SCOUT_LIMITS.history_ms).slice(-PUBLIC_SCOUT_LIMITS.history_records);
  const stale=latest&&current>=Date.parse(latest.feed.discovery_expires_at);
  const out=freeze({version:1,status:stale?'stale':status,error,evaluated_at:Number.isFinite(current)?current:null,feed:latest?.feed??null,assessments:(latest?.assessments??[]).map(a=>current>=Date.parse(a.expires_at)?{...a,status:'expired',reject_reasons:[...new Set([...a.reject_reasons,'lead_expired'])]}:a),digest:latest?.digest??null,records:[...activity]});snapshots.add(out);return out;
 }
 function emit(){const out=snapshot();if(!disposed)try{Promise.resolve(onChange(out)).catch(()=>{});}catch{}return out;}
 function disconnect(){if(disposed)return snapshot();epoch++;controller?.abort();controller=null;pending=null;status='unavailable';error='offline';return emit();}
 async function refresh(){
  if(disposed)return snapshot();if(pending)return pending;
  let n;try{n=time();}catch{status='unavailable';error='clock_unavailable';return emit();}
  if(n-lastAttempt<PUBLIC_SCOUT_LIMITS.poll_ms)return snapshot();lastAttempt=n;
  const revision=++epoch;controller=new AbortController();const localController=controller;
  status='loading';error=null;
  // The shared request is assigned before any observer is called.
  let resolve;pending=new Promise(done=>{resolve=done;});const result=pending;
  emit();
  if(disposed||revision!==epoch){resolve(snapshot());return result;}
  let timer;
  const timeout=new Promise((_,reject)=>{timer=delay(()=>{localController.abort();reject(Object.assign(Error('timeout'),{publicCode:'timeout'}));},PUBLIC_SCOUT_LIMITS.timeout_ms);});
  const work=(async()=>{
   if(typeof fetcher!=='function')fail('unavailable');
   const response=await fetcher(PUBLIC_SCOUT_URL,{method:'GET',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',signal:localController.signal});
   const raw=await boundedResponse(response,localController.signal);
   const checked=await validatePublicFeed(raw,{now_ms:time(),...(latest?{last_seen:{completed_at:latest.feed.run.completed_at,digest:latest.digest}}:{})});
   if(!checked.ok)fail('invalid_feed');
   if(latest&&checked.digest!==latest.digest&&BigInt(checked.feed.run.workflow_run_id)<=BigInt(latest.feed.run.workflow_run_id))fail('invalid_feed');return checked;
  })();
  try{
   const checked=await Promise.race([work,timeout]);
   if(disposed||revision!==epoch)return snapshot();
   const fresh=latest?.digest!==checked.digest;
   latest=freeze({feed:clone(checked.feed),assessments:clone(checked.assessments),digest:checked.digest});
   status='ready';error=null;
   if(fresh)activity.push(...scoutActivityRecords(latest.feed,latest.digest));
  }catch(e){if(!disposed&&revision===epoch){status='unavailable';error=['timeout','untrusted_source','response_too_large','invalid_content_type','unbounded_response','invalid_encoding','invalid_feed','clock_unavailable','clock_rollback'].includes(e?.publicCode)?e.publicCode:'unavailable';}}
  finally{cancel(timer);if(revision===epoch){pending=null;controller=null;emit();}resolve(snapshot());}
  return result;
 }
 function dispose(){disposed=true;epoch++;controller?.abort();controller=null;pending=null;}
 return {refresh,disconnect,snapshot,dispose};
}

// An event can carry only an immutable snapshot made by this validated transport.
// A cloned/forged DOM payload cannot inject a completed scan or a reviewer claim.
export function readPublicScoutSnapshot(value){return value&&snapshots.has(value)?value:null;}

export function publicScoutDisplay(snapshot,{now=Date.now()}={}){
 const s=readPublicScoutSnapshot(snapshot),feed=s?.feed;
 if(s?.evaluated_at!==null&&s?.evaluated_at!==undefined)now=Math.max(now,s.evaluated_at);
 if(!feed)return {status:s?.status==='loading'?'CHECKING':s?.status==='unavailable'?'UNAVAILABLE':'WAITING',output:'Scheduled public scout · waiting for a verified scan.',at:null,evidence:'No verified scheduled broad scan received. Public discovery is separate from fresh entry quotes. No independent reviewer or trade approval is inferred.',markerState:s?.status==='unavailable'?'offline':'waiting',key:null};
 const stale=!Number.isFinite(now)||now<Date.parse(feed.run.completed_at)||now>=Date.parse(feed.discovery_expires_at),offline=s.status==='unavailable'||s.error!==null,c=feed.coverage;
 const health=sourceHealth(feed),coverage=coverageText(c),leadCount=feed.leads.length;
 const heading=stale?(offline?'STALE · OFFLINE':'STALE'):offline?'OFFLINE':s.status==='loading'?'CHECKING':feed.run.status==='failed'?'RUN FAILED':feed.run.status==='initializing'?'INITIALIZING':feed.run.status==='recovery_needed'?'RECOVERY NEEDED':health.venues===0?'DATA UNAVAILABLE':health.venues<2?'PARTIAL SCAN':'SCAN RECORDED';
 const details=[`Scheduled deterministic public scan · ${feed.run.acquisition_mode==='capture_replay'?'original capture replay':feed.run.acquisition_mode==='none'?'no acquisition':'public-data read'}. Run ${feed.run.status} at ${feed.run.completed_at}; display expires ${feed.discovery_expires_at}. ${coverage}. ${leadCount} research leads; independent review awaiting.`,
  `Schedule: every 15 minutes at :07, :22, :37 and :52 UTC; GitHub scheduling can be delayed. ${stale?'This discovery snapshot is stale. ':''}${offline?'Feed unavailable; showing the last verified scan.':'This is bounded discovery coverage, not continuous live monitoring.'}`,
  ...(feed.run.status==='recovery_needed'?[`Acquisition paused until prior workflow run ${feed.run.recovery_required_run_id} is reconciled.`]:[]),
  ...(feed.run.status==='completed'&&health.venues<2?[health.venues===0?'Public source acquisition is unavailable; no completed market coverage is established.':'Partial scan: one venue source is unavailable; counts cover received data only.']:[]),
  ...feed.sources.map(source=>`Source capture ${source.source_id}: ${source.status}; observed ${source.observed_at}; earliest sample ${source.sample_lower_bound}; SHA-256 ${source.sha256}.`),
  ...health.missing.map(name=>`Source capture ${name}: missing.`),
  ...rejectionText(feed),
  ...feed.leads.map(({payload:p,evidence_sha256})=>leadText(p,evidence_sha256,now)),
  `Finder: ${feed.producer.finder.display_name} (deterministic). Checker: ${feed.producer.checker.display_name} (deterministic). Independent reviewer: awaiting; no independent review receipt. No lead is execution eligible. New paper-entry quotes and all existing execution checks remain separate.`,
  `Provenance: source commit ${feed.run.source_commit}; workflow run ${feed.run.workflow_run_id}; envelope SHA-256 ${s.digest}.`,
  ...Object.entries(feed.provider_status??{}).filter(([,p])=>p.reason_code).map(([venue,p])=>`${venue} public source refusal: ${p.reason_code}; ${p.permanent?'paused pending resolution':p.blocked_until?'cooldown until '+p.blocked_until:'not retried'}.`)
 ];
 return {status:heading,output:c&&health.venues?`${c.screened_identities} screened · ${leadCount} leads · ${health.venues<2?'partial data · ':''}review awaiting`:'Coverage unavailable · no completed scan',at:new Date(feed.run.completed_at).toISOString(),evidence:details.join('\n\n'),markerState:stale?'stale':offline||health.venues===0?'offline':'snapshot',key:s.digest};
}

function sourceHealth(feed){const map=new Map(feed.sources.map(s=>[s.source_id,s.status]));return {venues:Number(map.get('kraken_metadata')==='ok'&&map.get('kraken_tickers')==='ok')+Number(map.get('hyperliquid_bulk')==='ok'),missing:['kraken_metadata','kraken_tickers','hyperliquid_bulk'].filter(id=>!map.has(id))};}
function coverageText(c){if(!c)return 'Coverage unavailable';return `${c.screened_identities} screened · ${c.kraken} Kraken / ${c.hyperliquid} Hyperliquid · ${c.coarse_passes} coarse passes`;}
function rejectionText(feed){if(!feed.coarse_rejections)return ['No completed coarse screen or rejection totals available.'];return [`Recorded coarse rejections: ${Object.entries(feed.coarse_rejections).map(([reason,count])=>`${reason.replaceAll('_',' ')}: ${count}`).join('; ')}. Counts are screen checks, not independent investment reviews.`];}
function leadText(p,digest,now){
 const expired=!Number.isFinite(now)||now>=Date.parse(p.expires_at),failed=p.deterministic_checks.filter(x=>x.status==='failed'),unknown=p.deterministic_checks.filter(x=>x.status==='unknown');
 return `${p.identity.venue} · ${p.identity.pair} · exact instrument ${p.identity.instrument_id} · base ${p.identity.base_id} / quote ${p.identity.quote_id}. ${expired?'Quote evidence expired':'Time-bounded quote evidence; not an entry quote'} (expires ${p.expires_at}). Independent review awaiting. ${failed.length?'Recorded failed checks: '+failed.map(x=>x.check_id.replaceAll('_',' ')+': '+x.reason).join('; ')+'. ':''}${unknown.length?'Unknown checks: '+unknown.map(x=>x.check_id.replaceAll('_',' ')).join(', ')+'. ':''}Evidence SHA-256 ${digest}.`;
}
function scoutActivityRecords(feed,digest){
 const key='scout:'+digest,at=feed.run.completed_at,health=sourceHealth(feed);
 return [freeze({key,at,kind:'public_scout',text:`Deterministic scheduled scout · ${feed.run.status} · ${health.venues?coverageText(feed.coverage)+(health.venues<2?' · partial source data':''):'public data unavailable'} · ${feed.leads.length} research leads · independent review awaiting${feed.run.acquisition_mode==='capture_replay'?' · original capture replay':''}`}),
  ...rejectionText(feed).map((text,i)=>freeze({key:key+':rejections:'+i,at,kind:'public_scout',text})),
  ...feed.leads.map(({payload:p,evidence_sha256},i)=>freeze({key:key+':lead:'+i,at,kind:'public_scout',text:`Research lead · ${p.identity.venue} ${p.identity.pair} · instrument ${p.identity.instrument_id} · deterministic evidence only · ${p.deterministic_checks.filter(c=>c.status==='failed').map(c=>'failed '+c.check_id.replaceAll('_',' ')).join('; ')||'no failed check recorded; qualification unconfirmed'} · independent review awaiting · quote expires ${p.expires_at} · evidence ${evidence_sha256}`}))];
}
