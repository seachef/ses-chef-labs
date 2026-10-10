import {PUBLIC_REVIEWS_URL,REVIEW_LIMITS,validatePublicReviews} from './public-review-contract.mjs';
export {PUBLIC_REVIEWS_URL};
export const REVIEW_TRANSPORT_LIMITS=Object.freeze({bytes:REVIEW_LIMITS.input_bytes,timeout_ms:5000,poll_ms:300000,remembered_ids:256});
const snapshots=new WeakSet();
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const fail=code=>{throw Object.assign(Error(code),{publicCode:code});};
async function read(response,signal){
 if(!response?.ok)fail('unavailable');if(response.redirected||response.url&&response.url!==PUBLIC_REVIEWS_URL)fail('untrusted_review_source');
 const length=response.headers?.get('content-length');if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>REVIEW_TRANSPORT_LIMITS.bytes))fail('review_response_too_large');
 const type=(response.headers?.get('content-type')??'').split(';')[0].trim().toLowerCase();if(!['application/json','text/plain'].includes(type))fail('invalid_review_content_type');
 const reader=response.body?.getReader?.();if(!reader)fail('unbounded_review_response');let size=0;const chunks=[];
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal.aborted)fail('review_timeout');const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))fail('invalid_review_encoding');size+=value.byteLength;if(size>REVIEW_TRANSPORT_LIMITS.bytes)fail('review_response_too_large');chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}try{return new TextDecoder('utf-8',{fatal:true}).decode(all);}catch{fail('invalid_review_encoding');}
 }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});}
}
export function createPublicReviewFeed({fetch:fetcher=globalThis.fetch,now=()=>Date.now(),onChange=()=>{},setTimeout:delay=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout}={}){
 const rememberedDigests=Object.create(null);
 let latest=null,status='waiting',error=null,lastAttempt=-Infinity,clock=-Infinity,epoch=0,disposed=false,controller=null,pending=null;
 const time=()=>{const n=now();if(!Number.isSafeInteger(n)||n<clock)fail('review_clock_invalid');clock=n;return n;};
 function snapshot(){let n;try{n=time();}catch{n=clock;status='unavailable';error='review_clock_invalid';}
  const out=freeze({version:1,status,error,evaluated_at:Number.isFinite(n)?n:null,document:latest?.document??null,digest:latest?.digest??null,records:(latest?.records??[]).filter(r=>n-Date.parse(r.review_completed_at)<REVIEW_LIMITS.history_ms).map(r=>({...r,quote_state:n>=Date.parse(r.subject.quote_expires_at)?'expired':'time_bounded',execution_eligible:false,paper_entry_allowed:false,qualified_buy:false}))});snapshots.add(out);return out;
 }
 const emit=()=>{const s=snapshot();if(!disposed)try{Promise.resolve(onChange(s)).catch(()=>{});}catch{}return s;};
 function disconnect(){if(disposed)return snapshot();epoch++;controller?.abort();controller=null;pending=null;status='unavailable';error='offline';return emit();}
 async function refresh(){
  if(disposed)return snapshot();if(pending)return pending;let n;try{n=time();}catch{status='unavailable';error='review_clock_invalid';return emit();}
  if(n-lastAttempt<REVIEW_TRANSPORT_LIMITS.poll_ms)return snapshot();lastAttempt=n;const revision=++epoch;controller=new AbortController();const local=controller;status='loading';error=null;
  let resolve;pending=new Promise(done=>{resolve=done;});const result=pending;emit();if(disposed||revision!==epoch){resolve(snapshot());return result;}
  let timer;const timeout=new Promise((_,reject)=>{timer=delay(()=>{local.abort();reject(Object.assign(Error('review_timeout'),{publicCode:'review_timeout'}));},REVIEW_TRANSPORT_LIMITS.timeout_ms);});
  const work=(async()=>{if(typeof fetcher!=='function')fail('unavailable');const response=await fetcher(PUBLIC_REVIEWS_URL,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:local.signal});const raw=await read(response,local.signal);const checked=await validatePublicReviews(raw,{now_ms:time(),...(latest?{last_seen:{revision:latest.document.revision,record_created_at:latest.document.record_created_at,digest:latest.digest,record_digests:rememberedDigests}}:{})});if(!checked.ok)fail('invalid_review_document');if(new Set([...Object.keys(rememberedDigests),...Object.keys(checked.record_digests)]).size>REVIEW_TRANSPORT_LIMITS.remembered_ids)fail('review_history_limit');return checked;})();
  try{const checked=await Promise.race([work,timeout]);if(disposed||revision!==epoch)return snapshot();Object.assign(rememberedDigests,checked.record_digests);latest=freeze(structuredClone(checked));status='ready';error=null;}
  catch(e){if(!disposed&&revision===epoch){status='unavailable';error=['review_timeout','untrusted_review_source','review_response_too_large','invalid_review_content_type','unbounded_review_response','invalid_review_encoding','invalid_review_document','review_clock_invalid','review_history_limit'].includes(e?.publicCode)?e.publicCode:'unavailable';}}
  finally{cancel(timer);if(revision===epoch){pending=null;controller=null;emit();}resolve(snapshot());}return result;
 }
 function dispose(){disposed=true;epoch++;controller?.abort();controller=null;pending=null;}
 return{refresh,snapshot,disconnect,dispose};
}
export function readPublicReviewSnapshot(value){return value&&snapshots.has(value)?value:null;}
