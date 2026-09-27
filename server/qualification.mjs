// Future trusted server-side collector boundary. The browser cannot set these checks.
// This validates evidence completeness, not token safety or investment returns.
export const CHECKS=Object.freeze(['identity','age','drop','recovery','liquidity','security','supply','costs']);
export function evaluate(report,now=Date.now()) {
  const missing=()=>({state:'UNKNOWN',reason:'Complete current evidence required'});
  if(!report||report.schema!=='SCL_QUALIFICATION_EVIDENCE_V1'||!Number.isSafeInteger(report.observedAt)||report.observedAt>now||now-report.observedAt>120000) return missing();
  if(typeof report.assetId!=='string'||!/^[a-z0-9_-]{1,32}:[A-Za-z0-9_-]{1,128}$/.test(report.assetId)||typeof report.symbol!=='string'||!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(report.symbol)) return missing();
  if(!Array.isArray(report.checks)||report.checks.length!==CHECKS.length) return missing();
  const seen=new Set(); let failed=false;
  for(const c of report.checks) {
    if(!c||!CHECKS.includes(c.name)||seen.has(c.name)||!['PASS','FAIL'].includes(c.status)||!Number.isSafeInteger(c.observedAt)||!Number.isSafeInteger(c.expiresAt)||c.observedAt>report.observedAt||c.expiresAt<=now||c.expiresAt<=c.observedAt||typeof c.evidenceId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(c.evidenceId)||!Array.isArray(c.sources)||!c.sources.length||c.sources.length>8)return missing();
    // Source URLs are evidence metadata only. They are never fetched or opened here.
    if(c.sources.some(url=>{try{const u=new URL(url);return u.protocol!=='https:'||!!u.username||!!u.password}catch{return true}}))return missing();
    seen.add(c.name);if(c.status==='FAIL') failed=true;
  }
  return {state:failed?'WAIT':'PASS',assetId:report.assetId,symbol:report.symbol,observedAt:report.observedAt};
}
