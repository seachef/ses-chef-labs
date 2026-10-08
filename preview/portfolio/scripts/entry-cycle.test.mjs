import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CYCLE_START, CYCLE_ASSETS, deriveCycleReference, parseCycleCandles, readCycleReference } from '../portfolio/entry-cycle.mjs';

const WEEK=7*86400000, NOW=CYCLE_START+109*WEEK+2*86400000;
function candles(){return Array.from({length:110},(_,i)=>{
 const at=CYCLE_START+i*WEEK,low=i===5?'0.01':i===60?'1':'1.2',close=i===10?'10':i===109?'1.25':'2';
 return [at,'2',i===10?'12':'3',low,close,'100',at+WEEK-1];
});}
function segments(asset,rows=candles()){
 if(asset==='AKT')return [{error:[],result:{AKTUSD:rows.map(r=>[r[0]/1000,r[1],r[2],r[3],r[4],'1','100',20])}}];
 return CYCLE_ASSETS[asset].pairs.length===2?[rows.slice(0,51),rows.slice(50)]:[rows];
}
test('bear low excludes pre-peak prices and gives the exact current-to-low percentage',()=>{
 for(const asset of Object.keys(CYCLE_ASSETS)){
  const payload=segments(asset),copy=structuredClone(payload),q=deriveCycleReference(asset,payload,NOW);
  assert.equal(q.low,'1');assert.equal(q.current,'1.25');assert.equal(q.percentLabel,'+25%');assert.equal(q.lowAt,CYCLE_START+60*WEEK);assert.deepEqual(payload,copy);
  assert.equal(q.currency,asset==='AKT'?'USD':'USDT');
 }
});
test('current-week new lows are included and a price at the floor is not a false rebound',()=>{
 const rows=candles();rows.at(-1)[3]='0.75';rows.at(-1)[4]='0.75';
 const q=deriveCycleReference('APT',[rows],NOW);assert.equal(q.low,'0.75');assert.equal(q.percentLabel,'At low');
 rows.at(-1)[4]='0.75000001';assert.equal(deriveCycleReference('APT',[rows],NOW).percentLabel,'+<0.1%');
});
test('an initial listing wick cannot move the weekly-close anchor',()=>{
 const rows=candles();rows[0][2]='1249';const q=deriveCycleReference('TAO',[rows],NOW);assert.equal(q.peakAt,CYCLE_START+10*WEEK);assert.equal(q.low,'1');
});
test('missing history, truncated windows, gaps, invalid candles and old last prices fail closed',()=>{
 assert.throws(()=>deriveCycleReference('RENDER',[candles()],NOW),/Incomplete/);
 for(const change of [r=>r.splice(30,1),r=>r.splice(0,10),r=>r.splice(0,50),r=>r.pop(),r=>r[40][3]='0',r=>r[40][2]='1',r=>r.reverse()]){
  const rows=candles();change(rows);
  assert.throws(()=>deriveCycleReference('APT',[rows],NOW));
 }
 const rows=candles();rows.at(-2)[4]='20';rows.at(-2)[2]='21';assert.throws(()=>deriveCycleReference('APT',[rows],NOW),/Post-peak/);
 assert.throws(()=>parseCycleCandles({error:['unavailable']},'AKT','AKTUSD',NOW));
});
test('public GETs use fixed venue/pair identities and never send private data',async()=>{
 const payload=segments('RENDER'),calls=[];
 const q=await readCycleReference('RENDER',{now:()=>NOW,fetchImpl:async(url,options)=>{
  const index=calls.length;calls.push({url,options});return {ok:true,url,text:async()=>JSON.stringify(payload[index])};
 }});
 assert.equal(q.percentLabel,'+25%');assert.equal(calls.length,2);
 for(const {url,options} of calls){assert.equal(new URL(url).hostname,'data-api.binance.vision');assert.equal(new URL(url).searchParams.get('interval'),'1w');assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.body,undefined);}
 await assert.rejects(readCycleReference('UNKNOWN',{fetchImpl:()=>{throw Error('must not fetch');}}),/Unsupported/);
});
test('source failures never fall back to yesterday\'s low',async()=>{
 await assert.rejects(readCycleReference('APT',{fetchImpl:async()=>({ok:false})}),/unavailable/);
 await assert.rejects(readCycleReference('APT',{fetchImpl:async()=>({ok:true,text:async()=>'['})}));
});
test('Watch pulse is slow, amber-only and disabled for reduced motion',()=>{
 const css=fs.readFileSync('portfolio/entry-cycle.css','utf8');
 assert.match(css,/data-entry-status="watch"[^}]*animation:entry-watch-pulse 2\.6s/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*animation:none/);
 assert.doesNotMatch(css,/data-entry-status="(?:review|stale|unavailable)"[^}]*animation/);
});
