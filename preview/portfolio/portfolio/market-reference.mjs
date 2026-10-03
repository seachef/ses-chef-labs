/** Public market reference only. Never receives holdings, accounts, draft amounts or credentials. */
export const MARKET_SOURCE='https://us.okx.com/api/v5/market/candles';
export const MARKET_DOCUMENTATION='https://app.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks';
export const BINANCE_SOURCE='https://data-api.binance.vision/api/v3/klines';
export const BINANCE_DOCUMENTATION='https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data';
export const MARKET_INTERVALS=Object.freeze({'1h':3600000,'4h':14400000,'1d':86400000});
export const MAX_MARKET_BARS=300;
function numeric(value){
 if(typeof value==='number')return value;
 if(typeof value!=='string'||!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))return NaN;
 const number=Number(value);
 // A nonzero reported quantity must not underflow into an invented zero-volume bar.
 return number===0&&/[1-9]/.test(value.trim().split(/e/i)[0])?NaN:number;
}
function settings({now=Date.now(),interval='1d',limit=90,includeForming=false}={}){
 if(typeof interval!=='string'||!Object.hasOwn(MARKET_INTERVALS,interval))throw Error('Choose a supported candle interval: 1h, 4h or 1d.');
 if(!Number.isInteger(limit)||limit<1||limit>MAX_MARKET_BARS)throw Error('Choose between 1 and 300 market bars.');
 if(!Number.isSafeInteger(now)||now<=0)throw Error('The market reference time is invalid.');
 if(typeof includeForming!=='boolean')throw Error('The forming-candle option must be true or false.');
 return {now,interval,limit,includeForming,candleDurationMs:MARKET_INTERVALS[interval]};
}
function candleValues(row,{now,candleDurationMs}){
 const [time,open,high,low,close,volume]=row.slice(0,6).map(numeric),closeAt=time+candleDurationMs;
 if(!Number.isSafeInteger(time)||time<=0||time>now||time%candleDurationMs!==0||!Number.isSafeInteger(closeAt)||![open,high,low,close].every(n=>Number.isFinite(n)&&n>0)||high<Math.max(open,close)||low>Math.min(open,close)||high<low||!Number.isFinite(volume)||volume<0)return null;
 const isComplete=closeAt<=now;
 return {time,closeAt,open,high,low,close,volume,isComplete,isForming:!isComplete};
}
function resultFor(candles,{now,interval,limit,includeForming,candleDurationMs}){
 candles.sort((a,b)=>a.time-b.time);
 const result=candles.slice(-limit),latest=result.at(-1);
 if(!latest)throw Error(includeForming?'No valid market candles were returned for this pair.':interval==='1d'?'No completed daily prices were returned for this pair.':'No completed market candles were returned for this pair.');
 return {candles:result,latest,latestComplete:result.findLast(c=>c.isComplete)||null,interval,candleDurationMs,volumeUnit:'base',retrievedAt:now,stale:now-latest.closeAt>2*candleDurationMs};
}
/** Legacy OKX daily parser. Volume is the reported base-asset volume, not quote turnover. */
export function parseMarketCandles(payload,options={}){
 const config=settings(options);
 if(config.interval!=='1d')throw Error('This public reference supports daily candles only for USD and AUD. Choose USDT or USDC for intraday candles.');
 if(payload?.code!=='0'||!Array.isArray(payload.data))throw Error('The selected pair is unavailable from the public market feed.');
 const seen=new Set(),candles=[];
 for(const row of payload.data){
  if(!Array.isArray(row)||row.length<9||!['0','1'].includes(row[8]))continue;
  const candle=candleValues(row,config);
  if(!candle||seen.has(candle.time))continue;
  // A provider's provisional historical bar is never treated as a completed observation.
  if(candle.isComplete?row[8]!=='1':!config.includeForming||row[8]!=='0')continue;
  seen.add(candle.time);candles.push(candle);
 }
 return resultFor(candles,config);
}
/** Binance closeTime is inclusive; closeAt is the exclusive UTC interval boundary in milliseconds.
 * Completed candles remain the default. Opt in to the one currently forming bar explicitly.
 */
export function parseBinanceCandles(payload,options={}){
 const config=settings(options);
 if(!Array.isArray(payload))throw Error('The selected pair is unavailable from Binance public market data.');
 const seen=new Set(),candles=[];
 for(const row of payload){
  if(!Array.isArray(row)||row.length<7)continue;
  const candle=candleValues(row,config),closeTime=numeric(row[6]);
  if(!candle||!Number.isSafeInteger(closeTime)||closeTime!==candle.closeAt-1||seen.has(candle.time)||!candle.isComplete&&!config.includeForming)continue;
  // UTC-aligned opening times at or before now allow at most one forming bar.
  seen.add(candle.time);candles.push(candle);
 }
 return resultFor(candles,config);
}
/** One caller-triggered request; no polling, retries, pair substitution, or currency conversion.
 * Omit interval/includeForming/limit to preserve the legacy 90 completed daily observations.
 * Chart callers may request {interval:'1h'|'4h'|'1d',limit:300,includeForming:true}.
 */
export async function readMarketReference({baseAsset,quoteCurrency,interval='1d',limit,includeForming=false,signal,fetcher=fetch,now}={}){
 if(typeof baseAsset!=='string'||!/^[A-Z0-9]{2,15}$/.test(baseAsset)||!['USDT','USD','USDC','AUD'].includes(quoteCurrency))throw Error('Choose a coin and quote currency first.');
 if(baseAsset===quoteCurrency)throw Error('The selected pair is unsupported. Choose different base and quote currencies.');
 const options={interval,limit,includeForming,...(now===undefined?{}:{now})};
 settings(options);
 // Binance's official data-only host exposes public CORS-enabled spot prices.
 // This changes the reference venue, never the user's planned execution venue or currency.
 const binance=['USDT','USDC'].includes(quoteCurrency),source=binance?BINANCE_SOURCE:MARKET_SOURCE,url=new URL(source);
 if(!binance&&interval!=='1d')throw Error('This public reference supports daily candles only for USD and AUD. Choose USDT or USDC for intraday candles.');
 if(binance){url.searchParams.set('symbol',baseAsset+quoteCurrency);url.searchParams.set('interval',interval);url.searchParams.set('limit',String(limit??100));}
 else{url.searchParams.set('instId',baseAsset+'-'+quoteCurrency);url.searchParams.set('bar','1Dutc');url.searchParams.set('limit',String(limit??100));}
 const response=await fetcher(url.href,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});
 if(!response.ok)throw Error(response.status===400?'The selected pair is unavailable from the public market feed. Your draft is unchanged.':'The public market feed is unavailable. Your draft is unchanged.');
 const payload=await response.json(),result=(binance?parseBinanceCandles:parseMarketCandles)(payload,options);
 return {...result,pair:baseAsset+'/'+quoteCurrency,venue:binance?'Binance':'OKX',source,documentation:binance?BINANCE_DOCUMENTATION:MARKET_DOCUMENTATION};
}
