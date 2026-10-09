import {ASSETS,validateV2,paperViewV2,money,quote,fresh} from './status-v2.mjs?v=neptune-v2-20261009-r6'; import {setupPaperPanels} from './paper-panels-v2.mjs?v=neptune-v2-20261009-r6'; import {makeAtmosphere} from './depth-motion.mjs?v=neptune-v2-20261009-r6';
const $=id=>document.getElementById(id);
const endpoint='https://jhsrbmvmjtihlxnbrvbx.supabase.co/rest/v1/neptune_paper_v2_status?id=eq.neptune-paper-v2&select=id,payload';
// Existing public read-only key. No owner credential, order route or browser account state.
const publicKey='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impoc3JibXZtanRpaGx4bmJydmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDc4MjAsImV4cCI6MjEwNjQyMzgyMH0.fAhJqVZ6bf7sdPAGhX_Jq7o5rzROKIvXtUnTWtnHHIg';
const panels=setupPaperPanels({document,endpointRoot:'https://jhsrbmvmjtihlxnbrvbx.supabase.co/rest/v1',publicKey});
let selected='ETH/USD',report=null,connected=false,busy=false,polls=0,seenDecisions=null;
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
 busy=true;$('refresh').disabled=true;
 try{report=await readReports();connected=true;igniteDecisions();}catch{connected=false;}
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
function render(){
 panels.observe(connected?report:null);
 const view=paperViewV2(report,connected),a=report?.account,ccy=report?.currency;
 const amount=v=>money(v,ccy),positions=report?.positions||[],position=positions.find(p=>p.asset===selected);
 $('connection').textContent=view.label+' · '+selected.split('/')[0]; $('agentPulse').textContent=view.status==='running'?'CORE ONLINE':view.label.toUpperCase();
 $('feedSummary').textContent=connected?(report?'One paper account · 10s refresh':'Account not created · awaiting v2'):'Data unavailable · awaiting v2';
 $('feedState').textContent=view.label.toUpperCase();
 $('equity').textContent=amount(a?.equity);
 $('pnl').textContent=amount(Number.isFinite(a?.equity)&&Number.isFinite(a?.initial_cash)?a.equity-a.initial_cash:undefined);
 $('fills').textContent=report?.status!=='configuration_pending'&&a?String(a.fills):'—';
 $('position').textContent=position?`${selected} · ${position.qty.toPrecision(5)} virtual · ${positions.length} open account-wide`:a?.initial_cash?`${selected} · flat · ${positions.length} open account-wide`:view.status==='uncreated'?'Account not created. No verified position.':'No verified account or position available.';
 const fill=report?.fills.find(f=>f.asset===selected);
 $('lastFill').textContent=fill?`SIMULATED ${fill.side.toUpperCase()} · ${quote(fill.price)} · ${stamp(fill.at)} Perth`:'No verified simulated buy or sell received.';
 $('valuation').textContent=view.status==='running'?`Last sampled ${stamp(report.quote_at)} Perth · ${sampleAge(report.quote_at)} · not a live quote`:report&&a?.initial_cash?'LAST REPORT · NOT A CURRENT VALUATION':view.status==='uncreated'?'AUD chosen · account not created. No real orders.':'Data unavailable. No real orders or wallet access.';
 $('heartbeat').textContent='Server heartbeat '+stamp(report?.heartbeat_at)+' Perth';
 $('execution').textContent=`refreshFeed() · ${polls} checks · ${connected?(report?'v2 report validated':'awaiting v2 activation'):'data unavailable'}`;
 $('scanState').textContent=(report?.scan_at?`Last scan ${stamp(report.scan_at)} Perth · ${sampleAge(report.scan_at)} · `:'')+view.reason+' · Latest 50 decisions';
 $('accountDetails').textContent=a?.initial_cash?`One ${ccy} account · starting ${amount(a.initial_cash)} · settled cash ${amount(a.cash)} · available ${amount(a.available_cash)} · reserved ${amount(a.reserved_cash)} · realized ${amount(a.realized_pnl)} · unrealized ${amount(a.unrealized_pnl)} · fees ${amount(a.fees)} · modeled FX costs ${amount(a.fx_costs)} · unsettled proceeds ${quote(a.unsettled_usd)} · valuation ${stamp(a.valuation_at)} Perth · FX reference ${a.fx??'—'} / applied ${a.fx_applied_rate??'—'} AUD/USD · ${safe(a.fx_source)||'unavailable'} · rate date ${safe(a.fx_rate_date)||'—'} · retrieved ${stamp(a.fx_retrieved_at)} Perth`:view.reason;
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
document.querySelectorAll('.mobile-tabs button').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.mobile-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('.instrument').forEach(p=>p.classList.toggle('active',p.dataset.pane===button.dataset.pane));}));
$('about').addEventListener('click',()=>$('aboutDialog').showModal());
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let motion=!reduced.matches,inView=true;
const canvas=$('atmosphere'),ctx=canvas.getContext('2d');
const atmosphere=makeAtmosphere({canvas,ctx,request:fn=>requestAnimationFrame(fn),cancel:id=>cancelAnimationFrame(id),getDpr:()=>devicePixelRatio||1,
 getMasks:box=>[...document.querySelectorAll('header,.horizon,.coin,.windows,.deck-bar,.mobile-tabs,footer')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left-box.left,right:r.right-box.left,top:r.top-box.top,bottom:r.bottom-box.top};})});
function syncMotion(){document.body.classList.toggle('still',!motion||document.hidden||!inView);$('motion').textContent=motion?'Motion on':'Motion off';$('motion').setAttribute('aria-pressed',String(motion));atmosphere.setState({enabled:motion,visible:!document.hidden,inView});}
$('motion').addEventListener('click',()=>{motion=!motion;syncMotion();});
reduced.addEventListener('change',e=>{motion=!e.matches;syncMotion();});
window.addEventListener('resize',()=>atmosphere.resize());atmosphere.resize();syncMotion();
let atmosphereObserver;
if(typeof IntersectionObserver!=='undefined'){atmosphereObserver=new IntersectionObserver(entries=>{inView=entries.some(e=>e.isIntersecting);syncMotion();});atmosphereObserver.observe(canvas);}
window.addEventListener('pagehide',()=>{atmosphere.setState({visible:false});if(audioContext)void audioContext.suspend();});
window.addEventListener('pageshow',()=>{atmosphere.resize();syncMotion();});
let audioContext,soundOn=false;
$('sound').addEventListener('click',async()=>{try{
 if(!audioContext){const Audio=window.AudioContext||window.webkitAudioContext;audioContext=new Audio();const buffer=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate),data=buffer.getChannelData(0);let v=0;for(let i=0;i<data.length;i++){v=(v+(Math.random()*2-1)*.035)/1.025;data[i]=v;}const source=audioContext.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=500;const gain=audioContext.createGain();gain.gain.value=.23;source.connect(filter).connect(gain).connect(audioContext.destination);source.start();}
 soundOn=!soundOn;await audioContext[soundOn?'resume':'suspend']();$('sound').textContent=soundOn?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(soundOn));
 }catch{$('sound').textContent='Sound unavailable';}});
function clock(){$('clock').textContent='PERTH '+new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false});}
clock();setInterval(clock,1000);render();void refreshFeed();
setInterval(()=>{render();if(!document.hidden)void refreshFeed();},10000);
document.addEventListener('visibilitychange',()=>{syncMotion();if(document.hidden){if(audioContext)void audioContext.suspend();}else{if(soundOn&&audioContext)void audioContext.resume();void refreshFeed();}});

