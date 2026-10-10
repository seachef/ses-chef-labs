import {validateV2,fresh} from './status-v2.mjs?v=neptune-native-20261009';
import {readNativePaper} from './native-paper.mjs?v=neptune-native-20261009';
import {validateMarketActivitySnapshot} from './market-activity.mjs?v=market-activity-20261010';
export const TARGET_LIMITS=Object.freeze({freshMs:90000,checkMs:6500,pendingMs:12000,fillMs:1200,backlogMs:6000,capacity:8,markers:8,historyMs:3600000});
const instruments=Object.freeze(Object.fromEntries([
 ...['ETH','SOL','AVAX','LINK','AAVE','UNI'].map(s=>[s+'/USD',{label:s,pair:s+'/USD',venue:'Kraken'}]),
 ['hyperliquid:@107',{label:'HYPE',pair:'HYPE/USDC',venue:'Hyperliquid'}],['binance:SOLUSDT',{label:'SOL',pair:'SOL/USDT',venue:'Binance'}]
].map(([key,value])=>[key,Object.freeze(value)])));
export const sceneInstrument=asset=>Object.hasOwn(instruments,asset)?instruments[asset]:null;
const trusted=new WeakSet();
export const isVerifiedSceneFill=(cue,now=Date.now())=>!!cue&&trusted.has(cue)&&['buy','sell'].includes(cue.kind)&&Number.isFinite(now)&&now>=cue.createdAt&&now<cue.until;
// Pure, read-only presentation. Each source seeds independently, including delayed
// native history hydration. A decision can create a marker, never a fill receipt.
function tombstones(){const bits=new Uint8Array(1<<15),mask=bits.length*8-1;const indices=key=>{let a=2166136261,b=0x9e3779b9;for(const c of key){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b^c.charCodeAt(0),2246822519);}return [a,a+b,a+2*b,a+3*b].map(n=>(n>>>0)&mask);};return {has:key=>indices(key).every(i=>bits[i>>>3]&(1<<(i&7))),add(key){for(const i of indices(key))bits[i>>>3]|=1<<(i&7);}};}
export function createSceneTargets(){
 let active=true,connected=false,heartbeat=-Infinity,clock=-Infinity,cue=null;
 const markers=new Map(),sources=new Map(),queue=[];
 function source(name){if(!sources.has(name))sources.set(name,{seeded:false,watermark:-Infinity,seen:new Set(),retired:tombstones()});return sources.get(name);}
 function clear(){if(cue)trusted.delete(cue);cue=null;queue.length=0;for(const x of sources.values())x.seeded=false;for(const [k,v]of markers)markers.set(k,Object.freeze({...v,until:0}));}
 function disconnect(){connected=false;clear();}
 function tick(now){if(!Number.isFinite(now)||now<clock){disconnect();return false;}clock=now;if(!connected||(!Number.isFinite(heartbeat)||now<heartbeat||now-heartbeat>TARGET_LIMITS.freshMs)){clear();return false;}return true;}
 function remember(asset,at,fields={}){if(!sceneInstrument(asset))return;const old=markers.get(asset);if(old&&(Date.parse(old.at)>Date.parse(at)||old.at===at&&!Object.keys(fields).length))return;markers.set(asset,Object.freeze({asset,...sceneInstrument(asset),at,kind:'recorded',result:null,reason:null,until:0,...fields}));while(markers.size>TARGET_LIMITS.markers)markers.delete(markers.keys().next().value);}
 function accept(name,records,now,{fill=false,ready=true}={}){
  const s=source(name),baseline=!s.seeded,candidates=[];
  for(const r of records){const at=Date.parse(r.at),key=r.key;if(!sceneInstrument(r.asset)||!Number.isFinite(at)||at>now||at>heartbeat)continue;
   const isNew=!baseline&&!s.retired.has(key)&&at>s.watermark;
   s.seen.add(key);s.retired.add(key);remember(r.asset,r.at);
   if(isNew&&active&&fresh(r.at,now,TARGET_LIMITS.freshMs))candidates.push(r);
  }
  for(const r of records){const at=Date.parse(r.at);if(Number.isFinite(at)&&at<=now&&at<=heartbeat)s.watermark=Math.max(s.watermark,at);}
  while(s.seen.size>256)s.seen.delete(s.seen.values().next().value);
  if(ready){if(baseline)s.watermark=Math.max(s.watermark,heartbeat,now);s.seeded=true;}
  for(const r of candidates.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key))){
   if(fill){if(queue.length+(cue?1:0)<TARGET_LIMITS.capacity)queue.push(Object.freeze({asset:r.asset,kind:r.side,eventId:r.key,at:r.at,receivedAt:now}));}
   else remember(r.asset,r.at,{kind:'checked',result:r.result,reason:r.reason,until:Math.min(now+(r.result==='pending'?TARGET_LIMITS.pendingMs:TARGET_LIMITS.checkMs),Date.parse(r.at)+TARGET_LIMITS.freshMs)});
  }
 }
 return {
  observeReport(report,now=Date.now()){
   if(report===null){disconnect();return;}
   let p;try{p=validateV2([{id:'neptune-paper-v2',payload:report}]);}catch{disconnect();return;}
   const next=Date.parse(p.heartbeat_at);if(!Number.isFinite(now)||now<clock){disconnect();return;}clock=now;
   if(!Number.isFinite(next)||next>now||now-next>TARGET_LIMITS.freshMs){disconnect();return;}
   if(next<heartbeat)return;
   if(!connected||now-heartbeat>TARGET_LIMITS.freshMs)clear();heartbeat=next;connected=true;
   accept('legacy-fills',p.fills.map(r=>({...r,key:'kraken-fill:'+typeof r.id+':'+r.id})),now,{fill:true});
   const native=readNativePaper(p,now);
   if(native.state==='valid')accept('native-fills',native.fills.map(r=>({...r,key:'native-fill:'+typeof r.id+':'+r.id})),now,{fill:true});
   else {source('native-fills').seeded=false;for(let i=queue.length-1;i>=0;i--)if(queue[i].eventId.startsWith('native-fill:'))queue.splice(i,1);if(cue?.eventId.startsWith('native-fill:')){trusted.delete(cue);cue=null;}for(const [key,m]of markers)if(key.includes(':'))markers.set(key,Object.freeze({...m,until:0}));}
  },
  observeActivity(raw,now=Date.now()){
   const p=validateMarketActivitySnapshot(raw,{now});if(!p||!p.connected){for(const s of ['kraken-decisions','native-decisions'])source(s).seeded=false;for(const [key,m]of markers)if(m.kind==='checked')markers.set(key,Object.freeze({...m,until:0}));return;}
   if(!tick(now))return;
   accept('kraken-decisions',p.records.filter(r=>r.key.startsWith('kraken:')),now);
   if(p.nativeStatus==='ready')accept('native-decisions',p.records.filter(r=>r.key.startsWith('native:')),now);
   else if(p.nativeStatus==='unavailable'){source('native-decisions').seeded=false;for(const [key,m]of markers)if(key.includes(':')&&m.kind==='checked')markers.set(key,Object.freeze({...m,until:0}));}
  },
  current(now=Date.now()){
   if(!tick(now)||!active)return null;
   if(isVerifiedSceneFill(cue,now))return cue;cue=null;
   while(queue.length){const next=queue.shift(),until=Math.min(now+TARGET_LIMITS.fillMs,next.receivedAt+TARGET_LIMITS.backlogMs,Date.parse(next.at)+TARGET_LIMITS.freshMs,heartbeat+TARGET_LIMITS.freshMs);if(now<next.receivedAt||until<=now)continue;
    cue=Object.freeze({...next,createdAt:now,until});trusted.add(cue);remember(cue.asset,cue.at,{kind:cue.kind,result:'filled',until});break;
   }return cue;
  },
  markers(now=Date.now()){
   const current=tick(now)&&active;
   for(const [key,m]of markers)if(now-Date.parse(m.at)>TARGET_LIMITS.historyMs)markers.delete(key);
   return Object.freeze([...markers.values()].map(m=>Object.freeze({...m,active:current&&now>=Date.parse(m.at)&&now<m.until,opacity:current&&now<m.until?Math.min(1,(m.until-now)/900):.40})).sort((a,b)=>a.asset.localeCompare(b.asset)));
  },
  disconnect,
  setActive(value){if(typeof value!=='boolean')throw Error('Invalid scene activity');if(value!==active){active=value;clear();}},
  snapshot:()=>({connected,active,queued:queue.length,markerCount:markers.size,sourceCount:sources.size})
 };
}
