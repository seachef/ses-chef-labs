import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicScoutFeed,publicScoutDisplay,readPublicScoutSnapshot,PUBLIC_SCOUT_URL,PUBLIC_SCOUT_LIMITS} from './public-scout.mjs?v=public-scout-20261010';
import {validatePublicFeed} from './public-scout-contract-v1/public-feed.mjs';
import {payloadDigest} from './public-scout-contract-v1/lead-review.mjs';
import {setupCodingWorkers} from './team-worker-view.mjs';

// Archived public market observations with test-only commit/run identifiers.
// Timestamp shifts below are synthetic test inputs, never runtime feed data.
const base=JSON.parse(fs.readFileSync(new URL('./fixtures/public-scout-test.json',import.meta.url),'utf8'));
const T=Date.parse(base.run.completed_at)+1000,clone=x=>structuredClone(x),raw=x=>JSON.stringify(x),settle=()=>new Promise(resolve=>setImmediate(resolve));
function response(body=raw(base),extra={}){const r=new Response(body,{headers:{'content-type':'application/json'}});return {ok:r.ok,headers:r.headers,body:r.body,url:r.url,redirected:r.redirected,...extra};}
async function shifted(delta,id=String(BigInt(base.run.workflow_run_id)+1n)){
 const f=JSON.parse(raw(base),(_,v)=>typeof v==='string'&&/^2026-\d\d-\d\dT/.test(v)?new Date(Date.parse(v)+delta).toISOString():v);
 f.run.workflow_run_id=id;for(const item of f.leads){item.payload.epoch_id=id;item.evidence_sha256=await payloadDigest(item.payload);}return f;
}
function client({fetch=async()=>response(),now=T,onChange=()=>{},...options}={}){let time=now;const app=createPublicScoutFeed({fetch,now:()=>time,onChange,...options});return {app,setNow:n=>{time=n;}};}

