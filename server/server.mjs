import http from 'node:http';
import { mkdirSync,chmodSync } from 'node:fs';
import { resolve,join } from 'node:path';
import webpush from 'web-push';
import { authorized,subscription } from './security.mjs';
import { Store } from './store.mjs';
process.umask(0o077);
const origin=new URL(process.env.SCL_APP_ORIGIN||'').origin;
if(!origin.startsWith('https://'))throw Error('HTTPS app origin required');
const token=process.env.SCL_PAIRING_TOKEN||'';
if(token.length<32)throw Error('Set a random private pairing token of at least 32 characters');
const publicKey=process.env.SCL_VAPID_PUBLIC_KEY,privateKey=process.env.SCL_VAPID_PRIVATE_KEY,subject=process.env.SCL_VAPID_SUBJECT;
webpush.setVapidDetails(subject,publicKey,privateKey);
const data=resolve(process.env.SCL_DATA_DIR||'./private-data');mkdirSync(data,{recursive:true,mode:0o700});chmodSync(data,0o700);
const store=new Store(join(data,'notifications.sqlite'));let lastTest=0;
const server=http.createServer(async(req,res)=>{
 const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 if(req.headers.origin!==origin)return reply(403,{error:'Origin rejected'});
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');return reply(204,null);}
 if(!authorized(req.headers.authorization,token))return reply(401,{error:'Pairing required'});
 const path=new URL(req.url,'http://localhost').pathname;
 try{
  if(req.method==='GET'&&path==='/config')return reply(200,{publicKey,qualification:'NOT_CONNECTED',devices:store.devices().length});
  if(!['POST','DELETE'].includes(req.method))return reply(405,{error:'Unsupported request'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{error:'JSON required'});
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192){reply(413,{error:'Request too large'});req.destroy();return;}}
  const body=JSON.parse(raw||'{}');
  if(path==='/subscriptions'&&req.method==='POST')return reply(200,{id:store.save(subscription(body)),qualification:'NOT_CONNECTED'});
  if(path==='/subscriptions'&&req.method==='DELETE'){if(!/^[a-f0-9]{64}$/.test(body.id||''))throw Error();store.remove(body.id);return reply(200,{removed:true});}
  if(path==='/test'&&req.method==='POST'){
   if(Date.now()-lastTest<60000)return reply(429,{error:'Wait one minute between tests'});
   const d=store.devices().find(d=>d.id===body.id);if(!d)return reply(404,{error:'Device not found'});lastTest=Date.now();
   try{await webpush.sendNotification(d.subscription,JSON.stringify({type:'test',observedAt:Date.now(),expiresAt:Date.now()+120000,eventId:'test'}),{TTL:120,timeout:10000,urgency:'normal'});return reply(200,{status:'Accepted by push service; check your phone'});}
   catch(e){if([404,410].includes(e.statusCode))store.remove(d.id);return reply(502,{error:'Delivery unconfirmed; subscription may need renewal'});}
  }
  return reply(404,{error:'Not found'});
 }catch{return reply(400,{error:'Invalid request'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1',()=>console.log('READY_PORT='+server.address().port+' QUALIFIER_NOT_CONNECTED'));
