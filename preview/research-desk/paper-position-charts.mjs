import {paperTradePlanView} from './paper-trade-plan.mjs?v=experiment-provenance-v3-r2';
import {money} from './status-v2.mjs?v=experiment-provenance-v3-r2';

// Display-only, in-memory observations from the EXISTING status response. No
// market/history reader, storage, timer, execution route or account mutation.
export const POSITION_SAMPLE_LIMIT=240;
export const POSITION_RECEIPT_LIMIT=1024;
export const POSITION_SAMPLE_WINDOW_MS=3600000;
export const POSITION_QUOTE_MAX_AGE_MS=90000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const positive=n=>finite(n)&&n>0;
const time=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===s.slice(0,10)?Date.parse(s):NaN;
const iso=n=>new Date(n).toISOString();
const fresh=(at,now)=>finite(at)&&finite(now)&&at<=now&&now-at<=POSITION_QUOTE_MAX_AGE_MS;
const price=(n,ccy)=>positive(n)?ccy+' '+new Intl.NumberFormat('en-AU',{maximumSignificantDigits:9}).format(n):'Unavailable';
const amount=n=>finite(n)?money(n,'AUD'):'Unavailable';
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const quoteIdentity=(p,f)=>[p,f].every(x=>!('venue' in x)||['Kraken','kraken'].includes(x.venue))&&
 (!('quote_venue' in p)||['Kraken','kraken'].includes(p.quote_venue))&&(!('quote_asset' in p)||p.quote_asset===p.asset)&&(!('quote_currency' in p)||p.quote_currency==='USD');
const marketKey=asset=>'Kraken:'+asset;
// Identity never depends on an alterable timestamp or market label. Known IDs
// and orders remain quarantined after close/replacement for this page session.
const cycleKey=(p,f)=>stable(['Kraken',typeof f.id,f.id]);
const orderKey=f=>stable(['Kraken',typeof f.order_id,f.order_id]);
const immutable=(p,f)=>stable([marketKey(p.asset),f.id,f.order_id,f.decision_id,f.observation_id,f.source_hash,f.config_hash,f.config_version,f.quote_currency,time(f.at),time(f.fx_at),time(f.fx_retrieved_at),f.fx_source,f.fx_rate_date,f.price,f.qty,f.cash_delta_base,p.qty,p.entry_price,p.cost_base,p.entry_fx]);

// Generates only straight segments BETWEEN observed bid samples. Gaps are never
// interpolated across >90 seconds, rejected data, disconnects or conflicts.
export function positionChartGeometry(row){
 const samples=row.samples??[],levels=[['entry',row.entry],['stop',row.stop],['target',row.target]].filter(([,v])=>positive(v));
 const prices=[...samples.map(x=>x.price),...levels.map(([,v])=>v)].filter(positive);
 if(!prices.length)return null;
 const rawMin=Math.min(...prices),rawMax=Math.max(...prices),span=rawMax-rawMin,pad=span>0?span*.09:Math.max(rawMax*.01,Number.MIN_VALUE);
 const low=Math.max(0,rawMin-pad),high=rawMax+pad;
 if(!finite(high)||!(high>low))return null;
 const start=samples.length?samples[0].at:0,end=samples.length?samples.at(-1).at:0;
 const x=at=>end>start?44+(at-start)/(end-start)*912:500,y=value=>20+(1-(value-low)/(high-low))*230;
 const points=samples.map(s=>({...s,x:x(s.at),y:y(s.price)}));
 const segments=[];let segment=[];
 for(const p of points){if(segment.length&&(p.breakBefore||p.at-segment.at(-1).at>POSITION_QUOTE_MAX_AGE_MS)){segments.push(segment);segment=[];}segment.push(p);}if(segment.length)segments.push(segment);
 return {low,high,start,end,points,segments,levels:levels.map(([kind,value])=>({kind,value,y:y(value)}))};
}

