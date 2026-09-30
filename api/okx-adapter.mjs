import crypto from 'node:crypto';
import { normaliseStagedOrder, executionStatus } from './exchange-adapter.mjs';

const AU_BASE='https://us.okx.com';
const DEMO_HEADER='x-simulated-trading';

function cfg(env=process.env){
  return {
    base:String(env.SCL_OKX_BASE_URL||AU_BASE).replace(/\/$/,''),
    key:env.SCL_EXCHANGE_API_KEY||'', secret:env.SCL_EXCHANGE_API_SECRET||'',
    passphrase:env.SCL_EXCHANGE_API_PASSPHRASE||'',
    demo:env.SCL_OKX_DEMO!=='false',
    enabled:env.SCL_EXECUTION_ENABLED==='true',
    maxOrderAud:Number(env.SCL_MAX_ORDER_AUD||0)
  };
}
function signature(secret,timestamp,method,path,body=''){
  return crypto.createHmac('sha256',secret).update(timestamp+method.toUpperCase()+path+body).digest('base64');
}
export function okxStatus(env=process.env){
  const c=cfg(env),base=executionStatus(env);
  return {...base,provider:'OKX',region:'AU',baseUrl:c.base,demo:c.demo,credentialsPresent:Boolean(c.key&&c.secret&&c.passphrase),liveSubmissionEnabled:false};
}
export async function okxPrivateRequest(path,{method='GET',body=null,env=process.env}={}){
  const c=cfg(env);
  if(!c.key||!c.secret||!c.passphrase) throw new Error('OKX_CREDENTIALS_NOT_CONFIGURED');
  const timestamp=new Date().toISOString(),payload=body?JSON.stringify(body):'';
  const headers={'Content-Type':'application/json','OK-ACCESS-KEY':c.key,'OK-ACCESS-PASSPHRASE':c.passphrase,'OK-ACCESS-TIMESTAMP':timestamp,'OK-ACCESS-SIGN':signature(c.secret,timestamp,method,path,payload)};
  if(c.demo)headers[DEMO_HEADER]='1';
  const res=await fetch(c.base+path,{method,headers,body:payload||undefined});
  const json=await res.json().catch(()=>({}));
  if(!res.ok||String(json.code||'0')!=='0')throw new Error('OKX_API_'+(json.code||res.status)+': '+(json.msg||res.statusText));
  return json;
}
export async function getOkxBalance(env=process.env){return okxPrivateRequest('/api/v5/account/balance',{env});}
export async function getOkxPendingOrders(instType,env=process.env){
  const q=instType?'?instType='+encodeURIComponent(instType):'';
  return okxPrivateRequest('/api/v5/trade/orders-pending'+q,{env});
}
export function buildOkxOrder(staged,{instrumentType='SPOT',size,orderType='limit'}={}){
  const s=normaliseStagedOrder(staged);
  if(!(Number(size)>0))throw new Error('OKX_SIZE_REQUIRED');
  const swap=instrumentType==='SWAP';
  const instId=s.pair.replace('/','-')+(swap?'-SWAP':'');
  return {staged:s,request:{instId,tdMode:swap?'isolated':'cash',side:s.side==='LONG'?'buy':'sell',ordType:orderType,px:String(s.entry),sz:String(size)}};
}
export async function submitOkxApprovedOrder() {
  throw new Error('LIVE_EXECUTION_DISABLED_USE_DEMO_SERVICE');
}
