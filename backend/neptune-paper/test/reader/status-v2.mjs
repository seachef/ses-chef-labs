// Read-only public projection. This adapter never creates an account or a fill.
export const ACCOUNT_CURRENCY='AUD'; // Explicitly chosen by the owner; never a seeded balance.
export const ASSETS=Object.freeze(['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD']);
const states=['configuration_pending','stopped','warming_up','running','data_missing','data_stale','risk_paused','capacity_paused'];
const number=v=>typeof v==='number'&&Number.isFinite(v);
const nonnegative=v=>number(v)&&v>=0;
const nullable=v=>v===null||number(v);
const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const text=v=>typeof v==='string'&&v.length>0&&v.length<=1000;
const id=v=>text(v)||Number.isSafeInteger(v);
const asset=v=>ASSETS.includes(v);
const unique=a=>new Set(a.map(x=>x.id)).size===a.length;
const list=(a,test)=>Array.isArray(a)&&a.length<=50&&a.every(test)&&unique(a);
const price=v=>number(v)&&v>0;
const optionalPrice=v=>v===null||price(v);
function validPosition(p){return p&&asset(p.asset)&&p.quote_currency==='USD'&&price(p.qty)&&price(p.entry_price)&&price(p.entry_fx)&&nonnegative(p.cost_base)&&optionalPrice(p.stop)&&optionalPrice(p.target)&&optionalPrice(p.invalidation)&&nonnegative(p.initial_risk_base)&&typeof p.trailing_active==='boolean'&&optionalPrice(p.last_bid)&&(p.quote_at===null||timestamp(p.quote_at))&&timestamp(p.opened_at);}
function validDecision(d){return d&&id(d.id)&&timestamp(d.at)&&asset(d.asset)&&['buy','sell','hold'].includes(d.action)&&optionalPrice(d.price)&&d.quote_currency==='USD'&&text(d.reason)&&text(d.source)&&(d.observation_id===null||id(d.observation_id))&&(d.risk_base===null||nonnegative(d.risk_base))&&optionalPrice(d.stop)&&optionalPrice(d.target)&&optionalPrice(d.invalidation)&&d.confidence==='unvalidated'&&['pending','filled','cancelled','no_trade','blocked','trailing_updated'].includes(d.result);}
const fxFields=['fx','fx_source','fx_at','fx_rate_date','fx_retrieved_at','fx_applied_rate'];
function validFx(f){return price(f.fx)&&f.fx_source==='Frankfurter ECB reference'&&timestamp(f.fx_at)&&timestamp(f.fx_retrieved_at)&&typeof f.fx_rate_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(f.fx_rate_date)&&price(f.fx_applied_rate)&&nonnegative(f.fx_cost_base);}
function validFill(f){
 if(!f||!id(f.id)||!id(f.order_id)||!id(f.decision_id)||!id(f.observation_id)||!timestamp(f.at)||!asset(f.asset)||!['buy','sell'].includes(f.side)||!price(f.qty)||!price(f.price)||f.quote_currency!=='USD'||!nonnegative(f.slippage_pct)||!nonnegative(f.gross_usd)||!nonnegative(f.fee_usd)||!number(f.net_usd))return false;
 if(f.settlement_status==='pending_conversion')return f.side==='sell'&&[...fxFields,'gross_base','fee_base','fx_cost_base','cash_delta_base'].every(k=>f[k]===null);
 return f.settlement_status==='settled'&&validFx(f)&&nonnegative(f.gross_base)&&nonnegative(f.fee_base)&&number(f.cash_delta_base)&&(f.side==='buy'?f.cash_delta_base<0:f.cash_delta_base>=0);
}
function validSettlement(s){return s&&id(s.id)&&id(s.exit_fill_id)&&timestamp(s.at)&&price(s.usd_amount)&&validFx(s)&&nonnegative(s.cash_delta_base)&&number(s.pnl_base);}
function validResult(r){return r&&id(r.id)&&asset(r.asset)&&timestamp(r.closed_at)&&id(r.entry_fill_id)&&id(r.exit_fill_id)&&(r.status==='pending_conversion'?r.pnl_base===null&&r.net_r===null:r.status==='settled'&&number(r.pnl_base)&&nullable(r.net_r));}
export function validateV2(rows){
 if(!Array.isArray(rows)||rows.length!==1||rows[0]?.id!=='neptune-paper-v2')throw Error('Expected one v2 account');
 const p=rows[0].payload;
 if(!p||p.version!==2||p.mode!=='PAPER'||p.experimental!==true||p.historically_validated!==false||p.confidence!=='unvalidated'||p.account_id!=='neptune-paper-v2'||!states.includes(p.status)||![ACCOUNT_CURRENCY,null].includes(p.currency))throw Error('Invalid paper envelope');
 if(!['heartbeat_at','scan_at','quote_at'].every(k=>p[k]===null||timestamp(p[k]))||typeof p.scan_complete!=='boolean'||!text(p.message)||!Array.isArray(p.universe)||p.universe.length!==ASSETS.length||new Set(p.universe).size!==ASSETS.length||!p.universe.every(asset))throw Error('Invalid scan');
 const a=p.account;
 if(!a||!['initial_cash','cash','equity','realized_pnl','unrealized_pnl','fees'].every(k=>nullable(a[k]))||!Number.isSafeInteger(a.fills)||a.fills<0)throw Error('Invalid account');
 if(a.equity!==null&&!nonnegative(a.equity))throw Error('Invalid equity');
 if(p.status==='configuration_pending'){
  if(p.scan_complete||p.scan_at!==null||p.quote_at!==null)throw Error('Uncreated scan');
  if(!['initial_cash','cash','equity','realized_pnl','unrealized_pnl','fees'].every(k=>a[k]===null)||a.fills!==0||[p.positions,p.decisions,p.fills,p.results,p.settlements].some(a=>!Array.isArray(a)||a.length))throw Error('Uncreated account has activity');
 }else if(p.currency!==ACCOUNT_CURRENCY||a.initial_cash!==10000||!nonnegative(a.cash)||!number(a.realized_pnl)||!(nonnegative(a.fees)||a.fees===null&&a.fees_complete===false&&a.valuation_scope==='combined_native_v1'&&p.native_paper?.version===1&&p.native_paper?.mode==='PAPER'&&nonnegative(a.recorded_fees)&&nonnegative(a.recorded_fx_costs)))throw Error('Account not initialized');
 if('fees_complete' in a&&typeof a.fees_complete!=='boolean'||a.fees_complete===false&&(a.fees!==null||a.fx_costs!==null)||['recorded_fees','recorded_fx_costs'].some(k=>k in a&&!nonnegative(a[k])))throw Error('Invalid fee completeness');
 if(!Array.isArray(p.positions)||p.positions.length>3||!p.positions.every(validPosition)||new Set(p.positions.map(x=>x.asset)).size!==p.positions.length||!list(p.decisions,validDecision)||!list(p.fills,validFill)||!list(p.results,validResult)||!list(p.settlements,validSettlement)||a.fills<p.fills.length)throw Error('Invalid ledger');
 if(!p.risk||typeof p.risk.entry_paused!=='boolean'||!['per_entry_pct','max_notional_pct','max_positions','aggregate_pct','daily_drawdown_pct','total_drawdown_pct'].every(k=>nonnegative(p.risk[k]))||!p.cost_model||!nonnegative(p.cost_model.fee_per_side_pct)||!nonnegative(p.cost_model.slippage_per_side_pct)||p.cost_model.actual_fee_tier!==false)throw Error('Invalid risk/cost model');
 if(Object.entries({per_entry_pct:.25,max_notional_pct:10,max_positions:3,aggregate_pct:.75,daily_drawdown_pct:2,total_drawdown_pct:5}).some(([k,v])=>p.risk[k]!==v)||p.cost_model.fee_per_side_pct!==.8||p.cost_model.slippage_per_side_pct!==.25||p.cost_model.fx_adverse_per_side_pct!==.25)throw Error('Unexpected risk/cost configuration');
 if(p.status==='running'&&(p.risk.entry_paused||a.equity===null||a.unrealized_pnl===null))throw Error('Contradictory running state');
 for(const k of ['available_cash','reserved_cash','unsettled_usd','fx_costs'])if(k in a&&a[k]!==null&&!nonnegative(a[k]))throw Error('Invalid available cash');
 if(number(a.available_cash)&&number(a.reserved_cash)&&Math.abs(a.cash-a.available_cash-a.reserved_cash)>1e-6)throw Error('Cash availability mismatch');
 if('fx_source' in a&&a.fx_source!==null&&a.fx_source!=='Frankfurter ECB reference')throw Error('Unexpected valuation FX source');
 for(const k of ['fx','fx_applied_rate'])if(k in a&&a[k]!==null&&!price(a[k]))throw Error('Invalid valuation FX');
 for(const k of ['fx_at','fx_retrieved_at','valuation_at'])if(k in a&&a[k]!==null&&!timestamp(a[k]))throw Error('Invalid valuation timestamp');
 if('fx_rate_date' in a&&a.fx_rate_date!==null&&(typeof a.fx_rate_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(a.fx_rate_date)||!timestamp(a.fx_rate_date)))throw Error('Invalid valuation date');
 if(new Set(p.settlements.map(s=>s.exit_fill_id)).size!==p.settlements.length)throw Error('Duplicate FX settlement');
 for(const s of p.settlements){
  if(Math.abs(s.fx_applied_rate-s.fx*.9975)>1e-8||Math.abs(s.cash_delta_base-s.usd_amount*s.fx_applied_rate)>1e-6||Math.abs(s.fx_cost_base-s.usd_amount*(s.fx-s.fx_applied_rate))>1e-6)throw Error('Inconsistent FX settlement');
  const fill=p.fills.find(f=>f.id===s.exit_fill_id);
  if(fill&&(fill.side!=='sell'||fill.settlement_status!=='pending_conversion'||Math.abs(fill.net_usd-s.usd_amount)>1e-6||Date.parse(s.at)<Date.parse(fill.at)))throw Error('Invalid settlement linkage');
 }
 for(const f of p.fills){
  if(f.slippage_pct!==.25||Math.abs(f.fee_usd-f.gross_usd*.008)>1e-6)throw Error('Unexpected execution costs');
  const grossUsd=f.qty*f.price,netUsd=f.side==='buy'?-f.gross_usd-f.fee_usd:f.gross_usd-f.fee_usd;
  if(Math.abs(netUsd-f.net_usd)>1e-6)throw Error('Inconsistent net USD');
  if(Math.abs(grossUsd-f.gross_usd)>Math.max(1e-6,grossUsd*1e-8))throw Error('Inconsistent USD fill');
  if(f.settlement_status==='settled'){
   const expected=f.net_usd*f.fx_applied_rate;
   if(Math.abs(f.fx_applied_rate-f.fx*(f.side==='buy'?1.0025:.9975))>1e-8)throw Error('Unexpected FX modeling');
   if(Math.abs(f.gross_base-f.gross_usd*f.fx)>1e-6||Math.abs(f.fee_base-f.fee_usd*f.fx)>1e-6||Math.abs(f.fx_cost_base-Math.abs(f.net_usd)*Math.abs(f.fx_applied_rate-f.fx))>1e-6||Math.abs(expected-f.cash_delta_base)>1e-6)throw Error('Inconsistent fill accounting');
  }
 }
 for(const record of [p,...p.decisions,...p.fills,...p.settlements])for(const k of ['source_hash','config_hash'])if(k in record&&(typeof record[k]!=='string'||!/^\w{64}$/.test(record[k])||!/^[a-f0-9]+$/.test(record[k])))throw Error('Invalid audit hash');
 return p;
}
// Display tolerance covers a 60s server batch plus collector latency.
// This is NOT an execution gate: the server still requires quotes <=30s at fills.
export const DISPLAY_QUOTE_MAX_AGE_MS=90000;
export const fresh=(at,now,limit)=>timestamp(at)&&now-Date.parse(at)>=0&&now-Date.parse(at)<=limit;
export function paperViewV2(report,connected,now=Date.now()){
 if(!connected)return {status:'offline',label:'Data unavailable',reason:'Paper feed unavailable. No current valuation.'};
 if(!report)return {status:'uncreated',label:'Account not created',reason:'AUD chosen · awaiting authoritative v2 activation.'};
 if(report.status==='configuration_pending')return {status:'uncreated',label:'Account not created',reason:'AUD chosen · awaiting activation.'};
 if(['stopped','capacity_paused'].includes(report.status))return {status:report.status,label:report.status==='stopped'?'Engine stopped':'Capacity paused',reason:'Last report only. Engine is not running.'};
 if(!fresh(report.heartbeat_at,now,90000))return {status:'stale',label:'Heartbeat stale',reason:'Last report only. Engine activity is unconfirmed.'};
 if(['data_missing','data_stale'].includes(report.status)||!fresh(report.quote_at,now,DISPLAY_QUOTE_MAX_AGE_MS))return {status:'stale',label:'Sampled data unavailable',reason:'Last sample missing or stale. No current valuation.'};
 if(report.status!=='running')return {status:report.status,label:report.status.replaceAll('_',' '),reason:report.message==='Nothing to report'?report.status.replaceAll('_',' '):report.message};
 if(!report.scan_complete||!fresh(report.scan_at,now,120000))return {status:'incomplete',label:'Scan incomplete',reason:'Awaiting a complete fresh six-market scan.'};
 return {status:'running',label:'Paper engine running',reason:report.message==='Nothing to report'?'Nothing to report':report.message};
}
export function money(value,currency){return number(value)&&['AUD','USD'].includes(currency)?new Intl.NumberFormat('en-AU',{style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:2}).format(value):'—';}
export function quote(value){return number(value)?new Intl.NumberFormat('en-AU',{style:'currency',currency:'USD',currencyDisplay:'code',maximumFractionDigits:6}).format(value):'—';}
// Reuse the same execution/FX invariants for complete public history pages.
export function validHistoryRecord(kind,p){
 if(kind==='decisions')return validDecision(p);
 if(kind==='results')return validResult(p);
 if(kind==='settlements')return validSettlement(p)&&Math.abs(p.fx_applied_rate-p.fx*.9975)<=1e-8&&Math.abs(p.cash_delta_base-p.usd_amount*p.fx_applied_rate)<=1e-6&&Math.abs(p.fx_cost_base-p.usd_amount*(p.fx-p.fx_applied_rate))<=1e-6;
 if(kind==='fills'){
  if(!validFill(p)||p.slippage_pct!==.25||Math.abs(p.fee_usd-p.gross_usd*.008)>1e-6||Math.abs(p.qty*p.price-p.gross_usd)>Math.max(1e-6,p.gross_usd*1e-8)||Math.abs(p.net_usd-(p.side==='buy'?-p.gross_usd-p.fee_usd:p.gross_usd-p.fee_usd))>1e-6)return false;
  return p.settlement_status==='pending_conversion'||(Math.abs(p.fx_applied_rate-p.fx*(p.side==='buy'?1.0025:.9975))<=1e-8&&Math.abs(p.gross_base-p.gross_usd*p.fx)<=1e-6&&Math.abs(p.fee_base-p.fee_usd*p.fx)<=1e-6&&Math.abs(p.fx_cost_base-Math.abs(p.net_usd)*Math.abs(p.fx_applied_rate-p.fx))<=1e-6&&Math.abs(p.cash_delta_base-p.net_usd*p.fx_applied_rate)<=1e-6);
 }
 if(kind==='orders')return p&&id(p.id)&&id(p.decision_id)&&id(p.observation_id)&&timestamp(p.at)&&asset(p.asset)&&['buy','sell'].includes(p.side);
 if(kind==='order_events')return p&&id(p.id)&&id(p.order_id)&&timestamp(p.at)&&['pending','filled','cancelled','blocked'].includes(p.status);
 if(['cash_ledger','usd_ledger'].includes(kind))return p&&id(p.id)&&timestamp(p.at)&&(p.fill_id===null||id(p.fill_id))&&number(p.delta)&&(kind!=='cash_ledger'||nonnegative(p.balance));
 return false;
}
