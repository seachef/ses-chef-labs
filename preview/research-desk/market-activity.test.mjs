import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketActivityFeed,validateMarketActivitySnapshot,MARKET_ACTIVITY_MAX_AGE_MS,MARKET_REASONS,MARKET_SOURCES} from './market-activity.mjs';

const T=Date.parse('2026-10-10T04:00:00Z');
const iso=n=>new Date(n).toISOString();
const decision=(id='one',at=T-1000,extra={})=>({id,at:iso(at),asset:'ETH/USD',action:'hold',result:'no_trade',reason:'no_new_completed_bar',source:'Kraken public spot',quote_currency:'USD',...extra});
const report=(decisions=[],history_seq=1,at=T)=>({heartbeat_at:iso(at),decisions,history_seq});
function native(seq=1,at=T-1000,extra={}){
 const payload={schema_version:3,id:'native-'+seq,at:iso(at),asset:'hyperliquid:@107',quote_currency:'USDC',venue:'hyperliquid',source:'hyperliquid public spot',action:'hold',result:'blocked',reason:'spread_too_wide',...extra};
 return {seq,kind:'native_decisions',id:payload.id,at:payload.at,source_hash:'a'.repeat(64),config_hash:'b'.repeat(64),payload};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('projects only public-safe decision fields and preserves original observation times',async()=>{
 const events=[],f=createMarketActivityFeed({now:()=>T,onChange:s=>events.push(s),fetchNative:async()=>[native(3,T-2000),native(2,T-3000,{asset:'binance:SOLUSDT',quote_currency:'USDT',venue:'binance',source:'binance public spot'})]});
 await f.observe(report([decision('k',T-1000,{qty:999,balance:123,account_number:'PRIVATE',source_hash:'c'.repeat(64)})],3));
 const s=f.snapshot();
 assert.equal(s.nativeStatus,'ready');assert.equal(s.connected,true);assert.equal(s.records.length,3);
 assert.deepEqual(s.records.map(r=>r.source),['Binance paper decision','Hyperliquid paper decision','Kraken paper decision']);
 assert.deepEqual(s.records.map(r=>r.at),[iso(T-3000),iso(T-2000),iso(T-1000)]);
 assert.deepEqual(Object.keys(s.records[0]),['key','at','asset','action','result','reason','source']);
 assert.doesNotMatch(JSON.stringify(s),/PRIVATE|999|account_number|balance|source_hash|qty/);
 assert.equal(s.latestAt,iso(T-1000));assert.deepEqual(validateMarketActivitySnapshot(s,{now:T}),s);
 assert.ok(events.length>=2);
});

test('unchanged polls and heartbeat changes never append or refetch; newer IDs append once',async()=>{
 let calls=0;const events=[],f=createMarketActivityFeed({now:()=>T,onChange:s=>events.push(s),fetchNative:async q=>{calls++;assert.deepEqual(q,{watermark:calls===1?5:6,limit:50});return [native(4)];}});
 await f.observe(report([decision()],5,T-100));const initial=f.snapshot();
 for(let i=0;i<20;i++)await f.observe(report([decision()],5,T-i));
 assert.equal(calls,1);assert.deepEqual(f.snapshot().records,initial.records);assert.equal(events.length,22);
 await f.observe(report([decision(),decision('two',T-500)],6));
 assert.equal(calls,2);assert.equal(f.snapshot().records.length,3);
});

test('unknown free text and enum-looking secrets are withheld; verified reason enums retained',async()=>{
 const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>[native(1,T-900,{reason:'wallet_secret_word'})]});
 await f.observe(report([decision('k',T-1000,{reason:'<script> PRIVATE balance 999 </script>'}),decision('k2',T-950,{reason:'unsupported_specialist_market'})]));
 assert.deepEqual(f.snapshot().records.map(r=>r.reason),[null,'unsupported_specialist_market',null]);
 assert.doesNotMatch(JSON.stringify(f.snapshot()),/PRIVATE|script|wallet_secret_word/);
 assert.ok(Object.isFrozen(MARKET_REASONS));assert.ok(Object.isFrozen(MARKET_SOURCES));
});

test('changed legacy immutable content fails closed without relabelling accepted records',async()=>{
 const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>[]});await f.observe(report([decision()]));const original=f.snapshot().records;
 for(const change of [{reason:'spread_too_wide'},{result:'blocked'},{action:'buy'},{at:iso(T-500)},{asset:'SOL/USD'}]){
  await f.observe(report([decision('new'),decision('one',T-1000,change)]));
  assert.deepEqual(f.snapshot().records,original);assert.equal(f.snapshot().connected,false);
 }
});

