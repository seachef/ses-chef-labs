import {setupMarketWeb} from './agent-web.mjs?v=spider-web-20261010';
import {setupCodingWorkers} from './team-worker-view.mjs?v=team-worker-spider-web-20261010';
// A local observation viewer. This is not a coding-worker transport.
const MAX_TEXT=1600, MAX_SOURCE=12000, MAX_EVENTS=40, ACTIVE_MS=15000;
const PATH='preview/research-desk/neptune.mjs';
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
export function redactWorkText(value,limit=MAX_TEXT){
 if(typeof value!=='string')return '';
 return value
  .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/g,'[redacted credential]')
  .replace(/\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:sk|ghp|github_pat|sb_secret)[-_][A-Za-z0-9_-]{12,})\b/g,'[redacted token]')
  .replace(/\b(Bearer\s+)\S+/gi,'$1[redacted]')
  .replace(/\b(api[_-]?key|password|secret|access[_-]?token|authorization|cookie|account[_-]?id|wallet[_-]?address)\b\s*[:=]\s*(['"]?)[^\s,;\n]+/gi,'$1=[redacted]')
  .replace(/\b0x[a-fA-F0-9]{40,}\b/g,'[redacted address]')
  .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,'[redacted email]')
  .replace(/(?:[A-Za-z]:\\(?:Users|Documents)\\|\/(?:Users|home|root|workspace|private|tmp)\/)[^\s'"<>]*/g,'[redacted private path]')
  .replace(/https?:\/\/[^\s'"<>]+/g,'[redacted URL]')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'')
  .slice(0,Math.max(0,Math.min(limit,MAX_SOURCE)));
}
export function validateWorkEvent(raw,{now=Date.now()}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 // No coding_agent or reviewer can become live through this local browser channel.
 if(raw.version!==1||raw.actor_kind!=='browser_check'||raw.actor_id!=='browser-interface')return null;
 if(!['started','completed','failed'].includes(raw.kind)||!iso(raw.occurred_at))return null;
 const at=Date.parse(raw.occurred_at);if(at>now||now-at>60000)return null;
 if(typeof raw.run_id!=='string'||!/^interface:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z:\d{1,12}$/.test(raw.run_id))return null;
 if(raw.id!==raw.run_id+':'+raw.kind||raw.seq!==(raw.kind==='started'?0:1))return null;
 if(raw.task!=='Refresh public paper status'||raw.source?.path!==PATH||raw.source?.function_name!=='refreshFeed')return null;
 if(raw.source.commit!==null||raw.source.file_sha256!==null)return null;
 if(raw.evidence?.kind!=='local_invocation'||raw.evidence.id!==raw.run_id||!iso(raw.evidence.at))return null;
 if(Date.parse(raw.evidence.at)>at||raw.run_id.split('interface:')[1].slice(0,24)!==raw.evidence.at)return null;
 if(raw.kind==='started'&&raw.evidence.at!==raw.occurred_at)return null;
 if(raw.output?.exit_code!==null||raw.review!==null)return null;
 const expected=raw.kind==='started'?['Read-only status request started']:raw.kind==='failed'?['Status request failed; data unavailable']:['Status response received and validated','Empty status response received'];
 if(!expected.includes(raw.output?.summary))return null;
 return Object.freeze({version:1,id:raw.id,run_id:raw.run_id,seq:raw.seq,actor_id:raw.actor_id,actor_kind:raw.actor_kind,kind:raw.kind,occurred_at:raw.occurred_at,received_at:new Date(now).toISOString(),task:raw.task,source:Object.freeze({path:PATH,function_name:'refreshFeed',commit:null,file_sha256:null}),evidence:Object.freeze({kind:'local_invocation',id:raw.run_id,at:raw.evidence.at}),output:Object.freeze({summary:raw.output.summary,exit_code:null}),review:null});
}
export function createWorkStore(){
 const events=[],runs=new Map();let lastStarted=-Infinity,lastRunIndex=-1,rejected=0;
 return {
  ingest(raw,options){
   const event=validateWorkEvent(raw,options);if(!event){rejected++;return false;}
   const existing=runs.get(event.run_id),started=Date.parse(event.evidence.at),index=Number(event.run_id.split(':').at(-1));
   if(event.kind==='started'){
    // Monotonic per-page run index prevents replays after bounded history eviction.
    if(existing){if(JSON.stringify({...existing.started,received_at:null})!==JSON.stringify({...event,received_at:null}))rejected++;return false;}
    if(started<lastStarted||index<=lastRunIndex)return false;
    lastStarted=started;lastRunIndex=index;runs.set(event.run_id,{started:event,terminal:null});
   }else{
    if(existing?.terminal){if(JSON.stringify({...existing.terminal,received_at:null})!==JSON.stringify({...event,received_at:null}))rejected++;return false;}
    if(!existing||Date.parse(event.occurred_at)<Date.parse(existing.started.occurred_at)){rejected++;return false;}
    existing.terminal=event;
   }
   events.unshift(event);events.splice(MAX_EVENTS);
   while(runs.size>MAX_EVENTS)runs.delete(runs.keys().next().value);
   return true;
  },
  snapshot(){return Object.freeze({events:Object.freeze([...events]),rejected});}
 };
}
export function workState(snapshot,now=Date.now()){
 const newestRun=snapshot.events.reduce((latest,event)=>Math.max(latest,Number(event.run_id.split(':').at(-1))),-1);
 const event=snapshot.events.find(event=>Number(event.run_id.split(':').at(-1))===newestRun);
 if(!event)return {coding:'NOT CONNECTED',local:'Waiting for an observed check',event:null};
 const age=now-Date.parse(event.occurred_at);
 if(!Number.isFinite(age)||age<0)return {coding:'NOT CONNECTED',local:'Timestamp unavailable',event};
 if(event.kind==='started')return {coding:'NOT CONNECTED',local:age<=ACTIVE_MS?'CHECKING · local invocation':'WAITING · check has no recent completion',event};
 return {coding:'NOT CONNECTED',local:(event.kind==='failed'?'FAILED':'COMPLETED')+(age>ACTIVE_MS?' · previous local check':' · local check'),event};
}
export function validateBuildHistory(history,{now=Date.now()}={}){
 if(history?.version!==1||!Array.isArray(history.checks)||history.checks.length<1||history.checks.length>8)return null;
 const seen=new Set(),checks=[];
 for(const check of history.checks){
  if(!check||check.kind!=='test_run'||check.status!=='completed'||!iso(check.started_at)||!iso(check.completed_at))return null;
  if(Date.parse(check.completed_at)<Date.parse(check.started_at)||Date.parse(check.completed_at)>now)return null;
  if(check.exit_code!==0||!Number.isInteger(check.passed)||check.passed<1||check.passed>100000||check.failed!==0)return null;
  if(!/^[a-f0-9]{64}$/.test(check.source_set_sha256)||!/^[a-f0-9]{64}$/.test(check.log_sha256))return null;
  if(!['Frontend tests','Backend tests'].includes(check.label)||seen.has(check.label))return null;
  if(check.command!==(check.label==='Frontend tests'?'node --test *.test.mjs':'npm test'))return null;
  seen.add(check.label);checks.push(Object.freeze({kind:'test_run',status:'completed',label:check.label,command:check.command,started_at:check.started_at,completed_at:check.completed_at,exit_code:0,passed:check.passed,failed:0,source_set_sha256:check.source_set_sha256,log_sha256:check.log_sha256}));
 }
 return Object.freeze(checks);
}
const localTime=at=>iso(at)?new Date(at).toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC'):'Timestamp unavailable';
export function setupTeamWork({document,fetch:fetcher,now=()=>Date.now(),setInterval:schedule,clearInterval:unschedule}={}){
 const $=id=>document.getElementById(id);if(!$('teamWorkDialog'))return null;
 const coding=setupCodingWorkers({document,now}),marketWeb=setupMarketWeb({document,now});
 const store=createWorkStore();let source='',timer=null,disposed=false,renderedEvents=null;
 const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
 function render(){
  const snapshot=store.snapshot(),state=workState(snapshot,now());if(!coding)text('teamCodingState',state.coding);text('teamLocalState','INTERFACE · '+state.local);
  text('teamLocalOutput',state.event?.output.summary??'No observed interface result yet.');
  text('teamLocalTime',state.event?localTime(state.event.occurred_at):'No interface event yet');
  text('teamProofStatus',snapshot.rejected?'Some incomplete or invalid local browser events were withheld.':'Browser observations are separate from the coding-worker records above.');
  if(!source){const loaded=$('codeSource')?.textContent;if(loaded?.startsWith('async function refreshFeed(')){source=redactWorkText(loaded,MAX_SOURCE);if(source!==loaded)text('teamSourceIdentity','Loaded function reference with safety redactions or length limit applied; file commit and deployed backend identity unverified.');text('teamFullSource',source);if(coding)coding.setBrowserSource(source);else text('teamCodePreview',source.split('\n').slice(0,5).join('\n'));}}
  coding?.render();
  const eventSignature=snapshot.events.map(event=>event.id).join('|');
  if($('teamWorkDialog').open&&eventSignature!==renderedEvents){
   renderedEvents=eventSignature;
   const rows=snapshot.events.map(event=>{const li=document.createElement('li');li.textContent=`${localTime(event.occurred_at)} · ${event.kind.toUpperCase()} · ${event.output.summary}\nBrowser interface · refreshFeed() · ${event.run_id}\nEvidence: local invocation · source: loaded function · review: not reviewed`;return li;});
   if(!rows.length){const li=document.createElement('li');li.textContent='No observed interface calls.';rows.push(li);}$('teamWorkEvents').replaceChildren(...rows);
  }
 }
 function receive(event){if(!disposed&&store.ingest(event.detail,{now:now()}))render();}
 document.addEventListener('neptune:interface-work',receive);
 const open=()=>{if(!$('teamWorkDialog').open)$('teamWorkDialog').showModal();render();};
 const close=()=>{$('teamWorkDialog').close();};
 const stopTimer=()=>{if(timer!==null){unschedule?.(timer);timer=null;}};
 $('openTeamWork').addEventListener('click',open);$('closeTeamWork').addEventListener('click',close);$('teamWorkDialog').addEventListener('close',render);
 // The ordinary app's real polling updates the preview. This timeout-free path
 // creates no events, simulated work, animation, or invented progress.
 render();if(schedule)timer=schedule(()=>{if(!document.hidden)render();},1000);
 async function readHistory(){
  if(!fetcher)return;
  try{
   const response=await fetcher('./team-work-history.json',{credentials:'omit',cache:'no-store'});if(!response.ok)return;
   const history=await response.json();if(disposed)return;const checks=validateBuildHistory(history,{now:now()});if(!checks)return;
   const rows=checks.map(check=>{const li=document.createElement('li');li.textContent=`${check.label} · COMPLETED · ${check.passed} passed / 0 failed\n${localTime(check.completed_at)} · command: ${check.command} · exit 0\nReceipt source-set SHA-256: ${check.source_set_sha256}\nTest log SHA-256: ${check.log_sha256}\nHistorical local check · loaded page/source-set match not checked · review: not independently verified`;return li;});
   $('teamBuildHistory').replaceChildren(...rows);
  }catch{/* Keep the truthful missing-evidence state. */}
 }
 void readHistory();
 return {store,render,dispose(){disposed=true;coding?.dispose();marketWeb?.dispose();stopTimer();document.removeEventListener('neptune:interface-work',receive);}};
}
if(typeof document!=='undefined')setupTeamWork({document,fetch:globalThis.fetch?.bind(globalThis),setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval});
