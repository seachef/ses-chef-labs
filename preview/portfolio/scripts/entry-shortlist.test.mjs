import test from 'node:test';
import assert from 'node:assert/strict';
import {shortlistStates} from '../portfolio/entry-shortlist.mjs';
import {ENTRY_WATCH_ASSETS} from '../portfolio/news-data.mjs';
const now=Date.parse('2026-10-07T11:00:00Z');
function ledger(){return {schema_version:1,assets:[...ENTRY_WATCH_ASSETS],records:ENTRY_WATCH_ASSETS.flatMap(asset=>[0,1].map(i=>({id:asset.toLowerCase()+'-'+i,asset,status:'observed',venue:'Synthetic Spot',pair:asset+'USD',quote_currency:'USD',interval:'1d',candle_open_at:`2026-10-0${5+i}T00:00:00Z`,candle_close_at:`2026-10-0${6+i}T00:00:00Z`,low:i?'1':'2',close:'3',volume:'100',observed_at:'2026-10-07T10:00:00Z',source_url:'https://example.com/candles',assessment:i?'lower_low':'baseline',compared_with:i?asset.toLowerCase()+'-0':null,supersedes:null,note:'Synthetic market observation for a test.'}))) };}
test('all five fresh records remain Watch even when every asset has a lower low',()=>{
 const data=ledger(),copy=JSON.stringify(data);assert.deepEqual(shortlistStates(data,now),ENTRY_WATCH_ASSETS.map(asset=>({asset,status:'watch',label:'Watch'})));assert.equal(JSON.stringify(data),copy);
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