test('selected legacy fields reject malformed identities, sources, instruments, timestamps and enums',async()=>{
 for(const change of [{id:'x'.repeat(129)},{id:'private name'},{source:'private service'},{asset:'BTC/USD'},{quote_currency:'USDT'},{action:'trade'},{result:'rejected'},{at:iso(T+1)},{at:'2026-02-30T01:00:00Z'},{reason:null},{reason:'x'.repeat(1001)}]){
  let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>{calls++;return [];}});
  await f.observe(report([decision('one',T-1000,change)]));assert.equal(f.snapshot().records.length,0);assert.equal(f.snapshot().connected,false);assert.equal(calls,0);
 }
});

test('rejects contradictory report and event timestamps, duplicate legacy IDs and oversized reports',async()=>{
 for(const p of [report([decision()],1,T-2000),report([decision()],1,T+1),report([decision(),decision()]),report(Array.from({length:51},(_,i)=>decision('d'+i)))]){
  const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>[]});await f.observe(p);assert.equal(f.snapshot().connected,false);assert.deepEqual(f.snapshot().records,[]);
 }
});

test('only verified safe integer watermarks fetch native history; zero is an empty ready snapshot',async()=>{
 for(const watermark of [null,undefined,'1',1.5,-1,Infinity,Number.MAX_SAFE_INTEGER+1]){
  let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>{calls++;return [];}});await f.observe({...report([decision()]),history_seq:watermark});
  assert.equal(calls,0);assert.equal(f.snapshot().records.length,1);assert.equal(f.snapshot().nativeStatus,'unavailable');
 }
 let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>{calls++;return [];}});await f.observe(report([],0));assert.equal(calls,0);assert.equal(f.snapshot().nativeStatus,'ready');
});

test('native pages reject duplicates, wrong kinds, future or contradictory times and bad decimal proof atomically',async()=>{
 const badPages=[
  [native(1),native(1)],
  [native(1),native(2,T-500,{id:'native-1'})],
  [native(1),native(3)],
  [native(1),{...native(2),kind:'native_fills'}],
  [native(1),native(2,T+1)],
  [native(1),{...native(2),at:iso(T-500)}],
  [native(1),native(2,T-500,{price:123.45})],
  [native(1),native(2,T-500,{private_log:'PRIVATE'})],
  [native(1),native(2,T-500,{source:'Kraken public spot'})],
  [native(1),native(2,T-500,{action:'run'})],
  Array.from({length:51},(_,i)=>native(i+1))
 ];
 for(const rows of badPages){
  const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>rows});await f.observe(report([decision()],2));
  assert.equal(f.snapshot().records.length,1);assert.equal(f.snapshot().nativeStatus,'unavailable');assert.equal(f.snapshot().records[0].source,'Kraken paper decision');
 }
 const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>[native(2,T-500)]});await f.observe(report([],2,T-600));assert.equal(f.snapshot().nativeStatus,'unavailable');
});

test('native immutable ID or sequence conflicts retain the prior truthful batch',async()=>{
 for(const second of [native(1,T-1000,{reason:'no_qualified_momentum'}),native(1,T-1000,{id:'different'}),native(2,T-1000,{id:'native-1'}),{...native(1),source_hash:'c'.repeat(64)}]){
  let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>++calls===1?[native(1)]:[native(3),second]});
  await f.observe(report([],1));const original=f.snapshot().records;
  await f.observe(report([],3));assert.deepEqual(f.snapshot().records,original);assert.equal(f.snapshot().nativeStatus,'unavailable');
 }
});

test('unchanged native overlap is deduplicated regardless of object field order',async()=>{
 let calls=0;const initial=native(1),reordered={...initial,payload:Object.fromEntries(Object.entries(initial.payload).reverse())};
 const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>++calls===1?[initial]:[native(2,T-500),reordered]});
 await f.observe(report([],1));await f.observe(report([],2));assert.equal(f.snapshot().records.length,2);assert.equal(f.snapshot().nativeStatus,'ready');
});

test('failed watermark stays unavailable without refetching until verified sequence advances',async()=>{
 let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>{calls++;if(calls<3)throw Error('private response body');return [native(1)];}});
 await f.observe(report([decision()]));assert.equal(f.snapshot().nativeStatus,'unavailable');const original=f.snapshot().records;
 for(let i=0;i<20;i++)await f.observe(report([decision()]));assert.equal(calls,1);assert.deepEqual(f.snapshot().records,original);assert.equal(f.snapshot().nativeStatus,'unavailable');
 await f.observe(report([decision()],2));assert.equal(calls,2);assert.equal(f.snapshot().nativeStatus,'unavailable');
 await f.observe(report([decision()],3));assert.equal(f.snapshot().records.length,2);assert.equal(f.snapshot().nativeStatus,'ready');
 await f.observe(report([decision()],3));assert.equal(calls,3);assert.doesNotMatch(JSON.stringify(f.snapshot()),/private response/);
});

