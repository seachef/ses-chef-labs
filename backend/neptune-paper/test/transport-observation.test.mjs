// Actual candidate SQL and engine; pg_net transport only is stubbed. No live calls.
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const db=new PGlite();const q=async(s,a=[])=>(await db.query(s,a)).rows;
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create table public.paper_control(id int,owner_id uuid);
create schema net;create schema cron;
create table net.calls(id bigserial primary key,url text,body jsonb,method text);
create table net._http_response(id bigint primary key,status_code int,content_type text,headers jsonb,content text,timed_out bool,error_msg text,created timestamptz);
create function net.http_get(url text,params jsonb,headers jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.calls(url,method) values(url,'GET') returning id$$;
create function net.http_post(url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.calls(url,body,method) values(url,body,'POST') returning id$$;
create table cron.job_run_details(jobid bigint,return_message text);create table cron.job(jobid bigint,jobname text,username text,database text,command text,active bool);
create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$update cron.job set active=false where jobid=$1 returning true$$;
create table public.observed_scans(payload jsonb);`);
for(const f of ['schema.sql','core.sql','owner-access.sql','native-economics.sql','native-ledger.sql','native-order-rules.sql','native-scanner-helpers.sql','native-audit.sql','native-public-projection.sql','collector.sql','native-collector.sql','transport-observation.sql','collector-integration.sql'])await db.exec(await fs.readFile(new URL('../'+f,import.meta.url),'utf8'));
// Test-only call counter still invokes the actual engine, never a fake process_scan.
await db.exec(`alter function neptune_v2_private.process_scan(jsonb) rename to tested_process_scan;
create function neptune_v2_private.process_scan(o jsonb) returns jsonb language plpgsql as $$begin insert into public.observed_scans values(o);return neptune_v2_private.tested_process_scan(o);end$$;
insert into neptune_v2_private.build_metadata values(6,repeat('b',64),'00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',now());
select neptune_v2_private.initialize('AUD');insert into public.neptune_paper_v2_control(id,owner_id) values('neptune-paper-v2','00000000-0000-0000-0000-000000000001');select neptune_v2_private.allocate_specialists();update public.neptune_paper_v2_control set enabled=true;select neptune_v2_private.sync_control();
insert into cron.job values(9,'neptune-v2-feed-guard',current_user,current_database(),'set statement_timeout=''8s''; select neptune_v2_private.feed_tick();',true);
insert into neptune_v2_private.feed_control(id,started_at,contract_verified,job_id,job_owner,job_database) values(true,clock_timestamp(),true,9,current_user,current_database());`);
const native=JSON.parse(await fs.readFile(new URL('./fixtures/normalized-native.json',import.meta.url),'utf8'));
const metadata={};for(const m of native.markets)metadata[m.venue]={...m.metadata,at:new Date(Date.now()-1000).toISOString()};for(const f of Object.values(native.quote_fx))metadata[f.base]={...f.metadata,at:new Date(Date.now()-1000).toISOString()};
await q("insert into neptune_mv_private.control(id,started_at,enabled,contract_verified,metadata) values(true,clock_timestamp(),true,true,$1)",[JSON.stringify(metadata)]);
const assets=['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD'];
const fxDate=new Date(Date.now()-86400000).toISOString().slice(0,10);
function legacy(kind,asset){const ms=Date.now(),at=ms/1000,start=Math.floor(ms/900000)*900000;if(kind==='fx')return[{base:'USD',quote:'AUD',rate:1.5,date:fxDate}];let result;
 if(kind==='metadata')result=Object.fromEntries(assets.map(a=>[a,{wsname:a,altname:a.replace('/',''),base:a.split('/')[0],quote:'USD',aclass_base:'currency',aclass_quote:'currency',status:'online',lot:'unit',lot_multiplier:1,ordermin:'0.001',costmin:'1',tick_size:'0.01',lot_decimals:6}]));
 if(kind==='depth')result={[asset]:{bids:[['100','100000',at-1]],asks:[['100.01','100000',at-1]]}};
 if(kind==='trade')result={[asset]:[['100','10',at-1,'b','m','',1]]};
 if(kind==='bars')result={[asset]:Array.from({length:97},(_,i)=>[(start-(96-i)*900000)/1000,'100','101','99','100','100','1000',100])};
 return{error:[],result};}
function multivenue(v,k,price=100){const ms=Date.now(),start=Math.floor(ms/900000)*900000;if(k==='depth')return v==='binance'?{lastUpdateId:123,bids:[[String(price),'100000']],asks:[[String(price+.01),'100000']]}:{coin:'@107',time:ms-10,levels:[[{px:String(price),sz:'100000',n:1}],[{px:String(price+.01),sz:'100000',n:1}]]};
 if(k==='fx')return{error:[],result:{[v+'/USD']:{bids:[['0.999','100000',ms/1000-1]],asks:[['1.001','100000',ms/1000-1]]}}};
 if(k==='metadata')return{error:'temporary metadata outage'};
 if(k==='avg_price')return{mins:5,price:String(price),closeTime:ms-10};
 if(k==='trades')return v==='binance'?[{id:1,price:'100',qty:'10',time:ms-10}]:[{coin:'@107',px:'100',sz:'10',time:ms-10,tid:1}];
 if(k==='bars')return Array.from({length:97},(_,i)=>{let t=start-(96-i)*900000;return v==='binance'?[t,'100','101','99','100','1000',t+899999,'100000',100,'500','50000','0']:{s:'@107',i:'15m',t,T:t+899999,o:'100',h:'101',l:'99',c:'100',v:'1000',n:100};});
 throw Error('Unexpected request '+v+' '+k);}
async function respond({legacyStatus=200,nativeDeny=null,omitLegacy=false,onlyLegacy=false,onlyNative=false,nativePrice=100}={}){
 if(!onlyNative)for(const r of await q('select * from neptune_v2_private.feed_requests')){
  if(omitLegacy&&r.kind!=='fx')continue;const status=r.kind==='fx'?200:legacyStatus;
  await q("insert into net._http_response values($1,$2,'application/json','{}',$3,false,null,clock_timestamp())",[r.request_id,status,JSON.stringify(legacy(r.kind,r.asset))]);
 }
 if(!onlyLegacy)for(const r of await q('select * from neptune_mv_private.requests')){const status=r.venue===nativeDeny?403:r.kind==='metadata'?503:200;await q("insert into net._http_response values($1,$2,'application/json','{}',$3,false,null,clock_timestamp())",[r.request_id,status,JSON.stringify(multivenue(r.venue,r.kind,nativePrice))]);}
}
const tick=()=>db.exec('select neptune_v2_private.feed_tick()');const scans=()=>q('select payload from public.observed_scans');let passed=0;const ok=s=>{passed++;console.log('PASS',s);};


// Exact production policy and actual SQL journal; only network responses are synthetic.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const millis=value=>new Date(value).getTime();
const hmeta=()=>({...structuredClone(native.markets.find(m=>m.venue==='hyperliquid').metadata),at:new Date(Date.now()-60000).toISOString()});
const parseH=(raw,lower,upper,cutoff=upper,meta=hmeta(),kind='depth')=>q("select neptune_mv_private.parse('hyperliquid',$6,$1,$2,$3,$4,false,$5) p",[JSON.stringify(raw),lower,cutoff,JSON.stringify(meta),upper,kind]).then(x=>x[0].p);
const depth=t=>({coin:'@107',time:t,levels:[[{px:'20.8',sz:'100000',n:1}],[{px:'20.801',sz:'100000',n:1}]]});
async function response(req,body,created=req.sent_at,status=200){await q("insert into net._http_response values($1,$2,'application/json','{}',$3,false,null,$4)",[req.request_id,status,JSON.stringify(body),created]);}
async function respondMissing(){
 for(const r of await q('select q.* from neptune_v2_private.feed_requests q where not exists(select 1 from net._http_response s where s.id=q.request_id)'))await response(r,legacy(r.kind,r.asset));
 for(const r of await q('select q.* from neptune_mv_private.requests q where not exists(select 1 from net._http_response s where s.id=q.request_id)'))await response(r,multivenue(r.venue,r.kind),r.sent_at,r.kind==='metadata'?503:200);
}
async function check(name,fn){await db.exec('begin');try{await fn();ok(name);}finally{await db.exec('rollback');}}
await check('actual batch-start70ms/source-event mismatch is accepted inside the first-observation interval',async()=>{
 const lowerMs=Date.now()-1000,lower=new Date(lowerMs).toISOString(),upper=new Date(lowerMs+200).toISOString();
 const p=await parseH(depth(lowerMs+70),lower,upper);assert(p?.book);assert.equal(millis(p.book.at),lowerMs+70);assert.equal(millis(p.received_at),lowerMs);
 assert.equal(await parseH(depth(lowerMs+201),lower,upper),null,'a source event after the observed upper bound stays invalid');
 assert.equal(await parseH(depth(lowerMs+70),upper,lower),null,'inverted bounds are invalid');
});
await check('fresh upper observation never rejuvenates stale lower-bound data or future metadata',async()=>{
 const now=Date.now(),lower=new Date(now-31000).toISOString(),upper=new Date(now).toISOString();assert.equal(await parseH(depth(now-100),lower,upper),null);
 const goodLower=new Date(now-1000).toISOString();const meta=hmeta();meta.at=new Date(now+100).toISOString();assert.equal(await parseH(depth(now-100),goodLower,upper,upper,meta),null);
});
await check('legacy source timestamps use the upper bound while snapshot freshness stays conservative',async()=>{
 const n=Date.now(),lower=new Date(n-1000).toISOString(),upper=new Date(n-700).toISOString();
 const raw={error:[],result:{'SOL/USD':[['100','1',(n-930)/1000,'b','m','',1]]}};
 const p=(await q("select neptune_v2_private.feed_parse_bounded('trade','SOL/USD',$1,$2,$3,$3) p",[JSON.stringify(raw),lower,upper]))[0].p;assert(p?.trade_at);assert(Math.abs(millis(p.trade_at)-(n-930))<1);
 raw.result['SOL/USD'][0][2]=(n-699)/1000;assert.equal((await q("select neptune_v2_private.feed_parse_bounded('trade','SOL/USD',$1,$2,$3,$3) p",[JSON.stringify(raw),lower,upper]))[0].p,null);
});
await check('future FX reference date cannot become admissible by delayed collection across midnight',async()=>{
 const d=new Date(),midnight=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1),lower=new Date(midnight-1000).toISOString(),upper=new Date(midnight-500).toISOString(),cutoff=new Date(midnight+1000).toISOString();
 const raw=[{base:'USD',quote:'AUD',rate:1.5,date:new Date(midnight).toISOString().slice(0,10)}];
 assert.equal((await q("select neptune_v2_private.feed_parse_bounded('fx','',$1,$2,$3,$4) p",[JSON.stringify(raw),lower,cutoff,upper]))[0].p,null);
});
await check('queued candle cannot mature across a boundary just because observation or retry is later',async()=>{
 const edge=Math.floor(Date.now()/900000)*900000,lower=new Date(edge-1000).toISOString(),upper=new Date(edge+1000).toISOString();
 const candles=Array.from({length:97},(_,i)=>{const t=edge-(96-i)*900000;return{s:'@107',i:'15m',t,T:t+899999,o:'20',h:'21',l:'19',c:'20',v:'10000',n:100};});
 const meta=hmeta();meta.at=new Date(edge-2000).toISOString();const p=await parseH(candles,lower,upper,upper,meta,'bars');assert(p?.bars?.length===95);assert.equal(p.volume_24h_base,null);assert(p.bars.every(b=>b.t+900000<=edge-1000));assert.equal(p.volume_window_end_ms,edge-900000);
 const later=await parseH(candles,lower,upper,new Date(edge+5000).toISOString(),meta,'bars');assert.deepEqual(later.bars,p.bars);
});
await check('journal captures only owned visible responses, after SELECT, and preserves first observation',async()=>{
 await tick();const request=(await q("select * from neptune_mv_private.requests where venue='hyperliquid' and kind='depth'"))[0];
 assert.equal((await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p,null);
 await pause(100);await response(request,depth(Date.now()-10));const before=(await q('select clock_timestamp() t'))[0].t;
 const a=(await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p;
 const after=(await q('select clock_timestamp() t'))[0].t;assert(millis(a.first_observed_at)>=millis(before));assert(millis(a.first_observed_at)<=millis(after));assert.equal(a.wire_received_at,null);assert.equal(a.timestamp_basis,'pg_net_batch_start_to_first_database_observation');
 await pause(100);const b=(await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p;assert.equal(b.first_observed_at,a.first_observed_at);assert.equal(b.response_sha256,a.response_sha256);
 assert.equal((await q("select neptune_mv_private.observe_response('legacy',$1) p",[request.request_id]))[0].p,null);assert.equal((await q("select neptune_mv_private.observe_response('native',999999) p"))[0].p,null);
});
await check('created before dispatch uses max lower bound without fabricating a receipt time',async()=>{
 await tick();const request=(await q("select * from neptune_mv_private.requests where venue='hyperliquid' and kind='depth'"))[0];const old=new Date(millis(request.sent_at)-1000).toISOString();await response(request,depth(Date.now()-10),old);
 const p=(await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p;assert.equal(millis(p.sample_lower_bound),millis(request.sent_at));assert.equal(millis(p.batch_started_at),millis(old));
});
await check('already-seen future or null created metadata remains rejected after retry',async()=>{
 await tick();const requests=await q("select * from neptune_mv_private.requests where venue='hyperliquid' order by kind");const future=requests[0],missing=requests[1];const created=new Date(Date.now()+400).toISOString();await response(future,depth(Date.now()+300),created);await response(missing,depth(Date.now()-10),null);
 for(const r of [future,missing])assert.equal((await q("select neptune_mv_private.observe_response('native',$1) p",[r.request_id]))[0].p,null);
 const before=await q('select * from neptune_mv_private.response_observations order by request_id');assert.equal(before.length,2);assert(before.some(x=>x.batch_started_at===null));assert(before.some(x=>millis(x.sample_lower_bound)>millis(x.first_observed_at)));
 await pause(500);for(const r of [future,missing])assert.equal((await q("select neptune_mv_private.observe_response('native',$1) p",[r.request_id]))[0].p,null);
 assert.deepEqual(await q('select * from neptune_mv_private.response_observations order by request_id'),before);
});
await check('response hash mutation and request reassignment fail closed without refreshing the journal',async()=>{
 await tick();const request=(await q("select * from neptune_mv_private.requests where venue='hyperliquid' and kind='depth'"))[0];await response(request,depth(Date.now()-10));
 const a=(await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p;
 await q("update net._http_response set content=content||' ' where id=$1",[request.request_id]);assert.equal((await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p,null);
 await q("update net._http_response set content=left(content,length(content)-1) where id=$1",[request.request_id]);
 await db.exec('alter table neptune_mv_private.requests disable trigger immutable');await q("update neptune_mv_private.requests set epoch=epoch+1 where request_id=$1",[request.request_id]);await db.exec('alter table neptune_mv_private.requests enable trigger immutable');
 assert.equal((await q("select neptune_mv_private.observe_response('native',$1) p",[request.request_id]))[0].p,null);assert.equal(millis((await q('select first_observed_at from neptune_mv_private.response_observations where request_id=$1',[request.request_id]))[0].first_observed_at),millis(a.first_observed_at));
});
await check('partial native and legacy batches persist bounds before waiting and cannot age a future event into validity',async()=>{
 await tick();const nr=(await q("select * from neptune_mv_private.requests where venue='hyperliquid' and kind='depth'"))[0],lr=(await q("select * from neptune_v2_private.feed_requests where asset='SOL/USD' and kind='trade'"))[0];
 const event=Date.now()+1000;await response(nr,depth(event));await response(lr,{error:[],result:{'SOL/USD':[['100','1',event/1000,'b','m','',1]]}});
 await tick();assert.equal((await scans()).length,0);const a=await q('select request_id,first_observed_at from neptune_mv_private.response_observations order by request_id');assert.equal(a.length,2);assert(a.every(x=>millis(x.first_observed_at)<event));
 await pause(1200);await tick();assert.deepEqual(await q('select request_id,first_observed_at from neptune_mv_private.response_observations order by request_id'),a);
 await respondMissing();await tick();const out=(await scans())[0].payload;assert.equal(out.markets.find(x=>x.asset==='hyperliquid:@107').book,undefined);assert.equal(out.markets.find(x=>x.asset==='SOL/USD').trade_at,undefined);
 const b=await q('select request_id,first_observed_at from neptune_mv_private.response_observations where request_id=any($1) order by request_id',[a.map(x=>x.request_id)]);assert.deepEqual(b,a);
});
await check('standalone native collect also records visible responses before its early pending return',async()=>{
 await tick();const nr=(await q("select * from neptune_mv_private.requests where venue='hyperliquid' and kind='depth'"))[0];await response(nr,depth(Date.now()-10));
 assert.equal((await q('select neptune_mv_private.collect((select epoch from public.neptune_paper_v2_control)) p'))[0].p,null);
 const a=(await q('select first_observed_at from neptune_mv_private.response_observations where request_id=$1',[nr.request_id]))[0].first_observed_at;await pause(50);await q('select neptune_mv_private.collect((select epoch from public.neptune_paper_v2_control))');assert.equal(millis((await q('select first_observed_at from neptune_mv_private.response_observations where request_id=$1',[nr.request_id]))[0].first_observed_at),millis(a));
});
await check('real collector admits valid post-created Hyperliquid events with explicit interval evidence',async()=>{
 await tick();await pause(100);await respondMissing();await tick();const out=(await scans())[0].payload,hyper=out.markets.find(x=>x.asset==='hyperliquid:@107');assert(hyper.book);
 const e=hyper.feed_evidence.depth;assert(millis(hyper.book.at)>millis(e.batch_started_at));assert(millis(hyper.book.at)<=millis(e.first_observed_at));assert.equal(e.received_at_basis,'conservative_sample_lower_bound');assert.equal(e.wire_received_at,null);assert.equal(millis(hyper.received_at),millis(e.received_at));assert.equal(Object.keys(out.quote_fx).length,1);assert.equal((await q("select count(*) n from neptune_mv_private.requests where venue in('binance','USDT')"))[0].n,0);
});
for(const role of ['anon','authenticated','service_role']){assert.equal((await q("select has_table_privilege($1,'neptune_mv_private.response_observations','select') p",[role]))[0].p,false);assert.equal((await q("select has_function_privilege($1,'neptune_mv_private.observe_response(text,bigint)','execute') p",[role]))[0].p,false);}ok('response observation journal and helpers remain private');
await db.close();console.log(JSON.stringify({groups_passed:passed,policy:'production interval-bound transport',live_mutations:false}));
