import crypto from 'node:crypto';

const allowedBases=new Set(['https://us.okx.com','https://openapi.okx.com','https://www.okx.com']);
export class DemoError extends Error { constructor(code){super(code);this.code=code;} }
export function demoConfig(env=process.env){
  const base=env.SCL_OKX_BASE_URL||'https://us.okx.com';
  if(!allowedBases.has(base))throw new DemoError('INVALID_OKX_HOST');
  if(env.SCL_OKX_DEMO!=='true'||env.SCL_EXECUTION_ENABLED==='true')throw new DemoError('DEMO_ONLY');
  const cap=Number(env.SCL_DEMO_MAX_ORDER_USDT||100),daily=Number(env.SCL_DEMO_MAX_DAILY_USDT||300);
  if(!Number.isFinite(cap)||!Number.isFinite(daily)||cap<=0||daily<cap)throw new DemoError('INVALID_ORDER_CAP');
  return {base,cap,daily,key:env.SCL_EXCHANGE_API_KEY,secret:env.SCL_EXCHANGE_API_SECRET,passphrase:env.SCL_EXCHANGE_API_PASSPHRASE};
}
export function createDemoClient(env=process.env,transport=fetch){
  const cfg=demoConfig(env);
  const configured=Boolean(cfg.key&&cfg.secret&&cfg.passphrase);
  async function request(path,{body,privateRequest=false}={}){
    const method=body?'POST':'GET',payload=body?JSON.stringify(body):'';
    const headers={'Content-Type':'application/json','x-simulated-trading':'1'};
    if(privateRequest){
      if(!configured)throw new DemoError('DEMO_KEY_REQUIRED');
      const stamp=new Date().toISOString();
      Object.assign(headers,{'OK-ACCESS-KEY':cfg.key,'OK-ACCESS-PASSPHRASE':cfg.passphrase,'OK-ACCESS-TIMESTAMP':stamp,'OK-ACCESS-SIGN':crypto.createHmac('sha256',cfg.secret).update(stamp+method+path+payload).digest('base64')});
    }
    let response,json;
    try{response=await transport(cfg.base+path,{method,headers,body:payload||undefined,signal:AbortSignal.timeout(7000)});json=await response.json();}catch{throw new DemoError(body?'ORDER_STATUS_UNKNOWN':'OKX_UNAVAILABLE');}
    if(!response.ok||String(json.code)!=='0')throw new DemoError('OKX_REJECTED');
    return json.data;
  }
  return {configured,cfg,request,
    balance:()=>request('/api/v5/account/balance',{privateRequest:true}),
    order:(instId,id)=>request('/api/v5/trade/order?instId='+encodeURIComponent(instId)+'&clOrdId='+encodeURIComponent(id),{privateRequest:true}),
    submit:body=>request('/api/v5/trade/order',{body,privateRequest:true}),
    cancel:(instId,clOrdId)=>request('/api/v5/trade/cancel-order',{body:{instId,clOrdId},privateRequest:true})};
}
// Fixed-point arithmetic keeps quantity and price on the exchange increments.
const SCALE=10n**18n;
function decimal(s){s=String(s);if(!/^\d+(?:\.\d{1,18})?$/.test(s))throw new DemoError('INVALID_DECIMAL');const [a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(18,'0'));}
function display(n){const a=n/SCALE,b=(n%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return a.toString()+(b?'.'+b:'');}
function step(n,increment){const d=decimal(increment);if(d<=0n)throw new DemoError('INVALID_INCREMENT');return n/d*d;}
export function makeDemoOrder(setup,amount,instrument,ticker,now=Date.now()){
  const at=Date.parse(setup?.publishedAt),entry=Number(setup?.entry),stop=Number(setup?.stop),targets=setup?.targets;
  if(setup?.verified!==true||setup.side!=='buy'||!/^https:\/\/t\.me\/(virtualbacon|vb_trade)\/\d+$/.test(setup.sourceUrl)||!Number.isFinite(at)||now-at>86400000||at-now>60000)throw new DemoError('SETUP_UNAVAILABLE');
  if(!/^[A-Z0-9]{2,15}\/USDT$/.test(setup.pair)||!(entry>0&&stop>0&&stop<entry)||!Array.isArray(targets)||!targets.length||targets.some(n=>!Number.isFinite(Number(n))||Number(n)<=entry))throw new DemoError('INVALID_SETUP');
  if(instrument.instId!==setup.pair.replace('/','-')||instrument.state!=='live'||instrument.instType!=='SPOT')throw new DemoError('INSTRUMENT_UNAVAILABLE');
  if(!Number.isFinite(Number(ticker.ts))||Math.abs(now-Number(ticker.ts))>60000||!(Number(ticker.last)>0)||Math.abs(Number(ticker.last)-entry)/entry>.02)throw new DemoError('ENTRY_MOVED');
  const budget=decimal(amount),px=step(decimal(setup.entry),instrument.tickSz),sl=step(decimal(setup.stop),instrument.tickSz),tp=step(decimal(targets[0]),instrument.tickSz);
  if(budget<=0n||px<=0n||sl<=0n||sl>=px||tp<=px)throw new DemoError('INVALID_ORDER');
  const sz=step(budget*SCALE/px,instrument.lotSz);
  if(sz<decimal(instrument.minSz)||sz<=0n)throw new DemoError('BELOW_MINIMUM');
  return {instId:instrument.instId,tdMode:'cash',side:'buy',ordType:'limit',px:display(px),sz:display(sz),attachAlgoOrds:[{slTriggerPx:display(sl),slOrdPx:'-1',slTriggerPxType:'last',tpTriggerPx:display(tp),tpOrdPx:'-1',tpTriggerPxType:'last'}]};
}