test('concurrent unchanged watermark shares one request; newer report makes older completion inert',async()=>{
 const requests=[],events=[],f=createMarketActivityFeed({now:()=>T,onChange:s=>events.push(s),fetchNative:async q=>{const d=deferred();requests.push({...d,q});return d.promise;}});
 const first=f.observe(report([decision()],5)),same=f.observe(report([decision()],5));assert.equal(requests.length,1);
 const newer=f.observe(report([decision('new',T-500)],6));assert.equal(requests.length,2);
 requests[1].resolve([native(6,T-200)]);await newer;const accepted=f.snapshot(),emitted=events.length;
 requests[0].resolve([native(5)]);await Promise.all([first,same]);
 assert.deepEqual(f.snapshot(),accepted);assert.equal(events.length,emitted);assert.equal(accepted.nativeStatus,'ready');
});

test('disconnect and dispose invalidate delayed successes and failures without callbacks or replay',async()=>{
 for(const terminal of ['disconnect','dispose'])for(const failure of [false,true]){
  const d=deferred(),events=[],f=createMarketActivityFeed({now:()=>T,onChange:s=>events.push(s),fetchNative:async()=>d.promise});
  const pending=f.observe(report([decision()]));f[terminal]();const length=events.length;
  if(failure)d.reject(Error('stale failure'));else d.resolve([native()]);await pending;
  assert.equal(f.snapshot().records.length,1);assert.equal(f.snapshot().connected,false);assert.equal(events.length,length);
  if(terminal==='dispose'){await f.observe(report([decision('late')]));assert.equal(events.length,length);assert.equal(f.snapshot().records.length,1);}
 }
});

test('reconnect does not retry an interrupted or completed watermark; advancement starts a fresh fetch',async()=>{
 const d=deferred();let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>++calls===1?d.promise:[native(1)]});
 const first=f.observe(report());f.disconnect();await f.observe(report());assert.equal(calls,1);assert.equal(f.snapshot().records.length,0);assert.equal(f.snapshot().nativeStatus,'unavailable');
 await f.observe(report([],2));assert.equal(calls,2);assert.equal(f.snapshot().records.length,1);
 d.resolve([native(1)]);await first;f.disconnect();await f.observe(report([],2));assert.equal(calls,2);assert.equal(f.snapshot().nativeStatus,'ready');
});

test('watermark rollback, old reports and hidden observations cannot overwrite or append newer evidence',async()=>{
 let calls=0;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>{calls++;return [];}});
 await f.observe(report([decision()],10));const initial=f.snapshot().records;
 await f.observe(report([decision('old')],9,T-2000));assert.deepEqual(f.snapshot().records,initial);assert.equal(calls,1);
 await f.observe(report([decision('rollback')],9));assert.equal(f.snapshot().connected,false);assert.deepEqual(f.snapshot().records,initial);
 await f.observe(report([decision('hidden')],11),{connected:false});assert.equal(calls,1);assert.deepEqual(f.snapshot().records,initial);
});

test('records expire after one hour and cannot reappear after clock rollback or a new poll',async()=>{
 let n=T;const f=createMarketActivityFeed({now:()=>n,fetchNative:async()=>[]});
 await f.observe(report([decision('old',T-MARKET_ACTIVITY_MAX_AGE_MS-1),decision('edge',T-MARKET_ACTIVITY_MAX_AGE_MS),decision()]));
 assert.equal(f.snapshot().records.length,2);n=T+MARKET_ACTIVITY_MAX_AGE_MS;assert.equal(f.snapshot().records.length,0);assert.equal(f.snapshot().latestAt,null);
 n=T;await f.observe(report([decision()]));assert.equal(f.snapshot().records.length,0);
});

test('record and identity eviction keep bounded output and prevent retimestamped legacy ID resurrection',async()=>{
 const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>[]});
 for(let page=0;page<12;page++)await f.observe(report(Array.from({length:50},(_,i)=>decision('record-'+(page*50+i),T-10000+page*50+i)),0));
 assert.equal(f.snapshot().records.length,100);assert.equal(f.snapshot().records[0].at,iso(T-9500));const original=f.snapshot().records;
 await f.observe(report([decision('record-0',T-1,{reason:'spread_too_wide'}),decision('late-old',T-10000)],0));
 assert.deepEqual(f.snapshot().records,original);
});

