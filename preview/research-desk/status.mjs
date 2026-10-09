const HEARTBEAT_MAX_AGE_MS = 90000;
export function validateReports(rows) {
 if(!Array.isArray(rows))throw Error('Invalid reports');
 const markets=['BTC/USD','ETH/USD','SOL/USD'];
 const data=rows.map(row=>row?.payload).filter(r=>markets.includes(r?.symbol));
 if(new Set(data.map(r=>r.symbol)).size!==data.length||data.some(r=>r.version!==1||r.mode!=='PAPER'||r.currency!=='USD'||r.experimental!==true||r.historically_validated!==false))throw Error('Unverified reports');
 return data;
}
const QUOTE_MAX_AGE_MS = 120000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const safeText = value => typeof value === 'string' ? value.slice(0,350) : '';
function ageMs(time, now) {
 const parsed = typeof time === 'string' ? Date.parse(time) : NaN;
 return Number.isFinite(parsed) && parsed <= now + 10000 ? Math.max(0, now-parsed) : Infinity;
}
export function paperView(data, connected, now=Date.now()) {
 if (!data) return {status:connected?'waiting':'offline',label:connected?'Awaiting first tick':'Offline',reason:'No verified server report is available.'};
 if (data.capacity_paused===true && data.enabled===false && data.status==='capacity_paused') return {status:'ended',label:connected?'Campaign ended':'Campaign ended · last report',reason:'Last confirmed terminal stop: '+(safeText(data.capacity_reason)||'Campaign safety limit reached.')+' The campaign cannot resume. Prices and valuations below are from its last report.'};
 if (!connected) return {status:'offline',label:'Offline · last report',reason:'Status service unavailable. Values below are the last received report, not a current valuation.'};
 if (ageMs(data.heartbeat_at,now)>HEARTBEAT_MAX_AGE_MS) return {status:'stale',label:'Stale heartbeat',reason:'The server heartbeat is stale or missing. Running is not confirmed; values are from the last report.'};
 if (data.enabled === false) return {status:'paused',label:'Paused',reason:safeText(data.reason)||'The server reports that paper execution is paused.'};
 if (ageMs(data.last_quote_at,now)>QUOTE_MAX_AGE_MS) return {status:'stale',label:'Stale quote',reason:'No fresh market quote is confirmed. Values are from the last report.'};
 if (data.status === 'feed_error' || data.status === 'risk_paused') return {status:'error',label:'Data blocked',reason:safeText(data.reason)||'The runner reports a data or execution block.'};
 if (data.enabled !== true || !['waiting','checking','pending_buy','pending_sell','holding'].includes(data.status)) return {status:'waiting',label:'Waiting',reason:safeText(data.reason)||'Waiting for a confirmed running state from the server.'};
 return {status:'running',label:data.status==='holding'?'Paper · holding':data.status.startsWith('pending_')?'Paper · pending fill':'Paper · monitoring',reason:safeText(data.reason)||'Monitoring the fixed experimental rule; no new fill reported.'};
}

