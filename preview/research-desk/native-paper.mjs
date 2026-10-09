// Optional, read-only native venue projection. Never merges into legacy orders or cues.
const instruments={'binance:SOLUSDT':{agent:'binance',base:'SOL',quote:'USDT'},'hyperliquid:@107':{agent:'hyperliquid',base:'HYPE',quote:'USDC'}};
const finite=n=>typeof n==='number'&&Number.isFinite(n),nonnegative=n=>finite(n)&&n>=0;
const text=(s,max=120)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const timestamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const fresh=(s,now)=>timestamp(s)&&now-Date.parse(s)>=0&&now-Date.parse(s)<=90000;
const equal=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.max(Math.abs(a),Math.abs(b),Number.MIN_VALUE)*1e-10;
const amount=n=>!finite(n)?'—':n!==0&&Math.abs(n)<1e-12?'AUD '+String(n):new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',currencyDisplay:'code',minimumFractionDigits:2,maximumFractionDigits:n!==0&&Math.abs(n)<.01?12:2}).format(n);
export function readNativePaper(report,now=Date.now()){
 const p=report?.native_paper,unavailable=(state,message)=>({state,message,positions:[],balances:[],fills:[],valuationComplete:false,markedTotal:null});
 if(p===undefined||p===null)return {state:'absent',message:'Native venue report unavailable.',positions:[],balances:[],fills:[],valuationComplete:true,markedTotal:0};
 const bad=()=>unavailable('invalid','Native venue accounting failed validation. Balances and fills withheld.');
 if(report.mode!=='PAPER'||report.currency!=='AUD'||p.version!==1||p.mode!=='PAPER'||!timestamp(p.observed_at)||typeof p.valuation_complete!=='boolean'||!(p.valuation_at===null||timestamp(p.valuation_at))||p.history_complete!==false||('legacy_mark_base' in p&&!(p.legacy_mark_base===null||nonnegative(p.legacy_mark_base)))||!Array.isArray(p.positions)||p.positions.length>2||!Array.isArray(p.pending_quote_balances)||p.pending_quote_balances.length>10||!Array.isArray(p.recent_fills)||p.recent_fills.length>50)return bad();
 if(new Set(p.positions.map(x=>x?.asset)).size!==p.positions.length||new Set(p.pending_quote_balances.map(x=>x?.agent_id+':'+x?.currency)).size!==p.pending_quote_balances.length||new Set(p.recent_fills.map(x=>x?.id)).size!==p.recent_fills.length)return bad();
 for(const x of p.positions){const i=instruments[x?.asset];if(!i||x.agent_id!==i.agent||x.base!==i.base||x.quote_currency!==i.quote||x.venue!==i.agent||!finite(x.owned_qty)||x.owned_qty<=0||x.owned_qty>=1e12||!['sellable_qty','dust_qty','cost_base','initial_risk_base'].every(k=>nonnegative(x[k]))||x.cost_base<=0||!equal(x.owned_qty,x.sellable_qty+x.dust_qty)||!(x.mark_base===null||nonnegative(x.mark_base))||!['open','dust_held'].includes(x.position_status)||x.position_status==='dust_held'&&(x.sellable_qty!==0||x.dust_qty<=0)||x.position_status==='open'&&x.sellable_qty<=0)return bad();}
 for(const x of p.positions){
  if(x.mark_base===0&&!(x.position_status==='dust_held'&&x.sellable_qty===0&&x.verified_fee_dust===true&&finite(x.qty_step)&&x.qty_step>x.owned_qty&&['conservative non-executable dust liquidation floor','non_executable_conservative_floor'].includes(x.valuation_basis)&&x.liquidation_floor_base===0&&nonnegative(x.conservative_risk_base)&&x.conservative_risk_base>=x.cost_base&&text(x.inventory_cycle_id,128)&&text(x.last_fill_id,128)))return bad();
 }
 for(const x of p.pending_quote_balances){if(!['binance','hyperliquid'].includes(x?.agent_id)||x.currency!==(x.agent_id==='binance'?'USDT':'USDC')||!finite(x.amount)||x.amount<=0||!(x.mark_base===null||finite(x.mark_base)&&x.mark_base>0))return bad();}
 for(const x of p.recent_fills){const i=instruments[x?.asset];if(!i||!text(x.id,128)||x.venue!==i.agent||!['buy','sell'].includes(x.side)||x.quote_currency!==i.quote||!timestamp(x.at)||Date.parse(x.at)>Date.parse(p.observed_at)||!finite(x.gross_qty)||x.gross_qty<=0||!nonnegative(x.fee_qty)||!nonnegative(x.fee_quote)||!finite(x.net_inventory_delta)||!finite(x.net_quote_delta)||!['open','dust_held','closed'].includes(x.position_status)||!['settled','pending_native_conversion'].includes(x.settlement_status)||!['cash_delta_base','fee_base','fx_cost_base'].every(k=>x[k]===null||finite(x[k]))||x.fee_base!==null&&x.fee_base<0||x.fx_cost_base!==null&&x.fx_cost_base<0)return bad();
  if(x.side==='buy'&&(x.fee_currency!==i.base||x.fee_quote!==0||!equal(x.net_inventory_delta,x.gross_qty-x.fee_qty)||x.net_inventory_delta<=0||x.net_quote_delta>=0||x.position_status==='closed'||x.settlement_status!=='settled'||!(x.cash_delta_base<0)))return bad();
  if(x.side==='sell'&&(x.fee_currency!==i.quote||x.fee_qty!==0||!equal(x.net_inventory_delta,-x.gross_qty)||x.net_quote_delta<=0||x.settlement_status==='settled'&&!(x.cash_delta_base>0)))return bad();
  if('at_fill_settlement_status' in x&&!['settled','pending_native_conversion'].includes(x.at_fill_settlement_status))return bad();
  if('settled_at' in x&&x.settled_at!==null&&(!timestamp(x.settled_at)||Date.parse(x.settled_at)<Date.parse(x.at)||Date.parse(x.settled_at)>Date.parse(p.observed_at)||x.settlement_status!=='settled'))return bad();
  if(x.at_fill_settlement_status==='pending_native_conversion'&&x.settlement_status==='settled'&&!timestamp(x.settled_at))return bad();
  if(x.settlement_status==='pending_native_conversion'&&(x.cash_delta_base!==null||x.fee_base!==null||x.fx_cost_base!==null))return bad();
  if(x.settlement_status==='settled'&&(!nonnegative(x.fee_base)||!nonnegative(x.fx_cost_base)))return bad();
 }
 if(!Number.isSafeInteger(report.account?.fills)||report.account.fills<p.recent_fills.length+(report.fills?.length||0)||p.recent_fills.some(x=>report.fills?.some(f=>f.id===x.id)))return bad();
 const marks=[...p.positions,...p.pending_quote_balances];
 if(p.valuation_complete&&(!timestamp(p.valuation_at)||marks.some(x=>x.mark_base===null)))return bad();
 if(!fresh(p.observed_at,now)||!fresh(report.heartbeat_at,now))return unavailable('stale','Native venue report stale. Current holdings, values and fills withheld.');
 const valuationComplete=p.valuation_complete&&fresh(p.valuation_at,now);
 return {state:'valid',message:valuationComplete?'Native venue paper report received.':'Native venue paper report received; combined valuation incomplete.',positions:p.positions,balances:p.pending_quote_balances,fills:p.recent_fills,valuationComplete,markedTotal:valuationComplete?marks.reduce((n,x)=>n+x.mark_base,0):null,observedAt:p.observed_at,legacyMark:p.legacy_mark_base??null};
}
export function nativeFillLabel(f){return f.side==='sell'?(f.position_status==='open'?'PARTIAL EXIT':f.position_status==='dust_held'?'DUST REMAINS':'REPORTED CLOSED'):'INVENTORY RECEIVED';}
export function renderNativePaper(document,report,now=Date.now()){
 const v=readNativePaper(report,now),list=(id,rows,format,empty)=>{const nodes=(rows.length?rows:[null]).map(x=>{const li=document.createElement('li');li.textContent=x?format(x):empty;return li;});document.getElementById(id).replaceChildren(...nodes);};
 document.getElementById('nativeStatus').textContent=v.message+(v.observedAt?' Observed '+new Date(v.observedAt).toISOString()+'.':'');
 list('nativePositions',v.positions,x=>`${x.venue} · ${x.asset} · ${x.base}/${x.quote_currency} · ${x.position_status}\nOwned ${x.owned_qty} ${x.base} · sellable ${x.sellable_qty} · dust ${x.dust_qty}\nAllocated cost ${amount(x.cost_base)} · marked value ${amount(v.valuationComplete?x.mark_base:null)} · initial risk ${amount(x.initial_risk_base)}${x.mark_base===0&&x.verified_fee_dust?'\nConservative non-executable dust liquidation floor; not a quoted market price. Retained cost '+amount(x.cost_base)+' · conservative risk '+amount(x.conservative_risk_base)+' · cycle '+x.inventory_cycle_id+' · last fill '+x.last_fill_id:''}`,'No verified native holding records available.');
 list('nativeBalances',v.balances,x=>`${x.agent_id} · ${x.amount} ${x.currency} awaiting conversion · marked AUD ${amount(v.valuationComplete?x.mark_base:null)}. Quote currency is not assumed equal to USD.`,'No verified pending native quote records available.');
 list('nativeFills',v.fills,x=>`${x.at} · SIMULATED ${x.side.toUpperCase()} · ${x.venue} · ${x.asset} · ${nativeFillLabel(x)}\nGross ${x.gross_qty} · fee ${x.fee_qty||x.fee_quote} ${x.fee_currency} · inventory delta ${x.net_inventory_delta} · quote delta ${x.net_quote_delta} ${x.quote_currency}\nAUD cash delta ${amount(x.cash_delta_base)} · recorded fee ${amount(x.fee_base)} · FX cost ${amount(x.fx_cost_base)} · ${x.settlement_status}${x.at_fill_settlement_status?' · at fill '+x.at_fill_settlement_status:''}${x.settled_at?' · converted '+x.settled_at:''} · fill ${x.id}`,'No verified native paper fills available.');
 return v;
}
