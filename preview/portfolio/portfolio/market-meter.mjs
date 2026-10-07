import {computeMarketCondition} from './market-condition.mjs?v=20261007.meter1';
import {MARKET_UNIVERSE} from './market-universe.mjs?v=20261007.meter1';
const API='https://data-api.binance.vision/api/v3/';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
const number=value=>new Intl.NumberFormat('en-AU',{maximumFractionDigits:4}).format(value);
const sign=value=>value>0?'above':value<0?'below':'equal to';
const unknown=reason=>({condition:'unknown',conditionLabel:'Unknown',reason});
export function checkedMarketPayload(raw){
 if(!raw||raw.schema_version!==1||!Array.isArray(raw.btcDailyBars)||raw.btcDailyBars.length>205||!Array.isArray(raw.breadthTickers)||raw.breadthTickers.length!==MARKET_UNIVERSE.symbols.length||!raw.universe||raw.universe.mode!=='fixed_basket'||raw.universe.id!==MARKET_UNIVERSE.id||raw.universe.selectedAt!==MARKET_UNIVERSE.selectedAt||JSON.stringify(raw.universe.symbols)!==JSON.stringify(MARKET_UNIVERSE.symbols))throw Error('Invalid fixed-basket market data');
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 if(!exact(raw,['schema_version','observed_at','universe','btcDailyBars','breadthTickers'])||!exact(raw.universe,['id','selectedAt','symbols','mode'])||typeof raw.observed_at!=='string'||!Number.isFinite(Date.parse(raw.observed_at)))throw Error('Invalid market envelope');
 const decimal=x=>typeof x==='string'&&x.length<=64&&x.trim()===x&&/^-?\d+(?:\.\d+)?$/.test(x);
 if(raw.breadthTickers.some(row=>!exact(row,['symbol','priceChange','lastPrice','openTime','closeTime'])||!decimal(row.priceChange)||!decimal(row.lastPrice)))throw Error('Invalid market ticker');
 if(raw.btcDailyBars.some(row=>!Array.isArray(row)||row.length!==12||row.some((value,i)=>[0,6,8].includes(i)?!Number.isSafeInteger(value):!decimal(value))))throw Error('Invalid daily prices');
 return raw;
}
async function readJSON(fetchImpl,url,signal,maxBytes=262144){
 const response=await fetchImpl(url,{credentials:'omit',cache:'no-store',redirect:'error',signal});
 if(!response.ok||Number(response.headers?.get('content-length')||0)>maxBytes)throw Error('Public market feed unavailable');
 const text=await response.text();if(new TextEncoder().encode(text).length>maxBytes)throw Error('Public market response too large');return JSON.parse(text);
}
export async function fetchPublicMarket({fetchImpl=globalThis.fetch?.bind(globalThis),nowMs=Date.now(),signal}={}){
 const barsURL=new URL(API+'klines');for(const [key,value]of Object.entries({symbol:'BTCUSDT',interval:'1d',limit:200,timeZone:0,endTime:Math.floor(nowMs/86400000)*86400000-1}))barsURL.searchParams.set(key,String(value));
 const tickersURL=new URL(API+'ticker/24hr');tickersURL.searchParams.set('symbols',JSON.stringify(MARKET_UNIVERSE.symbols));tickersURL.searchParams.set('type','FULL');
 const [btcDailyBars,breadthTickers]=await Promise.all([readJSON(fetchImpl,barsURL,signal),readJSON(fetchImpl,tickersURL,signal)]);
 return checkedMarketPayload({schema_version:1,observed_at:new Date(nowMs).toISOString(),universe:MARKET_UNIVERSE,btcDailyBars,breadthTickers:Array.isArray(breadthTickers)?breadthTickers.map(row=>Object.fromEntries(['symbol','priceChange','lastPrice','openTime','closeTime'].map(key=>[key,row[key]]))):breadthTickers});
}
export function meterDetails(result,message=''){
 const valid=result.condition!=='unknown';
 return `<p>${valid?'This describes recent market conditions. It does not predict the next move.':'A fresh, complete market reading is unavailable.'}</p>${message?`<p class="meter-note">${esc(message)}</p>`:''}${valid?`<ul><li>Bitcoin’s last completed daily close was <strong>${sign(result.sma50Signal)}</strong> its 50-day average.</li><li>The same close was <strong>${sign(result.sma200Signal)}</strong> its 200-day average.</li><li><strong>${result.breadth.advancing} of ${result.breadth.expected}</strong> coins in the fixed Binance sample rose over their last 24 hours.</li></ul><dl><dt>BTC daily close</dt><dd>${number(result.btc.close)} USDT</dd><dt>50-day average</dt><dd>${number(result.btc.sma50)} USDT</dd><dt>200-day average</dt><dd>${number(result.btc.sma200)} USDT</dd><dt>Daily close date</dt><dd>${esc(result.btc.closedCandleDate)} UTC</dd><dt>Breadth checked</dt><dd>${esc(when(result.asOf))}</dd><dt>Reading expires</dt><dd>${esc(when(result.expiresAt))}</dd></dl>`:`<p>${esc(result.reason||'Check the public feeds again.')}</p>`}<details><summary>Method &amp; sources</summary><p>Each Bitcoin check adds +1 above its average, 0 when equal, or −1 below. Breadth adds +1 when at least 60% rise, −1 when 40% or fewer rise, otherwise 0. A total of +2 or +3 is Bull; −2 or −3 is Bear; anything else is Neutral.</p><p>This is a simple, unvalidated rule. It uses a fixed 115-asset Binance screen selected on 7 October 2026, not every cryptoasset. Two of its three checks use Bitcoin. USDT is distinct from USD and AUD.</p><p>Public prices refresh on opening the app or tapping this meter, with a one-minute retry limit. No background polling or orders. Stale or incomplete data shows Unknown.</p><p><a href="https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints" target="_blank" rel="noopener noreferrer">Official Binance market-data documentation</a></p><p>Basket: ${esc(MARKET_UNIVERSE.id)}</p></details><p class="meter-note">The market meter never qualifies an individual coin for entry.</p>`;
}
export function createMarketMeter({button,dialog,content,fetchImpl=globalThis.fetch?.bind(globalThis),now=()=>Date.now(),timeoutMs=10000}={}){
 if(!button||!dialog||!content)throw Error('Market meter elements required');
 let payload=null,controller=null,seedController=null,disposed=false,timer=null,lastAttempt=-Infinity,message='';
 const calculate=()=>{try{return payload?computeMarketCondition({...payload,nowMs:now()}):unknown('No checked snapshot loaded.');}catch{return unknown('Market data could not be verified.');}};
 function render(){if(disposed)return;clearTimeout(timer);const result=calculate();button.dataset.marketCondition=result.condition;button.querySelector('[data-market-label]').textContent=result.conditionLabel;button.setAttribute('aria-label','Market conditions: '+result.conditionLabel+'. Open details');const opened=content.querySelector('details')?.open,scroll=dialog.scrollTop;content.innerHTML=meterDetails(result,message);if(opened)content.querySelector('details').open=true;dialog.scrollTop=scroll;if(result.expiresAt){timer=setTimeout(render,Math.max(1,Date.parse(result.expiresAt)-now()+1));timer?.unref?.();}return result;}
 async function refresh(){
  if(disposed||controller||now()-lastAttempt<60000)return;lastAttempt=now();controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),timeoutMs);button.setAttribute('aria-busy','true');
  try{const next=await fetchPublicMarket({fetchImpl,nowMs:now(),signal:active.signal});if(disposed||active.signal.aborted)return;const result=computeMarketCondition({...next,nowMs:now()});if(result.condition==='unknown')throw Error('Public inputs are incomplete or stale');payload=next;message='Fresh public snapshot loaded.';}catch{if(!disposed)message='A fresh check could not be completed. Any remaining reading uses the last checked snapshot and will expire.';}finally{clearTimeout(timeout);if(controller===active)controller=null;if(!disposed){button.removeAttribute('aria-busy');render();}}
 }
 async function start(){
  seedController=new AbortController();const activeSeed=seedController,timeout=setTimeout(()=>activeSeed.abort(),timeoutMs);
  try{const seed=checkedMarketPayload(await readJSON(fetchImpl,new URL('../data/market-conditions.json',import.meta.url),activeSeed.signal));if(!disposed&&!payload){payload=seed;message='Checked public snapshot.';render();}}catch{if(!disposed)render();}finally{clearTimeout(timeout);if(seedController===activeSeed)seedController=null;}if(!disposed)await refresh();
 }
 const click=()=>{render();if(!dialog.open)dialog.showModal();void refresh();};
 const close=()=>{if(dialog.open)dialog.close();button.focus();};
 const closeButton=dialog.querySelector('[data-close-meter]'),cancel=event=>{event.preventDefault();close();};button.addEventListener('click',click);closeButton.addEventListener('click',close);dialog.addEventListener('cancel',cancel);
 return {start,refresh,recheck:render,destroy(){disposed=true;controller?.abort();seedController?.abort();clearTimeout(timer);button.removeEventListener('click',click);closeButton.removeEventListener('click',close);dialog.removeEventListener('cancel',cancel);if(dialog.open)dialog.close();}};
}
const doc=globalThis.document,button=doc?.getElementById('marketMeter');
if(button){const make=()=>createMarketMeter({button,dialog:doc.getElementById('marketMeterDialog'),content:doc.getElementById('marketMeterContent')});let meter=make();void meter.start();globalThis.addEventListener?.('pagehide',()=>meter.destroy());globalThis.addEventListener?.('pageshow',event=>{if(event.persisted){meter=make();void meter.start();}});doc.addEventListener('visibilitychange',()=>{if(!doc.hidden){meter.recheck();void meter.refresh();}});}
