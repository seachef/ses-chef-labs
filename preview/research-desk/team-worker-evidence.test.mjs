import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {validateTeamWork,createTeamWorkStore,teamWorkerState,matchPublicWorkSource,TEAM_WORK_LIMITS} from './team-worker-evidence.mjs';import {PUBLIC_WORK_SOURCES} from './team-public-source.mjs';import {setupCodingWorkers} from './team-worker-view.mjs';
const T=Date.parse('2026-10-10T00:00:00.000Z'),iso=n=>new Date(n).toISOString(),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),SID=id(1),ACTOR=id(2),RUN=id(3),HASH='a'.repeat(64);
const source=()=>({repository:'seachef/ses-chef-labs',scope:'published_reference',...Object.fromEntries(['path','function_name','commit','file_sha256','snippet_sha256'].map(k=>[k,PUBLIC_WORK_SOURCES[0][k]]))});
function ev(seq,o={}){const kind=o.kind??'worker_event',w=kind==='worker_event';return {id:id(100+seq),event_number:seq,session_id:SID,session_generation:1,session_seq:w?0:seq-1,kind,observed_at:iso(T+seq*1000),received_at:iso(T+seq*1000),payload_sha256:String(seq%10).repeat(64),slot:w?1:null,run_generation:w?1:null,actor_id:w?ACTOR:null,role:w?'builder':null,run_id:w?RUN:null,run_seq:w?0:null,state:w?'running':null,task:w?'team_work':null,step:w?'task_started':({session_opened:'session_started',publisher_heartbeat:'publisher_heartbeat',session_closed:'session_closed'})[kind],source:w?source():null,candidate_sha256:w?HASH:null,result:null,handoff_from_run_id:null,...o};}
const open=()=>ev(1,{kind:'session_opened'});
function packet(events,headers={}){const workers=new Map();for(const e of events)if(e.kind==='worker_event'){const {event_number,...w}=e;workers.set(e.slot,{...w,revision:e.run_seq});}const last=events.at(-1),pub=events.filter(e=>e.kind!=='worker_event').at(-1);return {version:2,bridge_version:'team-work-cache-v2',origin:'assistant_observed',content_at:last.received_at,session_id:SID,session_generation:1,session_revision:pub.session_seq,session_state:pub.kind==='session_closed'?'closed':'open',publisher_observed_at:pub.observed_at,publisher_received_at:pub.received_at,snapshot_revision:last.event_number,events:events.filter(e=>e.kind!=='publisher_heartbeat'&&e.step!=='status_observed').slice(-8),workers:[...workers.values()].sort((a,b)=>a.slot-b.slot),history_complete:false,limits:{...TEAM_WORK_LIMITS},...headers};}
const load=(s,events,now=T+events.at(-1).event_number*1000)=>s.ingest(packet(events),{now});const state=(s,now,i=0)=>teamWorkerState(s.snapshot(),s.snapshot().report?.workers[i],now);const start=()=>{const s=createTeamWorkStore();load(s,[open(),ev(2)]);return s;};
test('v2 publisher-only session and absent cache never create workers',()=>{const s=createTeamWorkStore();assert.equal(load(s,[open()]).accepted,true);assert.equal(s.snapshot().report.workers.length,0);const absent={...packet([open()]),content_at:null,snapshot_revision:0,session_id:null,session_generation:0,session_revision:0,session_state:'absent',publisher_observed_at:null,publisher_received_at:null,events:[]};assert.ok(validateTeamWork(absent,{now:T}));});
test('malformed fields, bounds, dates, enums, duplicate identities and record mismatches fail closed',()=>{const mutations=[p=>p.version=1,p=>p.bridge_version='team-work-v1',p=>p.origin='signed',p=>p.history_complete=true,p=>p.snapshot_revision=-1,p=>p.snapshot_revision=Number.MAX_SAFE_INTEGER+1,p=>p.session_generation=0,p=>p.session_id='bad',p=>p.content_at=iso(T+4000),p=>p.publisher_observed_at=iso(T+3000),p=>p.limits.worker_fresh_ms=99999,p=>p.workers[0].slot=7,p=>p.workers[0].revision=2,p=>p.workers[0].run_generation=0,p=>p.workers[0].role='toString',p=>p.workers[0].task='__proto__',p=>p.workers[0].observed_at='2026-02-30T00:00:00.000Z',p=>p.workers[0].received_at=iso(T+999),p=>p.events[1].event_number=0,p=>p.events[1].run_seq=1,p=>p.workers.push({...p.workers[0]}),p=>p.events.push({...p.events[1]})];for(const change of mutations){const p=packet([open(),ev(2)]);change(p);assert.equal(validateTeamWork(p,{now:T+2000}),null,change.toString());}assert.equal(validateTeamWork({...packet([open(),ev(2)]),extra:'x'.repeat(17000)},{now:T+2000}),null);});
test('six independent worker leases cannot be renewed by publisher heartbeat',()=>{const events=[open(),...Array.from({length:6},(_,i)=>ev(i+2,{slot:i+1,actor_id:id(20+i),run_id:id(30+i)}))],s=createTeamWorkStore();assert.equal(load(s,events).accepted,true);assert.ok(s.snapshot().report.workers.every(w=>teamWorkerState(s.snapshot(),w,T+7000).live));events.push(ev(8,{kind:'publisher_heartbeat',observed_at:iso(T+63000),received_at:iso(T+63000)}));assert.equal(load(s,events,T+63000).accepted,true);assert.equal(state(s,T+63000).state,'unconfirmed');assert.equal(state(s,T+63000,5).live,true);});
test('old observation with fresh receipt is never working',()=>{const p=packet([open(),ev(2)]);p.events=[];p.workers[0].observed_at=iso(T-59000);const s=createTeamWorkStore();assert.equal(s.ingest(p,{now:T+2000}).accepted,true);assert.equal(state(s,T+2000).live,false);});
test('expiry, disconnect, closed session and future dates prevent live state',()=>{const s=start();assert.equal(state(s,T+62001).live,false);s.disconnect();assert.equal(state(s,T+2000).state,'offline');assert.equal(load(s,[open(),ev(2),ev(3,{kind:'session_closed'})]).accepted,true);assert.equal(state(s,T+3000).state,'closed');assert.equal(validateTeamWork(packet([open(),ev(2)]),{now:T+1999}),null);});
test('duplicate poll cannot pulse, freshen timestamps or reset lease',()=>{const s=createTeamWorkStore(),e=[open(),ev(2)];assert.deepEqual(load(s,e).pulses,[ACTOR]);assert.deepEqual(load(s,e,T+3000).pulses,[]);assert.equal(s.snapshot().report.workers[0].observed_at,iso(T+2000));assert.equal(state(s,T+62001).live,false);});
test('same snapshot revision rejects changed content or omission',()=>{for(const change of [p=>p.content_at=iso(T+3000),p=>p.publisher_observed_at=iso(T+2000),p=>p.workers[0].source.file_sha256='f'.repeat(64),p=>p.events=[]]){const s=start(),p=packet([open(),ev(2)]);change(p);assert.equal(s.ingest(p,{now:T+3000}).accepted,false);assert.equal(s.snapshot().connected,false);}});
test('rollback rejection retains high-water and allows original exact snapshot',()=>{const s=start();assert.equal(load(s,[open()]).accepted,false);assert.equal(load(s,[open(),ev(2)]).accepted,true);assert.equal(s.snapshot().report.snapshot_revision,2);});
test('same worker revision is immutable even in a newer publisher snapshot',()=>{for(const change of [w=>w.observed_at=iso(T+3000),w=>w.received_at=iso(T+3000),w=>w.step='source_inspected',w=>w.source.file_sha256='e'.repeat(64),w=>w.payload_sha256='c'.repeat(64)]){const s=start(),p=packet([open(),ev(2),ev(3,{kind:'publisher_heartbeat'})],{events:[]});change(p.workers[0]);assert.equal(s.ingest(p,{now:T+3000}).accepted,false);}});
test('high revisions and gaps are allowed without missing-history reconstruction',()=>{const s=start(),p=packet([open(),ev(4000,{run_seq:3000,step:'source_inspected',source:{...source(),scope:'candidate',commit:null},candidate_sha256:'b'.repeat(64)})],{events:[]});assert.equal(s.ingest(p,{now:T+4000000}).accepted,true);assert.equal(s.snapshot().report.workers[0].revision,3000);});
test('known terminal cannot revive; new generation can replace after unseen terminal',()=>{const s=start();assert.equal(load(s,[open(),ev(3,{run_seq:1,state:'completed',step:'task_completed'})]).accepted,true);assert.equal(load(s,[open(),ev(4,{run_seq:2,step:'status_observed'})]).accepted,false);assert.equal(load(start(),[open(),ev(3,{run_id:id(99),run_generation:2})]).accepted,true);});
test('six slot fences survive payload disappearance and session change',()=>{const s=start();assert.equal(s.ingest(packet([open(),ev(3,{kind:'publisher_heartbeat'})],{workers:[]}),{now:T+3000}).accepted,true);assert.equal(load(s,[open(),ev(4,{run_generation:0})]).accepted,false);const a=ev(5,{kind:'session_opened',session_generation:2,session_id:id(90),session_seq:0}),b=ev(6,{session_generation:2,session_id:id(90),run_generation:2,run_id:id(91)});assert.equal(s.ingest(packet([a,b],{session_id:id(90),session_generation:2}),{now:T+6000}).accepted,true);assert.equal(s.snapshot().fence_count,1);});
test('same slot generation cannot change session or run identity',()=>{const s=start(),a=ev(3,{kind:'session_opened',session_generation:2,session_id:id(90),session_seq:0}),b=ev(4,{session_generation:2,session_id:id(90),run_id:id(91)});assert.equal(s.ingest(packet([a,b],{session_generation:2,session_id:id(90)}),{now:T+4000}).accepted,false);});
test('1500 accepted renewals remain bounded without heartbeat/status activity',()=>{const s=createTeamWorkStore(),events=[open(),ev(2)];load(s,events);for(let n=1;n<=1500;n++){events.push(ev(n*2+1,{kind:'publisher_heartbeat'}),ev(n*2+2,{run_seq:n,step:'status_observed'}));assert.equal(load(s,events).accepted,true);assert.equal(s.snapshot().report.events.length,2);assert.equal(s.snapshot().fence_count,1);assert.equal(s.snapshot().event_proof_count,2);}assert.equal(s.snapshot().report.workers[0].revision,1500);});
test('adjacent candidate change needs source transition',()=>{const s=start();assert.equal(load(s,[open(),ev(3,{run_seq:1,step:'status_observed',candidate_sha256:'b'.repeat(64)})]).accepted,false);assert.equal(load(s,[open(),ev(3,{run_seq:1,step:'source_changed',candidate_sha256:'b'.repeat(64),source:{...source(),scope:'candidate',commit:null}})]).accepted,true);});
test('test/review result claims need matching candidate, terminal state, verdict and typed evidence',()=>{const good=ev(3,{run_seq:1,state:'completed',step:'tests_passed',result:{kind:'test',verdict:'passed',target_sha256:HASH,artifact_sha256:'b'.repeat(64),command_id:'frontend_tests',passed:364,failed:0,exit_code:0}});assert.ok(validateTeamWork(packet([open(),good]),{now:T+3000}));for(const change of [e=>e.state='running',e=>e.result.target_sha256='c'.repeat(64),e=>e.result.failed=1,e=>e.result.exit_code=1,e=>e.result=null,e=>e.result.kind='review']){const e=structuredClone(good);change(e);assert.equal(validateTeamWork(packet([open(),e]),{now:T+3000}),null);}});
test('handoff needs retained completed same-candidate origin',()=>{const end=ev(3,{run_seq:1,state:'completed',step:'task_completed'}),review=ev(4,{slot:2,actor_id:id(5),role:'reviewer',run_id:id(6),handoff_from_run_id:RUN}),p=packet([open(),end,review]);assert.deepEqual(createTeamWorkStore().ingest(p,{now:T+4000}).handoffs,[{from:ACTOR,to:id(5),event_id:review.id}]);p.events=[review];assert.deepEqual(createTeamWorkStore().ingest(p,{now:T+4000}).handoffs,[]);});
test('pause requires newer publisher and worker observation; duplicate cannot resume',()=>{const s=start();s.pause({now:T+3000});load(s,[open(),ev(2)],T+4000);assert.equal(state(s,T+4000).live,false);const e=[open(),ev(2),ev(5,{kind:'publisher_heartbeat'})];load(s,e);assert.equal(state(s,T+5000).live,false);e.push(ev(6,{run_seq:1,step:'status_observed'}));load(s,e);assert.equal(state(s,T+6000).live,true);});
test('clock rollback fails closed until genuinely fresh observations',()=>{const s=start();s.checkClock({now:T+5000});s.checkClock({now:T+4000});assert.equal(s.snapshot().connected,false);load(s,[open(),ev(2)],T+6000);assert.equal(state(s,T+6000).live,false);});
test('six-hour display eviction leaves permanent fence and original snapshot unchanged',()=>{const s=start(),before=JSON.stringify(s.snapshot().report);assert.equal(state(s,T+21602001).state,'expired');assert.equal(s.snapshot().fence_count,1);assert.equal(JSON.stringify(s.snapshot().report),before);});
test('unknown fields are discarded; normalized evidence is deeply immutable',()=>{const p=packet([open(),ev(2)]);p.secret='private';p.workers[0].prompt='private';p.workers[0].source.secret='private';const x=validateTeamWork(p,{now:T+2000});assert.ok(x);assert.doesNotMatch(JSON.stringify(x),/private|prompt|secret/);assert.ok(Object.isFrozen(x));assert.ok(Object.isFrozen(x.workers[0].source));});
test('catalog matches only exact immutable published identity',()=>{assert.ok(matchPublicWorkSource(source()));for(const o of [{commit:'f'.repeat(40)},{file_sha256:'f'.repeat(64)},{snippet_sha256:null},{scope:'candidate',commit:null}])assert.equal(matchPublicWorkSource({...source(),...o}),null);for(const r of PUBLIC_WORK_SOURCES){assert.equal(crypto.createHash('sha256').update(r.code).digest('hex'),r.snippet_sha256);assert.equal(r.commit,'0ed31a9437767169664edd0a8f1555d2e38d4351');}});
test('actual SQL projection passes v2 adapter and store',()=>{const p=JSON.parse(fs.readFileSync(new URL('./fixtures/team-work-cache-v2-sql.json',import.meta.url))),now=Date.parse(p.content_at);assert.ok(validateTeamWork(p,{now}));assert.equal(createTeamWorkStore().ingest(p,{now}).accepted,true);});
class Node{constructor(){this.textContent='';this.children=[];this.events={};this.attrs={};this.open=false;this.hidden=false;}set innerHTML(v){throw Error('unsafe');}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events[k]=v;}replaceChildren(...c){this.children=c;}getBoundingClientRect(){return {left:0,top:0,width:100,height:42};}}
function ui({workers=false}={}){const nodes=new Map(),events={},timers=[],document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:()=>new Node(),addEventListener:(k,fn)=>events[k]=fn,removeEventListener:k=>delete events[k]};let now=T+2000;const app=setupCodingWorkers({document,now:()=>now,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});if(workers)nodes.get('showCodingTeam').events.click();return {nodes,events,app,document,timers,setNow:n=>now=n};}const send=(b,e)=>b.events['neptune:team-work-report']({detail:packet(e)});
test('six unassigned slots stay separate from market controls',()=>{const b=ui({workers:true});assert.equal(b.nodes.get('codingWorkerSlots').children.length,6);assert.equal(b.nodes.get('teamCodingState').textContent,'NOT CONNECTED');assert.ok(b.nodes.get('codingWorkerSlots').children.every(n=>n.disabled));b.nodes.get('showMarketStreams').events.click();assert.equal(b.nodes.get('codingWorkerSlots').hidden,true);assert.equal(b.nodes.get('marketStreamSlots').hidden,false);});
test('actual server slot six stays AGENT 006 with other slots empty',()=>{const b=ui({workers:true});send(b,[open(),ev(2,{slot:6})]);assert.equal(b.nodes.get('codingWorkerSlots').children[5].disabled,false);assert.equal(b.nodes.get('codingWorkerSlots').children[0].disabled,true);assert.match(b.nodes.get('teamActivityPreview').textContent,/AGENT 006/);});
test('one event gives one pulse; source stays static and timer ticks invent no work',()=>{const b=ui({workers:true}),e=[open(),ev(2)];send(b,e);assert.equal(b.nodes.get('teamCodingState').textContent,'1 OBSERVED ACTIVE');assert.equal(b.timers.length,1);const old=b.nodes.get('teamActivityPreview').textContent;b.nodes.get('toggleTeamPane').events.click();assert.equal(b.nodes.get('codingWorkerSource').textContent,PUBLIC_WORK_SOURCES[0].code);for(let i=0;i<10;i++)b.app.render();send(b,e);assert.equal(b.timers.length,1);assert.equal(b.nodes.get('teamActivityPreview').textContent,old);b.setNow(T+63000);b.app.render();assert.equal(b.nodes.get('teamCodingState').textContent,'OFFLINE');});
test('current worker status renewals never create activity lines',()=>{const b=ui({workers:true}),e=[open(),ev(2)];send(b,e);const old=b.nodes.get('teamActivityPreview').textContent;e.push(ev(3,{kind:'publisher_heartbeat'}),ev(4,{run_seq:1,step:'status_observed'}));b.setNow(T+4000);send(b,e);assert.equal(b.nodes.get('teamActivityPreview').textContent,old);assert.equal(b.timers.length,1);});
test('new real worker events always auto-follow while duplicate polls do not move the reader',()=>{const b=ui({workers:true}),e=[open(),ev(2)];send(b,e);const a=b.nodes.get('teamActivityPreview');a.scrollHeight=200;a.clientHeight=30;a.scrollTop=0;e.push(ev(3,{run_seq:1,step:'source_inspected'}));b.setNow(T+3000);send(b,e);assert.equal(a.scrollTop,200);a.scrollTop=0;send(b,e);b.app.render();assert.equal(a.scrollTop,0);e.push(ev(4,{run_seq:2,step:'tests_started'}));b.setNow(T+4000);send(b,e);assert.match(a.textContent,/Tests started/);assert.equal(a.scrollTop,200);assert.match(b.nodes.get('teamCodeNote').textContent,/Auto-follow new worker events/);});
test('source mode and hidden-page receipt never move activity reader until activity resumes',()=>{const b=ui({workers:true}),e=[open(),ev(2)];send(b,e);const a=b.nodes.get('teamActivityPreview'),old=a.textContent;a.scrollHeight=200;a.clientHeight=30;a.scrollTop=0;b.nodes.get('toggleTeamPane').events.click();e.push(ev(3,{run_seq:1,step:'source_inspected'}));b.setNow(T+3000);send(b,e);assert.equal(a.textContent,old);assert.equal(a.scrollTop,0);b.nodes.get('toggleTeamPane').events.click();assert.match(a.textContent,/Source inspected/);assert.equal(a.scrollTop,200);const current=a.textContent;a.scrollTop=0;b.document.hidden=true;b.events.visibilitychange();const count=b.timers.length;e.push(ev(4,{run_seq:2,step:'tests_started'}));b.setNow(T+4000);send(b,e);assert.equal(a.textContent,current);assert.equal(a.scrollTop,0);assert.equal(b.timers.length,count);});
test('visible tab resume waits for fresh worker and publisher observations',()=>{const b=ui({workers:true}),e=[open(),ev(2)];send(b,e);b.document.hidden=true;b.setNow(T+3000);b.events.visibilitychange();b.document.hidden=false;b.setNow(T+4000);b.events.visibilitychange();send(b,e);assert.doesNotMatch(b.nodes.get('teamCodingState').textContent,/OBSERVED ACTIVE/);e.push(ev(5,{kind:'publisher_heartbeat'}),ev(6,{run_seq:1,step:'status_observed'}));b.setNow(T+6000);send(b,e);assert.equal(b.nodes.get('teamCodingState').textContent,'1 OBSERVED ACTIVE');});
test('one-hour activity and six-hour worker retention expire at render time',()=>{const b=ui({workers:true});send(b,[open(),ev(2)]);b.setNow(T+3602001);b.app.render();assert.doesNotMatch(b.nodes.get('teamActivityPreview').textContent,/Task started/);b.setNow(T+21602001);b.app.render();assert.ok(b.nodes.get('codingWorkerSlots').children.every(n=>n.disabled));assert.equal(b.app.store.snapshot().fence_count,1);});
test('mismatched, staged or injected code never renders unsafe HTML or substitute source',()=>{for(const o of [{file_sha256:'f'.repeat(64)},{scope:'candidate',commit:null}]){const b=ui({workers:true}),e=ev(2);Object.assign(e.source,o);e.source.code='<script>SECRET</script>';send(b,[open(),e]);assert.doesNotMatch(b.nodes.get('codingWorkerSource').textContent,/SECRET|async function/);}});
test('activity pane keeps exact compact geometry, bounded history and internal instant scrolling',()=>{const css=fs.readFileSync(new URL('./team-work.css',import.meta.url),'utf8'),src=fs.readFileSync(new URL('./team-worker-view.mjs',import.meta.url),'utf8');assert.match(css,/#teamActivityPreview\{grid-column:1 \/ -1;grid-row:2;height:27px\}/);assert.match(css,/overscroll-behavior:contain;scroll-behavior:auto/);assert.match(src,/while\(activityRecords.size>40\)/);assert.doesNotMatch(src,/scrollIntoView|window\.scroll|document\.(?:body|documentElement)\.scroll/);});
test('cache identities and limited-history explanation identify v2 truthfully',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),src=fs.readFileSync(new URL('./neptune.mjs',import.meta.url),'utf8');assert.match(html,/neptune\.mjs\?v=progress-roll-20261010/);assert.match(html,/team-work\.mjs\?v=progress-roll-20261010/);assert.match(html,/limited cache is not a complete activity log, signed worker attestation or a persistent AI workforce/);assert.match(src,/emitTeamWorkReport\(report\?\.team_work\?\?null\)/);});
test('ring worker requires current slot and retained terminal cannot precede running current revision',()=>{let p=packet([open(),ev(2)]);p.workers=[];assert.equal(validateTeamWork(p,{now:T+2000}),null);const terminal=ev(3,{run_seq:1,state:'completed',step:'task_completed'}),current=ev(4,{run_seq:2,step:'status_observed'});p=packet([open(),terminal,current]);assert.equal(validateTeamWork(p,{now:T+4000}),null);});
test('content timestamp must equal newest producer receipt, not poll time',()=>{const p=packet([open(),ev(2)]);p.content_at=iso(T+3000);assert.equal(validateTeamWork(p,{now:T+3000}),null);});
test('retained same-run transition revisions cannot repeat or continue after terminal',()=>{const a=ev(2,{run_seq:1,step:'source_inspected'}),b=ev(3,{run_seq:1,step:'tests_started'}),c=ev(4,{run_seq:2,step:'status_observed'});assert.equal(validateTeamWork(packet([open(),a,b,c]),{now:T+4000}),null);});
test('activity expiry removes old evidence without scrolling an older reader to bottom',()=>{const b=ui({workers:true});send(b,[open(),ev(2)]);const a=b.nodes.get('teamActivityPreview');a.scrollHeight=200;a.clientHeight=30;a.scrollTop=0;b.setNow(T+3602001);b.app.render();assert.doesNotMatch(a.textContent,/Task started/);assert.equal(a.scrollTop,0);});

test('fresh page starts on market checks without requiring worker or browser evidence',()=>{
 const b=ui();
 assert.equal(b.app.currentView(),'market');
 assert.equal(b.nodes.get('teamTerminal').attrs['data-view'],'market');
 assert.equal(b.nodes.get('showMarketStreams').attrs['aria-pressed'],'true');
 assert.equal(b.nodes.get('showCodingTeam').attrs['aria-pressed'],'false');
 assert.equal(b.nodes.get('marketStreamSlots').hidden,false);
 assert.equal(b.nodes.get('codingWorkerSlots').hidden,true);
 assert.equal(b.nodes.get('toggleTeamPane').hidden,false);
 assert.equal(b.nodes.get('teamActivityPreview').hidden,false);
 assert.equal(b.nodes.get('teamViewCaption').textContent,'Automated market checks');
 assert.equal(b.nodes.get('teamCodeCaption').textContent,'MARKET ACTIVITY · PAPER + RESEARCH');
 assert.equal(b.nodes.get('teamCodeNote').textContent,'Feed unavailable · last recorded decisions.');
 assert.equal(b.app.store.snapshot().report,null);
 assert.ok(b.nodes.get('codingWorkerSlots').children.every(n=>n.disabled));
});

test('explicit Workers choice survives repeated clicks, report refreshes, disconnection and page resume',()=>{
 const b=ui();
 for(let i=0;i<3;i++)b.nodes.get('showCodingTeam').events.click();
 send(b,[open(),ev(2)]);
 b.app.setBrowserSource('async function refreshFeed(){\n return readReports();\n}');
 for(let i=0;i<3;i++)b.app.render();
 b.events['neptune:team-work-disconnected']();
 b.document.hidden=true;b.events.visibilitychange();
 b.document.hidden=false;b.events.visibilitychange();
 assert.equal(b.app.currentView(),'workers');
 assert.equal(b.nodes.get('codingWorkerSlots').hidden,false);
 assert.equal(b.nodes.get('marketStreamSlots').hidden,true);
 assert.equal(b.nodes.get('showCodingTeam').attrs['aria-pressed'],'true');
 assert.equal(b.nodes.get('showMarketStreams').attrs['aria-pressed'],'false');
 assert.equal(b.nodes.get('codingWorkerSlots').children.filter(n=>!n.disabled).length,1);
 for(let i=0;i<3;i++)b.nodes.get('showMarketStreams').events.click();
 b.app.render();
 assert.equal(b.app.currentView(),'market');
 assert.equal(b.nodes.get('marketStreamSlots').hidden,false);
 assert.equal(b.nodes.get('codingWorkerSlots').hidden,true);
 assert.equal(b.nodes.get('teamCodePreview').textContent,'async function refreshFeed(){\n return readReports();\n}');
 assert.equal(b.nodes.get('toggleTeamPane').hidden,false);
 // A new page always gets the predictable default, not the last page's choice.
 assert.equal(ui().app.currentView(),'market');
});

test('incoming worker records never switch the default market view or manufacture active workers',()=>{
 const b=ui();send(b,[open(),ev(2)]);
 assert.equal(b.app.currentView(),'market');
 assert.equal(b.nodes.get('marketStreamSlots').hidden,false);
 assert.equal(b.nodes.get('teamViewCaption').textContent,'Automated market checks');
 assert.equal(b.nodes.get('codingWorkerSlots').children.filter(n=>!n.disabled).length,1);
 assert.equal(b.timers.length,0);
 b.setNow(T+63000);b.app.render();
 assert.equal(b.nodes.get('teamCodingState').textContent,'OFFLINE');
 assert.equal(b.app.currentView(),'market');
});

test('initial HTML matches the market default before scripts load or when they fail',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.match(html,/id="teamTerminal" data-view="market"/);
 assert.match(html,/id="showCodingTeam" aria-pressed="false">Workers/);
 assert.match(html,/id="showMarketStreams" aria-pressed="true">Market checks/);
 assert.match(html,/id="teamViewCaption">Automated market checks/);
 assert.match(html,/id="codingWorkerSlots"[^>]* hidden>/);
 assert.doesNotMatch(html,/id="marketStreamSlots"[^>]* hidden/);
 assert.doesNotMatch(html,/id="toggleTeamPane"[^>]* hidden>/);
 assert.match(html,/id="teamCodePreview"[^>]* hidden>/);
 assert.doesNotMatch(html,/id="teamActivityPreview"[^>]* hidden>/);
 assert.match(html,/id="teamCodeCaption">MARKET ACTIVITY · PAPER \+ RESEARCH/);
 assert.match(html,/id="teamCodeNote"[^>]*>Awaiting new verified decisions · auto-follow enabled\./);
 assert.match(html,/id="teamFooter">Ambient flight · tap for real evidence/);
});

