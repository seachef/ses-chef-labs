import test from 'node:test';
import assert from 'node:assert/strict';
import {shortlistStates} from '../portfolio/entry-shortlist.mjs';
import {ENTRY_WATCH_ASSETS} from '../portfolio/news-data.mjs';
const now=Date.parse('2026-10-07T11:00:00Z');
function ledger(){return {schema_version:1,assets:[...ENTRY_WATCH_ASSETS],records:ENTRY_WATCH_ASSETS.flatMap(asset=>[0,1].map(i=>({id:asset.toLowerCase()+'-'+i,asset,status:'observed',venue:'Synthetic Spot',pair:asset+'USD',quote_currency:'USD',interval:'1d',candle_open_at:`2026-10-0${5+i}T00:00:00Z`,candle_close_at:`2026-10-0${6+i}T00:00:00Z`,low:i?'1':'2',close:'3',volume:'100',observed_at:'2026-10-07T10:00:00Z',source_url:'https://example.com/candles',assessment:i?'lower_low':'baseline',compared_with:i?asset.toLowerCase()+'-0':null,supersedes:null,note:'Synthetic market observation for a test.'}))) };}
test('fresh verified lower lows use an amber evidence tag, never green',()=>{
 const data=ledger(),copy=JSON.stringify(data);assert.deepEqual(shortlistStates(data,now),ENTRY_WATCH_ASSETS.map(asset=>({asset,status:'watch',label:'Lower low'})));assert.equal(JSON.stringify(data),copy);
});
test('missing and empty research is neutral, not a buy indication',()=>{
 for(const data of [null,{...ledger(),records:[]}])assert.ok(shortlistStates(data,now).every(row=>row.status==='unavailable'&&row.label==='No data'));
});
test('observation age expires honestly at the 36-hour boundary',()=>{
 const data=ledger(),edge=Date.parse('2026-10-08T22:00:00Z');assert.ok(shortlistStates(data,edge).every(row=>row.status==='watch'));assert.ok(shortlistStates(data,edge+1).every(row=>row.status==='stale'));
});
test('old candles cannot appear current just because their retrieval was recent',()=>{
 const data=ledger();for(const row of data.records){row.observed_at='2026-10-10T10:00:00Z';}assert.ok(shortlistStates(data,Date.parse('2026-10-10T11:00:00Z')).every(row=>row.status==='stale'));
});
test('invalid or injected qualification flags never grant readiness',()=>{
 const data=ledger();data.records[0].qualified=true;assert.throws(()=>shortlistStates(data,now),/unknown property/);
 const statuses=new Set(shortlistStates(ledger(),now).map(row=>row.status));assert.equal(statuses.has('buy'),false);assert.equal(statuses.has('qualified'),false);
});
test('a failed latest check does not reuse an older positive status',()=>{
 const data=ledger();data.records.push({...data.records[0],id:'render-unavailable',status:'unavailable',candle_open_at:null,candle_close_at:null,low:null,close:null,volume:null,observed_at:'2026-10-07T10:30:00Z',assessment:'unknown',compared_with:null,note:'Synthetic provider unavailable.'});assert.equal(shortlistStates(data,now)[0].status,'unavailable');
});

test('a corrected comparison removes the lower-low tag until the latest candle is rechecked',()=>{
 const data=ledger(),first=data.records[0];data.records.push({...first,id:'render-corrected',observed_at:'2026-10-07T10:30:00Z',low:'0.5',supersedes:first.id});
 assert.equal(shortlistStates(data,now)[0].label,'Watch');
});
test('higher lows do not imply basing, crowd interest or an all-time low',()=>{
 const data=ledger();for(const row of data.records)if(row.assessment==='lower_low'){row.low='2';row.assessment='not_lower_low';}
 assert.ok(shortlistStates(data,now).every(row=>row.label==='Watch'));
});

test('empty shortlist stays empty on refresh and never requests removed coin prices',async()=>{
 const {createEntryShortlist}=await import('../portfolio/entry-shortlist.mjs');
 const nodes=[];
 const element=()=>({hidden:false,append(){},insertBefore(){},remove(){},querySelector(selector){return this.children?.[selector]||null;},set innerHTML(value){this.children={'[role="status"]':{textContent:''},button:{hidden:false,disabled:false}};}});
 const doc={createElement(){const node=element();nodes.push(node);return node;}};
 const container={ownerDocument:doc,append(){},insertBefore(){},querySelector(){return null;},addEventListener(){},removeEventListener(){}};
 let requests=0;
 const shortlist=createEntryShortlist({container,historyContainer:{querySelector(){return null;}},fetchImpl:()=>{requests++;throw Error('No coin request allowed');}});
 const filter=nodes[1];
 assert.equal(filter.querySelector('[role="status"]').textContent,'No qualifying coins shortlisted.');
 assert.equal(filter.querySelector('button').hidden,true);
 await shortlist.loadCycles();await shortlist.loadCycles({force:true});shortlist.recheck();
 assert.equal(requests,0);assert.equal(filter.querySelector('[role="status"]').textContent,'No qualifying coins shortlisted.');shortlist.destroy();
});

test('HTML has no active rejected coin cards and preserves the market meter',async()=>{
 const {readFile}=await import('node:fs/promises');
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/data-entry-coin=/);
 assert.match(html,/id="marketMeter"/);
});
