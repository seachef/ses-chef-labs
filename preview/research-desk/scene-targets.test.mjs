import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSceneTargets,isVerifiedSceneFill,sceneInstrument,TARGET_LIMITS} from './scene-targets.mjs?v=experiment-provenance-v3-r2';
import {validateV2} from './status-v2.mjs?v=experiment-provenance-v3-r2';
import {readNativePaper} from './native-paper.mjs';

const NOW=Date.parse('2026-10-09T13:20:00Z');
const iso=n=>new Date(n).toISOString();
const clone=structuredClone;
const running=JSON.parse(fs.readFileSync(new URL('./fixtures/engine-running-v2.json',import.meta.url),'utf8'));
const settled=JSON.parse(fs.readFileSync(new URL('./fixtures/engine-settled-v2.json',import.meta.url),'utf8'));
const buyTemplate=running.fills.find(f=>f.side==='buy');
const sellTemplate=settled.fills.find(f=>f.side==='sell');

function legacyFill(id,at=NOW,side='buy',asset='ETH/USD'){
 return {...clone(side==='sell'?sellTemplate:buyTemplate),id,at:iso(at),side,asset};
}
function nativeFill(id,at=NOW,side='buy',asset='binance:SOLUSDT'){
 const hype=asset==='hyperliquid:@107',venue=hype?'hyperliquid':'binance',base=hype?'HYPE':'SOL',quote=hype?'USDC':'USDT';
 return {id,asset,venue,side,quote_currency:quote,gross_qty:.123,
  fee_qty:side==='buy'?.000123:0,fee_quote:side==='buy'?0:.5,fee_currency:side==='buy'?base:quote,
  net_inventory_delta:side==='buy'?.122877:-.123,net_quote_delta:side==='buy'?-300:399.5,
  cash_delta_base:side==='buy'?-450:null,fee_base:side==='buy'?.45:null,fx_cost_base:side==='buy'?1:null,
  position_status:side==='buy'?'open':'closed',settlement_status:side==='buy'?'settled':'pending_native_conversion',at:iso(at)};
}
function report({at=NOW,fills=[],native,decisions=[]}={}){
 const p=clone(running);
 Object.assign(p,{heartbeat_at:iso(at),scan_at:iso(at),quote_at:iso(at),fills,positions:[],settlements:[],results:[],decisions});
 p.account.fills=fills.length+(native?.length??0);
 p.account.valuation_at=iso(at);
 if(native!==undefined)p.native_paper={version:1,mode:'PAPER',observed_at:iso(at),valuation_at:iso(at),valuation_complete:true,history_complete:false,positions:[],pending_quote_balances:[],recent_fills:native};
 assert.equal(validateV2([{id:'neptune-paper-v2',payload:p}]),p,'test report must satisfy the authoritative legacy validator');
 if(native!==undefined)assert.equal(readNativePaper(p,at).state,'valid','test native report must satisfy the native validator');
 return p;
}
function activity(records=[],{connected=true,nativeStatus='ready'}={}){
 return {records,connected,nativeStatus,latestAt:records.at(-1)?.at??null};
}
function decision(id,at=NOW,asset='ETH/USD',action='hold',result='no_trade'){
 const native=asset.includes(':');
 return {key:(native?'native':'kraken')+':string:'+id,at:iso(at),asset,action,result,reason:result==='pending'?'completed_15m_momentum':'later_observation_entry',source:native?(asset.startsWith('hyperliquid')?'Hyperliquid paper decision':'Binance paper decision'):'Kraken paper decision'};
}
function quiet(scene,at=NOW){assert.equal(scene.current(at),null);assert.ok(scene.markers(at).every(m=>!m.active));}
function seeded({native}={}){const scene=createSceneTargets();scene.observeReport(report({native}),NOW);return scene;}

test('fixed instrument registry labels HYPE with its actual USDC pair',()=>{
 assert.deepEqual(sceneInstrument('hyperliquid:@107'),{label:'HYPE',pair:'HYPE/USDC',venue:'Hyperliquid'});
 assert.deepEqual(sceneInstrument('binance:SOLUSDT'),{label:'SOL',pair:'SOL/USDT',venue:'Binance'});
 assert.equal(sceneInstrument('HYPE/USD'),null);
 assert.equal(sceneInstrument('__proto__'),null);
 assert.ok(Object.isFrozen(sceneInstrument('hyperliquid:@107')));
});

