// Fixed visual grouping, not a topology or a count of independent workers.
export const WEB_MARKET_IDS=Object.freeze(['openScoutStream','openDepthStream','openPulseStream','openShieldStream','openLedgerStream','openWatchStream']);
const STATES=new Set(['waiting','snapshot','observed','stale','offline']);
const validTime=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
export function createWebEvidenceStore(){
 const fences=new Map();let lastNow=-Infinity,resumeAfter=-Infinity;
 return {
  observe(raw,{now=Date.now(),active=true}={}){
   if(!Number.isFinite(now))return {accepted:false,pulses:[]};
   if(now<lastNow)resumeAfter=Math.max(resumeAfter,lastNow);lastNow=Math.max(lastNow,now);
   if(!active)resumeAfter=Math.max(resumeAfter,now);
   if(raw?.version!==1||!Array.isArray(raw.nodes)||raw.nodes.length!==6)return {accepted:false,pulses:[]};
   const slots=new Set();
   for(const node of raw.nodes){if(!node||!Number.isInteger(node.slot)||node.slot<1||node.slot>6||slots.has(node.slot)||!STATES.has(node.state)||(node.key===null)!==(node.at===null)||node.key!==null&&(typeof node.key!=='string'||node.key.length>200)||node.at!==null&&(!validTime(node.at)||Date.parse(node.at)>now))return {accepted:false,pulses:[]};slots.add(node.slot);}
   const pulses=[];
   for(const node of raw.nodes){
    const at=Date.parse(node.at),old=fences.get(node.slot);
    if(!node.key||!Number.isFinite(at)||at>now)continue;
    if(old&&(at<old.at||at===old.at))continue;
    fences.set(node.slot,{at,key:node.key});
    // The initial snapshot is a baseline. Polling, repainting and age changes
    // cannot replay it. Only a genuinely newer, fresh observation can glow.
    if(old&&old.key!==node.key&&active&&at>resumeAfter&&now-at<=15000&&node.state==='observed')pulses.push(node.slot);
   }
   return {accepted:true,pulses};
  },
  pause(now=Date.now()){resumeAfter=Math.max(resumeAfter,now,lastNow);},
  size:()=>fences.size
 };
}
export function setupMarketWeb({document,now=()=>Date.now(),setTimeout:delay=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout}={}){
 const store=createWebEvidenceStore(),timers=new Map();
 const clear=()=>{for(const id of WEB_MARKET_IDS)document.getElementById(id)?.setAttribute?.('data-pulse','false');for(const timer of timers.values())cancel?.(timer);timers.clear();};
 const pause=()=>{store.pause(now());clear();};
 function receive(event){
  const active=!document.hidden&&document.getElementById('teamTerminal')?.getAttribute?.('data-view')==='market';
  const result=store.observe(event.detail,{now:now(),active});
  if(!result.accepted){clear();return;}
  const pulses=result.pulses;
  for(const node of event.detail.nodes){const button=document.getElementById(WEB_MARKET_IDS[node.slot-1]);button?.setAttribute?.('data-state',node.state);if(node.state!=='observed'){button?.setAttribute?.('data-pulse','false');if(timers.has(node.slot)){cancel?.(timers.get(node.slot));timers.delete(node.slot);}}}
  if(!active){clear();return;}
  for(const slot of pulses){const button=document.getElementById(WEB_MARKET_IDS[slot-1]);if(!button)continue;button.setAttribute?.('data-pulse','false');void button.offsetWidth;button.setAttribute?.('data-pulse','true');if(timers.has(slot))cancel?.(timers.get(slot));timers.set(slot,delay(()=>{button.setAttribute?.('data-pulse','false');timers.delete(slot);},900));}
 }
 document.addEventListener('neptune:market-evidence',receive);document.addEventListener('visibilitychange',pause);document.defaultView?.addEventListener?.('pagehide',pause);document.defaultView?.addEventListener?.('pageshow',pause);
 document.getElementById('showCodingTeam')?.addEventListener('click',clear);
 return {store,dispose(){clear();document.removeEventListener('neptune:market-evidence',receive);document.removeEventListener('visibilitychange',pause);document.defaultView?.removeEventListener?.('pagehide',pause);document.defaultView?.removeEventListener?.('pageshow',pause);document.getElementById('showCodingTeam')?.removeEventListener?.('click',clear);}};
}
