import {settledProfits} from './profit-events.mjs?v=neptune-specialists-20261009';
import {validateV2,fresh} from './status-v2.mjs?v=neptune-specialists-20261009';
const trusted=new WeakSet();
export const CUE_LIMITS=Object.freeze({capacity:8,durationMs:900,profitDurationMs:2400,backlogMs:6000,eventAgeMs:90000});
export function isVerifiedCue(cue,now=Date.now()){return !!cue&&trusted.has(cue)&&Number.isFinite(now)&&now>=cue.createdAt&&now<cue.until;}
export function createPaperCueBridge(){
 let seeded=false,cue=null,lastHeartbeat=-Infinity,active=true;const queue=[],seen=new Map(),watermark={f:-Infinity,d:-Infinity,p:-Infinity};
 function reset(){cue=null;queue.length=0;seeded=false;seen.clear();}
 function eligible(item,now){return now>=item.receivedAt&&now-item.receivedAt<CUE_LIMITS.backlogMs&&fresh(item.r.at,now,CUE_LIMITS.eventAgeMs)&&now>=lastHeartbeat&&now-lastHeartbeat<CUE_LIMITS.eventAgeMs;}
 function current(now=Date.now()){
  if(!Number.isFinite(now)||!active)return null;
  if(isVerifiedCue(cue,now))return cue;
  cue=null;while(queue.length){const next=queue.shift();if(!eligible(next,now))continue;const until=Math.min(now+(next.kind==='profit'?CUE_LIMITS.profitDurationMs:CUE_LIMITS.durationMs),next.receivedAt+CUE_LIMITS.backlogMs,Date.parse(next.r.at)+CUE_LIMITS.eventAgeMs,lastHeartbeat+CUE_LIMITS.eventAgeMs);if(until<=now)continue;
   cue=Object.freeze({kind:next.kind,role:next.role,asset:next.r.asset,eventId:next.r.id,pnl_base:next.r.pnl_base??null,at:next.r.at,createdAt:now,until});trusted.add(cue);break;
  }return cue;
 }
 return {
  observe(report,now=Date.now()){
   if(!Number.isFinite(now))throw Error('Invalid cue clock');
   if(report===null){reset();return null;}
   let p;try{p=validateV2([{id:'neptune-paper-v2',payload:report}]);}catch(e){reset();throw e;}
   const heartbeat=Date.parse(p.heartbeat_at);if(Number.isFinite(heartbeat)&&heartbeat<lastHeartbeat)return p;if(Number.isFinite(heartbeat)&&heartbeat<=now)lastHeartbeat=Math.max(lastHeartbeat,heartbeat);
   const records=[...p.fills.map(r=>({key:'f:'+r.id,kind:r.side,priority:2,r})),...p.decisions.map(r=>({key:'d:'+r.id,kind:'review',priority:1,r})),...settledProfits(p).map(r=>({key:'p:'+r.id,kind:'profit',priority:3,r}))];
   const freshHeartbeat=fresh(p.heartbeat_at,now,CUE_LIMITS.eventAgeMs),newRecords=records.filter(({key,r})=>active&&seeded&&!seen.has(key)&&freshHeartbeat&&fresh(r.at,now,CUE_LIMITS.eventAgeMs)&&(key[0]==='p'?Date.parse(r.at)>watermark.p:Date.parse(r.at)>=watermark[key[0]]));
   for(const {key,r}of records){seen.set(key,now);const at=Date.parse(r.at);if(at<=now)watermark[key[0]]=Math.max(watermark[key[0]],at);}for(const [key,at]of seen)if(now-at>120000)seen.delete(key);while(seen.size>256)seen.delete(seen.keys().next().value);
   if(!seeded)watermark.p=Math.max(watermark.p,now);seeded=freshHeartbeat;if(!freshHeartbeat){cue=null;queue.length=0;return p;}
   // FIFO receipts within each batch. Existing receipts keep their place; reviews never delay executions.
   newRecords.sort((a,b)=>b.priority-a.priority||Date.parse(a.r.at)-Date.parse(b.r.at)||a.key.localeCompare(b.key));
   const fills=newRecords.filter(r=>r.priority>=2),reviews=newRecords.filter(r=>r.priority===1);
   if(fills.length){if(cue?.kind==='review')cue=null;for(let i=queue.length-1;i>=0;i--)if(queue[i].kind==='review')queue.splice(i,1);}
   for(let i=queue.length-1;i>=0;i--)if(!eligible(queue[i],now))queue.splice(i,1);
   for(const next of fills){if(queue.length+(isVerifiedCue(cue,now)?1:0)>=CUE_LIMITS.capacity)break;queue.push({kind:next.kind,r:{id:next.r.id,asset:next.r.asset,at:next.r.at,pnl_base:next.r.pnl_base??null},role:'Trades',receivedAt:now});}
   if(!fills.length&&reviews.length&&!cue&&!queue.length){const next=reviews.at(-1);queue.push({kind:next.kind,r:{id:next.r.id,asset:next.r.asset,at:next.r.at,pnl_base:next.r.pnl_base??null},role:['blocked','trailing_updated'].includes(next.r.result)?'Risk':p.scan_complete&&fresh(p.scan_at,now,120000)?'Scout':null,receivedAt:now});}
   current(now);return p;
  },
  current,
  disconnect:reset,
  setActive(value){if(typeof value!=='boolean')throw Error('Invalid cue activity');if(value!==active){active=value;reset();}},
  snapshot:()=>({seeded,active,seenCount:seen.size,hasCue:!!cue,queued:queue.length})
 };
}
