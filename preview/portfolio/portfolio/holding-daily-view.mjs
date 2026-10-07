import {createHoldingDayChangeSource,calculateHoldingDayChange,holdingDayChangeTarget,MAX_ENDPOINT_AGE_MS} from './holding-day-change.mjs?v=20261007.moves1';
import {verifiedFx,fxReferenceDate} from './model.mjs?v=20261007.moves1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
export function signedMove(value,currency){
 if(typeof value!=='string'||!/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))return '—';
 const negative=value.startsWith('-'),abs=value.replace(/^[-+]/,''),[whole,frac='']=abs.split('.'),n=BigInt(whole+frac),scale=10n**BigInt(frac.length),sign=n===0n?'':negative?'−':'+';
 const unit=currency==='AUD'?'A$':currency==='USD'?'US$':'';
 if(n!==0n&&n*100n<scale)return sign+'<'+unit+'0.01'+(currency==='percent'?'%':'');
 const cents=(n*100n*2n+scale)/(scale*2n),text=(cents/100n).toLocaleString('en-AU')+'.'+(cents%100n).toString().padStart(2,'0');
 return sign+unit+text+(currency==='percent'?'%':'');
}
export function signedMovePercent(exact){
 if(!exact||!/^[-]?\d+$/.test(exact.numerator)||!/^\d+$/.test(exact.denominator)||BigInt(exact.denominator)<=0n)return '—';
 const value=BigInt(exact.numerator),negative=value<0n,n=negative?-value:value,d=BigInt(exact.denominator),sign=n===0n?'':negative?'−':'+';
 if(n&&n*100n<d)return sign+'<0.01%';const cents=(n*100n*2n+d)/(d*2n);
 return sign+(cents/100n).toLocaleString('en-AU')+'.'+(cents%100n).toString().padStart(2,'0')+'%';
}
export function dailyMoveFx(snapshot,now=Date.now()){
 const rate=verifiedFx(snapshot),at=Date.parse(snapshot?.fx_observed_at),provenance=snapshot?.provenance?.valuation,reportedDate=provenance?.fx?.provider_observation_date,providerAt=Date.parse(provenance?.fx?.provider_as_of||provenance?.fx_provider_as_of),date=reportedDate!=null?fxReferenceDate(snapshot):Number.isFinite(providerAt)&&providerAt<=now?new Date(providerAt).toISOString().slice(0,10):null,dateAt=Date.parse(date+'T00:00:00Z');
 if(!rate||!date||!Number.isFinite(at)||at>now+60000||!Number.isFinite(dateAt)||dateAt>now||now-dateAt>7*86400000)return null;
 return {rate,date,source:snapshot.fx_source,verified:true};
}
const reasonText=reason=>({loading:'Checking daily move',rate_budget:'Daily move not checked · public limit',unreliable_asset:'Daily move unavailable · unreliable asset',stale_endpoint:'Daily move unavailable · old candles',missing_24h_baseline:'Daily move unavailable · missing prior-day candle',unsupported_network:'Daily move unavailable · network unsupported',unverified_pool:'Daily move unavailable · pool unverified',fx_unavailable:'Daily AUD move unavailable · FX needs refresh'}[reason]||'Daily move unavailable');
export function dailyMoveMarkup(holding,comparison,currency,snapshot,now=Date.now(),detail=false){
 const result=calculateHoldingDayChange({quantity:holding.quantity,comparison,currency,fx:dailyMoveFx(snapshot,now),nowMs:now});
 if(result.status!=='ready')return `<span class="holding-day is-unknown">${esc(reasonText(result.reason))}</span>`;
 const summary=`${signedMove(result.selectedCurrencyChange,currency)} (${signedMovePercent(result.percentExact)})`,timing=`24h market move ending ${when(result.endpointAt)}. Based on saved quantity; excludes trading/transfer activity, fees and FX movement.${result.fx?' AUD uses the '+result.fx.date+' reference rate.':''}${result.proxyNote?' '+result.proxyNote:''}`;
 const line=`<span class="holding-day is-${result.direction}" title="${esc(timing)}"><span class="sr-only">24 hour market move: </span>${esc(summary)}<small>24h market move · ${esc(result.endpointAt.slice(11,16))} UTC</small></span>`;
 if(!detail)return line;
 return `${line}<p class="fine-print">${esc(timing)}</p><p class="fine-print">Candle boundaries: ${esc(when(result.baselineAt))} to ${esc(when(result.endpointAt))}. Checked ${esc(when(result.retrievedAt))}. Pool prices are indicative, not guaranteed execution prices.</p><p class="fine-print"><a href="${esc(result.sourceUrl)}" target="_blank" rel="noopener noreferrer">GeckoTerminal public candles</a></p>`;
}
/** Public comparisons only; private quantities remain in the caller's render model. */
export function createHoldingDailyController({source=createHoldingDayChangeSource(),now=()=>Date.now(),onChange=()=>{}}={}){
 let context=null,generation=0,active=null,expiry=null,working=false,queue=[],records=new Map(),targets=new Map(),lastRefresh=-Infinity;const starts=[],publicCache=new Map();
 const keyOf=h=>`${h.chainId}:${String(h.assetId).toLowerCase()}`;
 function notify(){onChange();clearTimeout(expiry);const deadlines=[...records.values()].filter(x=>x.status==='ready').map(x=>Date.parse(x.endpointAt)+MAX_ENDPOINT_AGE_MS+1).filter(at=>at>now());if(deadlines.length){expiry=setTimeout(notify,Math.min(...deadlines)-now());expiry?.unref?.();}}
 async function pump(){if(working||!context||!active)return;working=true;const token=generation,controller=active;
  try{while(queue.length&&token===generation&&!controller.signal.aborted){const item=queue.shift();for(let i=starts.length-1;i>=0;i--)if(starts[i].until<=now())starts.splice(i,1);if(starts.length>=12){if(!['ready','stale'].includes(records.get(item.key)?.status))records.set(item.key,{status:'unavailable',reason:'rate_budget'});notify();continue;}const reservation={until:Infinity};starts.push(reservation);let result;try{result=await source.get(item.input,{signal:controller.signal});}finally{reservation.until=now()+60000;}if(token!==generation||controller.signal.aborted)return;records.set(item.key,result);publicCache.set(JSON.stringify(item.input),{result,at:now()});while(publicCache.size>64)publicCache.delete(publicCache.keys().next().value);notify();}}
  finally{if(token===generation)working=false;}
 }
 function clear(){generation++;active?.abort();active=null;clearTimeout(expiry);context=null;records.clear();targets.clear();queue=[];working=false;lastRefresh=-Infinity;}
 function setScope(next,holdings){if(context!==next){clear();context=next;if(context)active=new AbortController();}if(!context)return;
  for(const h of holdings){const key=keyOf(h);if(records.has(key))continue;let input;try{if(h.unreliable)throw Error('unreliable_asset');input={chainId:h.chainId,assetId:h.assetId,poolAddress:h.pricePairAddress??undefined};holdingDayChangeTarget(input);}catch(error){records.set(key,{status:'unavailable',reason:error.code||error.message});continue;}targets.set(key,{key,input});const cached=publicCache.get(JSON.stringify(input));if(cached&&now()>=cached.at&&now()-cached.at<60000){records.set(key,cached.result);continue;}records.set(key,{status:'unavailable',reason:'loading'});queue.push({key,input});}
  lastRefresh=now();notify();void pump();
 }
 function refresh(){if(!context||working||now()-lastRefresh<60000)return;lastRefresh=now();active=new AbortController();queue=[...targets.values()];void pump();}
 function pause(){generation++;active?.abort();active=null;queue=[];working=false;for(const [key,value]of records)if(value.reason==='loading')records.set(key,{status:'unavailable',reason:'comparison_unavailable'});lastRefresh=-Infinity;}
 return {setScope,clear,refresh,pause,recheck:notify,comparison:h=>records.get(keyOf(h))||{status:'unavailable',reason:'loading'}};
}
