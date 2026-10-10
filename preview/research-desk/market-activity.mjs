import {validateHistoryRow} from './paper-history-v2.mjs?v=experiment-provenance-v3-r2';

// This is a bounded view of recorded paper decisions, never a worker log or a
// heartbeat generator. No network, account values or execution controls live here.
export const MARKET_ACTIVITY_MAX_AGE_MS=60*60*1000;
const MAX_RECORDS=100,MAX_IDENTITIES=256,PAGE_LIMIT=50;
export const MARKET_REASONS=Object.freeze([
 'missing_or_stale_fx','missing_book','stale_book','invalid_depth','crossed_book',
 'missing_or_stale_metadata','missing_completed_bars','invalid_completed_bars',
 'stale_completed_bars','missing_volume','missing_or_malformed_trade','stale_last_trade',
 'spread_too_wide','volume_below_threshold','insufficient_near_depth','insufficient_exit_depth',
 'stale_account_mark','post_exit_cooldown','warmup_no_historical_replay',
 'entry_expired_or_invalidated','awaiting_later_observation','entry_risk_cost_or_depth_gate',
 'later_observation_entry','no_new_completed_bar','completed_15m_momentum',
 'no_qualified_momentum','trailing_stop_raised','position_within_plan','net_r_target',
 'protective_stop','daily_drawdown','total_drawdown','drawdown_limit','storage_entry_limit',
 'entry_risk_paused','stopped','unsupported_specialist_market','restart_warmup_cancelled',
 'native_protective_rule_gate','venue_disabled_by_owner','blocked_duplicate_canonical_dust',
 'blocked_duplicate_canonical_exposure','native_feed_protective_only',
 'audit_capacity_entry_pause','native_order_rules_or_conversion_slot','control_cancelled_entry'
]);
export const MARKET_SOURCES=Object.freeze({
 'ETH/USD':'Kraken paper decision','SOL/USD':'Kraken paper decision',
 'AVAX/USD':'Kraken paper decision','LINK/USD':'Kraken paper decision',
 'AAVE/USD':'Kraken paper decision','UNI/USD':'Kraken paper decision',
 'hyperliquid:@107':'Hyperliquid paper decision','binance:SOLUSDT':'Binance paper decision'
});
const REASONS=new Set(MARKET_REASONS);
const ACTIONS=new Set(['buy','sell','hold']);
const RESULTS=new Set(['pending','filled','cancelled','no_trade','blocked','trailing_updated']);
const STATUSES=new Set(['idle','loading','ready','unavailable']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sequence=v=>Number.isSafeInteger(v)&&v>=0;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v)||Number.isSafeInteger(v);
const sourceFor=asset=>typeof asset==='string'&&Object.hasOwn(MARKET_SOURCES,asset)?MARKET_SOURCES[asset]:null;
function recordKey(key,source){
 if(typeof key!=='string'||key.length>143)return false;
 const match=/^(kraken|native):(string|number):(.+)$/.exec(key);
 if(!match||(match[1]==='kraken')!==(source==='Kraken paper decision'))return false;
 return match[2]==='string'?id(match[3]):Number.isSafeInteger(Number(match[3]))&&String(Number(match[3]))===match[3];
}
function timestamp(v){
 if(typeof v!=='string'||v.length>40||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v))return NaN;
 const parsed=Date.parse(v);
 // Date.parse normalizes nonexistent calendar days; do not accept those.
 const calendar=new Date(v.slice(0,10)+'T00:00:00Z');
 return Number.isFinite(parsed)&&Number.isFinite(calendar.getTime())&&calendar.toISOString().slice(0,10)===v.slice(0,10)?parsed:NaN;
}
const chronological=(a,b)=>timestamp(a.at)-timestamp(b.at)||a.key.localeCompare(b.key);

// Revalidate the public projection at the DOM event boundary as well. Unknown
// fields are stripped and arbitrary reason/source strings never reach rendering.
export function validateMarketActivitySnapshot(raw,{now=Date.now()}={}){
 try{return readSnapshot(raw,now);}catch{return null;}
}
function readSnapshot(raw,now){
 if(!Number.isFinite(now)||!object(raw)||typeof raw.connected!=='boolean'||!STATUSES.has(raw.nativeStatus)||!Array.isArray(raw.records)||raw.records.length>MAX_RECORDS)return null;
 const records=[],keys=new Set();let previous=-Infinity;
 for(const r of raw.records){
  if(!object(r)||!recordKey(r.key,r.source)||keys.has(r.key)||!sourceFor(r.asset)||r.source!==sourceFor(r.asset)||!ACTIONS.has(r.action)||!RESULTS.has(r.result)||r.reason!==null&&!REASONS.has(r.reason))return null;
  const at=timestamp(r.at);
  if(!Number.isFinite(at)||at>now||at<previous)return null;
  keys.add(r.key);previous=at;
  if(now-at<=MARKET_ACTIVITY_MAX_AGE_MS)records.push({key:r.key,at:r.at,asset:r.asset,action:r.action,result:r.result,reason:r.reason,source:r.source});
 }
 if(raw.latestAt!==(raw.records.at(-1)?.at??null))return null;
 return {records,connected:raw.connected,nativeStatus:raw.nativeStatus,latestAt:records.at(-1)?.at??null};
}

