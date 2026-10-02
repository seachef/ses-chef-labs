import { formatUnits, multiplyDecimals, rawUnits } from './domain.mjs';
export const COINS = Object.freeze([
  {symbol:'DRAGONX',name:'DragonX',icon:'dragonx.png',assetId:'0x96a5399d07896f757bd4c6ef56461f58db951862',decimals:18},
  {symbol:'SHOGUN',name:'SHOGUN',icon:'shogun.png',assetId:'0xfd4cb1294df23920e683e046963117cae6c807d9',decimals:18},
  {symbol:'HEX',name:'HEX',icon:'hex.png',assetId:'0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',decimals:8},
  {symbol:'HDRN',name:'Hedron',icon:'hdrn.png',assetId:'0x3819f64f282bf135d62168c1e513280daf905e06',decimals:9},
  {symbol:'ICSA',name:'Icosa',icon:'icsa.png',assetId:'0xfc4913214444af5c715cc9f7b52655e788a569ed',decimals:9}
]);
export const SOCIALS=Object.freeze([
  {id:'x',name:'X',url:'https://x.com/'},
  {id:'facebook',name:'Facebook',url:'https://www.facebook.com/'},
  {id:'instagram',name:'Instagram',url:'https://www.instagram.com/'},
  {id:'youtube',name:'YouTube',url:'https://www.youtube.com/'},
  {id:'tiktok',name:'TikTok',url:'https://www.tiktok.com/'},
  {id:'telegram',name:'Telegram',url:'https://web.telegram.org/'},
  {id:'chatgpt',name:'ChatGPT',url:'https://chatgpt.com/'},
  {id:'github',name:'GitHub',url:'https://github.com/seachef/ses-chef-labs'},
  {id:'westpac',name:'Westpac',url:'https://www.westpac.com.au/'},
  {id:'coinspot',name:'CoinSpot',url:'https://www.coinspot.com.au/'},
  {id:'bigpond',name:'Bigpond',url:'https://email.telstra.com/'},
  {id:'gmail',name:'Gmail',url:'https://mail.google.com/'},
  {id:'whatsapp',name:'WhatsApp',url:'https://web.whatsapp.com/'}
]);
export const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export function socialURL(id,value){const safe=safeURL(value);if(!safe)return null;const host=new URL(safe).hostname;const allow={x:['x.com','www.x.com'],facebook:['facebook.com','www.facebook.com'],instagram:['instagram.com','www.instagram.com'],youtube:['youtube.com','www.youtube.com'],tiktok:['tiktok.com','www.tiktok.com'],telegram:['web.telegram.org','t.me','telegram.me'],chatgpt:['chatgpt.com'],github:['github.com'],westpac:['www.westpac.com.au','westpac.com.au','banking.westpac.com.au'],coinspot:['www.coinspot.com.au','coinspot.com.au'],bigpond:['email.telstra.com'],gmail:['mail.google.com'],whatsapp:['web.whatsapp.com']};return allow[id]?.includes(host)?safe:null;}
export function decimalSum(values){
  const parts=values.map(value=>{if(typeof value!=='string'||!/^\d+(\.\d+)?$/.test(value))throw Error('Invalid decimal');const [a,b='']=value.split('.');return {n:BigInt(a+b),scale:b.length};});
  const scale=Math.max(0,...parts.map(x=>x.scale));const n=parts.reduce((sum,x)=>sum+x.n*10n**BigInt(scale-x.scale),0n).toString().padStart(scale+1,'0');
  return scale?`${n.slice(0,-scale)}.${n.slice(-scale)}`.replace(/\.?0+$/,'')||'0':n;
}
export function displayDecimal(value,digits=6){
  if(value==null)return '—';if(!/^\d+(\.\d+)?$/.test(String(value)))return '—';
  const [whole,fraction='']=String(value).split('.');const base=BigInt(whole).toLocaleString('en-AU');
  const clipped=fraction.slice(0,digits).replace(/0+$/,'');
  if(whole==='0'&&fraction&&!clipped&&/[1-9]/.test(fraction))return '<0.'+'0'.repeat(digits-1)+'1';
  return base+(clipped?'.'+clipped:'');
}
export function aud(value){if(value==null||!/^\d+(\.\d+)?$/.test(String(value)))return '—';const [whole,fraction='']=String(value).split('.');const cents=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2))+(Number(fraction[2]||0)>=5?1n:0n);return 'A$'+(cents/100n).toLocaleString('en-AU')+'.'+(cents%100n).toString().padStart(2,'0');}
export function verifiedFx(snapshot){return snapshot?.usd_to_aud!=null&&Number(snapshot.usd_to_aud)>0&&Number.isFinite(Date.parse(snapshot.fx_observed_at))&&!!snapshot.fx_source?snapshot.usd_to_aud:null;}
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
export function valuationContext(snapshot){
  const v=snapshot?.provenance?.valuation||{},carried=v.basis==='carried_forward_balances'||v.balances_refreshed===false;
  const balanceStart=validTime(v.balance_as_of_start)||(carried?null:validTime(snapshot?.observed_at));
  const balanceEnd=validTime(v.balance_as_of_end)||(carried?balanceStart:validTime(snapshot?.read_window_end)||balanceStart);
  return {carried,balanceStart,balanceEnd,valuedAt:validTime(v.valued_at),fxAt:verifiedFx(snapshot)?validTime(snapshot.fx_observed_at):null,fxSource:snapshot?.fx_source||null};
}
export function groupHoldings(model){
  if(!model?.snapshot)return [];const groups=new Map();
  const get=row=>{const key=`${row.chain_id}:${String(row.asset_id).toLowerCase()}`;if(!groups.has(key))groups.set(key,{key,assetId:row.asset_id,chainId:row.chain_id,symbol:row.symbol,decimals:row.decimals,liquidRaw:0n,stakedRaw:0n,quotes:[],unreliable:false});const g=groups.get(key);if(g.decimals!==row.decimals)throw Error('Inconsistent token decimals');return g;};
  for(const row of model.balances||[]){const g=get(row);g.liquidRaw+=BigInt(rawUnits(row.balance_raw));if(row.price_status==='unreliable')g.unreliable=true;if(row.price_status==='observed'&&row.price_usd!=null&&Number.isFinite(Date.parse(row.price_observed_at))&&row.price_source&&row.provenance?.quote?.held_valuation_eligible!==false)g.quotes.push(row);}
  for(const row of model.stakes||[]){if(row.status==='unlocked')continue;get(row).stakedRaw+=BigInt(rawUnits(row.principal_raw));}
  const fx=verifiedFx(model.snapshot);
  return [...groups.values()].map(g=>{const quote=g.quotes.sort((a,b)=>Date.parse(b.price_observed_at)-Date.parse(a.price_observed_at))[0];const liquid=formatUnits(g.liquidRaw.toString(),g.decimals),staked=formatUnits(g.stakedRaw.toString(),g.decimals),quantity=decimalSum([liquid,staked]);const usd=quote?multiplyDecimals(quantity,quote.price_usd):null;return {...g,liquidRaw:undefined,stakedRaw:undefined,quotes:undefined,liquid,staked,quantity,usd,aud:usd!=null&&fx?multiplyDecimals(usd,fx):null,unitPriceUsd:quote?.price_usd??null,priceAt:quote?.price_observed_at||null,priceSource:quote?.price_source||null,quote:quote?.provenance?.quote||null};}).sort((a,b)=>{const order=s=>{const i=COINS.findIndex(c=>c.symbol===s);return i<0?99:i;};return order(a.symbol)-order(b.symbol)||a.key.localeCompare(b.key);});
}
export function portfolioTotal(model){const s=model?.snapshot;if(!s||valuationContext(s).carried||s.status!=='complete'||s.observed_wallets!==s.expected_wallets||s.unpriced_assets!==0||!verifiedFx(s))return null;return s.held_value_aud??null;}
export function pricedHoldingsSummary(holdings){
  const priced=holdings.filter(h=>h.aud!=null),held=holdings.filter(h=>h.quantity!=='0');
  return {value:priced.length?decimalSum(priced.map(h=>h.aud)):null,pricedAssets:held.filter(h=>h.aud!=null).length,unpricedAssets:held.filter(h=>h.aud==null).length};
}
export function historyPoints(history,days,now=Date.now()){
  const cutoff=now-days*86400000;return (history||[]).filter(s=>Number.isFinite(Date.parse(s.observed_at))&&Date.parse(s.observed_at)>=cutoff&&Date.parse(s.observed_at)<=now+60000).sort((a,b)=>Date.parse(a.observed_at)-Date.parse(b.observed_at)).map(s=>({at:s.observed_at,value:!valuationContext(s).carried&&s.status==='complete'&&verifiedFx(s)&&s.observed_wallets===s.expected_wallets&&s.unpriced_assets===0?s.held_value_aud??null:null,status:s.status}));
}