test('first report seeds legacy and native actual fills without replaying them',()=>{
 const scene=createSceneTargets();
 scene.observeReport(report({fills:[legacyFill('old-legacy')],native:[nativeFill('old-native',NOW,'buy','hyperliquid:@107')]}),NOW);
 quiet(scene);
 assert.equal(scene.snapshot().queued,0);
 assert.deepEqual(scene.markers(NOW).map(m=>m.pair),['ETH/USD','HYPE/USDC']);
});

test('first delayed native fill hydration stays quiet independently of the seeded legacy source',()=>{
 const scene=seeded();
 scene.observeReport(report({at:NOW+100,native:[nativeFill('hydrated-native',NOW+100)]}),NOW+100);
 quiet(scene,NOW+100);
 scene.observeReport(report({at:NOW+200,native:[nativeFill('new-native',NOW+200)]}),NOW+200);
 const cue=scene.current(NOW+200);
 assert.equal(cue?.kind,'buy');
 assert.equal(cue?.asset,'binance:SOLUSDT');
 assert.equal(isVerifiedSceneFill(cue,NOW+200),true);
});

for(const side of ['buy','sell'])test('only a new validated legacy '+side+' creates a trusted receipt',()=>{
 const scene=seeded(),at=NOW+100;
 scene.observeReport(report({at,fills:[legacyFill('new-'+side,at,side)]}),at);
 const cue=scene.current(at);
 assert.equal(cue?.kind,side);assert.equal(cue?.asset,'ETH/USD');assert.equal(cue?.at,iso(at));
 assert.equal(isVerifiedSceneFill(cue,at),true);assert.equal(isVerifiedSceneFill({...cue},at),false);
 assert.equal(scene.current(at+1),cue,'the same receipt is reused for one animation');
 assert.equal(scene.current(cue.until),null,'an expired receipt is not replayed');
});

for(const side of ['buy','sell'])test('validated native '+side+' uses actual fill receipts including unsettled exits',()=>{
 const scene=seeded({native:[]}),at=NOW+100;
 scene.observeReport(report({at,native:[nativeFill('native-'+side,at,side,'hyperliquid:@107')]}),at);
 const cue=scene.current(at);
 assert.equal(cue?.kind,side);assert.equal(cue?.asset,'hyperliquid:@107');assert.equal(isVerifiedSceneFill(cue,at),true);
 assert.equal(scene.markers(at).find(m=>m.asset===cue.asset)?.pair,'HYPE/USDC');
});

test('decision action buy/result filled is a checked marker and never a firing receipt',()=>{
 const scene=seeded({native:[]});scene.observeActivity(activity(),NOW);
 const at=NOW+100;scene.observeReport(report({at,native:[]}),at);
 scene.observeActivity(activity([decision('decision-only',at,'ETH/USD','buy','filled'),decision('native-decision-only',at,'hyperliquid:@107','buy','filled')]),at);
 assert.equal(scene.current(at),null);
 const markers=scene.markers(at);assert.equal(markers.length,2);
 assert.ok(markers.every(m=>m.kind==='checked'&&m.result==='filled'&&m.active));
 assert.ok(markers.every(m=>!isVerifiedSceneFill(m,at)));
});

test('raw ledger decisions also cannot masquerade as actual fills',()=>{
 const scene=seeded(),at=NOW+100;
 const d={...clone(running.decisions.find(d=>d.action==='buy'&&d.result==='filled')),id:'decision-no-fill',at:iso(at)};
 scene.observeReport(report({at,decisions:[d]}),at);quiet(scene,at);
});

