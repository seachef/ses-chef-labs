import {PUBLIC_WORK_SOURCES} from './team-public-source.mjs';
export const TEAM_WORK_LIMITS=Object.freeze({worker_fresh_ms:60000,publisher_fresh_ms:60000,worker_display_ms:21600000,recent_display_ms:3600000,worker_slots:6,recent_slots:8});
export const WORK_ROLES=Object.freeze({builder:'Builder',tester:'Tester',reviewer:'Reviewer'});
export const WORK_TASKS=Object.freeze({team_work:'Team work window',frontend:'Frontend',backend:'Backend',public_feeds:'Public feeds',paper_engine:'Paper engine',accessibility:'Accessibility'});
export const WORK_STEPS=Object.freeze({session_started:'Session started',publisher_heartbeat:'Publisher heartbeat',session_closed:'Session closed',task_started:'Task started',status_observed:'Status observed',source_inspected:'Source inspected',source_changed:'Source changed',tests_started:'Tests started',tests_passed:'Tests passed',tests_failed:'Tests failed',review_started:'Review started',review_passed:'Review passed',review_changes_requested:'Changes requested',waiting_for_review:'Waiting for review',blocked:'Blocked',task_completed:'Task completed',task_failed:'Task failed'});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const time=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const fresh=(value,now,limit)=>time(value)&&now-Date.parse(value)>=0&&now-Date.parse(value)<=limit;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const stable=value=>JSON.stringify(value);
function sourceRef(value){
 if(value===null)return null;
 if(!plain(value)||value.repository!=='seachef/ses-chef-labs'||!['published_reference','candidate'].includes(value.scope))return false;
 if(typeof value.path!=='string'||! /^(?:preview\/research-desk\/[a-z0-9-]+\.(?:mjs|html|css)|backend\/neptune-paper\/[a-z0-9-]+\.(?:sql|json|py)|backend\/neptune-paper\/test\/[a-z0-9-]+\.test\.mjs)$/.test(value.path)||value.path.includes('..')||value.path.length>160)return false;
 if(typeof value.function_name!=='string'||!/^[A-Za-z_][A-Za-z0-9_.]{0,99}$/.test(value.function_name)||!sha(value.file_sha256))return false;
 if(value.snippet_sha256!==null&&!sha(value.snippet_sha256))return false;
 if(value.scope==='published_reference'?!/^[a-f0-9]{40}$/.test(value.commit):value.commit!==null)return false;
 return Object.freeze({repository:value.repository,scope:value.scope,path:value.path,function_name:value.function_name,commit:value.commit,file_sha256:value.file_sha256,snippet_sha256:value.snippet_sha256});
}
function resultRef(value,candidate){
 if(value===null)return null;
 if(!plain(value)||!['test','review'].includes(value.kind)||!['passed','failed','changes_requested'].includes(value.verdict)||!sha(value.target_sha256)||value.target_sha256!==candidate||!sha(value.artifact_sha256))return false;
 if(![null,'frontend_tests','backend_tests','bridge_tests','syntax_checks'].includes(value.command_id))return false;
 if(![value.passed,value.failed].every(v=>v===null||integer(v)&&v<=999999)||!(value.exit_code===null||Number.isInteger(value.exit_code)&&value.exit_code>=0&&value.exit_code<=255))return false;
 if(value.kind==='test'&&(value.command_id===null||value.passed===null||value.failed===null||value.exit_code===null))return false;
 if(value.kind==='test'&&value.verdict==='passed'&&(value.failed!==0||value.exit_code!==0))return false;
 if(value.kind==='review'&&value.command_id!==null)return false;
 return Object.freeze({kind:value.kind,verdict:value.verdict,target_sha256:value.target_sha256,artifact_sha256:value.artifact_sha256,command_id:value.command_id,passed:value.passed,failed:value.failed,exit_code:value.exit_code});
}
function workerFields(raw,now){
 if(!uuid(raw.actor_id)||!Object.hasOwn(WORK_ROLES,raw.role)||!uuid(raw.run_id)||!integer(raw.run_seq)||!['running','blocked','completed','failed'].includes(raw.state)||!Object.hasOwn(WORK_TASKS,raw.task)||!Object.hasOwn(WORK_STEPS,raw.step))return null;
 if(!time(raw.observed_at)||!time(raw.received_at)||Date.parse(raw.observed_at)>Date.parse(raw.received_at)||Date.parse(raw.received_at)>now)return null;
 if(raw.candidate_sha256!==null&&!sha(raw.candidate_sha256)||raw.handoff_from_run_id!==null&&(!uuid(raw.handoff_from_run_id)||raw.handoff_from_run_id===raw.run_id))return null;
 if(raw.run_seq===0&&(raw.step!=='task_started'||raw.state!=='running'))return null;
 if(raw.step==='source_changed'&&(raw.source===null||raw.candidate_sha256===null))return null;
 const source=sourceRef(raw.source),result=resultRef(raw.result,raw.candidate_sha256);if(source===false||result===false)return null;
 if(raw.run_seq>1000000000||raw.run_seq>0&&raw.step==='task_started'||['session_started','publisher_heartbeat','session_closed'].includes(raw.step))return null;
 if(raw.step==='source_changed'&&source?.scope!=='candidate')return null;
 if(raw.state==='blocked'&&!['blocked','waiting_for_review'].includes(raw.step)||raw.state==='failed'&&!['task_failed','tests_failed'].includes(raw.step)||raw.state==='completed'&&!['task_completed','tests_passed','review_passed','review_changes_requested'].includes(raw.step)||raw.state==='running'&&['blocked','waiting_for_review','task_completed','task_failed'].includes(raw.step))return null;
 if(result&&(raw.state!=='completed'&&raw.state!=='failed'||['tests_passed','review_passed','review_changes_requested'].includes(raw.step)&&raw.state!=='completed'||raw.step==='tests_failed'&&raw.state!=='failed'))return null;
 if(result?.kind==='test'&&(!['tests_passed','tests_failed'].includes(raw.step)||result.verdict!==(raw.step==='tests_passed'?'passed':'failed')||raw.step==='tests_failed'&&result.exit_code===0))return null;
 if(result?.kind==='review'&&(raw.role!=='reviewer'||!['review_passed','review_changes_requested'].includes(raw.step)||result.verdict!==(raw.step==='review_passed'?'passed':'changes_requested')||result.passed!==null||result.failed!==null||result.exit_code!==null))return null;
 if(result===null&&['tests_passed','tests_failed','review_passed','review_changes_requested'].includes(raw.step))return null;
 if(raw.handoff_from_run_id!==null&&raw.run_seq!==0)return null;
 return Object.freeze({actor_id:raw.actor_id,role:raw.role,run_id:raw.run_id,run_seq:raw.run_seq,state:raw.state,task:raw.task,step:raw.step,observed_at:raw.observed_at,received_at:raw.received_at,source,candidate_sha256:raw.candidate_sha256,result,handoff_from_run_id:raw.handoff_from_run_id});
}
export function matchPublicWorkSource(source){
 if(!source||source.scope!=='published_reference'||source.repository!=='seachef/ses-chef-labs')return null;
 return PUBLIC_WORK_SOURCES.find(ref=>['path','function_name','commit','file_sha256','snippet_sha256'].every(key=>source[key]===ref[key]))??null;
}
// Version 2 is a derived current-state cache. Missing history is not a gap in a log.
const positive=v=>integer(v)&&v>0;
const terminal=v=>['completed','failed'].includes(v);
const fingerprint=value=>stable(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='event_number')));
function envelope(item,raw,now,{current=false}={}){
 if(!plain(item)||!uuid(item.id)||!sha(item.payload_sha256)||item.session_id!==raw.session_id||item.session_generation!==raw.session_generation||!integer(item.session_seq)||item.session_seq>1000000000)return null;
 if(!time(item.observed_at)||!time(item.received_at)||Date.parse(item.observed_at)>Date.parse(item.received_at)||Date.parse(item.received_at)>Date.parse(raw.content_at)||Date.parse(item.received_at)>now)return null;
 const base={id:item.id,session_id:item.session_id,session_seq:item.session_seq,session_generation:item.session_generation,kind:item.kind,payload_sha256:item.payload_sha256};
 if(item.kind==='worker_event'){
  const worker=workerFields(item,now);if(!worker||!integer(item.slot)||item.slot<1||item.slot>6||!positive(item.run_generation)||item.session_seq!==0||current&&item.revision!==item.run_seq)return null;
  return Object.freeze({...base,...worker,slot:item.slot,run_generation:item.run_generation,revision:item.run_seq});
 }
 if(current||!['session_opened','session_closed'].includes(item.kind)||item.run_generation!==null||item.slot!==null||item.session_seq>raw.session_revision)return null;
 if(['actor_id','role','run_id','run_seq','state','task','source','candidate_sha256','result','handoff_from_run_id'].some(key=>item[key]!==null))return null;
 if(item.step!==({session_opened:'session_started',session_closed:'session_closed'})[item.kind]||item.kind==='session_opened'&&item.session_seq!==0||item.kind==='session_closed'&&raw.session_state!=='closed'||Date.parse(item.received_at)>Date.parse(raw.publisher_received_at))return null;
 return Object.freeze({...base,observed_at:item.observed_at,received_at:item.received_at,step:item.step,slot:null,run_generation:null,actor_id:null,role:null,run_id:null,run_seq:null,state:null,task:null,source:null,candidate_sha256:null,result:null,handoff_from_run_id:null});
}
export function validateTeamWork(raw,{now=Date.now()}={}){
 try{
  if(!Number.isFinite(now)||!plain(raw)||raw.version!==2||raw.bridge_version!=='team-work-cache-v2'||raw.origin!=='assistant_observed'||raw.history_complete!==false)return null;
  if(new TextEncoder().encode(JSON.stringify(raw)).length>16384||!integer(raw.snapshot_revision)||!integer(raw.session_generation)||!integer(raw.session_revision)||raw.session_revision>1000000000||!['absent','open','closed'].includes(raw.session_state)||raw.session_state==='closed'&&raw.session_revision===0)return null;
  if(!plain(raw.limits)||Object.entries(TEAM_WORK_LIMITS).some(([key,value])=>raw.limits[key]!==value)||!Array.isArray(raw.events)||raw.events.length>8||!Array.isArray(raw.workers)||raw.workers.length>6)return null;
  const header={version:2,bridge_version:'team-work-cache-v2',origin:'assistant_observed',snapshot_revision:raw.snapshot_revision,content_at:raw.content_at,session_id:raw.session_id,session_generation:raw.session_generation,session_revision:raw.session_revision,session_state:raw.session_state,publisher_observed_at:raw.publisher_observed_at,publisher_received_at:raw.publisher_received_at,history_complete:false,limits:TEAM_WORK_LIMITS};
  if(raw.session_state==='absent'){
   if(raw.session_id!==null||raw.session_generation!==0||raw.session_revision!==0||raw.snapshot_revision!==0||raw.content_at!==null||raw.publisher_observed_at!==null||raw.publisher_received_at!==null||raw.events.length||raw.workers.length)return null;
   return Object.freeze({...header,events:Object.freeze([]),workers:Object.freeze([])});
  }
  if(!uuid(raw.session_id)||!positive(raw.session_generation)||!positive(raw.snapshot_revision)||!time(raw.content_at)||Date.parse(raw.content_at)>now||!time(raw.publisher_observed_at)||!time(raw.publisher_received_at)||Date.parse(raw.publisher_observed_at)>Date.parse(raw.publisher_received_at)||Date.parse(raw.publisher_received_at)>Date.parse(raw.content_at))return null;
  const workers=[],slots=new Set(),actors=new Set(),runs=new Set(),workerIds=new Set();
  for(const item of raw.workers){
   const worker=envelope(item,raw,now,{current:true});if(!worker||slots.has(worker.slot)||actors.has(worker.actor_id)||runs.has(worker.run_id)||workerIds.has(worker.id))return null;
   slots.add(worker.slot);actors.add(worker.actor_id);runs.add(worker.run_id);workerIds.add(worker.id);workers.push(worker);
  }
  workers.sort((a,b)=>a.slot-b.slot);
  const latestReceipt=Math.max(Date.parse(raw.publisher_received_at),...workers.map(w=>Date.parse(w.received_at)));
  if(Date.parse(raw.content_at)!==latestReceipt)return null;
  const events=[],numbers=new Set(),ids=new Set();
  for(const item of raw.events){
   const event=envelope(item,raw,now);if(!event||!positive(item.event_number)||item.event_number>raw.snapshot_revision||numbers.has(item.event_number)||ids.has(item.id)||event.step==='status_observed')return null;
   numbers.add(item.event_number);ids.add(item.id);
   const worker=workers.find(w=>w.slot===event.slot);
   if(event.kind==='worker_event'&&!worker)return null;
   if(worker){
    if(event.run_generation>worker.run_generation)return null;
    if(event.run_generation===worker.run_generation&&terminal(event.state)&&event.run_seq<worker.revision)return null;
    if(event.run_generation===worker.run_generation&&(event.run_id!==worker.run_id||event.actor_id!==worker.actor_id||event.role!==worker.role||event.task!==worker.task||event.run_seq>worker.revision||event.run_seq===worker.revision&&fingerprint(event)!==fingerprint(worker)))return null;
   }
   events.push(Object.freeze({...event,event_number:item.event_number}));
  }
  events.sort((a,b)=>a.event_number-b.event_number);
  const eventRuns=new Map();
  for(const event of events){
   if(event.kind!=='worker_event')continue;
   const key=event.slot+':'+event.run_generation,old=eventRuns.get(key);
   if(old&&(event.run_seq<=old.run_seq||terminal(old.state)||['run_id','actor_id','role','task'].some(k=>event[k]!==old[k])))return null;
   eventRuns.set(key,event);
  }
  return Object.freeze({...header,events:Object.freeze(events),workers:Object.freeze(workers)});
 }catch{return null;}
}
export function teamPublisherLive(snapshot,now=Date.now()){
 const report=snapshot.report;
 return !!(snapshot.connected&&report?.session_state==='open'&&fresh(report.content_at,now,TEAM_WORK_LIMITS.worker_display_ms)&&fresh(report.publisher_observed_at,now,60000)&&fresh(report.publisher_received_at,now,60000)&&(snapshot.resume_after===null||Date.parse(report.publisher_observed_at)>snapshot.resume_after));
}
export function teamWorkerState(snapshot,worker,now=Date.now()){
 const report=snapshot.report;
 if(!worker)return {state:'empty',label:'UNASSIGNED',live:false};
 if(!fresh(worker.received_at,now,TEAM_WORK_LIMITS.worker_display_ms))return {state:'expired',label:'RECORD EXPIRED',live:false};
 if(!snapshot.connected||!report)return {state:'offline',label:'OFFLINE',live:false};
 if(report.session_state!=='open')return {state:'closed',label:'SESSION CLOSED',live:false};
 if(!teamPublisherLive(snapshot,now))return {state:'offline',label:'PUBLISHER OFFLINE',live:false};
 if(terminal(worker.state)||worker.state==='blocked')return {state:worker.state,label:worker.state.toUpperCase(),live:false};
 if(!fresh(worker.observed_at,now,60000)||!fresh(worker.received_at,now,60000)||snapshot.resume_after!==null&&Date.parse(worker.observed_at)<=snapshot.resume_after)return {state:'unconfirmed',label:'STATUS UNCONFIRMED',live:false};
 return {state:'working',label:'OBSERVED WORKING',live:true};
}
export function createTeamWorkStore(){
 let report=null,connected=false,revision=0,resumeAfter=null,lastNow=-Infinity,eventHighWater=0;
 // These six fences survive payload/display expiry and session changes.
 const fences=new Map(),eventProofs=new Map();
 function reject(){connected=false;revision++;return {accepted:false,pulses:[],handoffs:[]};}
 return {
  ingest(raw,{now=Date.now()}={}){
   if(now<lastNow){resumeAfter=Math.max(resumeAfter??-Infinity,lastNow);return reject();}lastNow=now;
   const next=validateTeamWork(raw,{now});if(!next)return reject();
   if(report){
    if(next.snapshot_revision<report.snapshot_revision||next.session_generation<report.session_generation)return reject();
    if(next.snapshot_revision===report.snapshot_revision&&stable(next)!==stable(report))return reject();
    if(next.session_generation===report.session_generation){
     if(next.session_id!==report.session_id||next.session_revision<report.session_revision)return reject();
     if(next.session_revision===report.session_revision&&['session_state','publisher_observed_at','publisher_received_at'].some(k=>next[k]!==report[k]))return reject();
     if(next.session_revision>report.session_revision&&(report.session_state!=='open'||Date.parse(next.publisher_observed_at)<=Date.parse(report.publisher_observed_at)||Date.parse(next.publisher_received_at)<Date.parse(report.publisher_received_at)))return reject();
    }else if(next.snapshot_revision<=report.snapshot_revision||next.session_id===report.session_id)return reject();
    if(report.content_at&&(!next.content_at||Date.parse(next.content_at)<Date.parse(report.content_at)))return reject();
   }
   for(const worker of next.workers){
    const old=fences.get(worker.slot);if(!old)continue;
    if(worker.run_generation<old.run_generation)return reject();
    if(worker.run_generation===old.run_generation){
     if(worker.session_generation!==old.session_generation||worker.run_id!==old.run_id||worker.actor_id!==old.actor_id||worker.role!==old.role||worker.task!==old.task||worker.revision<old.revision)return reject();
     if(worker.revision===old.revision&&fingerprint(worker)!==fingerprint(old))return reject();
     if(worker.revision>old.revision&&(terminal(old.state)||Date.parse(worker.observed_at)<=Date.parse(old.observed_at)||Date.parse(worker.received_at)<Date.parse(old.received_at)))return reject();
     // A missing intermediate source_changed is allowed: this is not complete history.
     if(worker.revision===old.revision+1&&worker.candidate_sha256!==old.candidate_sha256&&worker.step!=='source_changed')return reject();
    }
   }
   for(const event of next.events){const old=eventProofs.get(event.event_number);if(old&&old!==stable(event))return reject();}
   const newEvents=next.events.filter(event=>event.event_number>eventHighWater);
   for(const worker of next.workers)fences.set(worker.slot,worker);
   eventProofs.clear();for(const event of next.events){eventProofs.set(event.event_number,stable(event));eventHighWater=Math.max(eventHighWater,event.event_number);}
   report=next;connected=true;revision++;
   const snapshot={report,connected,resume_after:resumeAfter},eligible=teamPublisherLive(snapshot,now);
   const pulses=eligible?newEvents.filter(e=>e.kind==='worker_event'&&fresh(e.observed_at,now,15000)&&fresh(e.received_at,now,15000)&&(resumeAfter===null||Date.parse(e.observed_at)>resumeAfter)).map(e=>e.actor_id):[];
   const handoffs=[];
   if(eligible)for(const event of newEvents){
    if(event.kind!=='worker_event'||event.step!=='task_started'||!event.handoff_from_run_id||!fresh(event.observed_at,now,15000)||resumeAfter!==null&&Date.parse(event.observed_at)<=resumeAfter)continue;
    const origin=next.events.find(item=>item.kind==='worker_event'&&item.run_id===event.handoff_from_run_id&&item.state==='completed');
    if(origin&&origin.actor_id!==event.actor_id&&origin.event_number<event.event_number&&origin.candidate_sha256!==null&&origin.candidate_sha256===event.candidate_sha256&&Date.parse(origin.observed_at)<=Date.parse(event.observed_at))handoffs.push(Object.freeze({from:origin.actor_id,to:event.actor_id,event_id:event.id}));
   }
   return {accepted:true,pulses:[...new Set(pulses)],handoffs};
  },
  checkClock({now=Date.now()}={}){if(now<lastNow){resumeAfter=Math.max(resumeAfter??-Infinity,lastNow);connected=false;revision++;}else lastNow=now;},
  disconnect(){connected=false;revision++;},
  pause({now=Date.now()}={}){resumeAfter=Math.max(resumeAfter??-Infinity,now,lastNow);connected=false;revision++;},
  snapshot(){return Object.freeze({report,connected,revision,resume_after:resumeAfter,fence_count:fences.size,event_proof_count:eventProofs.size});}
 };
}
