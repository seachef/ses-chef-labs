/** Public market reference only. Never receives holdings, accounts, draft amounts or credentials. */
export const MARKET_SOURCE='https://us.okx.com/api/v5/market/candles';
export const MARKET_DOCUMENTATION='https://app.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks';
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
export async function readMarketReference({baseAsset,quoteCurrency,signal,fetcher=fetch,now=Date.now()}={}){
 if(!/^[A-Z0-9]{2,15}$/.test(baseAsset||'')||!['USDT','USD','USDC','AUD'].includes(quoteCurrency))throw Error('Choose a coin and quote currency first.');
 const url=new URL(MARKET_SOURCE);url.searchParams.set('instId',baseAsset+'-'+quoteCurrency);url.searchParams.set('bar','1Dutc');url.searchParams.set('limit','100');
 const response=await fetcher(url.href,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});
 if(!response.ok)throw Error('The public market feed is unavailable. Your draft is unchanged.');
 const result=parseMarketCandles(await response.json(),{now});return {...result,pair:baseAsset+'/'+quoteCurrency,source:MARKET_SOURCE};
}