test('native decision hydration is independently quiet after legacy decision baseline',()=>{
 const scene=seeded();scene.observeActivity(activity([],{nativeStatus:'loading'}),NOW);
 const at=NOW+100;scene.observeReport(report({at}),at);
 scene.observeActivity(activity([decision('native-hydration',at,'hyperliquid:@107')]),at);
 quiet(scene,at);
 scene.observeReport(report({at:at+100}),at+100);
 scene.observeActivity(activity([decision('native-new',at+100,'hyperliquid:@107')]),at+100);
 assert.equal(scene.current(at+100),null);assert.equal(scene.markers(at+100)[0]?.active,true);
});

test('repeated and reordered reports cannot replay actual fill IDs or extend their lifetime',()=>{
 const scene=seeded(),at=NOW+100,fill=legacyFill('once',at),p=report({at,fills:[fill]});
 scene.observeReport(p,at);const cue=scene.current(at);assert.ok(cue);
 scene.observeReport(clone(p),at+1);assert.equal(scene.current(at+1),cue);
 assert.equal(scene.current(cue.until),null);
 scene.observeReport(report({at:cue.until+1,fills:[fill]}),cue.until+1);assert.equal(scene.current(cue.until+1),null);
});

test('two new actual fills at one timestamp both queue once',()=>{
 const scene=seeded(),at=NOW+100;
 scene.observeReport(report({at,fills:[legacyFill('b',at,'buy','SOL/USD'),legacyFill('a',at)]}),at);
 const first=scene.current(at),second=scene.current(first.until);
 assert.ok(first&&second);assert.notEqual(first.eventId,second.eventId);
 assert.equal(scene.current(second.until),null);
});

test('a regressed report cannot insert a new older fill',()=>{
 const scene=seeded();scene.observeReport(report({at:NOW+200}),NOW+200);
 scene.observeReport(report({at:NOW+100,fills:[legacyFill('regressed',NOW+100)]}),NOW+201);
 quiet(scene,NOW+201);
});

for(const [name,change]of Object.entries({
 'live mode':p=>p.mode='LIVE',
 'bad ledger quantity':p=>p.fills[0].qty=-1,
 'duplicate fill identity':p=>p.fills.push(clone(p.fills[0])),
 'forged execution accounting':p=>p.fills[0].net_usd=0,
 'unknown asset':p=>p.fills[0].asset='DOGE/USD',
 'future heartbeat':p=>p.heartbeat_at=iso(NOW+101),
 'invalid heartbeat':p=>p.heartbeat_at='not-a-time',
 'future fill':p=>p.fills[0].at=iso(NOW+101)
}))test(name+' cannot emit a fill',()=>{
 const scene=seeded(),p=report({at:NOW+100,fills:[legacyFill('bad',NOW+100)]});change(p);
 scene.observeReport(p,NOW+100);quiet(scene,NOW+100);
});

test('a stale report cannot fire and reconnecting first report is quiet',()=>{
 const scene=seeded(),at=NOW+TARGET_LIMITS.freshMs+1;
 scene.observeReport(report({fills:[legacyFill('stale')]}),at);quiet(scene,at);
 scene.observeReport(report({at:at+1,fills:[legacyFill('reconnected',at+1)]}),at+1);quiet(scene,at+1);
});

test('stale fills in a fresh report do not fire',()=>{
 const scene=seeded(),at=NOW+TARGET_LIMITS.freshMs+1;
 scene.observeReport(report({at,fills:[legacyFill('stale-fill',NOW)]}),at);quiet(scene,at);
});

test('native accounting failures cannot create receipts and repaired hydration remains quiet',()=>{
 const scene=seeded({native:[]}),at=NOW+100;
 const p=report({at,native:[nativeFill('bad-native',at)]});p.native_paper.recent_fills[0].net_inventory_delta=.123;
 scene.observeReport(p,at);quiet(scene,at);
 scene.observeReport(report({at:at+1,native:[nativeFill('repaired',at+1)]}),at+1);quiet(scene,at+1);
});

test('an invalid activity snapshot does not produce a fill or inject arbitrary marker fields',()=>{
 const scene=seeded();scene.observeActivity(activity(),NOW);
 const at=NOW+100;scene.observeReport(report({at}),at);
 for(const bad of [
  {...decision('bad-source',at),source:'<img src=x onerror=alert(1)>'},
  {...decision('bad-id',at),key:'kraken-fill:string:forged'},
  {...decision('bad-reason',at),reason:'<script>bad()</script>'},
  {...decision('future',at),at:iso(at+1)}
 ]){scene.observeActivity(activity([bad]),at);quiet(scene,at);}
 assert.equal(scene.markers(at).length,0);
});

