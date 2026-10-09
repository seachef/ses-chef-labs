import {readNativePaper,nativeFillLabel} from './native-paper.mjs?v=neptune-native-20261009'; import {readPortfolioSnapshot} from './portfolio-snapshot.mjs?v=neptune-native-20261009'; import {createLaserAudio} from './laser-audio.mjs?v=neptune-native-20261009'; import {readDailyPerformance} from './daily-performance.mjs?v=neptune-native-20261009'; import {ASSETS,validateV2,paperViewV2,money,quote,fresh} from './status-v2.mjs?v=neptune-native-20261009'; import {setupPaperPanels} from './paper-panels-v2.mjs?v=neptune-native-r2-20261009'; import {makeCosmosScene,createPaperCueBridge} from './cosmos-controller.mjs?v=neptune-native-20261009'; import {readResearchV1} from './research-v1.mjs?v=neptune-native-20261009';
const $=id=>document.getElementById(id);
const endpoint='https://jhsrbmvmjtihlxnbrvbx.supabase.co/rest/v1/neptune_paper_v2_status?id=eq.neptune-paper-v2&select=id,payload';
// Existing public read-only key. No owner credential, order route or browser account state.
const publicKey='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impoc3JibXZtanRpaGx4bmJydmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDc4MjAsImV4cCI6MjEwNjQyMzgyMH0.fAhJqVZ6bf7sdPAGhX_Jq7o5rzROKIvXtUnTWtnHHIg';
const panels=setupPaperPanels({document,endpointRoot:'https://jhsrbmvmjtihlxnbrvbx.supabase.co/rest/v1',publicKey});
const cueBridge=createPaperCueBridge();
let selected='ETH/USD',report=null,connected=false,busy=false,polls=0,seenDecisions=null;
const runtimeEvents=[];
function recordRuntime(message){
 const entry={at:new Date().toISOString(),message};runtimeEvents.unshift(entry);runtimeEvents.splice(40);
 list('runtimeLog',runtimeEvents.slice(0,3),e=>`${new Date(e.at).toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false})}  ${e.message}`,'No interface checks yet.');
 list('runtimeHistory',runtimeEvents,e=>`${stamp(e.at)} Perth · ${e.message}`,'No interface checks yet.');
 $('watchOutput').textContent=entry.message;$('watchTime').textContent=new Date(entry.at).toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false})+' Perth · interface';$('watchStatus').textContent=message.includes('started')?'CHECKING':message.includes('failed')?'UNAVAILABLE':'RECEIVED';
}
const safe=v=>typeof v==='string'?v.slice(0,1000):'';
const stamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-AU',{timeZone:'Australia/Perth',hour12:false}):'—';
const sampleAge=at=>{const age=Date.now()-Date.parse(at);return Number.isFinite(age)&&age>=0?Math.floor(age/1000)+'s ago':'age unavailable';};
async function readReports(){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
 try{const response=await fetch(endpoint,{headers:{apikey:publicKey},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
 if(!response.ok)throw Error('Status service unavailable');
 const rows=await response.json();return Array.isArray(rows)&&rows.length===0?null:validateV2(rows);
 }finally{clearTimeout(timeout);}
}
async function refreshFeed(){
 if(busy)return;
 busy=true;$('refresh').disabled=true;recordRuntime('GET paper status · request started');
 try{report=await readReports();cueBridge.observe(report);connected=true;igniteDecisions();recordRuntime(report?'Report validated · '+paperViewV2(report,true).label:'Empty response · account not created');}catch{connected=false;cueBridge.disconnect();recordRuntime('Feed check failed · data unavailable');}
 finally{polls++;busy=false;$('refresh').disabled=false;render();}
}
function igniteDecisions(){
 const decisions=report?.decisions||[],ids=new Set(decisions.map(d=>d.id));
 if(seenDecisions&&paperViewV2(report,connected).status==='running')for(const d of decisions){
  if(seenDecisions.has(d.id)||!fresh(d.at,Date.now(),90000))continue;
  const node=[...document.querySelectorAll('[data-market]')].find(n=>n.dataset.market===d.asset);
  if(node){node.classList.remove('ignite');void node.offsetWidth;node.classList.add('ignite');}
 }
 seenDecisions=ids;
}
function list(id,items,format,empty){
 const nodes=items.map(item=>{const li=document.createElement('li');li.textContent=format(item);return li;});
 if(!nodes.length){const li=document.createElement('li');li.textContent=empty;nodes.push(li);}
 $(id).replaceChildren(...nodes);
}
function sceneCue(){const cue=cueBridge.current(),label=cue?(cue.kind==='profit'?'SIMULATED NET PROFIT · '+money(cue.pnl_base,'AUD'):cue.kind==='review'?'PAPER REVIEW · UNVALIDATED':'SIMULATED '+cue.kind.toUpperCase())+' · '+cue.asset:'Ambient scene · not a trade signal';if($('sceneCue').textContent!==label)$('sceneCue').textContent=label;return cue;}
function renderStreams(view){
 const current=view.status==='running',research=readResearchV1(report);
 const set=(id,text)=>{if($(id).textContent!==text)$(id).textContent=text;};
 const show=(id,status,output,at)=>{set(id+'Status',status);set(id+'Output',output);set(id+'Time',at?new Date(at).toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false})+' Perth · '+sampleAge(at):'No observation yet');};
 show('scout','NOT CONNECTED','Broad market screen not connected.',null);
 $('scoutEvidence').textContent='No broad market discovery feed has been received. Execution universe remains the existing six paper markets. Catalogue coverage is not evidence of screening or qualification.';
 if(research){const c=research.catalogue;show('scout','SNAPSHOT',`${c.research_markets} markets catalogued · live screen not connected.`,c.observed_at);$('scoutEvidence').textContent=`Fixed public Kraken catalogue snapshot, observed ${stamp(c.observed_at)} Perth. ${c.listed_pairs} listed pairs; ${c.online_usd_pairs} online USD pairs; ${c.research_markets} research markets after ${c.excluded} exclusions and ${c.cashlike_removed} cash-like removals. ${c.sizing_supported} sizing-supported markets. This is catalogue coverage, not live screening, project review, qualification or trade authorization. Broader live scanning is not connected. Execution remains the existing six markets. Source: ${c.source_url} · SHA256 ${c.source_sha256}`;}
 const decisions=report?.decisions||[],fromStream=id=>{const x=research?.streams.find(s=>s.id===id);return x?.decision_id?decisions.find(d=>d.id===x.decision_id&&d.at===x.at&&d.asset===x.asset):null;},depth=fromStream('depth')||decisions.find(d=>/spread_too_wide|volume_below_threshold|insufficient_near_depth/.test(d.reason)),pulse=fromStream('pulse')||decisions[0];
 show('depth',current&&fresh(depth?.at,Date.now(),90000)?'OBSERVED':depth?'LAST REPORT':'WAITING',depth?depth.asset+' · '+safe(depth.reason):'No liquidity decision observed.',depth?.at);
 $('depthEvidence').textContent=depth?`${stamp(depth.at)} Perth · ${depth.asset} · ${depth.action} · ${safe(depth.reason)} · source ${safe(depth.source)} · decision ${depth.id} · observation ${depth.observation_id??'—'} · unvalidated. This reports only an observed decision; it does not imply all liquidity checks passed.`:'No applicable liquidity decision in the last verified report. No gate pass is inferred.';
 show('pulse',current&&fresh(pulse?.at,Date.now(),90000)?'UNVALIDATED':pulse?'LAST REPORT':'WAITING',pulse?pulse.asset+' · '+pulse.action.toUpperCase()+' · '+safe(pulse.reason):'No entry decision observed.',pulse?.at);
 const risk=report?.risk;
 show('shield',risk?(current?(risk.entry_paused?'PAUSED':'OBSERVED'):'LAST REPORT'):'WAITING',risk?(risk.entry_paused?'Entries paused · '+(safe(risk.pause_reason)||'server risk lock'):'Entry risk '+risk.per_entry_pct+'% · max '+risk.max_positions+' positions'):'Risk configuration unavailable.',report?.heartbeat_at);
 $('shieldEvidence').textContent=risk?`Report ${stamp(report.heartbeat_at)} Perth · entries ${risk.entry_paused?'paused':'not paused'} · ${safe(risk.pause_reason)||'no pause reason'} · entry risk ${risk.per_entry_pct}% · max ${risk.max_positions} positions · aggregate ${risk.aggregate_pct}% · daily drawdown ${risk.daily_drawdown_pct}% · total drawdown ${risk.total_drawdown_pct}%. These are reported limits, not confirmation that a proposed entry passed all gates. Full cost configuration and owner controls are in Watch.`:'No verified risk configuration received.';
 const native=readNativePaper(report),nativeFill=native.state==='valid'?[...native.fills].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0]:null;
 const fill=report?.fills?.[0],fillCount=report?.account?.initial_cash&&report.status!=='configuration_pending'?report.account.fills:null;
 show('ledger',Number.isSafeInteger(fillCount)?fillCount+' FILLS':'WAITING',fill?'Simulated '+fill.side.toUpperCase()+' '+fill.asset+' · '+quote(fill.price):fillCount===0?'0 fills · waiting for a verified execution.':'No verified paper fill received.',fill?.at);
 if(nativeFill&&(!fill||Date.parse(nativeFill.at)>Date.parse(fill.at)))show('ledger','NATIVE PAPER',`${nativeFill.side.toUpperCase()} ${nativeFill.asset} · ${nativeFillLabel(nativeFill)}`,nativeFill.at);
 const last=runtimeEvents[0];
 show('watch',busy?'CHECKING':polls===0?'WAITING':connected?'RECEIVED':'UNAVAILABLE',last?.message||'First interface check pending.',last?.at);
}
function renderPortfolio(view){
 const a=report?.account,snapshot=readPortfolioSnapshot(report,connected),value=n=>Number.isFinite(n)?new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n):'—';
 $('portfolioBalance').textContent=value(snapshot.equity);$('portfolioCash').textContent=value(snapshot.cash);$('portfolioExposure').textContent=value(snapshot.exposure);const daily=readDailyPerformance(report,connected),signed=n=>new Intl.NumberFormat('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2,signDisplay:'always'}).format(n);$('portfolioPnl').textContent=daily.available?signed(daily.pnl):'—';$('portfolioPct').textContent=daily.available?signed(daily.pct)+'%':'Unavailable';$('portfolioSince').textContent=daily.available?'Since '+daily.since+' Perth':'Perth day';$('dailyDetails').textContent=daily.available?'Today: AUD '+signed(daily.pnl)+' ('+signed(daily.pct)+'%) since first observed today at '+daily.since+' Perth. Server baseline AUD '+daily.baselineEquity.toFixed(2)+'; net external virtual cash flows AUD '+daily.netExternalFlows.toFixed(2)+'. This is not a full midnight-to-now return.':daily.reason+'. No zero return is inferred.';
 $('portfolioState').textContent=snapshot.valuationCurrent?'Valued · '+sampleAge(a.valuation_at)+(view.status==='running'?'':' · screen incomplete'):snapshot.cashCurrent?'Cash verified · valuation unavailable':view.status==='loading'?'Waiting':view.label;
}
function render(){
 sceneCue();atmosphere.refresh();
 panels.observe(connected?report:null);
 const view=polls===0?{status:'loading',label:'Connecting to paper feed',reason:'Awaiting the first verified report.'}:paperViewV2(report,connected),a=report?.account,ccy=report?.currency;
 const amount=v=>money(v,ccy),positions=report?.positions||[],position=positions.find(p=>p.asset===selected);
 renderStreams(view);renderPortfolio(view);
 $('connection').textContent=view.label+' · '+selected.split('/')[0]; $('agentPulse').textContent=view.status==='running'?'CORE ONLINE':view.label.toUpperCase();
 $('feedSummary').textContent=polls===0?'Awaiting first verified report':connected?(report?'One paper account · 10s refresh':'Account not created · awaiting v2'):'Data unavailable · awaiting v2';
 $('feedState').textContent=view.label.toUpperCase();
 const nativeAccount=readNativePaper(report),nativeValuationOK=nativeAccount.state==='absent'&&a?.valuation_scope!=='combined_native_v1'||readPortfolioSnapshot(report,connected).valuationCurrent;
 const holdingsScope=nativeAccount.state==='valid'?`${positions.length} legacy open · ${nativeAccount.positions.filter(p=>p.position_status==='open').length} native open · ${nativeAccount.positions.filter(p=>p.position_status==='dust_held').length} native dust`:`${positions.length} legacy open`+(nativeAccount.state==='absent'?'':' · native holdings unverified');
 $('equity').textContent=amount(nativeValuationOK?a?.equity:null);
 $('pnl').textContent=amount(nativeValuationOK&&Number.isFinite(a?.equity)&&Number.isFinite(a?.initial_cash)?a.equity-a.initial_cash:undefined);
 $('fills').textContent=report?.status!=='configuration_pending'&&a?String(a.fills):'—';
 $('position').textContent=position?`${selected} · ${position.qty.toPrecision(5)} virtual · ${holdingsScope}`:a?.initial_cash?`${selected} · flat · ${holdingsScope}`:view.status==='uncreated'?'Account not created. No verified position.':'No verified account or position available.';
 const fill=report?.fills.find(f=>f.asset===selected);
 $('lastFill').textContent=fill?`SIMULATED ${fill.side.toUpperCase()} · ${quote(fill.price)} · ${stamp(fill.at)} Perth`:'No verified simulated buy or sell received.';
 $('valuation').textContent=view.status==='running'?`Last sampled ${stamp(report.quote_at)} Perth · ${sampleAge(report.quote_at)} · not a live quote`:report&&a?.initial_cash?'LAST REPORT · NOT A CURRENT VALUATION':view.status==='uncreated'?'AUD chosen · account not created. No real orders.':polls===0?'Awaiting first verified valuation. No real orders.':'Data unavailable. No real orders or wallet access.';
 $('heartbeat').textContent='Server heartbeat '+stamp(report?.heartbeat_at)+' Perth';
 $('execution').textContent=`refreshFeed() · ${polls} checks · ${polls===0?'first check pending':connected?(report?'v2 report validated':'awaiting v2 activation'):'data unavailable'}`;
 $('scanState').textContent=view.status==='running'?'Verified paper-engine decisions · unvalidated':view.label+' · no current findings';
 list('recentFindings',(report?.decisions||[]).slice(0,2),d=>`${d.asset} · ${d.action.toUpperCase()} · ${safe(d.reason)}`,view.status==='running'?view.reason:'No current verified decision ledger.');
 $('accountDetails').textContent=a?.initial_cash?`One ${ccy} account · starting ${amount(a.initial_cash)} · settled cash ${amount(a.cash)} · available ${amount(a.available_cash)} · reserved ${amount(a.reserved_cash)} · realized ${amount(a.realized_pnl)} · unrealized ${amount(nativeValuationOK?a.unrealized_pnl:null)} · fees ${amount(a.fees)} · modeled FX costs ${amount(a.fx_costs)}${a.fees_complete===false?' · fee totals incomplete; recorded fees '+amount(a.recorded_fees)+' / FX '+amount(a.recorded_fx_costs):''} · unsettled proceeds ${quote(a.unsettled_usd)} · valuation ${stamp(a.valuation_at)} Perth · FX reference ${a.fx??'—'} / applied ${a.fx_applied_rate??'—'} AUD/USD · ${safe(a.fx_source)||'unavailable'} · rate date ${safe(a.fx_rate_date)||'—'} · retrieved ${stamp(a.fx_retrieved_at)} Perth`:view.reason;
 $('riskDetails').textContent=report?`Experimental / confidence unvalidated. Config ${safe(report.config_version)||'unavailable'} · source ${safe(report.source_hash)||'unavailable'} · config hash ${safe(report.config_hash)||'unavailable'}. Entry risk ${report.risk.per_entry_pct}% · max ${report.risk.max_positions} positions · aggregate risk ${report.risk.aggregate_pct}% · daily drawdown ${report.risk.daily_drawdown_pct}% · total drawdown ${report.risk.total_drawdown_pct}%. Entries ${report.risk.entry_paused?'paused':'enabled'} · ${safe(report.risk.pause_reason)||'no pause'}. Modeled fee ${report.cost_model.fee_per_side_pct}% and slippage ${report.cost_model.slippage_per_side_pct}% each side; adverse FX ${report.cost_model.fx_adverse_per_side_pct??'—'}% each side; ${safe(report.cost_model.fx_model)||'FX model unavailable'}; actual fee tier unverified. Display samples may be up to 90s old; server execution still requires quotes no older than 30s.`:'Engine configuration unavailable. This window shows actual interface source, not AI reasoning.';
 list('positionDetails',positions,p=>`${p.asset}: ${p.qty} virtual · entry ${quote(p.entry_price)} · entry FX ${p.entry_fx} ${ccy}/USD · cost ${amount(p.cost_base)} · last sampled bid ${quote(p.last_bid)} (${stamp(p.quote_at)} Perth · ${sampleAge(p.quote_at)}) · stop ${quote(p.stop)} · target ${quote(p.target)} · invalidation ${quote(p.invalidation)} · trailing TP ${p.trailing_active?'active':'inactive'} · risk ${amount(p.initial_risk_base)}`,'No verified open positions.');
 list('fillHistory',report?.fills||[],f=>`${stamp(f.at)} · SIMULATED ${f.side.toUpperCase()} ${f.asset} · ${f.qty} @ ${quote(f.price)} · fee ${amount(f.fee_base)} · slippage ${f.slippage_pct}% · cash change ${amount(f.cash_delta_base)} · ${f.settlement_status==='pending_conversion'?'USD proceeds awaiting AUD conversion · net '+quote(f.net_usd):'FX reference '+f.fx+'; applied '+f.fx_applied_rate+' '+ccy+'/USD · '+safe(f.fx_source)+' · rate date '+safe(f.fx_rate_date)+' · retrieved '+stamp(f.fx_retrieved_at)+' · modeled FX cost '+amount(f.fx_cost_base)} · fill ${f.id} / decision ${f.decision_id}`,'No verified simulated executions.');
 list('resultsHistory',report?.results||[],r=>`${stamp(r.closed_at)} · ${r.asset} · ${r.status==='pending_conversion'?'USD exit filled · AUD P&L pending conversion':'realized '+amount(r.pnl_base)} · net R ${r.net_r??'—'} · fills ${r.entry_fill_id} → ${r.exit_fill_id}`,'No closed results.');
 list('settlementHistory',report?.settlements||[],s=>`${stamp(s.at)} · SIMULATED AUD conversion · ${quote(s.usd_amount)} → ${amount(s.cash_delta_base)} · reference ${s.fx} / applied ${s.fx_applied_rate} AUD/USD · ${safe(s.fx_source)} · rate date ${safe(s.fx_rate_date)} · retrieved ${stamp(s.fx_retrieved_at)} · FX cost ${amount(s.fx_cost_base)} · realized ${amount(s.pnl_base)} · exit fill ${s.exit_fill_id}`,'No verified FX settlements.');
 list('events',report?.decisions||[],d=>`${stamp(d.at)} · ${d.asset} ${d.action.toUpperCase()} · ${quote(d.price)} · ${safe(d.reason)} · source ${safe(d.source)} / ${d.observation_id??'—'} · confidence ${d.confidence} · risk ${amount(d.risk_base)} · stop ${quote(d.stop)} · target ${quote(d.target)} · invalidation ${quote(d.invalidation)} · result ${d.result}`,view.status==='running'?view.reason:'No current verified decision ledger.');
 document.querySelectorAll('[data-market]').forEach(node=>{node.setAttribute('aria-pressed',String(node.dataset.market===selected));const d=report?.decisions.find(d=>d.asset===node.dataset.market);node.querySelector('span').textContent=view.status==='running'&&d&&fresh(d.at,Date.now(),90000)?'PAPER · '+d.action.toUpperCase():'SCREENING';});
}
for(const asset of ASSETS){const option=document.createElement('option');option.value=asset;option.textContent=asset.split('/')[0]+' · PAPER';$('marketSelect').append(option);}
$('marketSelect').value=selected;
$('marketSelect').addEventListener('change',()=>{selected=$('marketSelect').value;render();});
$('codeSource').textContent=refreshFeed.toString();
$('refresh').addEventListener('click',refreshFeed);
document.querySelectorAll('[data-market]').forEach(node=>node.addEventListener('click',()=>{selected=node.dataset.market;$('marketSelect').value=selected;render();}));
$('about').addEventListener('click',()=>$('aboutDialog').showModal());
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
$('openPortfolio').addEventListener('click',()=>$('historyDialog').showModal());
for(const [stream,name] of [['Scout','Scout'],['Depth','Depth'],['Pulse','Findings'],['Shield','Shield'],['Ledger','History'],['Watch','Runtime']]){const dialog=$(name.toLowerCase()+'Dialog');$('open'+stream+'Stream').addEventListener('click',()=>dialog.showModal());$('close'+name).addEventListener('click',()=>dialog.close());}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let motion=!reduced.matches,inView=true,scenePageVisible=true;
let audioContext,soundOn=true,audioVisible=true,audioRevision=0;
const laserAudio=createLaserAudio({getContext:()=>audioContext,canPlay:()=>soundOn&&audioVisible&&motion&&!reduced.matches&&!document.hidden&&inView&&scenePageVisible});
const canvas=$('atmosphere'),ctx=canvas.getContext('2d');
const atmosphere=makeCosmosScene({canvas,ctx,getCue:sceneCue,onBeam:frame=>laserAudio.observe(frame),showCaption:false,showMarketLabels:false,getMarketPositions:()=>{const box=canvas.getBoundingClientRect();return [...document.querySelectorAll('[data-market]')].map(node=>{const r=node.getBoundingClientRect();return {label:node.dataset.market.split('/')[0],x:r.left+r.width/2-box.left,y:r.top+r.height/2-box.top};});},request:fn=>requestAnimationFrame(fn),cancel:id=>cancelAnimationFrame(id),getDpr:()=>devicePixelRatio||1,
 getMasks:box=>[...document.querySelectorAll('header,.horizon,.coin,.windows,.deck-bar,.mobile-tabs,footer')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left-box.left,right:r.right-box.left,top:r.top-box.top,bottom:r.bottom-box.top};})});
