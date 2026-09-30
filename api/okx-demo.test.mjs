import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDemoClient,demoConfig,makeDemoOrder,DemoError} from './okx-demo.mjs';
import {createDemoServer} from './okx-server.mjs';
const setup=()=>({verified:true,pair:'HBAR/USDT',side:'buy',entry:0.10283,stop:0.095,targets:[0.12],publishedAt:new Date().toISOString(),sourceUrl:'https://t.me/vb_trade/999'});
const instrument={instId:'HBAR-USDT',instType:'SPOT',state:'live',tickSz:'0.00001',lotSz:'1',minSz:'1'};
test('demo config rejects live mode and unapproved hosts',()=>{
  assert.throws(()=>demoConfig({SCL_OKX_DEMO:'false'}),/DEMO_ONLY/);
  assert.throws(()=>demoConfig({SCL_OKX_DEMO:'true',SCL_EXECUTION_ENABLED:'true'}),/DEMO_ONLY/);
  assert.throws(()=>demoConfig({SCL_OKX_DEMO:'true',SCL_OKX_BASE_URL:'https://attacker.test'}),/INVALID_OKX_HOST/);
});
test('signed requests always use demo header and nested rejections remain visible',async()=>{
  let observed;
  const client=createDemoClient({SCL_OKX_DEMO:'true',SCL_EXCHANGE_API_KEY:'demo',SCL_EXCHANGE_API_SECRET:'secret',SCL_EXCHANGE_API_PASSPHRASE:'pass'},async(url,options)=>{observed={url,options};return {ok:true,json:async()=>({code:'0',data:[{sCode:'51000'}]})};});
  const response=await client.submit({instId:'HBAR-USDT'});
  assert.equal(observed.options.headers['x-simulated-trading'],'1');assert(observed.options.headers['OK-ACCESS-SIGN']);assert.equal(response[0].sCode,'51000');
});
test('sizes round down; stale quotes and absent protective levels block preview',()=>{
  const order=makeDemoOrder(setup(),'100',instrument,{last:'0.10283',ts:Date.now()});assert.equal(order.sz,'972');assert.equal(order.attachAlgoOrds[0].slOrdPx,'-1');assert.equal(order.attachAlgoOrds[0].tpTriggerPx,'0.12');
  assert.throws(()=>makeDemoOrder(setup(),'100',instrument,{last:'0.10283',ts:Date.now()-120000}),/ENTRY_MOVED/);
  assert.throws(()=>makeDemoOrder({...setup(),stop:0},'100',instrument,{last:'0.10283',ts:Date.now()}),/INVALID_SETUP/);
  assert.throws(()=>makeDemoOrder(setup(),'0.01',instrument,{last:'0.10283',ts:Date.now()}),/BELOW_MINIMUM/);
});
async function fixture(t,{unknown=false,rejected=false}={}){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'scl-demo-'));let submits=0;
  const current=setup(),client={configured:true,cfg:{cap:100,daily:100},request:async p=>p.includes('instruments')?[instrument]:[{last:'0.10283',ts:Date.now()}],balance:async()=>[{details:[{ccy:'USDT',availBal:'1000'}]}],order:async()=>[],cancel:async()=>[{sCode:'0'}],submit:async()=>{submits++;if(unknown)throw new DemoError('ORDER_STATUS_UNKNOWN');return [{sCode:rejected?'51000':'0',ordId:'123'}];}};
  const journalPath=path.join(folder,'ledger.json'),server=createDemoServer({client,journalPath,readFeed:()=>({setups:[current]})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.close();fs.rmSync(folder,{recursive:true,force:true});});
  const post=async(route,body,origin=base)=>{const r=await fetch(base+'/api/okx/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
  return {post,server,current,journalPath,client,submits:()=>submits};
}
test('confirmation is explicit; simultaneous repeats submit once; caps stay enforced',async t=>{
  const f=await fixture(t);assert.equal((await f.post('preview',{pair:'HBAR/USDT',amount:100},'https://attacker.test')).status,403);
  const p=await f.post('preview',{pair:'HBAR/USDT',amount:100});assert(p.id);
  assert.equal((await f.post('confirm',{id:p.id})).error,'CONFIRMATION_REQUIRED');
  await Promise.all([f.post('confirm',{id:p.id,confirm:true}),f.post('confirm',{id:p.id,confirm:true})]);assert.equal(f.submits(),1);
  assert.equal((await f.post('preview',{pair:'HBAR/USDT',amount:1})).error,'DAILY_CAP');
});
test('changed setups require a new preview',async t=>{
  const f=await fixture(t),p=await f.post('preview',{pair:'HBAR/USDT',amount:100});f.current.stop=0.09;
  assert.equal((await f.post('confirm',{id:p.id,confirm:true})).error,'PREVIEW_EXPIRED');assert.equal(f.submits(),0);
});
test('uncertain submission is journalled and never sent again',async t=>{
  const f=await fixture(t,{unknown:true}),p=await f.post('preview',{pair:'HBAR/USDT',amount:100});
  assert.equal((await f.post('confirm',{id:p.id,confirm:true})).error,'ORDER_STATUS_UNKNOWN');
  await f.post('confirm',{id:p.id,confirm:true});assert.equal(f.submits(),1);assert.equal(JSON.parse(fs.readFileSync(f.journalPath))[0].status,'unknown');
  const restarted=createDemoServer({client:f.client,journalPath:f.journalPath,readFeed:()=>({setups:[f.current]})});await new Promise(r=>restarted.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+restarted.address().port;const r=await fetch(base+'/api/okx/confirm',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id:p.id,confirm:true})});assert.equal((await r.json()).status,'unknown');assert.equal(f.submits(),1);restarted.close();
});
test('exchange rejection does not appear as an accepted order',async t=>{
  const f=await fixture(t,{rejected:true}),p=await f.post('preview',{pair:'HBAR/USDT',amount:100});assert.equal((await f.post('confirm',{id:p.id,confirm:true})).error,'ORDER_REJECTED');
});