function decision(d,{native=false,now,reportAt}){
 if(!object(d)||!id(d.id)||!ACTIONS.has(d.action)||!RESULTS.has(d.result)||typeof d.reason!=='string'||!d.reason.length||d.reason.length>1000)throw Error('Invalid public decision');
 const source=sourceFor(d.asset),at=timestamp(d.at);
 if(!source||!Number.isFinite(at)||at>now||at>reportAt)throw Error('Invalid decision time or instrument');
 const venue=d.asset==='hyperliquid:@107'?'hyperliquid':d.asset==='binance:SOLUSDT'?'binance':null;
 if(native?!venue:!!venue)throw Error('Decision source mismatch');
 if(native){
  if(d.source!=null&&d.source!==venue+' public spot')throw Error('Native source mismatch');
 }else if(d.source!=='Kraken public spot'||d.quote_currency!=='USD')throw Error('Kraken source mismatch');
 const identity=(native?'native:':'kraken:')+typeof d.id+':'+String(d.id);
 const record={at:new Date(at).toISOString(),asset:d.asset,action:d.action,result:d.result,reason:REASONS.has(d.reason)?d.reason:null,source};
 // Only immutable selected decision content is kept for legacy comparisons;
 // unknown fields and account/quantity/balance fields are never projected.
 return {identity,at,record,fingerprint:JSON.stringify([d.id,d.at,d.asset,d.action,d.result,d.reason,d.source??null,d.quote_currency])};
}

// A fixed-size, fail-closed tombstone set prevents evicted IDs being replayed
// with new timestamps. False positives can omit a record, never invent one.
// The exact recent identity map below catches contradictory content separately.
function tombstones(){
 const bits=new Uint8Array(1<<17),mask=(bits.length*8)-1;
 function indices(value){
  let a=2166136261,b=0x9e3779b9;
  for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}
  return [a,a+b,a+2*b,a+3*b].map(v=>(v>>>0)&mask);
 }
 return {has:value=>indices(value).every(i=>bits[i>>>3]&(1<<(i&7))),add(value){for(const i of indices(value))bits[i>>>3]|=1<<(i&7);}};
}

