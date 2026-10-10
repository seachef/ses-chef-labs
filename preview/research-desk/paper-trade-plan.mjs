import {validateV2,money,fresh} from './status-v2.mjs?v=neptune-native-20261009';
import {readNativePaper} from './native-paper.mjs?v=neptune-native-20261009';
import {readPortfolioSnapshot} from './portfolio-snapshot.mjs?v=neptune-native-20261009';

// Read-only view over the existing report. It does not request, store, adjust or
// execute a trade. A target is a trigger, never a promised execution price.
const number=v=>typeof v==='number'&&Number.isFinite(v);
const positive=v=>number(v)&&v>0;
const same=(a,b)=>number(a)&&number(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.abs(a)*1e-9,Math.abs(b)*1e-9);
const time=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===v.slice(0,10)?Date.parse(v):NaN;
const by=(value,at)=>Number.isFinite(time(value))&&time(value)<=at;
const fxOrder=(x,at)=>by(x.fx_at,time(x.fx_retrieved_at))&&by(x.fx_retrieved_at,at)&&x.fx_rate_date===x.fx_at.slice(0,10);
const price=(n,ccy='USD')=>positive(n)?ccy+' '+new Intl.NumberFormat('en-AU',{maximumSignificantDigits:9}).format(n):'Unavailable';
const signed=n=>number(n)?money(n,'AUD'):'Unavailable';
const iso=v=>new Date(time(v)).toISOString();
const empty=(state,reason)=>({state,reason,rows:[],closed:[],unrealised:null,observedAt:null,preview:['Entry / target · '+state.toLowerCase(),'No checked paper position','Est. net P&L unavailable']});
function fxReady(a,at,now){
 return positive(a.fx)&&a.fx>=.25&&a.fx<=5&&a.fx_source==='Frankfurter ECB reference'&&same(a.fx_applied_rate,a.fx*.9975)&&
  by(a.fx_at,at)&&by(a.fx_retrieved_at,at)&&by(a.fx_at,time(a.fx_retrieved_at))&&fresh(a.fx_at,now,345600000)&&fresh(a.fx_retrieved_at,now,3600000)&&
  /^\d{4}-\d\d-\d\d$/.test(a.fx_rate_date??'')&&a.fx_at.slice(0,10)===a.fx_rate_date&&
  by(a.valuation_at,at)&&fresh(a.valuation_at,now,90000);
}
function entryReceipt(report,p,at){
 const f=report.fills.find(f=>f.id===p.entry_fill_id);
 if(!f||f.side!=='buy'||f.asset!==p.asset||f.settlement_status!=='settled'||!by(f.at,at)||time(f.at)!==time(p.opened_at)||
  !same(f.qty,p.qty)||!same(f.price,p.entry_price)||!same(f.fx,p.entry_fx)||!same(-f.cash_delta_base,p.cost_base)||
  !fxOrder(f,time(f.at)))return null;
 // A receipt already associated with an exit cannot establish this open cycle.
 if(report.results.some(r=>r.entry_fill_id===f.id)||report.fills.some(x=>x.asset===p.asset&&x.side==='sell'&&time(x.at)>=time(f.at)))return null;
 return f;
}
function legacyRow(report,p,at,now){
 const fill=entryReceipt(report,p,at),row={key:'open:'+p.asset,asset:p.asset,venue:'Kraken',currency:'USD',status:'OPEN · PAPER',entry:fill?p.entry_price:null,intended:null,target:p.target,stop:p.stop,estimatedExit:null,estimatedNet:null,at:p.opened_at,note:'Entry fill receipt missing or inconsistent; net estimate unavailable.'};
 if(!fill)return row;
 row.note='Actual simulated entry receipt '+fill.id+'.';
 if(!positive(p.target)||!positive(p.stop)){row.note+=' Plan incomplete; net estimate unavailable.';return row;}
 if(!by(p.quote_at,at)||!fresh(p.quote_at,now,90000)||!fxReady(report.account,at,now)){row.note+=' Current quote or AUD FX assumptions missing/stale; net estimate unavailable.';return row;}
 if(!positive(p.tick_size)||p.tick_size<1e-12||p.tick_size>1000){row.note+=' Execution price increment missing; net estimate unavailable.';return row;}
 const c=report.cost_model,ticks=p.target*(1-c.slippage_per_side_pct/100)/p.tick_size;
 if(!number(ticks)||ticks>Number.MAX_SAFE_INTEGER){row.note+=' Price precision cannot be verified; net estimate unavailable.';return row;}
 const exit=Math.floor(ticks)*p.tick_size,proceeds=p.qty*exit*(1-c.fee_per_side_pct/100)*report.account.fx_applied_rate,net=proceeds-p.cost_base;
 if(!positive(exit)||!number(net)||!positive(proceeds)){row.note+=' Calculation unavailable.';return row;}
 row.estimatedExit=exit;row.estimatedNet=net;
 row.note+=' Hypothetical full-size exit at the target trigger, less '+c.slippage_per_side_pct+'% sell slippage, rounded down to the '+price(p.tick_size)+' increment; '+c.fee_per_side_pct+'% sell fee and '+c.fx_adverse_per_side_pct+'% adverse exit FX. Entry fees/slippage/FX are already in recorded cost '+signed(p.cost_base)+'. Holds reference FX '+report.account.fx+' AUD/USD ('+report.account.fx_rate_date+', retrieved '+iso(report.account.fx_retrieved_at)+') unchanged. Future liquidity, gaps and FX can change the fill and result. This is an estimate, not earned profit.';
 return row;
}
function pendingRows(report,at,now){
 return report.decisions.filter(d=>d.action==='buy'&&d.result==='pending'&&report.decisions.filter(x=>String(x.id)===String(d.id)).length===1&&fresh(d.at,now,120000)&&by(d.at,at)&&
  !report.positions.some(p=>p.asset===d.asset)&&!report.fills.some(f=>f.decision_id===d.id)&&
  !report.decisions.some(x=>x!==d&&x.asset===d.asset&&(x.origin_decision_id===d.id||time(x.at)>=time(d.at)&&x.result!=='pending'))&&
  !report.decisions.some(x=>x!==d&&x.asset===d.asset&&x.result==='pending'&&(time(x.at)>time(d.at)||time(x.at)===time(d.at)&&String(x.id)>String(d.id))))
 .map(d=>({key:'pending:'+d.id,asset:d.asset,venue:'Kraken',currency:'USD',status:'INTENDED · NOT FILLED',entry:null,intended:d.price,target:d.target,stop:d.stop,estimatedExit:null,estimatedNet:null,at:d.at,note:'Decision '+d.id+'. This is the decision reference price, not an order limit or an actual fill. No verified filled quantity/cost; net estimate unavailable. Current pending order state is not supplied by this limited report.'}));
}
function closedRows(report,at){
 const groups=new Map();
 for(const r of report.results)if(by(r.closed_at,at)){const group=groups.get(r.exit_fill_id)??[];group.push(r);groups.set(r.exit_fill_id,group);}
 const results=[...groups.values()].map(group=>group.find(r=>r.status==='settled')??group[0]);
 return results.sort((a,b)=>time(b.closed_at)-time(a.closed_at)).slice(0,8).map(r=>{
  const group=groups.get(r.exit_fill_id),consistent=group.length<=2&&new Set(group.map(x=>x.status)).size===group.length&&group.every(x=>x.asset===r.asset&&x.entry_fill_id===r.entry_fill_id&&time(x.closed_at)===time(r.closed_at))&&new Set(report.results.filter(x=>x.entry_fill_id===r.entry_fill_id).map(x=>x.exit_fill_id)).size===1;
  const buy=report.fills.find(f=>f.id===r.entry_fill_id),sell=report.fills.find(f=>f.id===r.exit_fill_id),settlement=report.settlements.find(s=>s.exit_fill_id===r.exit_fill_id);
  const linked=buy?.side==='buy'&&sell?.side==='sell'&&buy.asset===r.asset&&sell.asset===r.asset&&same(buy.qty,sell.qty)&&by(buy.at,time(sell.at))&&time(buy.at)<time(sell.at)&&time(sell.at)===time(r.closed_at)&&by(sell.at,at)&&
   consistent&&
   fxOrder(buy,time(buy.at))&&
   (sell.settlement_status==='pending_conversion'||fxOrder(sell,time(sell.at)));
  let net=null,note='Realised P&L unavailable: matching entry/exit receipts or accounting are missing.';
  if(linked){
   const settled=sell.settlement_status==='settled'?{cash:sell.cash_delta_base,pnl:r.status==='settled'?r.pnl_base:null}:settlement&&by(settlement.at,at)&&time(settlement.at)>=time(sell.at)&&fxOrder(settlement,time(settlement.at))?{cash:settlement.cash_delta_base,pnl:settlement.pnl_base}:null;
   if(settled&&same(settled.cash+buy.cash_delta_base,settled.pnl)&&(r.status!=='settled'||same(r.pnl_base,settled.pnl))&&(!('settled_at' in r)||by(r.settled_at,at)&&time(r.settled_at)>=time(r.closed_at))){net=settled.pnl;note='Actual simulated exit '+sell.id+'; realised net P&L reconciles entry debit and settled AUD proceeds.';}
   else if(sell.settlement_status==='pending_conversion')note='Exit filled; AUD conversion/realised P&L not yet verified.';
  }
  return {asset:r.asset,entry:linked?buy.price:null,exit:linked?sell.price:null,net,at:r.closed_at,note};
 });
}
export function paperTradePlanView({report,connected=false,now=Date.now()}={}){
 let p;try{p=validateV2([{id:'neptune-paper-v2',payload:report}]);}catch{return empty('UNAVAILABLE','Checked paper report unavailable. No prices or profit are inferred.');}
 const at=time(p.heartbeat_at);
 if(p.status==='configuration_pending')return empty('WAITING','Paper account has not been created.');
 if(!connected)return empty('OFFLINE','Connection unavailable. Entry/target preview and current P&L withheld.');
 if(!number(now)||!Number.isFinite(at)||at>now||now-at>90000)return empty('STALE','Report old or future-dated. Entry/target preview and current P&L withheld.');
 if([...p.decisions,...p.fills,...p.settlements].some(x=>!by(x.at,at))||p.positions.some(x=>!by(x.opened_at,at))||p.results.some(x=>!by(x.closed_at,at)))return empty('UNAVAILABLE','Report contains invalid or future record times. No prices or profit are inferred.');
 const rows=p.positions.map(x=>legacyRow(p,x,at,now));
 rows.push(...pendingRows(p,at,now));
 const native=readNativePaper(p,now),nativeOkay=native.state==='valid'&&by(native.observedAt,at)&&(p.native_paper.valuation_at===null||by(p.native_paper.valuation_at,at));
 if(nativeOkay)for(const x of native.positions)rows.push({key:'native:'+x.asset,asset:x.asset,venue:x.venue,currency:x.quote_currency,status:x.position_status==='dust_held'?'DUST HELD · PAPER':'OPEN · PAPER',entry:null,intended:null,target:null,stop:null,estimatedExit:null,estimatedNet:null,at:native.observedAt,note:'Verified native holding: '+x.owned_qty+' '+x.base+'; sellable '+x.sellable_qty+', dust '+x.dust_qty+'. The existing native summary does not include the linked entry price, target, stop or complete exit cost/FX assumptions. These values and estimated net P&L are unavailable. '+x.quote_currency+' is not assumed equal to USD.'});
 // The scalar alone is insufficient: reconcile the reported unrealised amount
 // against marked equity, settled cash and every supported inventory cost basis.
 // Pending native quote balances do not expose their retained cost basis here.
 const snapshot=readPortfolioSnapshot(p,connected,now),costComplete=p.positions.every(x=>entryReceipt(p,x,at)!==null)&&(native.state==='absent'||nativeOkay&&native.balances.length===0);
 const heldCost=p.positions.reduce((total,x)=>total+x.cost_base,0)+(nativeOkay?native.positions.reduce((total,x)=>total+x.cost_base,0):0);
 const current=snapshot.valuationCurrent&&fxReady(p.account,at,now)&&p.positions.every(x=>by(x.quote_at,at))&&costComplete&&number(heldCost)&&same(p.account.unrealized_pnl,snapshot.equity-snapshot.cash-heldCost);
 const first=rows.find(x=>x.status==='OPEN · PAPER'&&x.entry!==null)??rows[0];
 const preview=first?[first.asset+' · '+(first.intended!==null?'intended':'paper entry')+' '+price(first.intended??first.entry,first.currency),
  'Target trigger '+price(first.target,first.currency),
  'Est. net P&L '+signed(first.estimatedNet)+(rows.length>1?' · +'+(rows.length-1)+' more':'')]:['Entry / target · no checked position','No entry or target inferred','Est. net P&L unavailable'];
 return {state:native.state==='invalid'||native.state==='stale'||native.state==='valid'&&!nativeOkay?'PARTIAL':'RECEIVED',observedAt:p.heartbeat_at,rows,closed:closedRows(p,at),unrealised:current?p.account.unrealized_pnl:null,preview,
  reason:'Simulated only. Target trigger and estimated exit are separate from an actual exit. Estimates are not guaranteed; profit is realised only after a filled exit and verified settlement.'+(native.state==='absent'?' Native entry/target data not supplied.':!nativeOkay?' Native holding data unavailable.':'')};
}
export function renderPaperTradePlan(document,options){
 const v=paperTradePlanView(options),set=(id,value)=>{const n=document.getElementById(id);if(n&&n.textContent!==value)n.textContent=value;};
 for(let i=0;i<3;i++)set('paperTradePreview'+i,v.preview[i]);
 set('paperPlanStatus',v.state+' · '+(v.observedAt?'Report '+iso(v.observedAt)+'. ':'')+v.reason);
 set('paperPlanUnrealised','Current unrealised P&L · whole paper account: '+signed(v.unrealised)+'. This includes open holdings and is not realised profit.');
 const list=(id,rows,format,fallback)=>{const n=document.getElementById(id);if(!n)return;const texts=rows.length?rows.map(format):[fallback],signature=texts.join('\n');if(n.dataset?.signature===signature)return;const children=texts.map(t=>{const li=document.createElement('li');li.textContent=t;return li;});n.replaceChildren(...children);if(n.dataset)n.dataset.signature=signature;};
 list('paperPlanRows',v.rows,r=>r.venue+' · '+r.asset+' · '+r.status+'\n'+(r.intended!==null?'Intended entry reference '+price(r.intended,r.currency)+' · actual entry not filled':'Actual paper entry '+price(r.entry,r.currency))+'\nPlanned target trigger '+price(r.target,r.currency)+' · stop trigger '+price(r.stop,r.currency)+'\nEstimated target exit after slippage '+price(r.estimatedExit,r.currency)+' · estimated net P&L '+signed(r.estimatedNet)+'\n'+r.note,'No checked open position or recent intended entry available. No zero profit is inferred.');
 list('paperPlanClosed',v.closed,r=>r.asset+' · '+iso(r.at)+'\nActual paper entry '+price(r.entry)+' · actual paper exit '+price(r.exit)+'\nRealised net P&L '+signed(r.net)+'\n'+r.note,'No verified linked exit result in this limited report. This does not establish that no earlier exits occurred.');
 return v;
}
