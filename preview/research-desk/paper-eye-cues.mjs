import {validateV2,fresh} from './status-v2.mjs?v=neptune-v2-20261009-r8';
const trusted=new WeakSet();
export function isVerifiedCue(cue,now=Date.now()){return !!cue&&trusted.has(cue)&&Number.isFinite(now)&&now>=cue.createdAt&&now<cue.until;}
export function createPaperCueBridge(){let seeded=false,cue=null,lastHeartbeat=-Infinity;const seen=new Map(),watermark={f:-Infinity,d:-Infinity};
 return {
  observe(report,now=Date.now()){
   if(!Number.isFinite(now))throw Error('Invalid cue clock');
   if(report===null){cue=null;seeded=false;seen.clear();return null;}
   let p;try{p=validateV2([{id:'neptune-paper-v2',payload:report}]);}catch(e){cue=null;throw e;}
   const heartbeat=Date.parse(p.heartbeat_at);if(Number.isFinite(heartbeat)&&heartbeat<lastHeartbeat)return p;if(Number.isFinite(heartbeat)&&heartbeat<=now)lastHeartbeat=Math.max(lastHeartbeat,heartbeat);
   const records=[...p.fills.map(r=>({key:'f:'+r.id,kind:r.side,priority:2,r})),...p.decisions.map(r=>({key:'d:'+r.id,kind:'review',priority:1,r}))];
   const freshHeartbeat=fresh(p.heartbeat_at,now,90000),newRecords=records.filter(({key,r})=>seeded&&!seen.has(key)&&freshHeartbeat&&fresh(r.at,now,90000)&&Date.parse(r.at)>=watermark[key[0]]);
   for(const {key,r}of records){seen.set(key,now);const at=Date.parse(r.at);if(at<=now)watermark[key[0]]=Math.max(watermark[key[0]],at);}for(const [key,at]of seen)if(now-at>120000)seen.delete(key);while(seen.size>256)seen.delete(seen.keys().next().value);
   seeded=freshHeartbeat;if(!freshHeartbeat)cue=null;
   newRecords.sort((a,b)=>b.priority-a.priority||Date.parse(b.r.at)-Date.parse(a.r.at));
   const next=newRecords[0];if(next){cue=Object.freeze({kind:next.kind,role:next.priority===2?'Trades':['blocked','trailing_updated'].includes(next.r.result)?'Risk':p.scan_complete&&fresh(p.scan_at,now,120000)?'Scout':null,asset:next.r.asset,eventId:next.r.id,at:next.r.at,createdAt:now,until:now+2600});trusted.add(cue);}
   return p;
  },
  current(now=Date.now()){return isVerifiedCue(cue,now)?cue:null;},
  disconnect(){cue=null;seeded=false;seen.clear();},
  snapshot:()=>({seeded,seenCount:seen.size,hasCue:!!cue})
 };
}