export function createMarketActivityFeed({fetchNative,onChange=()=>{},now=()=>Date.now()}={}){
 let records=[],connected=false,nativeStatus='idle',disposed=false,epoch=0;
 let newestWatermark=-1,successfulWatermark=-1,attemptedWatermark=-1,reportTime=-Infinity,clockFence=-Infinity,inFlight=null;
 const identities=new Map(),sequences=new Map(),retiredAt=new Map(),seen=tombstones();
 function time(){const n=now();if(!Number.isFinite(n))throw Error('Clock unavailable');clockFence=Math.max(clockFence,n);return n;}
 function retire(r){retiredAt.set(r.source,Math.max(retiredAt.get(r.source)??-Infinity,timestamp(r.at)));}
 function prune(){
  const keep=[];
  for(const r of records){if(clockFence-timestamp(r.at)<=MARKET_ACTIVITY_MAX_AGE_MS)keep.push(r);else retire(r);}
  keep.sort(chronological);
  for(const r of keep.slice(0,Math.max(0,keep.length-MAX_RECORDS)))retire(r);
  records=keep.slice(-MAX_RECORDS);
 }
 function snapshot(){
  try{time();}catch{/* Keep the last verified horizon; never move time backwards. */}
  prune();
  return {records:records.map(r=>({...r})),connected,nativeStatus,latestAt:records.at(-1)?.at??null};
 }
 function emit(){
  const state=snapshot();
  if(!disposed){try{Promise.resolve(onChange(state)).catch(()=>{});}catch{/* A view error cannot corrupt feed state. */}}
  return snapshot();
 }
 function stopPending(){epoch++;inFlight=null;}
 function disconnect(){
  if(disposed)return snapshot();
  stopPending();connected=false;nativeStatus='unavailable';return emit();
 }
 function additions(candidates,{native=false,watermark=-1}={}){
  const ids=new Set(),seqs=new Set(),accepted=[];
  for(const c of candidates){
   if(ids.has(c.identity)||native&&seqs.has(c.seq))throw Error('Duplicate decision identity');
   ids.add(c.identity);if(native)seqs.add(c.seq);
   const known=identities.get(c.identity),knownSequence=native?sequences.get(c.seq):null;
   if(known&&known.fingerprint!==c.fingerprint||knownSequence&&knownSequence!==c.identity)throw Error('Immutable decision changed');
   if(known)continue;
   if(seen.has(c.identity)||native&&c.seq<=successfulWatermark||c.at<(retiredAt.get(c.record.source)??-Infinity)||clockFence-c.at>MARKET_ACTIVITY_MAX_AGE_MS)continue;
   accepted.push(c);
  }
  // Validate the entire batch before committing any record or identity fence.
  accepted.sort((a,b)=>a.at-b.at||a.identity.localeCompare(b.identity));
  for(const c of accepted){
   const record={key:c.identity,...c.record};records.push(record);
   seen.add(c.identity);identities.set(c.identity,{fingerprint:c.fingerprint,seq:c.seq});
   if(native)sequences.set(c.seq,c.identity);
   while(identities.size>MAX_IDENTITIES){
    const first=identities.keys().next().value,old=identities.get(first);
    identities.delete(first);if(old.seq!==undefined)sequences.delete(old.seq);
   }
  }
  if(native)successfulWatermark=watermark;
  prune();
 }
 async function observe(report,{connected:available=true}={}){
  if(disposed)return snapshot();
  if(available!==true)return disconnect();
  let n,at,candidates;
  try{
   n=time();at=timestamp(report?.heartbeat_at);
   if(!object(report)||!Array.isArray(report.decisions)||report.decisions.length>PAGE_LIMIT||!Number.isFinite(at)&&report.decisions.length||Number.isFinite(at)&&at>n)throw Error('Invalid report');
   if(!Number.isFinite(at))at=n; // An empty, uncreated report has no event time.
   if(at<reportTime){connected=true;return emit();}
   candidates=report.decisions.map(d=>decision(d,{now:n,reportAt:at}));
   if(sequence(report.history_seq)&&report.history_seq<newestWatermark)throw Error('History watermark regressed');
   additions(candidates);
  }catch{return disconnect();}
  connected=true;if(Number.isFinite(timestamp(report.heartbeat_at)))reportTime=Math.max(reportTime,at);
  const watermark=report.history_seq;
  if(!sequence(watermark)){
   stopPending();nativeStatus='unavailable';return emit();
  }
  newestWatermark=Math.max(newestWatermark,watermark);
  if(watermark===successfulWatermark){nativeStatus='ready';return emit();}
  if(inFlight?.watermark===watermark){const pending=inFlight.promise;emit();return pending;}
  // A failed or visibility-interrupted request is not retried by unchanged
  // heartbeat polls. Only a genuinely advancing verified watermark may fetch.
  if(watermark<=attemptedWatermark){nativeStatus='unavailable';return emit();}
  stopPending();
  if(watermark===0){successfulWatermark=0;nativeStatus='ready';return emit();}
  if(typeof fetchNative!=='function'){nativeStatus='unavailable';return emit();}
  const requestEpoch=epoch;
  attemptedWatermark=watermark;
  // Set the shared promise before notifying the view. A synchronous visibility
  // callback can disconnect or replace this observation without starting work.
  let resolveRequest;
  const request={watermark,promise:new Promise(resolve=>{resolveRequest=resolve;})};inFlight=request;
  nativeStatus='loading';emit();
  if(disposed||requestEpoch!==epoch||!connected){resolveRequest(snapshot());return request.promise;}
  (async()=>{
   try{
    const data=await fetchNative({watermark,limit:PAGE_LIMIT});
    if(disposed||requestEpoch!==epoch||!connected)return snapshot();
    if(!Array.isArray(data)||data.length>PAGE_LIMIT)throw Error('Invalid native page');
    const current=time(),page=data.map(raw=>{
     if(raw?.kind!=='native_decisions')throw Error('Non-decision history row');
     const row=validateHistoryRow(raw);
     if(row.seq>watermark||timestamp(row.at)!==timestamp(row.payload.at))throw Error('Contradictory native history');
     const c=decision(row.payload,{native:true,now:current,reportAt:at});
     // Stable field ordering avoids treating JSON object key order as a change.
     const payload=Object.fromEntries(Object.keys(row.payload).sort().map(k=>[k,row.payload[k]]));
     return {...c,seq:row.seq,fingerprint:JSON.stringify({...row,payload})};
    });
    additions(page,{native:true,watermark});nativeStatus='ready';
   }catch{if(!disposed&&requestEpoch===epoch&&connected)nativeStatus='unavailable';}
   finally{if(!disposed&&requestEpoch===epoch){inFlight=null;emit();}}
   return snapshot();
  })().then(resolveRequest,()=>resolveRequest(snapshot()));
  return request.promise;
 }
 function dispose(){disposed=true;stopPending();connected=false;nativeStatus='unavailable';}
 return {observe,disconnect,snapshot,dispose};
}