test('native sequence and ID fences prevent replay after exact-key eviction',async()=>{
 let page=0,replay=null;const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>replay??Array.from({length:50},(_,i)=>native(page*50+i+1,T-10000+page*50+i))});
 for(page=0;page<12;page++)await f.observe(report([],(page+1)*50));
 const initial=f.snapshot().records;assert.equal(initial.length,100);
 page=0;await f.observe(report([],601));assert.deepEqual(f.snapshot().records,initial);
 // A genuinely advancing sequence cannot recycle an evicted immutable ID.
 replay=[native(602,T-1,{id:'native-1'})];await f.observe(report([],602));assert.deepEqual(f.snapshot().records,initial);
});

test('snapshot and onChange objects cannot mutate retained feed state; async view failure is isolated',async()=>{
 const f=createMarketActivityFeed({now:()=>T,onChange:async s=>{s.records.length=0;throw Error('view only');},fetchNative:async()=>[native()]});
 await f.observe(report([decision()]));await settle();const state=f.snapshot();state.records[0].reason='PRIVATE';state.connected=false;
 assert.equal(f.snapshot().records.length,2);assert.equal(f.snapshot().connected,true);assert.doesNotMatch(JSON.stringify(f.snapshot()),/PRIVATE/);
});

test('snapshot event-boundary validator rejects arbitrary fields in all displayed slots and strips extras',async()=>{
 const f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>[]});await f.observe(report([decision()],0));const state=f.snapshot();
 for(const patch of [{asset:'PRIVATE'},{source:'PRIVATE'},{action:'PRIVATE'},{result:'PRIVATE'},{reason:'private_enum_text'},{key:'PRIVATE'},{at:iso(T+1)}]){
  const bad=structuredClone(state);Object.assign(bad.records[0],patch);assert.equal(validateMarketActivitySnapshot(bad,{now:T}),null);
 }
 for(const patch of [{connected:'true'},{nativeStatus:'active worker'},{latestAt:iso(T)}])assert.equal(validateMarketActivitySnapshot({...state,...patch},{now:T}),null);
 const extra=structuredClone(state);extra.private='PRIVATE';extra.records[0].balance='PRIVATE';assert.doesNotMatch(JSON.stringify(validateMarketActivitySnapshot(extra,{now:T})),/PRIVATE|balance/);
 assert.equal(validateMarketActivitySnapshot({...state,records:[state.records[0],state.records[0]]},{now:T}),null);
 assert.deepEqual(validateMarketActivitySnapshot(state,{now:T+MARKET_ACTIVITY_MAX_AGE_MS}).records,[]);
 assert.equal(validateMarketActivitySnapshot({get records(){throw Error('untrusted getter');}},{now:T}),null);
});

test('a synchronous view disconnect during loading cannot start or resurrect a native request',async()=>{
 let calls=0,f;f=createMarketActivityFeed({now:()=>T,fetchNative:async()=>{calls++;return [native()];},onChange:s=>{if(s.nativeStatus==='loading')f.disconnect();}});
 await f.observe(report([decision()]));assert.equal(calls,0);assert.equal(f.snapshot().connected,false);assert.equal(f.snapshot().records.length,1);
});

test('a synchronous newer observation during loading wins without an obsolete network call',async()=>{
 const calls=[];let f,newer,fired=false;
 f=createMarketActivityFeed({now:()=>T,fetchNative:async q=>{calls.push(q.watermark);return [native(q.watermark)];},onChange:s=>{if(s.nativeStatus==='loading'&&!fired){fired=true;newer=f.observe(report([],2));}}});
 await f.observe(report([],1));await newer;assert.deepEqual(calls,[2]);assert.equal(f.snapshot().records[0].key,'native:string:native-2');assert.equal(f.snapshot().nativeStatus,'ready');
});

test('joining an inflight watermark survives synchronous disconnect or disposal without stale records',async()=>{
 for(const action of ['disconnect','dispose']){
  const pending=deferred();let trigger=false,calls=0,f;
  f=createMarketActivityFeed({now:()=>T,fetchNative:()=>{calls++;return pending.promise;},onChange:s=>{if(trigger&&s.nativeStatus==='loading'){trigger=false;f[action]();}}});
  const first=f.observe(report([],1));trigger=true;const joined=f.observe(report([],1));
  pending.resolve([native(1)]);await Promise.all([first,joined]);
  assert.equal(calls,1);assert.equal(f.snapshot().connected,false);assert.equal(f.snapshot().records.length,0);
 }
});
