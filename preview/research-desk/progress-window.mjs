import {validateV2} from './status-v2.mjs?v=experiment-provenance-v3-r2';
import {readNativePaper} from './native-paper.mjs?v=neptune-native-20261009';
import {validateMarketActivitySnapshot} from './market-activity.mjs?v=experiment-provenance-v3-r2';
import {readPublicScoutSnapshot,publicScoutDisplay} from './public-scout.mjs?v=public-scout-review-20261010';

// Display-only summary of existing public receipts. No timer, storage, request,
// account value, chat transcript, trading control or synthetic event is added.
export const PROGRESS_WINDOW_MS=15*60*1000;
const MAX_REPORT_AGE_MS=90000;
const instruments=Object.freeze({
 'ETH/USD':'Kraken ETH/USD','SOL/USD':'Kraken SOL/USD','AVAX/USD':'Kraken AVAX/USD',
 'LINK/USD':'Kraken LINK/USD','AAVE/USD':'Kraken AAVE/USD','UNI/USD':'Kraken UNI/USD',
 'binance:SOLUSDT':'Binance SOL/USDT','hyperliquid:@107':'Hyperliquid HYPE/USDC'
});
const reasons=Object.freeze({
 no_new_completed_bar:'waiting for the next finished 15-minute price period',
 no_qualified_momentum:'the price move was not strong enough',
 missing_completed_bars:'finished price history was missing',
 stale_completed_bars:'price history was too old',
 stale_book:'buy and sell prices were too old',missing_book:'buy and sell prices were missing',
 spread_too_wide:'the gap between buy and sell prices was too big',volume_below_threshold:'not enough trading was happening',
 insufficient_near_depth:'not enough coins were available near that price',insufficient_exit_depth:'there were not enough buyers to sell safely',
 position_within_plan:'existing position remains within its plan',
 warmup_no_historical_replay:'collecting fresh prices before trying a buy',entry_risk_cost_or_depth_gate:'a safety, cost or available-quantity check did not pass',
 awaiting_later_observation:'waiting for the next price check',native_feed_protective_only:'new buys were paused; only protective actions were allowed',
 native_protective_rule_gate:'a protective rule blocked the action'
});
const time=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===v.slice(0,10)?Date.parse(v):NaN;
const clock=at=>new Date(at).toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour12:false});
const date=at=>new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Perth',hour12:false})+' Perth';
const age=(at,now)=>{const seconds=Math.max(0,Math.floor((now-at)/1000));return seconds<60?seconds+'s ago':seconds<3600?Math.floor(seconds/60)+'m ago':Math.floor(seconds/3600)+'h ago';};
const plural=(n,word)=>n+' '+word+(n===1?'':'s');
const empty={state:'WAITING',headline:'Buys and sells unknown',observed:'No verified report yet',details:['Waiting for a checked paper report. We do not know whether any buys or sells happened.'],fills:[]};

