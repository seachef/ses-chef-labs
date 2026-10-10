import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupPaperTrialShortcut} from './paper-trial-shortcut.mjs?v=paper-trial-shortcut-20261010';
import {setupPaperPanels} from './paper-panels-v2.mjs?v=experiment-provenance-v3-r2';
import {EXPERIMENT_CAPABILITY} from './experiment-owner.mjs?v=experiment-provenance-v3-r2';

const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const html=read('./index.html'),css=read('./paper-trial-shortcut.css'),source=read('./paper-trial-shortcut.mjs');
class Node{
 constructor(id,actions){this.id=id;this.actions=actions;this.events={};this.children=[];this.open=false;this.disabled=false;this.dataset={};}
 addEventListener(type,handler){this.events[type]=handler;}
 replaceChildren(...children){this.children=children;}
 showModal(){this.actions.push('showModal');this.open=true;}
 scrollIntoView(options){this.actions.push(['scroll',this.id,options]);}
 focus(options){this.actions.push(['focus',this.id,options]);}
}
function dom(){const actions=[],nodes=new Map(),document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node(id,actions));return nodes.get(id);},createElement:()=>new Node('',actions)};return {actions,nodes,document};}
const report=()=>{const at=new Date().toISOString();return {experiment_provenance_version:1,market_experiment_capability:{...EXPERIMENT_CAPABILITY},heartbeat_at:at,experiment_evaluated_at:at,experiment_projection_scope:{fills_complete:true,results_complete:true,settlements_complete:true,positions_complete:true,fills_total:0,results_total:0,settlements_total:0,positions_total:0},fills:[],results:[],settlements:[],positions:[]};};
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};

