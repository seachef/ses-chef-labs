import {readPortfolioSnapshot} from './portfolio-snapshot.mjs?v=neptune-valuation-20261009';
// Read-only daily return: server-persisted Perth observation, never browser session P&L.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const timestamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const fresh=(s,now)=>timestamp(s)&&Date.parse(s)<=now&&now-Date.parse(s)<=90000;
const same=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<=1e-6;
export function perthDay(time){const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Perth',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
export function readDailyPerformance(report,connected=true,now=Date.now()){
 const unavailable=reason=>({available:false,reason}),p=report?.daily_performance;
 if(!connected||!p)return unavailable('Perth-day baseline unavailable');
 if(p.status==='unavailable')return unavailable('Perth-day return unavailable');
 if(p.status!=='available'||p.timezone!=='Australia/Perth'||p.coverage!=='since_first_observation'||p.day!==perthDay(now)||!Number.isSafeInteger(p.source_revision)||p.source_revision<0||!timestamp(p.baseline_at)||!timestamp(p.observed_at)||!finite(p.baseline_equity)||p.baseline_equity<=0||!finite(p.net_external_flows)||!finite(p.current_equity)||!finite(p.net_pnl)||!finite(p.pct))return unavailable('Daily return failed validation');
 if(perthDay(p.baseline_at)!==p.day||perthDay(p.observed_at)!==p.day||Date.parse(p.baseline_at)>Date.parse(p.observed_at)||!fresh(p.observed_at,now)||!readPortfolioSnapshot(report,connected,now).valuationCurrent)return unavailable('Daily valuation is stale or incomplete');
 if(report.currency!=='AUD'||!same(p.current_equity,report.account?.equity)||!same(p.net_pnl,p.current_equity-p.baseline_equity-p.net_external_flows)||!same(p.pct,p.net_pnl/p.baseline_equity*100))return unavailable('Daily cash-flow reconciliation failed');
 const since=new Date(p.baseline_at).toLocaleTimeString('en-AU',{timeZone:'Australia/Perth',hour:'2-digit',minute:'2-digit',hour12:false});
 return {available:true,pnl:p.net_pnl,pct:p.pct,since,baselineAt:p.baseline_at,baselineEquity:p.baseline_equity,netExternalFlows:p.net_external_flows,day:p.day};
}