test('pause drops active and queued receipts and resume establishes a quiet baseline',()=>{
 const scene=seeded(),at=NOW+100;
 scene.observeReport(report({at,fills:[legacyFill('visible',at),legacyFill('queued',at,'sell')]}),at);
 assert.ok(scene.current(at));scene.setActive(false);quiet(scene,at);
 assert.equal(scene.snapshot().queued,0);
 scene.observeReport(report({at:at+1,fills:[legacyFill('during-pause',at+1)]}),at+1);quiet(scene,at+1);
 scene.setActive(true);
 scene.observeReport(report({at:at+2,fills:[legacyFill('resume-baseline',at+2)]}),at+2);quiet(scene,at+2);
 scene.observeReport(report({at:at+3,fills:[legacyFill('after-resume',at+3)]}),at+3);assert.ok(scene.current(at+3));
});

test('disconnect clears active/queued receipts and reconnect has no historical catch-up',()=>{
 const scene=seeded(),at=NOW+100;
 scene.observeReport(report({at,fills:[legacyFill('disconnect-active',at),legacyFill('disconnect-queued',at)]}),at);assert.ok(scene.current(at));
 scene.disconnect();quiet(scene,at);assert.equal(scene.snapshot().connected,false);assert.equal(scene.snapshot().queued,0);
 scene.observeReport(report({at:at+1,fills:[legacyFill('disconnected-history',at+1)]}),at+1);quiet(scene,at+1);
});

test('clock rollback fails closed and cannot revive a prior animation',()=>{
 const scene=seeded(),at=NOW+100;
 scene.observeReport(report({at,fills:[legacyFill('clock-active',at)]}),at);assert.ok(scene.current(at));
 quiet(scene,at-1);assert.equal(scene.snapshot().connected,false);
 quiet(scene,at+1);
 scene.observeReport(report({at:at+2,fills:[legacyFill('clock-reconnect',at+2)]}),at+2);quiet(scene,at+2);
});

test('non-finite observer time fails closed',()=>{
 for(const n of [NaN,Infinity,-Infinity]){
  const scene=seeded(),at=NOW+100;scene.observeReport(report({at,fills:[legacyFill('nan-time',at)]}),n);
  quiet(scene,at);
 }
});

test('receipts and marker projections cannot be mutated into a new shot',()=>{
 const scene=seeded(),at=NOW+100,p=report({at,fills:[legacyFill('immutable',at)]});
 scene.observeReport(p,at);const cue=scene.current(at);assert.ok(Object.isFrozen(cue));
 assert.throws(()=>{cue.asset='SOL/USD';},TypeError);
 assert.equal(isVerifiedSceneFill(clone(cue),at),false);
 p.fills[0].side='sell';p.fills[0].asset='SOL/USD';assert.equal(cue.kind,'buy');assert.equal(cue.asset,'ETH/USD');
 const markers=scene.markers(at);assert.ok(Object.isFrozen(markers));assert.ok(markers.every(Object.isFrozen));
 assert.throws(()=>{markers[0].kind='sell';},TypeError);
 const snap=scene.snapshot();snap.queued=100000;assert.notEqual(scene.snapshot().queued,100000);
});

test('a burst respects receipt and marker capacity and expired backlog cannot replay later',()=>{
 const scene=seeded({native:[]}),at=NOW+100;
 const assets=['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD'];
 const fills=Array.from({length:50},(_,i)=>legacyFill('burst-'+i,at,'buy',assets[i%assets.length]));
 const native=Array.from({length:50},(_,i)=>nativeFill('native-burst-'+i,at,'buy',i%2?'hyperliquid:@107':'binance:SOLUSDT'));
 scene.observeReport(report({at,fills,native}),at);
 assert.ok(scene.snapshot().queued<=TARGET_LIMITS.capacity);
 assert.ok(scene.snapshot().markerCount<=TARGET_LIMITS.markers);
 assert.ok(scene.markers(at).length<=TARGET_LIMITS.markers);
 assert.ok(scene.current(at));
 assert.equal(scene.current(at+TARGET_LIMITS.backlogMs),null);
 assert.equal(scene.snapshot().queued,0);
});