export function coinMetadata(holding){return COINS.find(c=>holding.chainId===1&&c.assetId===String(holding.assetId).toLowerCase()&&c.decimals===holding.decimals)||null;}
export function partitionHoldings(holdings){
  const main=[],staking=[];
  for(const holding of holdings)(['HEX','HDRN','ICSA'].includes(coinMetadata(holding)?.symbol)?staking:main).push(holding);
  return {main,staking};
}
export function snapshotFreshness(snapshot,now=Date.now()) { const at=Date.parse(valuationContext(snapshot).balanceStart); if(!Number.isFinite(at)||at>now+60000)return 'unverified-time';return now-at>36*3600000?'stale':'dated'; }

// Display rounding only. Raw decimal strings remain unchanged in the read model.
function roundedDisplay(value,digits){
  const [whole,fraction='']=value.split('.'),scale=10n**BigInt(digits);
  const n=BigInt(whole)*scale+BigInt((fraction+'0'.repeat(digits)).slice(0,digits)||'0')+(Number(fraction[digits]||0)>=5?1n:0n);
  if(!digits)return n.toString();const raw=n.toString().padStart(digits+1,'0');return `${raw.slice(0,-digits)}.${raw.slice(-digits)}`.replace(/\.?0+$/,'')||'0';
}
export function compactQuantity(value){
  if(value==null||!/^\d+(\.\d+)?$/.test(String(value)))return '—';
  const [rawWhole,fraction='']=String(value).split('.'),whole=BigInt(rawWhole).toString(),normal=whole+(fraction?'.'+fraction:'');
  const tiers=[[12,'T'],[9,'B'],[6,'M'],[3,'K']];
  if(whole.length>=4){let index=tiers.findIndex(([power])=>whole.length>power);const scaled=power=>{const at=whole.length-power;return whole.slice(0,at)+'.'+whole.slice(at)+fraction;};let rounded=roundedDisplay(scaled(tiers[index][0]),2);if(index>0&&BigInt(rounded.split('.')[0])>=1000n){index--;rounded=roundedDisplay(scaled(tiers[index][0]),2);}return displayDecimal(rounded,2)+tiers[index][1];}
  if(whole!=='0')return displayDecimal(roundedDisplay(normal,2),2);
  const first=fraction.search(/[1-9]/);if(first<0)return '0';
  if(first>=6){let coefficient=BigInt(fraction.slice(first,first+3).padEnd(3,'0'))+(Number(fraction[first+3]||0)>=5?1n:0n),exponent=first+1;if(coefficient===1000n){coefficient=100n;exponent--;}const digits=coefficient.toString().padStart(3,'0'),mantissa=(digits[0]+'.'+digits.slice(1)).replace(/\.?0+$/,'');return mantissa+'e-'+exponent;}
  return roundedDisplay(normal,first+4);
}
export function priceUsd(value){if(value==null||!/^\d+(\.\d+)?$/.test(String(value)))return 'Unavailable';return BigInt(String(value).split('.')[0])>0n?aud(value).replace('A$','US$'):'US$'+compactQuantity(value);}
