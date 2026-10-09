// Optional read-only server projection. Never allocates cash, infers fills or activates agents.
export const SPECIALISTS=Object.freeze(['solana','base','ethereum','hyperliquid','binance']);
const names={solana:'Solana',base:'Base',ethereum:'Ethereum',hyperliquid:'Hyperliquid',binance:'Binance'};
const number=n=>typeof n==='number'&&Number.isFinite(n),nonnegative=n=>number(n)&&n>=0;
const same=(a,b)=>number(a)&&number(b)&&Math.abs(a-b)<=1e-6;
const timestamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const fresh=(s,now)=>timestamp(s)&&now-Date.parse(s)>=0&&now-Date.parse(s)<=90000;
const amount=n=>number(n)?new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',currencyDisplay:'code'}).format(n):'—';
const statusNames={research_only:'Research only',waiting_for_data:'Waiting for data',paper_active:'Paper scan observed',stopped:'Stopped'};
export function readSpecialistAccounts(report,now=Date.now()){
 const p=report?.specialist_accounts;
 if(p===undefined||p===null)return {state:'missing',accounts:[],message:'Five specialist accounts planned. Allocation has not been verified.'};
 const invalid=()=>({state:'invalid',accounts:[],message:'Specialist account data failed validation. No balances or activity inferred.'});
 if(p.version!==1||p.mode!=='PAPER'||p.currency!=='AUD'||p.initial_cash!==10000||report.currency!=='AUD'||report.account?.initial_cash!==10000||!Number.isSafeInteger(p.source_revision)||p.source_revision<0||!timestamp(p.observed_at)||!['pending','allocated'].includes(p.allocation_status)||!Array.isArray(p.accounts)||p.accounts.length!==5||new Set(p.accounts.map(a=>a?.id)).size!==5)return invalid();
 if(!(p.allocation_status==='pending'&&p.total_cash===null)&&!same(p.total_cash,report.account.cash))return invalid();
 for(const a of p.accounts){
  if(a&&('source_venue' in a&&a.source_venue!==null&&(typeof a.source_venue!=='string'||!a.source_venue.trim()||a.source_venue.length>120)||'readiness_reason' in a&&(typeof a.readiness_reason!=='string'||a.readiness_reason.length>500)||'execution_kind' in a&&!['spot_paper','research_only'].includes(a.execution_kind)||'costs_basis' in a&&(typeof a.costs_basis!=='string'||a.costs_basis.length>160)))return invalid();
  if(!a||!SPECIALISTS.includes(a.id)||a.nominal_initial_cash!==2000||!(a.costs_base===null||nonnegative(a.costs_base))||!Object.hasOwn(statusNames,a.status)||!(a.evidence_at===null||timestamp(a.evidence_at)))return invalid();
  if(p.allocation_status==='pending'){
   if(['cash','reserved_cash','available_cash','exposure_base','realized_pnl','costs_base'].some(k=>a[k]!==null)||a.status==='paper_active')return invalid();
  }else{
   if(!['cash','reserved_cash','available_cash'].every(k=>nonnegative(a[k]))||!same(a.cash,a.reserved_cash+a.available_cash)||!(a.exposure_base===null||nonnegative(a.exposure_base))||!(a.realized_pnl===null||number(a.realized_pnl)))return invalid();
  }
 }
 if(p.allocation_status==='allocated'&&!same(p.accounts.reduce((n,a)=>n+a.cash,0),p.total_cash))return invalid();
 if(p.allocation_status==='allocated'&&number(report.account.reserved_cash)&&!same(p.accounts.reduce((n,a)=>n+a.reserved_cash,0),report.account.reserved_cash))return invalid();
 if(p.allocation_status==='allocated'&&number(report.account.available_cash)&&!same(p.accounts.reduce((n,a)=>n+a.available_cash,0),report.account.available_cash))return invalid();
 if(!fresh(p.observed_at,now)||!fresh(report.heartbeat_at,now))return {state:'stale',accounts:[],message:'Specialist report is stale or future-dated. Current balances and activity are unavailable.'};
 return {state:p.allocation_status,accounts:SPECIALISTS.map(id=>p.accounts.find(a=>a.id===id)),observedAt:p.observed_at,totalCash:p.total_cash,sourceRevision:p.source_revision,message:p.allocation_status==='pending'?'Allocation pending. No specialist balances verified.':`Shared settled cash ${amount(p.total_cash)} · five subaccounts of the existing AUD 10,000 starting pool.`};
}
export function renderSpecialistAccounts(document,report,now=Date.now()){
 const view=readSpecialistAccounts(report,now),status=document.getElementById('specialistStatus'),list=document.getElementById('specialistAccounts');
 status.textContent=view.message+(view.observedAt?' Observed '+new Date(view.observedAt).toISOString()+' · source revision '+view.sourceRevision+'.':'');
 const rows=SPECIALISTS.map(id=>{
  const row=document.createElement('li'),a=view.accounts.find(a=>a.id===id);
  let label=view.state==='missing'?'Planned':view.state==='pending'?'Allocation pending':view.state==='stale'?'Stale report':view.state==='invalid'?'Unavailable':statusNames[a.status];
  if(a?.status==='paper_active'&&(!fresh(a.evidence_at,now)||!fresh(report.quote_at,now)||report.status!=='running'||!a.source_venue||a.execution_kind!=='spot_paper'))label='Paper scan unconfirmed';
  // Exposure and returns require a fresh valuation; settled cash does not.
  const valued=view.state==='allocated'&&fresh(report.quote_at,now)&&fresh(report.account?.valuation_at,now);
  row.textContent=`${names[id]} · ${label}\nSource venue: ${a?.source_venue??'unverified'} · ${a?.execution_kind==='spot_paper'?'spot paper only; no on-chain execution':'research only; no verified execution adapter'}\nReadiness: ${a?.readiness_reason||'not reported'}\nPlanned initial share AUD 2,000.00 · settled cash ${amount(a?.cash)} · available ${amount(a?.available_cash)} · reserved ${amount(a?.reserved_cash)}\nExposure ${amount(valued?a?.exposure_base:null)} · realized P&L ${amount(a?.realized_pnl)} · recorded fees/FX ${amount(a?.costs_base)}\nCost basis: ${a?.costs_basis??'not reported'}\nEvidence ${a?.evidence_at??'not received'}`;
  return row;
 });
 list.replaceChildren(...rows);return view;
}