for(const native of [false,true])test('long-running '+(native?'native':'legacy')+' dedupe cannot resurrect an evicted fill ID with a changed timestamp',()=>{
 const scene=seeded(native?{native:[]}:{});
 for(let i=1;i<=320;i++){
  const at=NOW+i;scene.observeReport(report(native?{at,native:[nativeFill('long-'+i,at)]}:{at,fills:[legacyFill('long-'+i,at)]}),at);
  assert.ok(scene.snapshot().queued<=TARGET_LIMITS.capacity);
 }
 const at=NOW+TARGET_LIMITS.backlogMs+1000;assert.equal(scene.current(at),null);
 scene.observeReport(report(native?{at:at+1,native:[nativeFill('long-1',at+1)]}:{at:at+1,fills:[legacyFill('long-1',at+1)]}),at+1);
 assert.equal(scene.current(at+1),null,'an old immutable fill identity must not become a new receipt after dedupe eviction');
});

test('number and string legacy fill IDs retain independent identities',()=>{
 const scene=seeded(),at=NOW+100;
 scene.observeReport(report({at,fills:[legacyFill(1,at),legacyFill('1',at,'sell')]}),at);
 const first=scene.current(at),second=scene.current(first.until);
 assert.ok(first&&second);assert.notEqual(first.eventId,second.eventId);
 assert.deepEqual(new Set([first.kind,second.kind]),new Set(['buy','sell']));
});

test('native invalidation drops native receipts without manufacturing a legacy fill',()=>{
 const scene=seeded({native:[]}),at=NOW+100;
 scene.observeReport(report({at,native:[nativeFill('native-active',at),nativeFill('native-queued',at)]}),at);
 const cue=scene.current(at);assert.ok(cue);
 const p=report({at:at+1,native:[]});p.native_paper.mode='LIVE';scene.observeReport(p,at+1);
 quiet(scene,at+1);assert.equal(scene.snapshot().queued,0);assert.equal(isVerifiedSceneFill(cue,at+1),false);
});

for(const [name,invalidate]of Object.entries({pause:s=>s.setActive(false),disconnect:s=>s.disconnect(),rollback:(s,at)=>s.current(at-1)}))test(name+' revokes previously issued receipt authority',()=>{
 const scene=seeded(),at=NOW+100;scene.observeReport(report({at,fills:[legacyFill('revoke-'+name,at)]}),at);
 const cue=scene.current(at);assert.equal(isVerifiedSceneFill(cue,at),true);
 invalidate(scene,at);assert.equal(isVerifiedSceneFill(cue,at+1),false);
});

test('unchanged decision snapshots neither erase a live marker nor extend its deadline',()=>{
 const scene=seeded();scene.observeActivity(activity(),NOW);
 const at=NOW+100;scene.observeReport(report({at}),at);
 const snapshot=activity([decision('pending-once',at,'ETH/USD','buy','pending')]);scene.observeActivity(snapshot,at);
 const initial=scene.markers(at)[0];assert.equal(initial.active,true);
 scene.observeActivity(clone(snapshot),at+1);const next=scene.markers(at+1)[0];
 assert.equal(next.active,true);assert.equal(next.until,initial.until);assert.equal(next.kind,'checked');
 assert.equal(scene.markers(initial.until)[0].active,false);assert.equal(scene.current(initial.until),null);
});

test('unavailable native decisions expire native checked markers without firing',()=>{
 const scene=seeded();scene.observeActivity(activity(),NOW);
 const at=NOW+100;scene.observeReport(report({at}),at);
 const records=[decision('native-status-change',at,'hyperliquid:@107')];scene.observeActivity(activity(records),at);
 assert.equal(scene.markers(at)[0].active,true);
 scene.observeActivity(activity(records,{nativeStatus:'unavailable'}),at+1);quiet(scene,at+1);
});

