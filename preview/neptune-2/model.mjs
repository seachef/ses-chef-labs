import {validateV2, paperViewV2, fresh, experimentRecordLabel} from '../research-desk/status-v2.mjs?v=experiment-provenance-v3-r2';
import {readPortfolioSnapshot} from '../research-desk/portfolio-snapshot.mjs?v=neptune-native-20261009';
import {readNativePaper} from '../research-desk/native-paper.mjs?v=neptune-native-20261009';
import {paperTradePlanView} from '../research-desk/paper-trade-plan.mjs?v=experiment-provenance-v3-r2';

// A release gate, not a browser preference. No report, URL or stored setting can
// enable Start. Remove only in a reviewed release after backend safety is proven.
export const START_BLOCK = 'Start is unavailable: storage capacity and protective-exit safety need a verified backend repair.';
const nativeBase = Object.freeze({'binance:SOLUSDT':'SOL', 'hyperliquid:@107':'HYPE'});
const finite = n => typeof n === 'number' && Number.isFinite(n);
const byReport = (at, report) => typeof at === 'string' && Number.isFinite(Date.parse(at)) && Date.parse(at) <= Date.parse(report.heartbeat_at);
export const amount = n => finite(n) ? new Intl.NumberFormat('en-AU', {style:'currency', currency:'AUD', currencyDisplay:'code', maximumFractionDigits:2}).format(n) : 'Unavailable';
export const price = (n, currency) => finite(n) && n > 0 ? currency + ' ' + new Intl.NumberFormat('en-AU', {maximumSignificantDigits:9}).format(n) : 'Unavailable';
export const timestamp = at => typeof at === 'string' && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString().replace('T',' ').replace(/\.\d{3}Z$/, ' UTC') : 'Unavailable';

export function pageView({report, connected=false, loading=false, now=Date.now()}={}) {
  const empty = {title:loading?'Checking paper account':'Data unavailable', detail:loading?'Waiting for the server.':'No verified report is available.', reportAt:null, current:false, balance:null, cash:null, realised:null, unrealised:null, positions:[], fills:[], positionsMessage:'Current positions unavailable.', historyMessage:'No verified fills available.', valuationMessage:'Current values are withheld until the report and valuation are verified.'};
  if (!report) return connected ? {...empty, title:'Account unavailable', detail:'The server returned no paper account. No balance or trade has been created.'} : empty;
  let p; try {p=validateV2([{id:'neptune-paper-v2', payload:report}]);} catch {return {...empty, detail:'The report failed validation. No prices or profit are inferred.'};}
  const view=paperViewV2(p, connected, now), heartbeat=connected && fresh(p.heartbeat_at, now, 90000);
  const chronological=[...p.positions.map(x=>x.opened_at),...p.decisions.map(x=>x.at),...p.fills.map(x=>x.at),...p.results.map(x=>x.closed_at),...p.settlements.map(x=>x.at)].every(at=>byReport(at,p));
  const current=heartbeat && chronological && p.status!=='configuration_pending';
  const plan=paperTradePlanView({report:p, connected, now}), snapshot=readPortfolioSnapshot(p, connected, now), native=readNativePaper(p,now);
  const nativeOkay=native.state==='absent' && p.account.valuation_scope!=='combined_native_v1' || native.state==='valid' && byReport(native.observedAt,p) && (p.native_paper.valuation_at===null || byReport(p.native_paper.valuation_at,p));
  const costComplete=p.account.fees_complete!==false && finite(p.account.fees) && nativeOkay && (!native.balances.length) && p.account.unsettled_usd===0;
  const positions=current?plan.rows.filter(x=>x.status==='OPEN · PAPER'||x.status==='DUST HELD · PAPER').map(x=>{
    const position=p.positions.find(y=>y.asset===x.asset);
    const quoted=position && fresh(position.quote_at,now,90000) && byReport(position.quote_at,p);
    return {...x, displayAsset:position?x.asset:nativeBase[x.asset]+'/'+x.currency, current:quoted?position.last_bid:null, note:position ? (x.entry===null?'Entry receipt unavailable. ':'')+(quoted?'Current is the sampled bid.':'Current quote unavailable.') : 'Native entry, current price, stop and target are not supplied by this report.'};
  }):[];
  // Historical receipts remain historical during an outage. Never use them as a
  // current quote, open-position count, or fresh account valuation.
  const fills=chronological?p.fills.map(x=>({key:'legacy:'+x.id, at:x.at, coin:x.asset, side:x.side, quote:price(x.price,'USD'), label:experimentRecordLabel(x), detail:x.settlement_status==='settled'?'Cash '+amount(x.cash_delta_base)+' · fee '+amount(x.fee_base)+' · FX cost '+amount(x.fx_cost_base):'AUD conversion pending; profit unavailable.'})):[];
  if(current && nativeOkay && native.state==='valid') for(const x of native.fills) fills.push({key:'native:'+x.id, at:x.at, coin:nativeBase[x.asset]+'/'+x.quote_currency+' · '+x.venue, side:x.side, quote:'Native fill', label:'', detail:'Inventory change '+x.net_inventory_delta+' '+nativeBase[x.asset]+' · fee '+(x.fee_qty||x.fee_quote)+' '+x.fee_currency+' · quote change '+x.net_quote_delta+' '+x.quote_currency+' · '+x.settlement_status+' · cash '+amount(x.cash_delta_base)+' · fee '+amount(x.fee_base)+' · FX cost '+amount(x.fx_cost_base)});
  fills.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return {...empty, title:chronological?view.label:'Report invalid', detail:chronological?view.reason:'Report contains records later than its heartbeat. Current values are withheld.', reportAt:p.heartbeat_at, current,
    balance:current && nativeOkay && byReport(p.account.valuation_at,p) && p.positions.every(x=>byReport(x.quote_at,p))?snapshot.equity:null, cash:current?snapshot.cash:null,
    realised:current && costComplete?p.account.realized_pnl:null,
    unrealised:current && costComplete?plan.unrealised:null, positions, fills:fills.slice(0,30),
    positionsMessage:!current?'Current positions unavailable: the report is missing, old or disconnected.':plan.state==='PARTIAL'?'Some native positions are unavailable.':positions.length?'Entry, sampled bid, stop trigger and target trigger.':'No verified open positions in this report.',
    historyMessage:'Latest supplied paper fills, up to 30. This is a limited snapshot; earlier records may exist.'+(current?'':' Last report only.'),
    valuationMessage:current && snapshot.valuationCurrent?'Simulated AUD account. Realised P&L is reported after modelled costs; unrealised P&L uses estimated net liquidation value.':'Current values unavailable. No zero balance or zero profit is inferred.'};
}
