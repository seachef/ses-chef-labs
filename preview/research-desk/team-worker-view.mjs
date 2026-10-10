import {readPublicScoutSnapshot,publicScoutDisplay,PUBLIC_SCOUT_LIMITS} from './public-scout.mjs?v=public-scout-review-20261010';
import {validateMarketActivitySnapshot} from './market-activity.mjs?v=market-activity-20261010';
import {createRollingActivity} from './rolling-activity.mjs?v=rolling-activity-20261010';
import {createTeamWorkStore,teamWorkerState,matchPublicWorkSource,teamPublisherLive,TEAM_WORK_LIMITS,WORK_ROLES,WORK_TASKS,WORK_STEPS} from './team-worker-evidence.mjs';
const stamp=value=>value?new Date(value).toISOString().replace('T',' ').replace('Z',' UTC'):'Time unavailable';
export function setupCodingWorkers({document,now=()=>Date.now(),setTimeout:delay=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout,requestAnimationFrame:requestFrame=document?.defaultView?.requestAnimationFrame?.bind(document.defaultView),cancelAnimationFrame:cancelFrame=document?.defaultView?.cancelAnimationFrame?.bind(document.defaultView)}={}){
 const $=id=>document.getElementById(id);if(!$('codingWorkerSlots'))return null;
 const store=createTeamWorkStore(),slots=[],slotIds=new Map(),pulseTimers=new Map();let edgeTimer=null,session=null,view='market',selected=null,browserSource='',renderedEvents=null,disposed=false,paneMode='activity',activitySignature='';const activityRecords=new Map();let displayedActivityKeys=new Set();let marketSnapshot={records:[],connected:false,nativeStatus:'idle',latestAt:null};let scoutSnapshot=null,pageHidden=false;
 const motionPreference=document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');let motionReduced=motionPreference?.matches===true;
 const appMotionOff=()=>document.body?.classList?.contains?.('still')===true;
 const rolling=createRollingActivity({element:$('teamActivityPreview'),now,requestAnimationFrame:requestFrame,cancelAnimationFrame:cancelFrame,reducedMotion:motionReduced||appMotionOff(),onChange:renderMarketNote});
 const text=(id,value)=>{if($(id)&&$(id).textContent!==value)$(id).textContent=value;};
 for(let index=0;index<6;index++){
  const button=document.createElement('button'),number=document.createElement('span'),role=document.createElement('span');button.setAttribute?.('class','worker-slot');button.setAttribute?.('aria-haspopup','dialog');number.setAttribute?.('class','worker-number');role.setAttribute?.('class','worker-role');number.textContent='AGENT '+String(index+1).padStart(3,'0');role.textContent='UNASSIGNED';button.replaceChildren(number,role);button.addEventListener('click',()=>{const id=[...slotIds.entries()].find(([,slot])=>slot===index)?.[0];if(id){selected=id;render();if(!$('teamWorkDialog').open)$('teamWorkDialog').showModal?.();render();}});button.addEventListener('animationend',()=>button.setAttribute?.('data-pulse','false'));slots.push({button,role,number});
 }
 const links=document.createElementNS?.('http://www.w3.org/2000/svg','svg');links?.setAttribute('class','worker-links');links?.setAttribute('aria-hidden','true');
 $('codingWorkerSlots').replaceChildren(...slots.map(slot=>slot.button),...(links?[links]:[]));
 function render(){
  if(disposed)return;
  store.checkClock({now:now()});
  const snapshot=store.snapshot(),workers=(snapshot.report?.workers??[]).filter(worker=>teamWorkerState(snapshot,worker,now()).state!=='expired');
  if(snapshot.report?.session_generation!==session){links?.replaceChildren();session=snapshot.report?.session_generation??null;slotIds.clear();selected=null;renderedEvents=null;activityRecords.clear();if(view==='workers')activitySignature='';}
  slotIds.clear();for(const worker of workers)slotIds.set(worker.actor_id,worker.slot-1);
  if(!workers.some(worker=>worker.actor_id===selected))selected=workers[0]?.actor_id??null;
  for(const event of snapshot.report?.events??[])if(event.kind==='worker_event'&&now()-Date.parse(event.received_at)<=TEAM_WORK_LIMITS.recent_display_ms){if(!activityRecords.has(event.event_number))activityRecords.set(event.event_number,event);}
  for(const [key,event] of activityRecords)if(now()<Date.parse(event.received_at)||now()-Date.parse(event.received_at)>TEAM_WORK_LIMITS.recent_display_ms){activityRecords.delete(key);}
  while(activityRecords.size>40)activityRecords.delete(Math.min(...activityRecords.keys()));
  const states=workers.map(worker=>teamWorkerState(snapshot,worker,now())),active=states.filter(state=>state.live).length;
  const connected=teamPublisherLive(snapshot,now());
  const overall=!snapshot.connected?'NOT CONNECTED':!connected?'OFFLINE':!workers.length?'WAITING FOR WORKERS':active?active+' OBSERVED ACTIVE':states.some(state=>state.state==='unconfirmed')?'STATUS UNCONFIRMED':'RECORDED WORK';
  if(!connected||view!=='workers'||document.hidden)links?.replaceChildren();
  text('teamWebCount',view==='market'?'6 check groups':workers.length+' recorded · '+active+' active');text('teamCodingState',overall);text('codingEvidenceState','CODING WORK FEED · '+overall);
  text('teamFooter',view==='market'?'Ambient flight · tap for real evidence':'Ambient flight · tap a worker for evidence');
  text('teamViewCaption',view==='market'?'Automated market checks':active?'Root-observed coding workers':'Coding-worker evidence · '+(workers.length?'last records':'waiting'));
  $('teamTerminal')?.setAttribute?.('data-view',view);$('codingWorkerSlots').hidden=view!=='workers';$('marketStreamSlots').hidden=view!=='market';$('showCodingTeam').setAttribute?.('aria-pressed',String(view==='workers'));$('showMarketStreams').setAttribute?.('aria-pressed',String(view==='market'));
  for(let index=0;index<6;index++){
   const worker=workers.find(item=>slotIds.get(item.actor_id)===index),state=teamWorkerState(snapshot,worker,now()),slot=slots[index];slot.role.textContent=worker?WORK_ROLES[worker.role]+' · '+state.label:'UNASSIGNED';slot.button.disabled=!worker;slot.button.setAttribute?.('data-state',state.state);slot.button.setAttribute?.('aria-pressed',String(worker?.actor_id===selected));slot.button.setAttribute?.('aria-label',worker?`AGENT ${String(index+1).padStart(3,'0')}. ${WORK_ROLES[worker.role]}. ${state.label}. ${WORK_TASKS[worker.task]}. Open worker evidence.`:`AGENT ${String(index+1).padStart(3,'0')}. Unassigned coding-worker slot.`);
   if(!connected||!worker||view!=='workers'||document.hidden){slot.button.setAttribute?.('data-pulse','false');slot.button.setAttribute?.('data-handoff','false');}
  }
  const worker=workers.find(item=>item.actor_id===selected),state=teamWorkerState(snapshot,worker,now()),reference=matchPublicWorkSource(worker?.source);
  text('teamWorkerTask',worker?WORK_ROLES[worker.role]+' · '+WORK_TASKS[worker.task]:'No coding-worker evidence received.');
  text('teamWorkerResult',worker?state.label+' · '+WORK_STEPS[worker.step]:'Waiting for a worker-specific event.');
  text('teamWorkerTime',worker?stamp(worker.observed_at)+' · observed':'No coding-worker timestamp');
  text('codingSelectedWorker',worker?'AGENT '+String(worker.slot).padStart(3,'0')+' · '+WORK_ROLES[worker.role]+' · '+WORK_TASKS[worker.task]+' · '+state.label+' · '+stamp(worker.observed_at):'No coding-worker evidence selected.');
  const identity=!worker?'No verified worker source reference.':worker.source?.scope==='candidate'?'Staged candidate source · code is not published.':reference?`Published source reference · ${reference.function_name} · ${reference.path} · commit ${reference.commit} · file SHA-256 ${reference.file_sha256}. Reference bytes do not prove this worker executed these lines.`:'Worker source version unverified; no code substituted.';
  text('codingSourceIdentity',identity+(worker?.candidate_sha256?' Candidate SHA-256: '+worker.candidate_sha256:''));text('codingWorkerSource',reference?.code??'No matching approved public source snippet.');
  if(view==='workers'){
   text('teamCodeCaption',reference?'PUBLISHED REFERENCE · '+reference.function_name+'()':worker?.source?.scope==='candidate'?'STAGED SOURCE · NOT PUBLISHED':'WORKER SOURCE · WAITING');text('teamCodePreview',reference?reference.code.split('\n').slice(0,5).join('\n'):worker?'Source identity unavailable or not published.':'Waiting for a real coding-worker event.');text('teamCodeNote',reference?'Immutable public reference · not an execution trace':'No substitute code or synthetic typing.');
  }else{
   text('teamCodeCaption','BROWSER SOURCE REFERENCE · refreshFeed()');text('teamCodePreview',browserSource?browserSource.split('\n').slice(0,5).join('\n'):'Waiting for loaded browser source.');text('teamCodeNote','Static browser function · not a coding worker.');
  }
  renderActivity();
  if($('teamWorkDialog').open){
   const records=(snapshot.report?.events??[]).filter(event=>event.kind==='worker_event'&&now()-Date.parse(event.received_at)>=0&&now()-Date.parse(event.received_at)<=TEAM_WORK_LIMITS.recent_display_ms),signature=records.map(event=>event.id+':'+event.payload_sha256).join('|');
   if(signature!==renderedEvents){renderedEvents=signature;const rows=records.slice().reverse().map(event=>{const li=document.createElement('li');const result=event.result?` · ${event.result.kind.toUpperCase()} ${event.result.verdict.replaceAll('_',' ').toUpperCase()} · candidate ${event.result.target_sha256}`:'';li.textContent=`${stamp(event.observed_at)} · ${WORK_ROLES[event.role]} · ${WORK_TASKS[event.task]}\n${WORK_STEPS[event.step]} · ${event.state.toUpperCase()} · run sequence ${event.run_seq}${result}\nPublisher-observed transition; limited history, no signed worker attestation.`;return li;});if(!rows.length){const li=document.createElement('li');li.textContent='No coding-worker events received.';rows.push(li);}$('codingWorkerEvents').replaceChildren(...rows);}
  }
 }
 function marketRecords(){
  return [...marketSnapshot.records,...(scoutSnapshot?.records??[])].filter(event=>now()-Date.parse(event.at)>=0&&now()-Date.parse(event.at)<=PUBLIC_SCOUT_LIMITS.history_ms).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.key.localeCompare(b.key)).slice(-140);
 }
 function renderMarketNote(){
  if(view!=='market'||paneMode!=='activity'||document.hidden||pageHidden||disposed)return;
  const state=rolling.snapshot(),age=marketSnapshot.latestAt?now()-Date.parse(marketSnapshot.latestAt):Infinity;
  const clockText=at=>new Date(at).toISOString().slice(11,19)+' UTC';
  const ageText=at=>{const seconds=Math.max(0,Math.floor((now()-Date.parse(at))/1000));return seconds<60?seconds+'s ago':Math.floor(seconds/60)+'m '+seconds%60+'s ago';};
  const status=!marketSnapshot.connected?'Feed unavailable · last recorded decisions.':marketSnapshot.nativeStatus==='unavailable'?'Native decision feed unavailable · last verified records.':age>90000?'Awaiting a new decision · last records shown.':'Paper checks · unvalidated.';
  const movement=!state.latestAt?status:(state.paused?'Paused · Resume to follow':state.rolling?'Rolling':'Waiting for new activity')+(state.queued?' · '+state.queued+' queued · oldest '+clockText(state.oldestQueuedAt):'')+' · last event '+clockText(state.latestAt)+' ('+ageText(state.latestAt)+')'+(!marketSnapshot.connected?' · Feed unavailable':marketSnapshot.nativeStatus==='unavailable'?' · native feed unavailable':age>90000?' · Awaiting a new decision':' · paper checks');
  text('teamCodeNote',movement);
  const detail=[status,state.oldestQueuedAt?'Oldest queued event: '+stamp(state.oldestQueuedAt)+' ('+ageText(state.oldestQueuedAt)+').':'No queued events.',state.displayedAt?'Last displayed event: '+stamp(state.displayedAt)+'.':'',state.latestAt?'Latest received event: '+stamp(state.latestAt)+'.':'','Original event clocks retained; at most 140 pending and 140 displayed records.',scoutSnapshot?'Scout: '+publicScoutDisplay(scoutSnapshot,{now:now()}).status.toLowerCase()+'; '+publicScoutDisplay(scoutSnapshot,{now:now()}).output+'.':''].filter(Boolean).join(' ');
  $('teamCodeNote')?.setAttribute?.('title',detail);$('teamCodeNote')?.setAttribute?.('aria-label',movement+'. '+detail);
  const button=$('pauseTeamActivity');if(button){button.textContent=state.paused?'Resume':'Pause';button.setAttribute?.('aria-pressed',String(state.paused));button.setAttribute?.('aria-label',state.paused?'Resume rolling verified market activity':'Pause rolling market activity to read');}
 }
 function renderActivity(){
  const activity=$('teamActivityPreview'),show=paneMode==='activity',market=view==='market';activity.hidden=!show;$('teamCodePreview').hidden=show;$('toggleTeamPane').hidden=false;$('toggleTeamPane').textContent=paneMode==='activity'?'Activity ⇄':'Source ⇄';$('toggleTeamPane').setAttribute?.('aria-label',paneMode==='activity'?'Showing observed activity. Switch to static source.':'Showing static source. Switch to observed activity.');
  if($('pauseTeamActivity'))$('pauseTeamActivity').hidden=!show||!market;
  if(!show||!market){$('teamCodeNote')?.removeAttribute?.('title');$('teamCodeNote')?.removeAttribute?.('aria-label');}
  rolling.setActive(show&&market&&!document.hidden&&!pageHidden);syncRollingMotion();
  rolling.update(marketRecords().map(event=>({key:'market:'+event.key,at:event.at,text:event.kind==='public_scout'?`${stamp(event.at)} · ${event.text}`:`${stamp(event.at)} · ${event.source} · ${event.asset} ${event.action.toUpperCase()} / ${event.result.replaceAll('_',' ').toUpperCase()} · ${event.reason?.replaceAll('_',' ')??'Reason unavailable'}`})));
  if(!show||document.hidden||pageHidden)return;
  text('teamCodeCaption',market?'MARKET ACTIVITY · PAPER + RESEARCH':'OBSERVED ACTIVITY · REAL EVENTS');
  activity.setAttribute?.('aria-label',market?'Verified market activity in arrival order; original UTC event times retained':'Recent verified worker activity, oldest to newest');
  if(market){activitySignature='market:';renderMarketNote();return;}
  const records=[...activityRecords.values()].sort((a,b)=>a.event_number-b.event_number),signature='workers:'+records.map(event=>event.id+':'+event.payload_sha256).join('|');
  if(signature!==activitySignature){
   const keys=records.map(event=>'workers:'+event.id),hasNew=keys.some(key=>!displayedActivityKeys.has(key)),switched=!activitySignature.startsWith('workers:'),oldTop=activity.scrollTop??0;
   const lines=records.map(event=>{const number=String(event.slot).padStart(3,'0'),result=event.result?.kind==='test'?` · ${event.result.passed} passed / ${event.result.failed} failed`:'';return `${new Date(event.observed_at).toISOString().slice(11,19)} UTC · AGENT ${number} ${WORK_ROLES[event.role]} · ${WORK_STEPS[event.step]}${result}`;});
   text('teamActivityPreview',lines.length?lines.join('\n'):'Waiting for real coding-worker events.');
   activitySignature=signature;displayedActivityKeys=new Set(keys);
   activity.scrollTop=lines.length&&(hasNew||switched)?activity.scrollHeight??0:oldTop;
  }
  text('teamCodeNote','Auto-follow new worker events · limited recorded activity.');
 }
 const pauseActivity=()=>{if(view==='market'&&paneMode==='activity')rolling.setPaused(!rolling.snapshot().paused);};
 const pauseForReader=event=>{if(view==='market'&&paneMode==='activity'&&(event.type!=='keydown'||['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Spacebar'].includes(event.key)))rolling.setPaused(true);};
 function syncRollingMotion(){rolling.setReducedMotion(motionReduced||appMotionOff());}
 const motionChanged=event=>{motionReduced=event.matches===true;syncRollingMotion();};
 const motionToggle=()=>queueMicrotask(()=>{if(!disposed)syncRollingMotion();});
 const motionObserver=document.body&&document.defaultView?.MutationObserver?new document.defaultView.MutationObserver(syncRollingMotion):null;
 motionObserver?.observe(document.body,{attributes:true,attributeFilter:['class']});
 $('accessMotion')?.addEventListener?.('click',motionToggle);
 $('pauseTeamActivity')?.addEventListener?.('click',pauseActivity);
 for(const type of ['wheel','touchstart','pointerdown','keydown'])$('teamActivityPreview').addEventListener(type,pauseForReader,{passive:true});
 motionPreference?.addEventListener?.('change',motionChanged);
 function receiveMarket(event){
  if(disposed)return;
  const next=validateMarketActivitySnapshot(event.detail,{now:now()});
  if(!next)return;
  marketSnapshot=next;render();
 }
 function receiveScout(event){if(disposed)return;const next=readPublicScoutSnapshot(event.detail);if(!next)return;scoutSnapshot=next;render();}
 document.addEventListener('neptune:public-scout',receiveScout);
 document.addEventListener('neptune:market-activity',receiveMarket);
 $('toggleTeamPane').addEventListener('click',()=>{paneMode=paneMode==='activity'?'source':'activity';render();});
 function pulse(actorId){
  if(view!=='workers'||document.hidden)return;
  const index=slotIds.get(actorId);if(index===undefined)return;const slot=slots[index];
  // A newly accepted worker event gets one gentle highlight; no timer emits work.
  slot.button.setAttribute?.('data-pulse','false');void slot.button.offsetWidth;slot.button.setAttribute?.('data-pulse','true');
  if(pulseTimers.has(actorId))cancel?.(pulseTimers.get(actorId));if(delay)pulseTimers.set(actorId,delay(()=>{slot.button.setAttribute?.('data-pulse','false');pulseTimers.delete(actorId);},900));
 }
 function handoff(edge){
  if(!links||view!=='workers'||document.hidden)return;
  const from=slotIds.get(edge.from),to=slotIds.get(edge.to);if(from===undefined||to===undefined)return;
  const bounds=$('codingWorkerSlots').getBoundingClientRect(),a=slots[from].button.getBoundingClientRect(),b=slots[to].button.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  const ax=a.left+a.width/2-bounds.left,ay=a.top+a.height/2-bounds.top,bx=b.left+b.width/2-bounds.left,by=b.top+b.height/2-bounds.top;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class','worker-handoff-edge');path.setAttribute('d',`M ${ax} ${ay} Q ${(ax+bx)/2} ${Math.max(2,Math.min(ay,by)-12)} ${bx} ${by}`);links.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);links.replaceChildren(path);
  if(edgeTimer!==null)cancel?.(edgeTimer);if(delay)edgeTimer=delay(()=>{links.replaceChildren();edgeTimer=null;},900);
 }
 function receive(event){
  if(disposed)return;const result=store.ingest(event.detail,{now:now()});if(document.hidden)store.disconnect();render();if(!result.accepted)return;
  for(const actorId of result.pulses)pulse(actorId);
  // Handoff text is exact. Edges are never invented from adjacency in the row.
  if(result.handoffs.length){const edge=result.handoffs.at(-1);handoff(edge);const from=slotIds.get(edge.from),to=slotIds.get(edge.to);if(from!==undefined&&to!==undefined)text('teamCodeNote',`Recorded handoff · AGENT ${String(from+1).padStart(3,'0')} → AGENT ${String(to+1).padStart(3,'0')}. Source remains a reference.`);}
 }
 function disconnect(){store.disconnect();render();}
 function visibilityChanged(event){if(event?.type==='pagehide')pageHidden=true;else if(event?.type==='pageshow')pageHidden=false;store.pause({now:now()});render();}
 document.addEventListener('visibilitychange',visibilityChanged);
 document.defaultView?.addEventListener?.('pagehide',visibilityChanged);
 document.defaultView?.addEventListener?.('pageshow',visibilityChanged);
 const showWorkers=()=>{view='workers';render();},showMarket=()=>{view='market';render();};
 $('showCodingTeam').addEventListener('click',showWorkers);$('showMarketStreams').addEventListener('click',showMarket);document.addEventListener('neptune:team-work-report',receive);document.addEventListener('neptune:team-work-disconnected',disconnect);
 render();
 return {store,render,currentView:()=>view,setBrowserSource(value){browserSource=value;render();},dispose(){disposed=true;rolling.dispose();motionObserver?.disconnect();$('accessMotion')?.removeEventListener?.('click',motionToggle);$('pauseTeamActivity')?.removeEventListener?.('click',pauseActivity);for(const type of ['wheel','touchstart','pointerdown','keydown'])$('teamActivityPreview').removeEventListener?.(type,pauseForReader);motionPreference?.removeEventListener?.('change',motionChanged);if(edgeTimer!==null)cancel?.(edgeTimer);links?.replaceChildren();for(const timer of pulseTimers.values())cancel?.(timer);pulseTimers.clear();document.removeEventListener('neptune:public-scout',receiveScout);document.removeEventListener('neptune:market-activity',receiveMarket);document.removeEventListener('neptune:team-work-report',receive);document.removeEventListener('neptune:team-work-disconnected',disconnect);document.removeEventListener('visibilitychange',visibilityChanged);document.defaultView?.removeEventListener?.('pagehide',visibilityChanged);document.defaultView?.removeEventListener?.('pageshow',visibilityChanged);}};
}