test('fill freshness bounds a receipt even when its normal animation duration remains',()=>{
 const scene=seeded(),at=NOW+TARGET_LIMITS.freshMs;
 scene.observeReport(report({at:NOW+45000}),NOW+45000);
 scene.observeReport(report({at,fills:[legacyFill('edge-of-freshness',NOW+1)]}),at);
 const cue=scene.current(at);assert.ok(cue);assert.equal(cue.until,at+1);
 assert.equal(isVerifiedSceneFill(cue,at),true);assert.equal(isVerifiedSceneFill(cue,at+1),false);
 assert.equal(scene.current(at+1),null);
});

test('a long observation gap establishes a quiet baseline instead of catching up',()=>{
 const scene=seeded(),at=NOW+TARGET_LIMITS.freshMs+100;
 scene.observeReport(report({at,fills:[legacyFill('after-gap',at)]}),at);
 quiet(scene,at);
});

test('marker history ages out and cannot be revived by moving the clock backwards',()=>{
 const scene=createSceneTargets();scene.observeReport(report({fills:[legacyFill('historical-marker')]}),NOW);
 assert.equal(scene.markers(NOW).length,1);
 assert.equal(scene.markers(NOW+TARGET_LIMITS.historyMs+1).length,0);
 assert.equal(scene.markers(NOW).length,0);
});

for(const mode of ['initial','reconnect','native-recovery'])test('delayed history before '+mode+' observation boundary never fires',()=>{
 const s=createSceneTargets();s.observeReport(report({native:[]}),NOW);
 if(mode==='reconnect'){s.disconnect();s.observeReport(report({at:NOW+50,native:[]}),NOW+50);}
 if(mode==='native-recovery'){const bad=report({at:NOW+50,native:[]});bad.native_paper.mode='LIVE';s.observeReport(bad,NOW+50);s.observeReport(report({at:NOW+100,native:[]}),NOW+100);}
 const at=NOW+200;s.observeReport(report({at,fills:[legacyFill('delayed-history',NOW-1)],native:[nativeFill('delayed-native-history',NOW-1,'buy','hyperliquid:@107')]}),at);quiet(s,at);
});
test('newly hydrated decision history predating each source baseline stays dim',()=>{const s=seeded({native:[]});s.observeActivity(activity(),NOW);s.observeReport(report({at:NOW+100,native:[]}),NOW+100);s.observeActivity(activity([decision('backfilled-check',NOW-1),decision('backfilled-native',NOW-1,'hyperliquid:@107')]),NOW+100);quiet(s,NOW+100);});

test('genuine experimental classification preserves one exact-market buy receipt cue',()=>{
 const scene=seeded(),fill={...legacyFill('experimental-confirmed-buy',NOW+100,'buy','SOL/USD'),trade_kind:'experimental',is_experimental:true,execution_class:'paper_experiment'};
 scene.observeReport(report({at:NOW+100,fills:[fill]}),NOW+100);
 const cue=scene.current(NOW+100);assert.ok(cue);assert.equal(cue.kind,'buy');assert.equal(cue.asset,'SOL/USD');assert.equal(sceneInstrument(cue.asset).venue,'Kraken');assert.ok(Object.isFrozen(cue));
 scene.observeReport(report({at:NOW+200,fills:[{...fill,trade_kind:'ordinary'}]}),NOW+200);
 assert.equal(scene.current(NOW+200),cue);assert.equal(scene.current(NOW+1500),null);assert.equal(scene.snapshot().queued,0);
 scene.observeReport(report({at:NOW+2000,fills:[fill]}),NOW+2000);assert.equal(scene.current(NOW+2000),null);
});
test('experimental intent alone and initial-load/reconnect history do not become new buys',()=>{
 const scene=createSceneTargets(),fill={...legacyFill('experiment-history',NOW,'buy','LINK/USD'),trade_kind:'experimental'};
 scene.observeReport(report({fills:[fill]}),NOW);quiet(scene);
 scene.observeActivity(activity([{...decision('experiment-intent',NOW+100,'SOL/USD','buy','pending'),trade_kind:'experimental'}]),NOW+100);assert.equal(scene.current(NOW+100),null);
 scene.disconnect();scene.observeReport(report({at:NOW+200,fills:[fill]}),NOW+200);quiet(scene,NOW+200);
});
test('experimental native buy keeps venue-qualified identity separate from same-ticker Kraken',()=>{
 const scene=seeded({native:[]}),fill={...nativeFill('experimental-binance-sol',NOW+100,'buy','binance:SOLUSDT'),trade_kind:'experimental'};
 scene.observeReport(report({at:NOW+100,native:[fill]}),NOW+100);
 const cue=scene.current(NOW+100);assert.equal(cue.asset,'binance:SOLUSDT');assert.equal(sceneInstrument(cue.asset).pair,'SOL/USDT');assert.equal(sceneInstrument(cue.asset).venue,'Binance');assert.notEqual(cue.asset,'SOL/USD');
});

