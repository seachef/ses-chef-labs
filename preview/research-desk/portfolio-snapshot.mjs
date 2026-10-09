import {readNativePaper} from './native-paper.mjs?v=neptune-native-20261009';
// Account freshness is independent of a broad-market screening result.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fresh=(at,now)=>typeof at==='string'&&Number.isFinite(Date.parse(at))&&now-Date.parse(at)>=0&&now-Date.parse(at)<=90000;
export function readPortfolioSnapshot(report,connected=true,now=Date.now()){
 const a=report?.account,heartbeat=connected&&fresh(report?.heartbeat_at,now),cashCurrent=heartbeat&&report?.currency==='AUD'&&a?.initial_cash===10000&&finite(a.cash)&&a.cash>=0;
 const markedPositions=Array.isArray(report?.positions)&&report.positions.every(p=>finite(p.qty)&&p.qty>0&&finite(p.last_bid)&&p.last_bid>0&&fresh(p.quote_at,now));
 const flat=Array.isArray(report?.positions)&&report.positions.length===0,native=readNativePaper(report,now),nativeReady=native.valuationComplete&&Number.isFinite(native.markedTotal)&&!(a?.valuation_scope==='combined_native_v1'&&native.state==='absent');
 const legacyMark=flat?0:native.state==='absent'?null:native.legacyMark,combinedReconciled=native.state==='absent'?(!flat||Math.abs(a?.equity-a?.cash)<=1e-6):Number.isFinite(legacyMark)&&Math.abs(a?.equity-a?.cash-legacyMark-native.markedTotal)<=1e-6;
 const valuationCurrent=cashCurrent&&fresh(a.valuation_at,now)&&finite(a.equity)&&a.equity>=a.cash&&a.unsettled_usd===0&&markedPositions&&nativeReady&&combinedReconciled;
 return {cash:cashCurrent?a.cash:null,equity:valuationCurrent?a.equity:null,exposure:valuationCurrent?a.equity-a.cash:null,cashCurrent:!!cashCurrent,valuationCurrent:!!valuationCurrent};
}
