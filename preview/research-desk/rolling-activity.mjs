// Presentation only: accepts already verified public records, never polls or
// invents activity. Every identity can enter this bounded, one-pass queue once.
export const ROLLING_ACTIVITY_LIMITS=Object.freeze({records:140,history_ms:3600000,row_ms:700,max_row_ms:1800,pixels_per_second:75});
function identityFence(){
 const bits=new Uint8Array(16384),mask=bits.length*8-1;
 function indices(value){let a=2166136261,b=0x9e3779b9;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return [a,a+b,a+2*b,a+3*b].map(n=>(n>>>0)&mask);}
 // Fixed-memory, fail-closed tombstones: collisions can omit a row, not replay it.
 return {has:key=>indices(key).every(i=>bits[i>>>3]&(1<<(i&7))),add(key){for(const i of indices(key))bits[i>>>3]|=1<<(i&7);}};
}
export function createRollingActivity({element,now=()=>Date.now(),requestAnimationFrame:requestFrame,cancelAnimationFrame:cancelFrame,onChange=()=>{},reducedMotion=false}={}){
 const limits=ROLLING_ACTIVITY_LIMITS,seen=identityFence();
 let history=[],queue=[],current=null,frame=null,lastFrame=null,active=false,paused=false,disposed=false,savedTop=0;
 const validAt=at=>Number.isFinite(Date.parse(at))&&Number.isFinite(now())&&now()>=Date.parse(at)&&now()-Date.parse(at)<=limits.history_ms;
 const position=()=>Number.isFinite(element?.scrollTop)?element.scrollTop:0;
 const height=()=>Number.isFinite(element?.scrollHeight)?element.scrollHeight:0;
 const bottom=()=>Math.max(0,height()-(Number.isFinite(element?.clientHeight)?element.clientHeight:0));
 function changed(){if(!disposed)onChange();}
 function stop(){if(frame!==null)cancelFrame?.(frame);frame=null;lastFrame=null;}
 function paint({removing=false,restore=false}={}){
  if(!active||disposed)return;
  const top=restore?savedTop:position(),oldHeight=height(),text=history.length?history.map(row=>row.text).join('\n'):'Waiting for a verified market decision.';
  if(element.textContent!==text)element.textContent=text;
  savedTop=removing?Math.max(0,top-Math.max(0,oldHeight-height())):top;
  element.scrollTop=savedTop;
 }
 function prune(){
  const retained=history.filter(row=>validAt(row.at)),pending=queue.filter(row=>validAt(row.at));
  const removed=retained.length!==history.length,queueChanged=pending.length!==queue.length;
  history=retained;queue=pending;
  if(current&&!validAt(current.at)){current=null;stop();}
  if(removed){paint({removing:true});if(current){current.from=position();current.to=bottom();current.elapsed=0;}}
  return removed||queueChanged;
 }
 function append(row){
  if(history.length>=limits.records){history.shift();paint({removing:true});}
  history.push(row);paint();
 }
 function begin(){
  const row=queue.shift();if(!row)return;
  append(row);
  const from=position(),to=bottom();
  current={at:row.at,from,to,elapsed:0,duration:Math.max(limits.row_ms,Math.min(limits.max_row_ms,Math.abs(to-from)*1000/limits.pixels_per_second))};
 }
 function schedule(){if(frame===null&&active&&!paused&&!disposed&&current)frame=requestFrame(tick);}
 function pump(){
  if(disposed||!active||paused)return;
  prune();
  if(reducedMotion||typeof requestFrame!=='function'){
   const hasNew=queue.length>0||current!==null;
   stop();current=null;
   while(queue.length)append(queue.shift());
   if(hasNew){element.scrollTop=height();savedTop=position();changed();}
   return;
  }
  if(!current&&queue.length){begin();changed();}
  schedule();
 }
 function tick(timestamp){
  frame=null;if(disposed||!active||paused)return;
  prune();if(!current){pump();changed();return;}
  const delta=lastFrame===null?0:Math.max(0,Math.min(100,timestamp-lastFrame));lastFrame=timestamp;
  current.elapsed+=delta;
  // Layout changes may alter the target, but paints never reset elapsed time.
  current.to=bottom();
  const fraction=Math.min(1,current.elapsed/current.duration);
  element.scrollTop=current.from+(current.to-current.from)*fraction;savedTop=position();
  if(fraction===1){current=null;lastFrame=null;changed();pump();}else schedule();
 }
 function update(records){
  if(disposed)return;
  let dirty=prune();
  for(const row of records){
   if(!row||typeof row.key!=='string'||typeof row.text!=='string'||!validAt(row.at)||seen.has(row.key))continue;
   seen.add(row.key);queue.push({key:row.key,at:row.at,text:row.text});dirty=true;
  }
  queue.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key));
  // Retain the newest bounded pending records; omitted IDs remain tombstoned.
  if(queue.length>limits.records)queue=queue.slice(-limits.records);
  pump();if(dirty)changed();
 }
 function setActive(value){
  if(disposed||active===Boolean(value))return;
  if(active)savedTop=position();active=Boolean(value);stop();
  if(active){prune();paint({restore:true});pump();}changed();
 }
 function setPaused(value){
  if(disposed||paused===Boolean(value))return;
  paused=Boolean(value);savedTop=position();stop();
  // A reader may have moved while paused. Resume from that actual position.
  if(current){current.from=position();current.elapsed=0;}
  if(!paused)pump();changed();
 }
 function setReducedMotion(value){if(disposed||reducedMotion===Boolean(value))return;reducedMotion=Boolean(value);stop();pump();changed();}
 function snapshot(){
  const all=[...history,...queue],oldest=rows=>rows.reduce((at,row)=>at===null||Date.parse(row.at)<Date.parse(at)?row.at:at,null);
  return {active,paused,reducedMotion,rolling:active&&!paused&&current!==null,queued:queue.length,retained:history.length,oldestQueuedAt:oldest(queue),oldestAt:oldest(all),displayedAt:history.at(-1)?.at??null,latestAt:all.reduce((at,row)=>at===null||Date.parse(row.at)>Date.parse(at)?row.at:at,null)};
 }
 function dispose(){disposed=true;stop();history=[];queue=[];current=null;}
 return {update,setActive,setPaused,setReducedMotion,snapshot,dispose};
}
