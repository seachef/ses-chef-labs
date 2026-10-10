import {ordinaryProfitEligible} from './experiment-provenance.mjs?v=experiment-provenance-v3-r2';
// Called only after validateV2. Require complete, linked, closed cost accounting.
export function settledProfits(p){
 if(p.mode!=='PAPER'||p.currency!=='AUD'||p.experiment_provenance_version!==1)return [];
 const seen=new Set();
 return p.results.flatMap(r=>{
  if(seen.has(r.exit_fill_id))return [];seen.add(r.exit_fill_id);
  const entry=p.fills.find(f=>f.id===r.entry_fill_id),exit=p.fills.find(f=>f.id===r.exit_fill_id),settlement=p.settlements.find(s=>s.exit_fill_id===r.exit_fill_id);
  if(!ordinaryProfitEligible(p,entry,exit,r,...(settlement?[settlement]:[]))||!entry||!exit||entry.side!=='buy'||exit.side!=='sell'||entry.asset!==r.asset||exit.asset!==r.asset||entry.settlement_status!=='settled'||entry.qty!==exit.qty||Date.parse(entry.at)>Date.parse(exit.at)||Date.parse(r.closed_at)!==Date.parse(exit.at))return [];
  const delayed=exit.settlement_status==='pending_conversion';
  if(delayed&&!settlement||!delayed&&r.status!=='settled')return [];
  const net=(delayed?settlement.cash_delta_base:exit.cash_delta_base)+entry.cash_delta_base;
  const reported=delayed?settlement.pnl_base:r.pnl_base;
  if(!Number.isFinite(net)||net<=0||!Number.isFinite(reported)||Math.abs(net-reported)>1e-6||(r.status==='settled'&&Math.abs(net-r.pnl_base)>1e-6))return [];
  return [{id:'closed:'+exit.id,asset:r.asset,at:delayed?settlement.at:r.closed_at,pnl_base:net}];
 });
}
