/** Public market reference only. Never receives holdings, accounts, draft amounts or credentials. */
export const MARKET_SOURCE='https://us.okx.com/api/v5/market/candles';
export const MARKET_DOCUMENTATION='https://app.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks';
export const BINANCE_SOURCE='https://data-api.binance.vision/api/v3/klines';
export const BINANCE_DOCUMENTATION='https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data';
const DAY=86400000;
export function parseMarketCandles(payload,{now=Date.now()}={}){
 if(payload?.code!=='0'||!Array.isArray(payload.data))throw Error('The selected pair is unavailable from the public market feed.');
 const seen=new Set(),candles=[];
 for(const row of payload.data){
  if(!Array.isArray(row)||row.length<9||row[8]!=='1')continue;
  const [time,open,high,low,close]=row.slice(0,5).map(Number);
  if(!Number.isFinite(time)||time<=0||time>now||time%DAY!==0||seen.has(time)||![open,high,low,close].every(n=>Number.isFinite(n)&&n>0)||high<Math.max(open,close)||low>Math.min(open,close)||high<low)continue;
  if(time+DAY>now)continue;
  seen.add(time);candles.push({time,closeAt:time+DAY,open,high,low,close});
 }
 candles.sort((a,b)=>a.time-b.time);
 if(!candles.length)throw Error('No completed daily prices were returned for this pair.');
 return {candles:candles.slice(-90),latest:candles.at(-1),retrievedAt:now,stale:now-candles.at(-1).closeAt>2*DAY};
}
/** Binance closeTime is inclusive; only complete UTC-day rows become observations. */
export function parseBinanceCandles(payload,{now=Date.now()}={}){
 if(!Array.isArray(payload))throw Error('The selected pair is unavailable from Binance public market data.');
 const complete=payload.filter(row=>Array.isArray(row)&&row.length>=7&&Number.isFinite(Number(row[0]))&&Number(row[6])+1===Number(row[0])+DAY&&Number(row[6])<now)
  .map(row=>[String(row[0]),...row.slice(1,5),'','','','1']);
 return parseMarketCandles({code:'0',data:complete},{now});
}
export async function readMarketReference({baseAsset,quoteCurrency,signal,fetcher=fetch,now=Date.now()}={}){
 if(!/^[A-Z0-9]{2,15}$/.test(baseAsset||'')||!['USDT','USD','USDC','AUD'].includes(quoteCurrency))throw Error('Choose a coin and quote currency first.');
 // Binance's official data-only host exposes public CORS-enabled spot prices.
 // This changes the reference venue, never the user's planned execution venue or currency.
 const binance=['USDT','USDC'].includes(quoteCurrency),source=binance?BINANCE_SOURCE:MARKET_SOURCE,url=new URL(source);
 if(binance){url.searchParams.set('symbol',baseAsset+quoteCurrency);url.searchParams.set('interval','1d');url.searchParams.set('limit','100');}
 else{url.searchParams.set('instId',baseAsset+'-'+quoteCurrency);url.searchParams.set('bar','1Dutc');url.searchParams.set('limit','100');}
 const response=await fetcher(url.href,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});
 if(!response.ok)throw Error('The public market feed is unavailable. Your draft is unchanged.');
 const payload=await response.json(),result=(binance?parseBinanceCandles:parseMarketCandles)(payload,{now});
 return {...result,pair:baseAsset+'/'+quoteCurrency,venue:binance?'Binance':'OKX',source,documentation:binance?BINANCE_DOCUMENTATION:MARKET_DOCUMENTATION};
}
