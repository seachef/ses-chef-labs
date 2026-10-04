/** Validate transient historical valuations against the exact selected scope. */
import {signedDecimalDifference,signedAud,signedUsd} from './history.mjs';
import {formatSignedPercent} from './headline.mjs';
import {COINS} from './model.mjs';
const ranges=new Set(['1h','1d','1w','1m','1y','max']);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=2000;
const decimal=value=>typeof value==='string'&&value.length<=1000&&/^(0|[1-9]\d*)(\.\d+)?$/.test(value);
const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const reject=()=>{throw new TypeError('Historical response does not match the selected wallet scope');};

export function normalizeWalletHistory(response,{accountId,walletIds,range='1d',currency='USD',now=Date.now()}={}){
  if(!text(accountId)||!Array.isArray(walletIds)||!walletIds.length||walletIds.some(id=>!text(id))||new Set(walletIds).size!==walletIds.length||!ranges.has(range)||!['USD','AUD'].includes(currency))reject();
  const r=response,s=r?.scope,c=r?.coverage,q=r?.query,w=r?.window,source=r?.source;
  if(r?.schema_version!==1||!['available','partial','unavailable'].includes(r.status)||s?.account_id!==accountId||!Array.isArray(s.wallet_ids)||!same(s.wallet_ids,walletIds)||!text(s.scope_key)||s.positions!=='liquid'||q?.range!==range||q.currency!==currency)reject();
  if(!Array.isArray(s.chain_ids)||!s.chain_ids.length||s.chain_ids.some(id=>!text(id))||!c||c.requested_wallet_count!==walletIds.length||!Number.isInteger(c.included_wallet_count)||c.included_wallet_count<0||c.included_wallet_count>walletIds.length||!Array.isArray(c.excluded_wallet_ids)||c.excluded_wallet_ids.some(id=>!walletIds.includes(id))||new Set(c.excluded_wallet_ids).size!==c.excluded_wallet_ids.length||typeof c.complete!=='boolean'||!Array.isArray(c.exclusions)||!Array.isArray(c.warnings))reject();
  if(!source||!text(source.provider)||!text(source.attribution)||!['wallet_balance_history','historical_block_balances_x_historical_prices'].includes(source.method)||stamp(source.retrieved_at)==null||stamp(source.retrieved_at)>now+60000||now-stamp(source.retrieved_at)>15*60000)reject();
  if(!w||!Array.isArray(r.points)||r.points.length>4096)reject();
  const first=stamp(w.actual_from),last=stamp(w.actual_to),interval=w.sample_interval_seconds;
  if(r.points.length&&(first==null||last==null||last<first||last>now+60000))reject();
  if(interval!=null&&(!Number.isInteger(interval)||interval<1||interval>366*86400))reject();
  const assetIds=s.asset_ids==null?null:s.asset_ids;if(assetIds!=null&&(!Array.isArray(assetIds)||!assetIds.length||assetIds.some(id=>id!=='native'&&!/^0x[0-9a-f]{40}$/.test(id))||new Set(assetIds).size!==assetIds.length))reject();
  const includedAssets=c.included_asset_ids??assetIds;
  if(includedAssets!=null&&(!Array.isArray(includedAssets)||new Set(includedAssets).size!==includedAssets.length||includedAssets.some(id=>!assetIds?.includes(id))))reject();
  const scope=JSON.stringify([accountId,[...walletIds].sort(),s.chain_ids,s.positions,range,currency,s.scope_key,assetIds]);
  let previous=null,segment=0;
  const points=r.points.map(point=>{
    const at=stamp(point?.at);
    if(at==null||at<first||at>last||previous!=null&&at<=previous||point.value!==null&&!decimal(point.value)||!text(point.coverage_key)||typeof point.complete!=='boolean')reject();
    const discontinuity=previous!=null&&interval!=null&&at-previous>interval*1500;
    if(discontinuity)segment++;
    previous=at;
    return {at:point.at,endAt:point.at,value:point.value,eligible:point.value!==null,
      reason:point.value===null?'history_data_gap':null,scopeKey:JSON.stringify([scope,point.coverage_key,segment]),complete:point.complete,discontinuity};
  });
  if(points.length&&(stamp(points[0].at)!==first||stamp(points.at(-1).at)!==last))reject();
  const baseline=points[0],endpoint=points.at(-1);
  let reason=r.status==='unavailable'?'history_unavailable':!points.length?'history_unavailable':points.length<2?'insufficient_distinct_observations':points.some(p=>!p.eligible||p.discontinuity)?'history_data_gap':points.some(p=>p.scopeKey!==endpoint.scopeKey)?'scope_changed':null;
  const change=reason?null:signedDecimalDifference(endpoint.value,baseline.value);
  if(includedAssets?.length===0&&points.some(p=>p.eligible))reject();
  const assetLabel=includedAssets?includedAssets.map(id=>id==='native'?'ETH':COINS.find(c=>c.assetId===id)?.symbol||'Other token').join(' + ')||'No priced assets':'Liquid wallet holdings';
  return {currency,range:range.toUpperCase(),points,assetLabel,source:{provider:source.provider,method:source.method,retrievedAt:source.retrieved_at,attribution:source.attribution,balanceAsOf:stamp(source.balance_as_of)!=null?source.balance_as_of:null},
    scope:{accountId,walletIds:[...walletIds],chainIds:[...s.chain_ids],positions:'liquid',assetIds},coverage:c,window:w,
    partialCoverage:!c.complete,metric:'value',connectorLimitMs:interval?interval*1500:null,reason,change,changeAvailable:change!=null,
    changeFormatted:change==null?'—':currency==='USD'?signedUsd(change):signedAud(change),
    percentFormatted:change==null?null:formatSignedPercent(change,baseline.value),
    baselineAt:baseline?.at||null,endpointAt:endpoint?.at||null,spanMs:baseline&&endpoint?stamp(endpoint.at)-stamp(baseline.at):null,
    includesExternalFlows:true,errorCode:text(r.error_code)?r.error_code:null};
}