export function progressView({report,connected=false,marketSnapshot=null,scoutSnapshot=null,now=Date.now()}={}){
 let p;try{p=validateV2([{id:'neptune-paper-v2',payload:report}]);}catch{return {...empty,state:connected?'UNAVAILABLE':'WAITING',details:[...empty.details]};}
 const at=time(p.heartbeat_at);
 if(!Number.isFinite(now)||!Number.isFinite(at)||at>now||p.status==='configuration_pending')return {...empty,details:[...empty.details]};
 const current=connected===true&&now-at<=MAX_REPORT_AGE_MS;
 const native=readNativePaper(p,now);
 const legacyValid=p.fills.every(f=>Number.isFinite(time(f.at))&&time(f.at)<=at&&Object.hasOwn(instruments,f.asset));
 const nativeValid=native.state==='valid'&&time(native.observedAt)<=at&&native.fills.every(f=>Number.isFinite(time(f.at))&&time(f.at)<=at);
 const receipts=[...(legacyValid?p.fills.map(f=>({at:f.at,side:f.side,asset:f.asset,note:f.settlement_status==='pending_conversion'?'waiting to convert proceeds to AUD':null})):[]),...(nativeValid?native.fills.map(f=>({at:f.at,side:f.side,asset:f.asset,note:(f.side==='buy'?'coins received':f.position_status==='open'?'sold part; some coins remain':f.position_status==='dust_held'?'small leftover remains':'reported closed')+(f.settlement_status==='pending_native_conversion'?' · waiting to convert proceeds to AUD':'')})):[])];
 const fills=receipts.filter(f=>time(f.at)>now-PROGRESS_WINDOW_MS&&time(f.at)<=now).sort((a,b)=>time(b.at)-time(a.at));
 const buys=fills.filter(f=>f.side==='buy').length,sells=fills.filter(f=>f.side==='sell').length;
 const completeSources=legacyValid&&nativeValid;
 const state=!connected?'OFFLINE':!current?'STALE':!completeSources?'PARTIAL':'OBSERVED';
 const headline=fills.length?plural(buys,'paper buy')+' · '+plural(sells,'sell')+' seen':!current?'Current buys and sells unknown':!completeSources?'No trades seen · some data missing':'No buys or sells in received data';
 const details=[`Last 15 minutes: ${date(now-PROGRESS_WINDOW_MS)} to ${date(now)}.`,
  `${state}. Last paper report ${date(at)} (${age(at,now)}). ${!connected?'The connection is down. These are the last records we received.':!current?'This report is old. It cannot tell us what is happening now.':'This time comes from the report. Refreshing the page does not make it newer.'}`,
  fills.length?`${plural(buys,'simulated buy')} and ${plural(sells,'simulated sell')} appear in the records we received for this period.`:current&&completeSources?'No buys or sells appear in the records we received. Some records may be missing, so we cannot say that no trades happened.':'Some trade records are missing or old. We cannot say that no trades happened.',
  `We only receive the latest 50 Kraken trades and 50 Binance/Hyperliquid trades. This may leave gaps in the last 15 minutes. Kraken records: ${legacyValid?'checked':'unavailable'}. Binance/Hyperliquid records: ${nativeValid?'checked':native.state==='valid'?'unavailable (times do not match)':native.state}.`,
  `Paper engine: ${({running:'running',stopped:'stopped',warming_up:'collecting fresh prices',data_missing:'some prices are missing',data_stale:'some prices are too old',risk_paused:'new buys paused by a safety rule',capacity_paused:'paused at its storage limit'})[p.status]??'waiting'}. ${p.scan_complete?'The report says its market check finished.':'The market check is incomplete.'} That alone does not make a coin safe to buy.`,
  'We count completed trade records only. A new price or a plan to buy is not a completed trade. These are practice trades. No real money moves.'
 ];
 const decisions=validateMarketActivitySnapshot(marketSnapshot,{now});
 if(decisions){const recent=decisions.records.filter(d=>time(d.at)>now-PROGRESS_WINDOW_MS),pending=recent.filter(d=>d.result==='pending').length,counts=new Map();
  for(const d of recent)if(['no_trade','blocked','cancelled'].includes(d.result)){const reason=d.reason??'unknown';counts.set(reason,(counts.get(reason)??0)+1);}
  const top=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,3);
  details.push(`Recent checks received: ${plural(recent.length,'record')}${pending?' · '+pending+' waiting (not completed trades)':''}. This is only part of the check history.`);
  if(top.length)details.push('Why checks ended without a trade: '+top.map(([r,count])=>(reasons[r]??'reason not explained in this view')+' ('+count+')').join('; ')+'.');
 }
 const scout=readPublicScoutSnapshot(scoutSnapshot);if(scout){const display=publicScoutDisplay(scout,{now}),labels={'CHECKING':'checking for a new report','UNAVAILABLE':'report unavailable','WAITING':'waiting for a report','STALE':'last report is old','STALE · OFFLINE':'last report is old and the connection is down','OFFLINE':'connection is down','RUN FAILED':'the last check failed','INITIALIZING':'getting ready','RECOVERY NEEDED':'paused until an earlier run is checked','DATA UNAVAILABLE':'market data unavailable','PARTIAL SCAN':'only some market data arrived','SCAN RECORDED':'a research check was recorded'};details.push('Public research: '+(labels[display.status]??'waiting for checked data')+(display.at?'. Last report '+date(time(display.at))+'.':'. No checked report time is available.'));} 
 details.push('This window shows the last 15 minutes of app data. Chat updates are separate. Next: waiting for new checked records.');
 return {state,headline,observed:'Report '+clock(at)+' Perth · '+age(at,now),details,
  fills:fills.map(f=>date(time(f.at))+' · SIMULATED '+f.side.toUpperCase()+' · '+instruments[f.asset]+(f.note?' · '+f.note:''))};
}

export function renderProgressWindow(document,options){
 const view=progressView(options),text=(id,value)=>{const n=document.getElementById(id);if(n&&n.textContent!==value)n.textContent=value;};
 text('progressState',({OBSERVED:'RECEIVED',STALE:'OLD'})[view.state]??view.state);text('progressHeadline',view.headline);text('progressObserved',view.observed);
 text('progressDetails',view.details.join('\n\n'));
 const list=document.getElementById('progressFills');if(list){const signature=view.fills.join('\n');if(list.dataset?.signature!==signature){const rows=(view.fills.length?view.fills:['No checked trade records available for this period.']).map(value=>{const li=document.createElement('li');li.textContent=value;return li;});list.replaceChildren(...rows);if(list.dataset)list.dataset.signature=signature;}}
 return view;
}