test('bright native button is in the shared header, outside either terminal view',()=>{
 const header=html.match(/<header>(.*?)<\/header>/s)[1];
 assert.match(header,/<button id="openPaperTrial"[^>]*type="button"[^>]*aria-haspopup="dialog"[^>]*aria-controls="historyDialog"[^>]*aria-label="Start paper trial"[^>]*aria-describedby="paperTrialShortcutHint"/);
 assert.match(header,/>START PAPER TRIAL<\/span>/);
 assert.match(header,/Opens controls · does not start a trial/);
 assert.equal((html.match(/id="openPaperTrial"/g)||[]).length,1);
 assert.ok(html.indexOf('id="openPaperTrial"')<html.indexOf('id="teamTerminal"'));
 assert.match(html,/<h4 id="experimentHeading" tabindex="-1">/);
 assert.match(css,/min-height:56px/);assert.match(css,/min-height:48px/);
 assert.match(css,/background:#c5ff78;color:#10200c/);
 assert.match(css,/:focus-visible\{outline:3px solid #fff/);
 assert.doesNotMatch(css,/animation|position:fixed|overflow:hidden|data-view/);
});

test('shortcut opens, scrolls below the sticky heading and focuses only the trial heading',()=>{
 const b=dom();setupPaperTrialShortcut(b.document);
 const click=b.nodes.get('openPaperTrial').events.click;
 click();assert.deepEqual(b.actions,['showModal',['scroll','experimentHeading',{block:'start',inline:'nearest',behavior:'auto'}],['focus','experimentHeading',{preventScroll:true}]]);
 assert.match(css,/#experimentHeading\{scroll-margin-top:90px\}/);
 click();assert.equal(b.actions.filter(x=>x==='showModal').length,1,'Repeated activation cannot show an already-open modal');
 b.nodes.get('historyDialog').open=false;click();assert.equal(b.actions.filter(x=>x==='showModal').length,2);
 assert.equal(b.nodes.get('experimentHeading').events.click,undefined);
});

test('Enter and Space use native button activation without a second keyboard dispatch',()=>{
 const b=dom();setupPaperTrialShortcut(b.document);
 assert.deepEqual(Object.keys(b.nodes.get('openPaperTrial').events),['click']);
 assert.doesNotMatch(source,/keydown|keyup|keypress|preventDefault|\.click\(|dispatchEvent/);
 assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|WebSocket|\.rpc\(|getClient|createExperimentOwner|nextCampaign|\.start\(|\.stop\(/);
});

test('missing shortcut, dialog or heading does not register a partial action',()=>{
 for(const missing of ['openPaperTrial','historyDialog','experimentHeading']){
  const b=dom(),get=b.document.getElementById;b.document.getElementById=id=>id===missing?null:get(id);
  assert.doesNotThrow(()=>setupPaperTrialShortcut(b.document));
  assert.ok([...b.nodes.values()].every(n=>Object.keys(n.events).length===0));
 }
});

test('shortcut does not check auth or mutate controls for absent, stale or current public capability',()=>{
 for(const mode of ['absent','stale','current']){
  const b=dom(),calls=[];
  const panels=setupPaperPanels({document:b.document,endpointRoot:'https://example.invalid',publicKey:'synthetic',getClient:async()=>{calls.push('auth');throw Error('Unexpected auth');},fetcher:async()=>{calls.push('fetch');throw Error('Unexpected history read');}});
  const p=report();if(mode==='absent')delete p.market_experiment_capability;if(mode==='stale')p.heartbeat_at=p.experiment_evaluated_at=new Date(Date.now()-91000).toISOString();
  panels.observe(p);const before=panels.experiments.getState();setupPaperTrialShortcut(b.document);b.nodes.get('openPaperTrial').events.click();
  assert.equal(b.nodes.get('experimentStart').disabled,true);assert.equal(b.nodes.get('experimentStop').disabled,true);assert.deepEqual(calls,[]);assert.deepEqual(panels.experiments.getState(),before);
 }
});

test('shortcut preserves verified-owner gates and sends no owner command even when Start is enabled',async()=>{
 const saved=globalThis.sessionStorage;globalThis.sessionStorage=memory();
 try{for(const mode of ['absent','stale','current']){
  const b=dom(),calls=[];
  const client={auth:{getUser:async()=>{calls.push('getUser');return {data:{user:{id:'test-owner'}}};},onAuthStateChange:()=>({})},from:()=>({select:()=>({eq:async()=>({data:[{id:'neptune-paper-v2',enabled:true,epoch:7}]})})}),rpc:async()=>{calls.push('rpc');throw Error('Unexpected owner command');}};
  const panels=setupPaperPanels({document:b.document,endpointRoot:'https://example.invalid',publicKey:'synthetic',getClient:async()=>client});
  const p=report();if(mode==='absent')delete p.market_experiment_capability;if(mode==='stale')p.heartbeat_at=p.experiment_evaluated_at=new Date(Date.now()-91000).toISOString();
  panels.observe(p);await panels.experiments.refresh();assert.equal(b.nodes.get('experimentStart').disabled,mode!=='current');
  const before=panels.experiments.getState(),beforeCalls=[...calls];setupPaperTrialShortcut(b.document);b.nodes.get('openPaperTrial').events.click();b.nodes.get('openPaperTrial').events.click();
  assert.deepEqual(calls,beforeCalls);assert.deepEqual(panels.experiments.getState(),before);assert.equal(b.nodes.get('experimentStart').disabled,mode!=='current');
  if(mode!=='current'){await panels.experiments.start();assert.equal(calls.includes('rpc'),false);}
 }}finally{if(saved===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=saved;}
});

test('isolated shortcut has a versioned entry point without revising owner runtime dependencies',()=>{
 for(const [kind,name] of [['stylesheet','paper-trial-shortcut.css'],['module','paper-trial-shortcut.mjs']])assert.ok(html.includes(`./${name}?v=paper-trial-shortcut-20261010`),kind);
 assert.match(html,/\.\/neptune\.mjs\?v=experiment-provenance-v3-r2/);
 assert.match(html,/\.\/team-work\.mjs\?v=experiment-provenance-v3-r2/);
 assert.doesNotMatch(source,/^import /m);
});