export function createPaperPositionCharts(){
 let clock=-Infinity,accepted=null,acceptedAt=null,highwater=-Infinity,signature=null,notice='WAITING',noticeReason='Waiting for a checked paper report.',rows=[],connectedNow=false;
 const cycles=new Map(),series=new Map(),receipts=new Map(),orders=new Map();
 function interrupt(){for(const s of series.values())s.breakNext=true;}
 function ingest({report,connected=false,now=Date.now()}={}){
  connectedNow=connected;
  if(!finite(now)||now<clock){notice='CLOCK UNAVAILABLE';noticeReason='Page clock is invalid or moved backwards; current values withheld.';interrupt();return snapshot(now);}
  clock=now;
  if(!connected){notice='OFFLINE';noticeReason='Connection unavailable. Last received samples only; current position state and P&L are unconfirmed.';interrupt();return snapshot(now);}
  const plan=paperTradePlanView({report,connected,now}),at=time(plan.observedAt);
  if(!['RECEIVED','PARTIAL'].includes(plan.state)||!fresh(at,now)){
   notice=plan.state;noticeReason=plan.reason;interrupt();return snapshot(now);
  }
  // Ignore irrelevant discovery/worker changes; they cannot supply price data.
  const sig=stable({heartbeat:report.heartbeat_at,positions:report.positions,fills:report.fills,results:report.results,settlements:report.settlements,native:report.native_paper??null,account:report.account,cost:report.cost_model});
  if(at<highwater){notice='LATE REPORT';noticeReason='Older report ignored. Last accepted position snapshot retained; no older cycle is reopened.';interrupt();return snapshot(now);}
  if(at===highwater){
   if(sig!==signature){notice='CONFLICT';noticeReason='Different data shares an accepted report timestamp. Current values withheld until a newer checked report arrives.';interrupt();}
   else if(notice!=='CONFLICT'){notice=plan.state;noticeReason=plan.reason;}
   return snapshot(now);
  }
  const next=[],seen=new Set();
  for(const p of report.positions){
   const planRow=plan.rows.find(x=>x.key==='open:'+p.asset),f=report.fills.find(x=>x.id===p.entry_fill_id),market=marketKey(p.asset),previous=cycles.get(market);
   seen.add(market);
   const row={...planRow,key:'unverified:'+market,market,asset:p.asset,venue:'Kraken',currency:'USD',base:p.asset.split('/')[0],qty:p.qty,cost:p.cost_base,openedAt:time(p.opened_at),fillId:null,identityVerified:false,exitConflict:p.entry_fill_id!=null&&report.results.some(r=>r.entry_fill_id===p.entry_fill_id),samples:[],sampleState:'UNAVAILABLE',sampleReason:'Matching actual entry receipt unavailable. No series is inferred.',latestBid:null,quoteAt:null,receivedAt:null};
   if(positive(planRow?.entry)&&f&&quoteIdentity(p,f)){
    const key=cycleKey(p,f),order=orderKey(f),openedAt=time(p.opened_at),fingerprint=immutable(p,f),known=receipts.get(key);
    const identityConflict=known&&(known.closed||known.fingerprint!==fingerprint)||orders.has(order)&&orders.get(order)!==key;
    const capacityReached=!known&&receipts.size>=POSITION_RECEIPT_LIMIT;
    const rejected=identityConflict||capacityReached||previous&&(openedAt<previous.openedAt||openedAt===previous.openedAt&&key!==previous.key||key===previous.key&&(previous.closed||fingerprint!==previous.fingerprint));
    if(rejected){row.entry=null;row.target=null;row.stop=null;row.estimatedExit=null;row.estimatedNet=null;row.sampleReason=capacityReached?'Page-session receipt capacity reached. No new cycle is inferred.':'Entry cycle was closed, superseded or changed inconsistently. Waiting for a new verified entry receipt.';}
    else{
     if(!known){receipts.set(key,{fingerprint,closed:false});orders.set(order,key);}
     if(previous?.key!==key||!series.has(key)){if(previous?.key!==key&&receipts.has(previous?.key))receipts.get(previous.key).closed=true;series.delete(previous?.key);cycles.set(market,{key,openedAt,fingerprint,closed:false});series.set(key,{points:[],lastAt:-Infinity,lastPrice:null,breakNext:false,conflictAt:null,trimmed:false});}
     const s=series.get(key);Object.assign(row,{key,identityVerified:true,fillId:String(f.id)});
     const quoteAt=time(p.quote_at);
     if(!positive(p.last_bid)||!fresh(quoteAt,now)||quoteAt>at||quoteAt<openedAt){row.sampleReason='Exact-market bid missing, stale, future-dated or earlier than this entry.';s.breakNext=true;}
     else if(quoteAt<s.lastAt){row.sampleReason='Out-of-order quote ignored; waiting for a newer exact-market bid.';s.breakNext=true;}
     else if(quoteAt===s.lastAt&&p.last_bid!==s.lastPrice){s.points=s.points.filter(x=>x.at!==quoteAt);s.conflictAt=quoteAt;s.breakNext=true;row.sampleReason='Conflicting prices share one quote timestamp; that sample is withheld.';}
     else if(quoteAt===s.conflictAt){row.sampleReason='Conflicting quote timestamp withheld until a newer bid arrives.';s.breakNext=true;}
     else{
      if(quoteAt>s.lastAt){s.points.push({at:quoteAt,price:p.last_bid,receivedAt:now,breakBefore:s.breakNext});s.lastAt=quoteAt;s.lastPrice=p.last_bid;s.breakNext=false;s.conflictAt=null;}
      Object.assign(row,{sampleState:'RECEIVED',sampleReason:'Reported Kraken '+p.asset+' bid; polling samples, not a streaming price.',latestBid:p.last_bid,quoteAt,receivedAt:s.points.at(-1)?.receivedAt??null});
     }
     row.samples=s.points.map(x=>({...x}));
    }
   }else if(f&&!quoteIdentity(p,f)){row.entry=null;row.target=null;row.stop=null;row.estimatedExit=null;row.estimatedNet=null;row.sampleReason='Venue or market identity mismatch. Prices and series withheld.';series.delete(previous?.key);}
   if(row.sampleState!=='RECEIVED'){row.estimatedExit=null;row.estimatedNet=null;const old=series.get(previous?.key);if(old)old.breakNext=true;}
   if(!row.identityVerified){row.qty=null;row.cost=null;row.openedAt=null;}
   next.push(row);
  }
  // A fresh, accepted empty position list closes the displayed legacy cycle.
  // Market high-water is bounded by six markets. Receipt/order tombstones cap
  // at 1024 identities; at capacity new cycles fail closed instead of evicting IDs.
  for(const [market,cycle] of cycles)if(!seen.has(market)){cycle.closed=true;if(receipts.has(cycle.key))receipts.get(cycle.key).closed=true;series.delete(cycle.key);}
  for(const r of plan.rows.filter(x=>x.key.startsWith('native:'))){const p=report.native_paper.positions.find(x=>x.asset===r.asset);next.push({...r,market:r.asset,key:r.key,identityVerified:false,fillId:null,base:p.base,qty:p.owned_qty,cost:p.cost_base,openedAt:null,samples:[],sampleState:'UNAVAILABLE',sampleReason:'Native holding summary has no linked entry receipt or timestamped native market bid. No chart or USD conversion is inferred.',latestBid:null,quoteAt:null,receivedAt:null});}
  // Native data can independently be missing; do not describe its disappearance
  // as a closed position. Preserve a clearly unconfirmed placeholder instead.
  if(!report.native_paper||plan.state==='PARTIAL')for(const r of rows.filter(x=>x.key.startsWith('native:')))if(!next.some(x=>x.key===r.key))next.push({...r,unconfirmed:true,sampleReason:'Native holding update unavailable. Last reported holding only; open/closed state unconfirmed.'});
  accepted=structuredClone(report);acceptedAt=now;highwater=at;signature=sig;rows=next;
  notice=plan.state;noticeReason=plan.reason;
  return snapshot(now);
 }
 function snapshot(now=Date.now()){
  const reportCurrent=connectedNow&&now>=acceptedAt&&fresh(highwater,now)&&['RECEIVED','PARTIAL'].includes(notice);
  const plan=accepted&&reportCurrent?paperTradePlanView({report:accepted,connected:true,now}):null;
  const visible=rows.map(row=>{
   const s=series.get(row.key);
   if(s&&finite(now)&&now>=acceptedAt){const before=s.points.length;s.points=s.points.filter(p=>p.at>=now-POSITION_SAMPLE_WINDOW_MS).slice(-POSITION_SAMPLE_LIMIT);if(s.points.length<before)s.trimmed=true;}
   const samples=(s?.points??[]).map(p=>({...p})),quoteCurrent=reportCurrent&&row.sampleState==='RECEIVED'&&fresh(row.quoteAt,now)&&!row.unconfirmed;
   const planRow=plan?.rows.find(x=>x.asset===row.asset&&x.venue===row.venue);
   return {...row,samples,trimmed:s?.trimmed??false,reportCurrent:reportCurrent&&!row.unconfirmed,quoteCurrent,
    latestBid:quoteCurrent?row.latestBid:null,estimatedExit:quoteCurrent?(planRow?.estimatedExit??null):null,estimatedNet:quoteCurrent?(planRow?.estimatedNet??null):null,
    sampleState:!reportCurrent?'LAST RECEIVED':quoteCurrent?'RECEIVED':row.sampleState==='RECEIVED'?'STALE':row.sampleState,
    sampleReason:!reportCurrent?'Historical samples only. Current position state, bid and P&L unavailable.':row.sampleState==='RECEIVED'&&!quoteCurrent?'Last bid is stale. Waiting for a newer exact-market sample.':row.sampleReason};
  });
  return {state:reportCurrent?notice:notice==='RECEIVED'||notice==='PARTIAL'?'STALE':notice,reason:noticeReason,reportAt:finite(highwater)?highwater:null,receivedAt:acceptedAt,rows:visible,unrealised:plan?.unrealised??null};
 }
 return {ingest,snapshot};
}