test('fixed public source, GET only, strict provenance and immutable isolated research snapshot',async()=>{
 let calls=0;const c=client({fetch:async(url,options)=>{calls++;assert.equal(url,PUBLIC_SCOUT_URL);assert.deepEqual(Object.keys(options).sort(),['cache','credentials','method','redirect','referrerPolicy','signal']);assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');return response();}});
 const s=await c.app.refresh();assert.equal(calls,1);assert.equal(s.status,'ready');assert.equal(s.feed.coverage.screened_identities,882);assert.equal(s.feed.leads.length,4);assert.equal(s.records.length,6);assert.equal(readPublicScoutSnapshot(s),s);assert.equal(readPublicScoutSnapshot(clone(s)),null);
 assert.ok(Object.isFrozen(s.feed.leads[0].payload.identity));assert.throws(()=>s.feed.coverage.kraken=1,TypeError);
 for(const a of s.assessments){assert.equal(a.execution_eligible,false);assert.equal(a.paper_entry_allowed,false);assert.equal(a.qualified_buy,false);assert.equal(a.independent_review.status,'not_reviewed');}
 const display=publicScoutDisplay(s,{now:T});assert.equal(display.status,'SCAN RECORDED');assert.match(display.output,/882 screened/);assert.match(display.evidence,/recorded failed checks/i);assert.match(display.evidence,/independent review awaiting/i);assert.match(display.evidence,/Recorded coarse rejections/);assert.match(display.evidence,/original capture replay/);assert.equal(display.markerState,'snapshot');assert.equal(display.at,new Date(base.run.completed_at).toISOString());
});

test('unchanged polls never append scan, rewrite source clocks or bypass one-minute browser throttle',async()=>{
 let calls=0;const c=client({fetch:async()=>{calls++;return response();}});await c.app.refresh();const s=c.app.snapshot(),rows=clone(s.records);
 for(let i=0;i<20;i++){await c.app.refresh();c.app.snapshot();}assert.equal(calls,1);
 c.setNow(T+60000);await c.app.refresh();assert.equal(calls,2);assert.deepEqual(c.app.snapshot().records,rows);assert.equal(c.app.snapshot().feed.run.completed_at,s.feed.run.completed_at);
});

test('expired quote evidence remains labelled discovery and never becomes fresh entry evidence',async()=>{
 const c=client();await c.app.refresh();const rows=clone(c.app.snapshot().records);c.setNow(T+180000);
 const d=publicScoutDisplay(c.app.snapshot(),{now:T+180000});assert.equal(d.status,'SCAN RECORDED');assert.match(d.evidence,/Quote evidence expired/);assert.match(d.evidence,/New paper-entry quotes/);assert.deepEqual(c.app.snapshot().records,rows);
 c.setNow(Date.parse(base.discovery_expires_at));assert.equal(c.app.snapshot().status,'stale');assert.equal(publicScoutDisplay(c.app.snapshot(),{now:Date.parse(base.discovery_expires_at)}).status,'STALE');
 c.setNow(T+3600001);assert.equal(c.app.snapshot().records.length,0);
});

test('stale initial feed, impossible source times, source hashes and fabricated reviewers fail closed',async()=>{
 const mutations=[f=>f.protocol='other',f=>f.extra='PRIVATE',f=>f.run.completed_at=new Date(T+1).toISOString(),f=>f.sources[0].sha256='f'.repeat(64),f=>f.leads[0].payload.execution_eligible=true,f=>f.leads[0].payload.ai_review_status='reviewed',f=>f.independent_reviews.push({verdict:'buy'}),f=>f.producer.finder.actor_type='model',f=>f.coverage.screened_identities++,f=>f.leads[0].evidence_sha256='f'.repeat(64),f=>f.leads[0].payload.evidence[0].observed_at=new Date(T+1).toISOString()];
 for(const change of mutations){const f=clone(base);change(f);const c=client({fetch:async()=>response(raw(f))});await c.app.refresh();assert.equal(c.app.snapshot().status,'unavailable',change.toString());assert.equal(c.app.snapshot().feed,null);assert.equal(c.app.snapshot().records.length,0);}
 const c=client({now:Date.parse(base.discovery_expires_at)});await c.app.refresh();assert.equal(c.app.snapshot().feed,null);
});

test('duplicate JSON keys, prototype fields, unsafe numbers, oversized arrays and depth are rejected',async()=>{
 for(const value of [raw(base).replace('{','{"protocol":"other",'),raw(base).replace('{','{"__proto__":{},'),raw(base).replace('"kraken":599','"kraken":9007199254740993'),raw({...base,leads:Array(5).fill(base.leads[0])}),'['.repeat(20)+'0'+']'.repeat(20)]){
  const c=client({fetch:async()=>response(value)});await c.app.refresh();assert.equal(c.app.snapshot().feed,null);assert.equal(c.app.snapshot().error,'invalid_feed');
 }
});

test('older run, same-time mutation and reused workflow ID reject without replacing last verified evidence',async()=>{
 let body=raw(base);const c=client({fetch:async()=>response(body)});await c.app.refresh();const digest=c.app.snapshot().digest;
 for(const [i,f] of [await shifted(-60000,'12344'),await shifted(0,'12346'),await shifted(60000,base.run.workflow_run_id)].entries()){
  body=raw(f);c.setNow(T+(i+1)*60000);await c.app.refresh();assert.equal(c.app.snapshot().status,'unavailable');assert.equal(c.app.snapshot().digest,digest);
 }
 const newer=await shifted(240000,'12346');body=raw(newer);c.setNow(T+240000);await c.app.refresh();assert.equal(c.app.snapshot().status,'ready');assert.equal(c.app.snapshot().records.length,12);
});

test('failed and initialization publisher states never fabricate zero-coverage success or lead checks',async()=>{
 for(const status of ['failed','initializing','recovery_needed']){
  const f=clone(base);Object.assign(f.run,{status,acquisition_mode:status==='failed'?'public_read':'none',recovery_required_run_id:status==='recovery_needed'?'12344':null});Object.assign(f,{coverage:null,coarse_rejections:null,leads:[],sources:[]});
  const c=client({fetch:async()=>response(raw(f))});await c.app.refresh();const d=publicScoutDisplay(c.app.snapshot(),{now:T});assert.equal(d.status,status==='failed'?'RUN FAILED':status==='initializing'?'INITIALIZING':'RECOVERY NEEDED');assert.match(d.output,/Coverage unavailable/);assert.match(d.evidence,/No completed coarse screen/);assert.doesNotMatch(d.output,/0 screened/);
 }
});

test('reported provider refusals stay explicit and do not become freshness or reviewer authority',async()=>{
 const f=clone(base);f.provider_status.hyperliquid={blocked_until:null,permanent:true,reason_code:'http_451',refused_at:f.run.completed_at};const c=client({fetch:async()=>response(raw(f))});await c.app.refresh();assert.match(publicScoutDisplay(c.app.snapshot(),{now:T}).evidence,/hyperliquid public source refusal: http_451; paused pending resolution/);
});

test('offline failure keeps last verified evidence while exact response source and redirect checks fail closed',async()=>{
 for(const extra of [{redirected:true},{url:'https://evil.invalid/feed.json'},{url:PUBLIC_SCOUT_URL+'?private=1'}]){
  const c=client({fetch:async()=>response(undefined,extra)});await c.app.refresh();assert.equal(c.app.snapshot().error,'untrusted_source');assert.equal(c.app.snapshot().feed,null);
 }
 let online=true;const c=client({fetch:async()=>{if(!online)throw Error('PRIVATE transport response');return response();}});await c.app.refresh();const old=c.app.snapshot().digest;online=false;c.setNow(T+60000);await c.app.refresh();const s=c.app.snapshot();assert.equal(s.digest,old);assert.equal(s.status,'unavailable');assert.match(publicScoutDisplay(s,{now:T+60000}).evidence,/Feed unavailable; showing the last verified scan/);assert.doesNotMatch(raw(s),/PRIVATE/);
});

test('size enforcement counts actual UTF-8 bytes with and without Content-Length; read cannot be unbounded',async()=>{
 const bodies=[()=>new Response('x',{headers:{'content-type':'text/plain','content-length':'65537'}}),()=>new Response('x',{headers:{'content-type':'text/plain','content-length':'bad'}}),()=>response(' '.repeat(65537)),()=>response('😀'.repeat(20000)),()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),()=>new Response(raw(base),{headers:{'content-type':'text/html'}}),()=>({ok:true,headers:new Headers({'content-type':'text/plain'}),body:null})];
 for(const make of bodies){const c=client({fetch:async()=>make()});await c.app.refresh();assert.equal(c.app.snapshot().feed,null);assert.equal(c.app.snapshot().status,'unavailable');}
 const padded=raw(base)+' '.repeat(65536-Buffer.byteLength(raw(base)));const c=client({fetch:async()=>response(padded)});await c.app.refresh();assert.equal(c.app.snapshot().status,'ready');
});

test('fetch and body timeout are bounded even when a transport ignores abort',async()=>{
 for(const bodyStall of [false,true]){
  let timer,signal;const c=client({fetch:async(_url,options)=>{signal=options.signal;if(bodyStall)return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/plain'}});return new Promise(()=>{});},setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){}});
  const p=c.app.refresh();await settle();timer();await p;assert.equal(signal.aborted,true);assert.equal(c.app.snapshot().error,'timeout');assert.equal(c.app.snapshot().status,'unavailable');
 }
});

test('concurrent refreshes share one request, visibility cancellation and disposal ignore late completion',async()=>{
 for(const action of ['disconnect','dispose']){
  let resolve,calls=0;const states=[],c=client({fetch:async()=>{calls++;return new Promise(r=>{resolve=r;});},onChange:s=>states.push(s)});
  const p=c.app.refresh(),q=c.app.refresh();assert.equal(calls,1);c.app[action]();const count=states.length;resolve(response());await Promise.all([p,q]);assert.equal(states.length,count);assert.equal(c.app.snapshot().feed,null);
 }
});

test('clock rollback cannot renew freshness, a snapshot, or a recorded scan',async()=>{
 const c=client();await c.app.refresh();c.setNow(T+180000);c.app.snapshot();c.setNow(T+60000);await c.app.refresh();assert.equal(c.app.snapshot().status,'unavailable');const d=publicScoutDisplay(c.app.snapshot(),{now:T+180000});assert.match(d.evidence,/Quote evidence expired/);
});

test('display observer exceptions do not corrupt or interrupt public research transport',async()=>{
 for(const onChange of [()=>{throw Error('view failed');},async()=>{throw Error('view failed');}]){const c=client({onChange});await c.app.refresh();await settle();assert.equal(c.app.snapshot().status,'ready');}
});

class Node{constructor(){this.textContent='';this.children=[];this.events={};this.attrs={};this.hidden=false;this.open=false;}set innerHTML(v){throw Error('unsafe HTML');}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events[k]=v;}replaceChildren(...c){this.children=c;}getBoundingClientRect(){return {left:0,top:0,width:100,height:42};}}
function ui(){const nodes=new Map(),events={},document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:()=>new Node(),addEventListener:(k,fn)=>events[k]=fn,removeEventListener:k=>delete events[k]};let now=T;const app=setupCodingWorkers({document,now:()=>now,setTimeout:()=>1,clearTimeout(){}});return {nodes,events,app,document,setNow:n=>now=n};}

test('real scan records enter existing activity without workers, scene beams or fabricated paper decisions',async()=>{
 const u=ui(),c=client();await c.app.refresh();const s=c.app.snapshot(),a=u.nodes.get('teamActivityPreview');a.scrollHeight=250;
 u.events['neptune:public-scout']({detail:s});assert.match(a.textContent,/Deterministic scheduled scout/);assert.match(a.textContent,/Research lead · kraken NEAR\/USD/);assert.match(a.textContent,/failed latest trade/);assert.match(a.textContent,/independent review awaiting/);assert.equal(a.scrollTop,250);assert.equal(u.nodes.get('teamCodingState').textContent,'NOT CONNECTED');assert.ok(u.nodes.get('codingWorkerSlots').children.every(n=>n.disabled));assert.equal(u.app.store.snapshot().report,null);
 const text=a.textContent;a.scrollTop=0;for(let i=0;i<20;i++){u.events['neptune:public-scout']({detail:c.app.snapshot()});u.app.render();}assert.equal(a.textContent,text);assert.equal(a.scrollTop,0);
 u.events['neptune:public-scout']({detail:{...clone(s),records:[{text:'FAKE REVIEWED BUY'}]}});assert.equal(a.textContent,text);
 u.nodes.get('showCodingTeam').events.click();assert.doesNotMatch(a.textContent,/scheduled scout/);u.nodes.get('showMarketStreams').events.click();assert.equal(a.textContent,text);
 u.app.dispose();assert.equal(u.events['neptune:public-scout'],undefined);
});

test('new research records respect source-pane choice, hidden page, repeated navigation and history expiry',async()=>{
 const u=ui(),c=client();await c.app.refresh();u.nodes.get('toggleTeamPane').events.click();const a=u.nodes.get('teamActivityPreview'),before=a.textContent;a.scrollTop=0;a.scrollHeight=250;
 u.events['neptune:public-scout']({detail:c.app.snapshot()});assert.equal(a.textContent,before);assert.equal(a.scrollTop,0);u.nodes.get('toggleTeamPane').events.click();assert.match(a.textContent,/scheduled scout/);
 const old=a.textContent;a.scrollTop=0;u.document.hidden=true;u.app.render();c.setNow(T+3600001);u.setNow(T+3600001);u.events['neptune:public-scout']({detail:c.app.snapshot()});assert.equal(a.textContent,old);assert.equal(a.scrollTop,0);u.document.hidden=false;u.app.render();assert.doesNotMatch(a.textContent,/scheduled scout/);assert.equal(a.scrollTop,0);
});

test('integration preserves complete scene/artwork/style and keeps research outside quote and trade bridges',()=>{
 const source=fs.readFileSync(new URL('./neptune.mjs',import.meta.url),'utf8'),clientSource=fs.readFileSync(new URL('./public-scout.mjs',import.meta.url),'utf8');
 const wiring=source.slice(source.indexOf('const publicScout='),source.indexOf("let selected='ETH/USD'"));assert.match(wiring,/neptune:public-scout/);assert.doesNotMatch(wiring,/sceneTargets\.|profitBridge\.|emitTeamWorkReport|marketActivity\.observe|paperViewV2/);
 assert.doesNotMatch(clientSource,/supabase|apikey|publicKey|localStorage|sessionStorage|innerHTML|insertAdjacentHTML|method:\s*['"](?:POST|PATCH|DELETE)|requestAnimationFrame/);assert.equal((clientSource.match(/https:\/\//g)||[]).length,1);
 assert.match(source,/marker\(1,scout.key,scout.at,scout.markerState\)/);assert.match(clientSource,/markerState:stale\?'stale':offline\|\|health.venues===0\?'offline':'snapshot'/);assert.equal(PUBLIC_SCOUT_LIMITS.bytes,65536);assert.equal(PUBLIC_SCOUT_LIMITS.timeout_ms,8000);
});


test('failed or absent public sources are explicit and partial scans never claim full coverage',async()=>{
 for(const mode of ['all_failed','missing','partial']){const f=clone(base);f.leads=[];f.coverage={kraken:0,hyperliquid:0,screened_identities:0,coarse_passes:0,detailed_leads:0};f.coarse_rejections={volume_below_100k_quote:0,change_outside_3_to_60_percent:0,spread_above_35_bps:0};if(mode==='missing')f.sources=[];else for(const s of f.sources)if(mode==='all_failed'||s.source_id==='hyperliquid_bulk')s.status='failed';const c=client({fetch:async()=>response(raw(f))});await c.app.refresh();const d=publicScoutDisplay(c.app.snapshot(),{now:T});assert.equal(d.status,mode==='partial'?'PARTIAL SCAN':'DATA UNAVAILABLE');assert.match(d.evidence,mode==='missing'?/Source capture kraken_metadata: missing/:/Source capture hyperliquid_bulk: failed/);if(mode!=='partial'){assert.match(d.output,/Coverage unavailable/);assert.match(d.evidence,/no completed market coverage/);assert.match(c.app.snapshot().records[0].text,/public data unavailable/);}}
});