for(const family of ['legacy','native'])for(const field of ['asset','at','order_id','decision_id','observation_id'])test('REVIEW: '+family+' same-ID '+field+' contradiction revokes active fill authority',()=>{
 const scene=seeded({native:[]}),isNative=family==='native',fill=isNative?nativeFill('immutable-cue',NOW+100):legacyFill('immutable-cue',NOW+100);
 for(const k of ['order_id','decision_id','observation_id'])fill[k]='original-'+k;
 scene.observeReport(report({at:NOW+100,fills:isNative?[]:[fill],native:isNative?[fill]:[]}),NOW+100);const cue=scene.current(NOW+100);assert.ok(cue);
 if(field==='asset'){if(isNative)Object.assign(fill,nativeFill(fill.id,NOW+100,'buy','hyperliquid:@107'));else fill.asset='SOL/USD';}
 else if(field==='at')fill.at=iso(NOW+101);else fill[field]='changed-'+field;
 scene.observeReport(report({at:NOW+110,fills:isNative?[]:[fill],native:isNative?[fill]:[]}),NOW+110);assert.equal(isVerifiedSceneFill(cue,NOW+110),false);assert.equal(scene.current(NOW+110),null);
});
for(const family of ['legacy','native'])test('REVIEW: '+family+' same-ID queued contradiction is purged before firing',()=>{
 const scene=seeded({native:[]}),isNative=family==='native',make=isNative?nativeFill:legacyFill,first=make('a-current',NOW+100),later=make('b-queued',NOW+100);
 scene.observeReport(report({at:NOW+100,fills:isNative?[]:[first,later],native:isNative?[first,later]:[]}),NOW+100);const cue=scene.current(NOW+100);later.observation_id='changed-lineage';scene.observeReport(report({at:NOW+110,fills:isNative?[]:[first,later],native:isNative?[first,later]:[]}),NOW+110);assert.equal(scene.current(cue.until),null);
});
test('REVIEW: explicit conflicting legacy venue cannot acquire Kraken receipt authority',()=>{const scene=seeded(),fill={...legacyFill('wrong-venue',NOW+100),venue:'binance'};scene.observeReport(report({at:NOW+100,fills:[fill]}),NOW+100);assert.equal(scene.current(NOW+100),null);});
test('REVIEW: native settlement enrichment preserves existing execution authority',()=>{
 const scene=seeded({native:[]}),fill=nativeFill('settlement-enrichment',NOW+100,'sell');scene.observeReport(report({at:NOW+100,native:[fill]}),NOW+100);const cue=scene.current(NOW+100);assert.equal(cue.kind,'sell');Object.assign(fill,{settlement_status:'settled',settled_at:iso(NOW+110),at_fill_settlement_status:'pending_native_conversion',cash_delta_base:599.25,fee_base:.75,fx_cost_base:1});scene.observeReport(report({at:NOW+110,native:[fill]}),NOW+110);assert.equal(scene.current(NOW+110),cue);assert.equal(isVerifiedSceneFill(cue,NOW+110),true);
});

