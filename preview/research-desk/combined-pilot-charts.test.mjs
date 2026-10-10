import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPaperPositionCharts,renderPaperPositionCharts} from './paper-position-charts.mjs?v=experiment-provenance-v3-r2';
import {paperTradePlanView} from './paper-trade-plan.mjs?v=experiment-provenance-v3-r2';
import {setupPaperPanels} from './paper-panels-v2.mjs?v=experiment-provenance-v3-r2';
import {settledProfits} from './profit-events.mjs?v=experiment-provenance-v3-r2';
import {createPaperCueBridge} from './paper-eye-cues.mjs?v=experiment-provenance-v3-r2';
import {createSceneTargets,isVerifiedSceneFill} from './scene-targets.mjs?v=experiment-provenance-v3-r2';
import {validateV2} from './status-v2.mjs?v=experiment-provenance-v3-r2';

// Synthetic fixture variants only. This suite has no live network client.
const original=JSON.parse(fs.readFileSync(new URL('./fixtures/engine-running-v2.json',import.meta.url)));
const closedFixture=JSON.parse(fs.readFileSync(new URL('./fixtures/experiment-public-v3.json',import.meta.url)));
const copy=x=>structuredClone(x),iso=x=>new Date(x).toISOString();
function classified(kind='experiment'){
 const p=copy(original),now=Date.parse(p.heartbeat_at);p.experiment_provenance_version=1;
 for(const name of ['fills','positions','results','settlements'])for(const row of p[name])row.paper_classification='strategy';
 for(const row of p.positions)row.tick_size=.000001;
 const position=p.positions.find(x=>x.asset==='ETH/USD'),fill=p.fills.find(x=>x.id===position.entry_fill_id);
 for(const row of [position,fill]){
  row.paper_classification=kind;
  if(kind==='experiment')Object.assign(row,{experiment_id:'chart-combined-trial',entry_method:'market_paper_experiment_v1',experiment_source_hash:'a'.repeat(64),experiment_config_hash:'b'.repeat(64),experiment_entry_order_id:fill.order_id,experiment_entry_fill_id:fill.id});
 }
 if(kind==='experiment'){
  fill.source_hash='a'.repeat(64);fill.config_hash='b'.repeat(64);p.experiment_evaluated_at=p.heartbeat_at;
  p.experiment_projection_scope=Object.fromEntries(['fills','positions','results','settlements'].flatMap(k=>[[k+'_total',p[k].length],[k+'_complete',true]]));
 }
 validateV2([{id:'neptune-paper-v2',payload:p}]);return {p,position,fill,now};
}
function frozen(value){if(value&&typeof value==='object'){Object.freeze(value);for(const x of Object.values(value))frozen(x);}return value;}
class Node{
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.events={};}
 set innerHTML(_){throw Error('HTML insertion is forbidden');}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 setAttribute(k,v){this.attributes[k]=v;}
 addEventListener(k,fn){this.events[k]=fn;}
 querySelectorAll(selector){const matches=n=>selector.startsWith('.')?n.className?.split(' ').includes(selector.slice(1)):n.tag===selector;return this.children.flatMap(n=>[...(matches(n)?[n]:[]),...n.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
function dom(){const nodes=new Map();const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:t=>new Node(t),createElementNS:(_,t)=>new Node(t)};return {document,nodes};}
const card=(nodes,asset='ETH/USD')=>nodes.get('paperPositionWindows').children.find(n=>n.children[0]?.textContent.includes(asset));
for(const [kind,label] of [['experiment','PAPER EXPERIMENT · chart-combined-trial · '],['strategy',''],['unresolved','PAPER CLASSIFICATION UNRESOLVED · ']]){
 test('combined chart headline retains '+kind+' classification and exact campaign identity',()=>{
  const {p,now}=classified(kind),{document,nodes}=dom(),controller=createPaperPositionCharts(),before=copy(p);
  const plan=paperTradePlanView({report:p,connected:true,now});const v=renderPaperPositionCharts(document,controller,{report:frozen(p),connected:true,now});
  const row=v.rows.find(x=>x.asset==='ETH/USD');assert.equal(row.classificationLabel,label);assert.equal(row.classificationLabel,plan.rows.find(x=>x.asset==='ETH/USD').classificationLabel);
  assert.equal(card(nodes).children[0].textContent,label+'Kraken · ETH/USD');assert.equal(row.identityVerified,true);assert.equal(row.samples.length,1);assert.deepEqual(p,before);
  renderPaperPositionCharts(document,controller,{report:p,connected:false,now:now+1});assert.equal(card(nodes).children[0].textContent,label+'Kraken · ETH/USD');assert.deepEqual(p,before);
 });
}
test('pre-provenance chart preserves its original neutral market title',()=>{const p=copy(original),{document,nodes}=dom();renderPaperPositionCharts(document,createPaperPositionCharts(),{report:p,connected:true,now:Date.parse(p.heartbeat_at)});assert.equal(card(nodes).children[0].textContent,'Kraken · ETH/USD');});
test('classification-only update keeps one receipt cycle and cannot replay a green buy',()=>{
 const {p,fill,position,now}=classified('strategy'),scene=createSceneTargets(),chart=createPaperPositionCharts();
 const seed=copy(p);seed.fills=[];seed.positions=[];seed.results=[];seed.settlements=[];scene.observeReport(seed,now-1);
 scene.observeReport(p,now);const cue=scene.current(now);const first=chart.ingest({report:p,connected:true,now}).rows.find(x=>x.asset==='ETH/USD');
 p.heartbeat_at=iso(now+1000);position.quote_at=p.heartbeat_at;
 for(const row of [position,fill])row.paper_classification='unresolved';
 const next=chart.ingest({report:p,connected:true,now:now+1000}).rows.find(x=>x.asset==='ETH/USD');scene.observeReport(p,now+1000);
 assert.equal(next.key,first.key);assert.equal(next.classificationLabel,'PAPER CLASSIFICATION UNRESOLVED · ');assert.equal(next.samples.length,2);
 if(cue)assert.equal(scene.current(now+1000),cue);assert.equal(scene.current(now+10000),null);
});
test('an actual classified experimental buy has green receipt authority but never ordinary-profit authority',()=>{
 const {p,fill,position,now}=classified();const scene=createSceneTargets();
 // Start immediately before the synthetic entry, then reveal only that real
 // fixture receipt. A campaign label alone never constructs a fill.
 const earlier=copy(p);earlier.heartbeat_at=iso(now-1);earlier.experiment_evaluated_at=earlier.heartbeat_at;earlier.fills=[];earlier.positions=[];earlier.results=[];earlier.settlements=[];for(const k of ['fills','positions','results','settlements'])earlier.experiment_projection_scope[k+'_total']=0;
 scene.observeReport(earlier,now-1);
 fill.at=p.heartbeat_at;position.opened_at=fill.at;p.fills=[fill];p.positions=[position];p.results=[];p.settlements=[];for(const k of ['fills','positions','results','settlements'])p.experiment_projection_scope[k+'_total']=p[k].length;
 validateV2([{id:'neptune-paper-v2',payload:p}]);scene.observeReport(p,now);const cue=scene.current(now);assert.equal(cue?.kind,'buy');assert.equal(cue.asset,'ETH/USD');assert.ok(isVerifiedSceneFill(cue,now));assert.deepEqual(settledProfits(p),[]);
 const closed=copy(closedFixture.report),bridge=createPaperCueBridge(),closeAt=Date.parse(closed.heartbeat_at),seed=copy(closed);seed.heartbeat_at=iso(closeAt-1);seed.fills=seed.fills.filter(f=>f.side==='buy');seed.results=[];seed.settlements=[];for(const k of ['fills','positions','results','settlements'])seed.experiment_projection_scope[k+'_total']=seed[k].length;
 bridge.observe(seed,closeAt-1);bridge.observe(closed,closeAt);assert.deepEqual(settledProfits(closed),[]);assert.notEqual(bridge.current(closeAt)?.kind,'profit');
});
test('combined passive panels and chart refresh perform no RPC, transport or input mutation',async()=>{
 const {p,now}=classified(),{document,nodes}=dom(),controller=createPaperPositionCharts(),calls=[];const before=copy(p),oldFetch=globalThis.fetch;
 globalThis.fetch=(...args)=>{calls.push({type:'global-fetch',args});throw Error('Unexpected network');};
 try{
  const panels=setupPaperPanels({document,endpointRoot:'https://example.invalid',publicKey:'synthetic',getClient:async()=>{calls.push({type:'client'});throw Error('Passive display requested auth');},fetcher:async(...args)=>{calls.push({type:'injected-fetch',args});throw Error('Passive display requested history');}});
  for(let i=0;i<3;i++){panels.observe(frozen(p));renderPaperPositionCharts(document,controller,{report:p,connected:true,now:now+i});}
  assert.equal(nodes.get('experimentStart').disabled,true);assert.equal(nodes.get('experimentStop').disabled,true);assert.deepEqual(calls,[]);assert.deepEqual(p,before);
  panels.observe(null);renderPaperPositionCharts(document,controller,{report:null,connected:false,now:now+4});assert.deepEqual(calls,[]);
 }finally{globalThis.fetch=oldFetch;}
});
test('combined authored cache graph carries chart, plan and all receipt authorities in one identity',()=>{
 const read=n=>fs.readFileSync(new URL('./'+n,import.meta.url),'utf8');const spec=(n,d)=>read(n).match(new RegExp("['\"](\\./"+d.replaceAll('.','\\.')+"(?:\\?[^'\"]*)?)['\"]"))?.[1];
 for(const [n,d] of [['neptune.mjs','paper-position-charts.mjs'],['paper-position-charts.mjs','paper-trade-plan.mjs'],['paper-position-charts.mjs','status-v2.mjs'],['paper-trade-plan.mjs','status-v2.mjs'],['neptune.mjs','scene-targets.mjs'],['cosmos-scene.mjs','scene-targets.mjs'],['scene-targets.mjs','status-v2.mjs'],['paper-eye-cues.mjs','profit-events.mjs']])assert.equal(spec(n,d),'./'+d+'?v=experiment-provenance-v3-r2',n+' -> '+d);
});

test('old unclassified positive close remains excluded from ordinary-profit cues',()=>{const p=copy(closedFixture.report);for(const k of Object.keys(p))if(k.startsWith('experiment_')||k==='market_experiment'||k==='market_experiment_capability')delete p[k];for(const kind of ['fills','positions','results','settlements'])for(const row of p[kind])for(const k of Object.keys(row))if(k.startsWith('experiment_')||k==='entry_method'||k==='paper_classification')delete row[k];validateV2([{id:'neptune-paper-v2',payload:p}]);assert.ok(p.results.some(r=>r.pnl_base>0));assert.deepEqual(settledProfits(p),[]);});