function element(doc,tag,text,className){const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function svgElement(doc,tag,attrs,text){const e=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e;}
function renderChart(document,row){
 const geometry=row.identityVerified?positionChartGeometry(row):null,wrap=element(document,'div',undefined,'position-chart-plot');
 if(!geometry){wrap.append(element(document,'p','No verified bid samples or price levels available.','position-chart-empty'));return wrap;}
 const svg=svgElement(document,'svg',{viewBox:'0 0 1000 290',role:'img','aria-label':row.venue+' '+row.asset+' observed bid line chart with actual paper entry, stop trigger and target trigger levels. Missing periods are gaps.'});
 svg.append(svgElement(document,'title',{},row.asset+' · '+row.currency+' · received bid samples'));
 for(let i=0;i<=4;i++){const y=20+i*57.5;svg.append(svgElement(document,'line',{x1:44,x2:956,y1:y,y2:y,class:'position-chart-grid'}));}
 for(const level of geometry.levels)svg.append(svgElement(document,'line',{x1:44,x2:956,y1:level.y,y2:level.y,class:'position-level position-level-'+level.kind}));
 for(const segment of geometry.segments)if(segment.length>1)svg.append(svgElement(document,'polyline',{points:segment.map(p=>p.x.toFixed(2)+','+p.y.toFixed(2)).join(' '),class:'position-price-line',fill:'none'}));
 for(const p of geometry.points){const dot=svgElement(document,'circle',{cx:p.x,cy:p.y,r:3,class:'position-price-point'});dot.append(svgElement(document,'title',{},iso(p.at)+' · bid '+price(p.price,row.currency)+' · first received '+iso(p.receivedAt)));svg.append(dot);}
 wrap.append(svg);
 const range=element(document,'p','Price range '+price(geometry.low,row.currency)+'–'+price(geometry.high,row.currency)+'. '+(geometry.points.length?'Samples '+iso(geometry.start)+' to '+iso(geometry.end)+'.':'No sampled price line yet. Reference levels only.'),'position-chart-axis');wrap.append(range);
 return wrap;
}
export function renderPaperPositionCharts(document,controller,options){
 const root=document.getElementById('paperPositionWindows');if(!root)return null;
 const view=controller.ingest(options),status=document.getElementById('paperPositionStatus'),summary=document.getElementById('paperPositionPnl');
 status.textContent=view.state+' · '+(view.reportAt?'Last accepted report '+iso(view.reportAt)+'. ':'')+view.reason;
 summary.textContent='Current unrealised P&L · whole paper account: '+amount(view.unrealised)+'. Target estimates are never added to portfolio equity.';
 // Include all view data; a repeated render preserves focus, expanded evidence,
 // scroll position and the exact nodes. Updated cards preserve details state.
 const signature=stable(view);if(root.dataset.signature===signature)return view;
 const evidenceState=new Map([...(root.querySelectorAll?.('details')??[])].map(n=>[n.dataset.key,{open:n.open===true,focused:document.activeElement===n.querySelector?.('summary'),scrollTop:n.querySelector?.('.position-sample-receipts')?.scrollTop??0}]));
 let restoreFocus=null;const restoreScroll=[];
 const cards=view.rows.map((r,index)=>{
  const card=element(document,'article',undefined,'position-chart-window');card.dataset.positionKey=r.key;
  const title=element(document,'h3',(r.classificationLabel??'')+r.venue+' · '+r.asset);title.id='paperPositionTitle'+index;card.setAttribute('aria-labelledby',title.id);card.append(title);
  card.append(element(document,'p',(r.reportCurrent?r.status:'LAST REPORTED HOLDING · OPEN/CLOSED UNCONFIRMED')+' · '+r.sampleState,'position-chart-state'));
  card.append(element(document,'p',r.sampleReason,'position-chart-note'));
  const metrics=element(document,'dl',undefined,'position-chart-metrics');
  const entries=[['Actual paper entry',price(r.entry,r.currency)],['Stop trigger',price(r.stop,r.currency)],['Target trigger',price(r.target,r.currency)],['Current received bid',price(r.latestBid,r.currency)],['Estimated exit at target',price(r.estimatedExit,r.currency)],['Estimated target net P&L',amount(r.estimatedNet)],['Quantity',positive(r.qty)?String(r.qty)+' '+r.base:'Unavailable'],['Recorded entry cost',amount(r.cost)],['Current position P&L','Unavailable: report does not allocate current net P&L per position'],['Actual exit / realised P&L',r.exitConflict?'Linked exit evidence conflicts with this reported open holding. Result unavailable here.':r.identityVerified?'No matched exit for this displayed open cycle':'Unavailable: no verified entry-cycle or linked exit evidence']];
  for(const [label,value] of entries){const cell=element(document,'div');cell.append(element(document,'dt',label),element(document,'dd',value));metrics.append(cell);}card.append(metrics);
  card.append(element(document,'p','Entry receipt '+(r.fillId??'unavailable')+(r.openedAt?' · filled '+iso(r.openedAt):'')+'. '+(r.quoteAt?'Bid timestamp '+iso(r.quoteAt)+(r.receivedAt?' · first received on this page '+iso(r.receivedAt):'')+'.':'No checked bid receipt timestamp.'),'position-chart-receipt'));
  card.append(renderChart(document,r));
  const legend=element(document,'ul',undefined,'position-chart-legend');for(const [kind,label] of [['bid','Observed bid'],['entry','Actual paper entry'],['stop','Stop trigger'],['target','Target trigger']]){const item=element(document,'li',label,'position-legend-'+kind);legend.append(item);}card.append(legend);
  card.append(element(document,'p',r.samples.length+' received sample'+(r.samples.length===1?'':'s')+' retained since this page opened, at most 240 points / one hour. '+(r.trimmed?'Older samples have been discarded. ':'')+'Earlier history is unavailable. One point stays a point; missing or interrupted periods remain gaps. Levels show the latest reported plan, not historical trigger changes. Reloading clears this local history.','position-chart-note'));
  const evidence=element(document,'details');evidence.dataset.key=r.key;const previousEvidence=evidenceState.get(r.key);if(previousEvidence?.open)evidence.open=true;
  const summary=element(document,'summary','Calculation notes & exact sample receipts');evidence.append(summary);if(previousEvidence?.focused)restoreFocus=summary;
  evidence.append(element(document,'p',r.note??'Entry and target calculation evidence unavailable.'));
  const sampleList=element(document,'ol',undefined,'position-sample-receipts');for(const s of r.samples){sampleList.append(element(document,'li',iso(s.at)+' · bid '+price(s.price,r.currency)+' · first received '+iso(s.receivedAt)+(s.breakBefore?' · gap before this point':'')));}if(!r.samples.length)sampleList.append(element(document,'li','No received exact-market sample history.'));evidence.append(sampleList);if(previousEvidence)restoreScroll.push([sampleList,previousEvidence.scrollTop]);card.append(evidence);
  return card;
 });
 if(!cards.length)cards.push(element(document,'p',view.reportAt&&['RECEIVED','PARTIAL'].includes(view.state)?'No verified open paper positions in the accepted report. Intended entries do not create a chart.':'No checked open position snapshot available. No flat account or zero profit is inferred.','position-chart-empty'));
 root.replaceChildren(...cards);root.dataset.signature=signature;for(const [list,scrollTop] of restoreScroll)list.scrollTop=scrollTop;restoreFocus?.focus({preventScroll:true});
 return view;
}