test('terminal restores inherited pointer input without enabling decorative hit targets or changing geometry',()=>{
 const css=fs.readFileSync(new URL('./team-work.css',import.meta.url),'utf8');
 const details=fs.readFileSync(new URL('./paper-details.css',import.meta.url),'utf8');
 assert.match(details,/\.lower-deck\{[^}]*pointer-events:none/);
 assert.match(css,/\.team-terminal\{pointer-events:auto;/);
 assert.match(css,/\.team-terminal:after\{[^}]*pointer-events:none/);
 assert.match(css,/\.worker-links\{[^}]*pointer-events:none/);
 assert.match(css,/\.team-terminal \.windows:before\{[^}]*pointer-events:none/);
});

test('reload cache keys reach both the corrected terminal style and nested view module',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
 const team=fs.readFileSync(new URL('./team-work.mjs',import.meta.url),'utf8');
 assert.match(html,/team-work\.css\?v=progress-roll-20261010/);
 assert.match(html,/team-work\.mjs\?v=progress-roll-20261010/);
 assert.match(team,/from '\.\/team-worker-view\.mjs\?v=progress-roll-20261010'/);
 const view=fs.readFileSync(new URL('./team-worker-view.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(team+view,/localStorage|sessionStorage/);
});

test('web worker click opens existing selected evidence dialog repeatedly without fabricating activity',()=>{
 const b=ui({workers:true}),dialog=b.nodes.get('teamWorkDialog');dialog.showModal=()=>{dialog.open=true;};
 send(b,[open(),ev(2)]);const count=b.app.store.snapshot().report.events.length;
 const button=b.nodes.get('codingWorkerSlots').children[0];assert.equal(button.attrs['aria-haspopup'],'dialog');
 for(let n=0;n<3;n++){button.events.click();assert.equal(dialog.open,true);assert.match(b.nodes.get('codingSelectedWorker').textContent,/AGENT 001 · Builder/);dialog.open=false;}
 assert.equal(b.app.store.snapshot().report.events.length,count);
 assert.equal(b.nodes.get('teamWebCount').textContent,'1 recorded · 1 active');
 b.setNow(T+63000);b.app.render();assert.equal(b.nodes.get('teamWebCount').textContent,'1 recorded · 0 active');assert.match(b.nodes.get('codingSelectedWorker').textContent,/PUBLISHER OFFLINE/);
});

test('switching away from a real worker pulse stops visible work effects and does not replay on return',()=>{
 const b=ui({workers:true});send(b,[open(),ev(2)]);const button=b.nodes.get('codingWorkerSlots').children[0];assert.equal(button.attrs['data-pulse'],'true');
 b.nodes.get('showMarketStreams').events.click();assert.equal(button.attrs['data-pulse'],'false');b.nodes.get('showCodingTeam').events.click();assert.equal(button.attrs['data-pulse'],'false');assert.equal(b.timers.length,1);
});

const marketRecord=(n,changes={})=>({key:'kraken:number:'+n,at:iso(T+n*1000),asset:'ETH/USD',action:'hold',result:'no_trade',reason:'no_qualified_momentum',source:'Kraken paper decision',...changes});
const sendMarket=(b,records,changes={})=>b.events['neptune:market-activity']({detail:{records,connected:true,nativeStatus:'ready',latestAt:records.at(-1)?.at??null,...changes}});
test('market decision stream is default, follows new evidence, preserves true event times and leaves workers unassigned',()=>{const b=ui(),a=b.nodes.get('teamActivityPreview');a.scrollHeight=240;a.scrollTop=0;sendMarket(b,[marketRecord(1),marketRecord(2)]);assert.match(a.textContent,/2026-10-10 00:00:01.000 UTC.*Kraken paper decision.*ETH\/USD HOLD \/ NO TRADE.*no qualified momentum/);assert.equal(a.scrollTop,240);assert.equal(a.hidden,false);assert.equal(b.nodes.get('teamCodePreview').hidden,true);assert.equal(b.nodes.get('teamCodingState').textContent,'NOT CONNECTED');assert.ok(b.nodes.get('codingWorkerSlots').children.every(n=>n.disabled));a.scrollTop=0;sendMarket(b,[marketRecord(1),marketRecord(2)]);for(let i=0;i<5;i++)b.app.render();assert.equal(a.scrollTop,0);b.setNow(T+3000);sendMarket(b,[marketRecord(1),marketRecord(2),marketRecord(3)]);assert.equal(a.scrollTop,240);assert.equal(a.textContent.split('\n').length,3);});
test('market source is optional, stale/offline states stay honest and market records never pulse workers',()=>{const b=ui(),a=b.nodes.get('teamActivityPreview');sendMarket(b,[marketRecord(1)]);b.nodes.get('toggleTeamPane').events.click();assert.equal(a.hidden,true);assert.equal(b.nodes.get('teamCodePreview').hidden,false);assert.match(b.nodes.get('teamCodeCaption').textContent,/BROWSER SOURCE REFERENCE/);b.nodes.get('toggleTeamPane').events.click();assert.equal(a.hidden,false);sendMarket(b,[marketRecord(1)],{connected:false});assert.match(b.nodes.get('teamCodeNote').textContent,/Feed unavailable/);b.setNow(T+95000);sendMarket(b,[marketRecord(1)]);assert.match(b.nodes.get('teamCodeNote').textContent,/Awaiting a new decision/);assert.equal(b.timers.length,0);b.setNow(T+3602000);b.app.render();assert.doesNotMatch(a.textContent,/ETH/);assert.match(a.textContent,/Waiting for a verified market decision/);});
test('invalid market event display projection does not substitute source or expose arbitrary text',()=>{const b=ui();sendMarket(b,[marketRecord(1)]);const before=b.nodes.get('teamActivityPreview').textContent;for(const edit of [{at:iso(T+100000)},{source:'private secret'},{reason:'<script>secret</script>'},{action:'execute'},{result:'approved'}])sendMarket(b,[marketRecord(2,edit)]);assert.equal(b.nodes.get('teamActivityPreview').textContent,before);});