function syncMotion(){if(!motion||reduced.matches||document.hidden||!inView||!scenePageVisible)laserAudio.stop();cueBridge.setActive(motion&&!reduced.matches&&!document.hidden&&inView&&scenePageVisible);sceneCue();document.body.classList.toggle('still',!motion||document.hidden||!inView||!scenePageVisible);$('accessMotion').textContent=motion?'Pause motion':'Enable motion';$('accessMotion').setAttribute('aria-pressed',String(motion));atmosphere.setState({enabled:motion&&!reduced.matches,visible:!document.hidden&&scenePageVisible,inView});}

$('accessMotion').addEventListener('click',()=>{motion=!motion;syncMotion();});
reduced.addEventListener('change',e=>{motion=!e.matches;syncMotion();});
window.addEventListener('resize',()=>atmosphere.resize());window.visualViewport?.addEventListener('resize',()=>atmosphere.resize());atmosphere.resize();syncMotion();
let atmosphereObserver;
if(typeof IntersectionObserver!=='undefined'){atmosphereObserver=new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);syncMotion();});atmosphereObserver.observe(canvas);}
window.addEventListener('pagehide',()=>{audioVisible=false;scenePageVisible=false;syncMotion();void syncSound();});
window.addEventListener('pageshow',()=>{audioVisible=true;scenePageVisible=true;atmosphere.resize();syncMotion();void syncSound();});