function revalueLegacyReceipt(f,fx){Object.assign(f,{fx,fx_source:'Frankfurter ECB reference',fx_at:iso(NOW),fx_rate_date:iso(NOW).slice(0,10),fx_retrieved_at:iso(NOW),fx_applied_rate:fx*(f.side==='buy'?1.0025:.9975),settlement_status:'settled'});f.gross_base=f.gross_usd*fx;f.fee_base=f.fee_usd*fx;f.fx_cost_base=Math.abs(f.net_usd)*Math.abs(f.fx_applied_rate-fx);f.cash_delta_base=f.net_usd*f.fx_applied_rate;}
for(const family of ['legacy','native'])test('REVIEW R3: '+family+' already-settled buy debit/FX change revokes active receipt',()=>{
 const native=family==='native',scene=seeded({native:[]}),f=native?nativeFill('settled-buy-debit',NOW+100):legacyFill('settled-buy-debit',NOW+100);scene.observeReport(report({at:NOW+100,fills:native?[]:[f],native:native?[f]:[]}),NOW+100);const cue=scene.current(NOW+100);assert.equal(cue.kind,'buy');
 if(native)f.cash_delta_base-=10;else revalueLegacyReceipt(f,1.6);scene.observeReport(report({at:NOW+110,fills:native?[]:[f],native:native?[f]:[]}),NOW+110);assert.equal(isVerifiedSceneFill(cue,NOW+110),false);assert.equal(scene.current(NOW+110),null);
});
for(const family of ['legacy','native'])test('REVIEW R3: '+family+' queued buy accounting contradiction is purged',()=>{
 const native=family==='native',scene=seeded({native:[]}),make=native?nativeFill:legacyFill,a=make('a-accounting-stable',NOW+100),b=make('b-accounting-changed',NOW+100);scene.observeReport(report({at:NOW+100,fills:native?[]:[a,b],native:native?[a,b]:[]}),NOW+100);const cue=scene.current(NOW+100);if(native)b.fee_base+=1;else revalueLegacyReceipt(b,1.6);scene.observeReport(report({at:NOW+110,fills:native?[]:[a,b],native:native?[a,b]:[]}),NOW+110);assert.equal(scene.current(cue.until),null);
});
for(const family of ['legacy','native'])test('REVIEW R3: '+family+' first sell settlement is accepted once; later proceeds change revokes',()=>{
 const native=family==='native',scene=seeded({native:[]}),f=native?nativeFill('first-sell-settlement',NOW+100,'sell'):legacyFill('first-sell-settlement',NOW+100,'sell');
 const pending=native?'pending_native_conversion':'pending_conversion';f.settlement_status=pending;if(!native)for(const k of ['fx','fx_source','fx_at','fx_rate_date','fx_retrieved_at','fx_applied_rate','gross_base','fee_base','fx_cost_base','cash_delta_base'])f[k]=null;
 scene.observeReport(report({at:NOW+100,fills:native?[]:[f],native:native?[f]:[]}),NOW+100);const cue=scene.current(NOW+100);assert.equal(cue.kind,'sell');
 if(native)Object.assign(f,{settlement_status:'settled',cash_delta_base:599.25,fee_base:.75,fx_cost_base:1});else revalueLegacyReceipt(f,1.5);Object.assign(f,{at_fill_settlement_status:pending,settled_at:iso(NOW+110)});
 scene.observeReport(report({at:NOW+110,fills:native?[]:[f],native:native?[f]:[]}),NOW+110);assert.equal(scene.current(NOW+110),cue);assert.equal(isVerifiedSceneFill(cue,NOW+110),true);
 if(native)f.cash_delta_base+=1;else revalueLegacyReceipt(f,1.6);scene.observeReport(report({at:NOW+120,fills:native?[]:[f],native:native?[f]:[]}),NOW+120);assert.equal(isVerifiedSceneFill(cue,NOW+120),false);assert.equal(scene.current(NOW+120),null);
});
test('REVIEW R3: native settled fee/FX costs cannot change under a fixed cash debit',()=>{
 for(const field of ['fee_base','fx_cost_base']){const scene=seeded({native:[]}),f=nativeFill('immutable-'+field,NOW+100);scene.observeReport(report({at:NOW+100,native:[f]}),NOW+100);const cue=scene.current(NOW+100);f[field]+=1;scene.observeReport(report({at:NOW+110,native:[f]}),NOW+110);assert.equal(isVerifiedSceneFill(cue,NOW+110),false);}
});