async function syncSound(){
 if(!soundOn||!audioVisible||document.hidden)laserAudio.stop();
 $('accessSound').textContent=soundOn?'Mute sound':'Enable sound';$('accessSound').setAttribute('aria-pressed',String(soundOn));
 if(!audioContext){$('audioStatus').textContent=soundOn?'Sound starts after your first tap or key press.':'Ocean and laser sounds muted.';return;}
 const revision=++audioRevision,active=soundOn&&audioVisible&&!document.hidden;
 try{await audioContext[active?'resume':'suspend']();if(revision!==audioRevision)return;if(active&&audioContext.state!=='running')throw Error('Audio resume interrupted');$('audioStatus').textContent=active?'Ocean and laser sounds on. Ambient lasers are decorative.':soundOn?'Ocean and laser sounds paused while the page is hidden.':'Ocean and laser sounds muted.';}
 catch{if(revision!==audioRevision)return;soundOn=false;$('accessSound').textContent='Enable sound';$('accessSound').setAttribute('aria-pressed','false');$('audioStatus').textContent='Sound unavailable in this browser session.';armSound();}
}
async function beginSound(event){
 if(event?.isTrusted===false||event?.target&&(event.target===$('accessSound')||event.target.closest?.('#accessSound')))return;
 if(event?.type==='touchend'&&(event.touches?.length>0||event.changedTouches&&event.changedTouches.length!==1))return;
 if(event?.type==='keydown'&&(event.ctrlKey||event.metaKey||event.altKey||/^(Escape|Tab|Shift|Control|Alt|Meta|CapsLock|F[0-9]{1,2})$/.test(event.key)))return;
 if(event?.type==='click'&&event.button!==undefined&&event.button!==0)return;
 document.removeEventListener('click',beginSound);document.removeEventListener('keydown',beginSound);document.removeEventListener('touchend',beginSound);
 try{
 if(!audioContext||audioContext.state==='closed'){const Audio=window.AudioContext||window.webkitAudioContext;audioContext=new Audio();const buffer=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate),data=buffer.getChannelData(0);let v=0;for(let i=0;i<data.length;i++){v=(v+(Math.random()*2-1)*.035)/1.025;data[i]=v;}const source=audioContext.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=500;const gain=audioContext.createGain();gain.gain.value=.23;source.connect(filter).connect(gain).connect(audioContext.destination);source.start();}
 soundOn=true;await syncSound();if(!soundOn)armSound();
 }catch{soundOn=false;$('accessSound').textContent='Enable sound';$('accessSound').setAttribute('aria-pressed','false');$('audioStatus').textContent='Sound unavailable in this browser session.';armSound();}
}
$('accessSound').addEventListener('click',async()=>{if(!audioContext||audioContext.state==='closed'){soundOn=true;await beginSound();}else{soundOn=!soundOn;await syncSound();}});
function armSound(){document.addEventListener('click',beginSound);document.addEventListener('keydown',beginSound);document.addEventListener('touchend',beginSound,{passive:true});}
armSound();
function clock(){$('clock').textContent='PERTH '+new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false});}
clock();setInterval(clock,1000);render();void refreshFeed();
setInterval(()=>{render();if(!document.hidden)void refreshFeed();},10000);
document.addEventListener('visibilitychange',()=>{syncMotion();void syncSound();if(!document.hidden)void refreshFeed();});

