// Synthetic fixtures only: no production rows, credentials or actual account identifiers.
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
await db.exec(await fs.readFile(new URL('../fx-cache-age.sql',import.meta.url),'utf8'));
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



const results=[];
const oldIntegration=await fs.readFile(new URL('../collector-integration.sql',import.meta.url),'utf8');
const oldWork=oldIntegration.match(/create or replace function neptune_v2_private\.feed_work\([\s\S]*?end\$\$;/)[0];
async function run({age='10356',dateDelta=0,bodyDate=fxDate,status=200,contentType='application/json',bodyRate=1.5,lowerAge=0,base='USD',quote='AUD',baseline=false,change=null}={}){
 if(baseline)await db.exec(oldWork);
 if(lowerAge){
  await db.exec("update neptune_v2_private.feed_control set last_epoch=floor(extract(epoch from clock_timestamp())/60)::bigint,last_dispatch_at=clock_timestamp(),pending_epoch=floor(extract(epoch from clock_timestamp())/60)::bigint,pending_control_epoch=1,pending_at=clock_timestamp()-interval '32 seconds';insert into neptune_v2_private.feed_requests select pending_epoch,'fx','',7770001,clock_timestamp()-interval '32 seconds',neptune_v2_private.feed_url('fx','') from neptune_v2_private.feed_control;insert into net._http_response values(7770001,200,'application/json','{}','[]',false,null,clock_timestamp()-interval '31 seconds')");
 }else{await tick();await respond();}
 const req=(await q("select * from neptune_v2_private.feed_requests where kind='fx'"))[0];
 const headers={};if(age!==null)headers.Age=age;if(dateDelta!==null)headers.Date=new Date(Date.now()-dateDelta*1000).toUTCString();
 await q('update net._http_response set status_code=$2,content_type=$3,headers=$4,content=$5 where id=$1',[req.request_id,status,contentType,JSON.stringify(headers),JSON.stringify([{date:bodyDate,base,quote,rate:bodyRate}])]);
 if(change)await change(req);
 await tick();const observed=await scans();assert.equal(observed.length,1,'one authoritative scan per batch');return{scan:observed[0].payload,req,headers};
}
async function check(name,fn){await db.exec('begin');try{const details=await fn();results.push({name,pass:true,...details});console.log('PASS',name);}catch(e){results.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}finally{await db.exec('rollback');}}
await check('baseline reproduces rejection of current daily reference with Age10356',async()=>{const {scan}=await run({baseline:true});assert.equal(scan.fx,null);});
await check('candidate admits observed daily rate and preserves every source clock and provenance field',async()=>{const {scan,req,headers}=await run();assert.equal(scan.fx.rate,1.5);assert.equal(scan.fx.rate_date,fxDate);assert.equal(Date.parse(scan.fx.at),Date.parse(fxDate+'T00:00:00Z'));assert.equal(scan.fx.source,'Frankfurter ECB reference');const e=scan.fx.feed_evidence;assert.equal(e.http_age,'10356');assert.equal(e.http_date,headers.Date);assert.equal(e.request_id,req.request_id);assert.equal(e.wire_received_at,null);assert.equal(Date.parse(scan.fx.fetched_at),Date.parse(e.received_at));assert.equal(e.received_at_basis,'conservative_sample_lower_bound');assert.match(e.request_sha256,/^[a-f0-9]{64}$/);assert.match(e.response_sha256,/^[a-f0-9]{64}$/);return{rate:scan.fx.rate,rate_date:scan.fx.rate_date,http_age:e.http_age,at:scan.fx.at,fetched_at:scan.fx.fetched_at};});
for(const age of ['0','3600','10356','75016','86400','345600'])await check('FX Age boundary accepts '+age,async()=>{assert.equal((await run({age})).scan.fx?.rate,1.5);});
for(const age of ['345601','345600.1','-1','NaN','Infinity','bad'])await check('FX Age invalid/excess rejected '+age,async()=>{assert.equal((await run({age})).scan.fx,null);});
await check('absent Age preserves existing valid-response behavior',async()=>{assert.equal((await run({age:null})).scan.fx?.rate,1.5);});
for(const delta of [10356,86400,345590])await check('cached FX HTTPDate accepts within declared bound '+delta,async()=>{assert.equal((await run({dateDelta:delta})).scan.fx?.rate,1.5);});
for(const delta of [345610,-10])await check('stale/future HTTPDate rejected '+delta,async()=>{assert.equal((await run({dateDelta:delta})).scan.fx,null);});
for(const date of [new Date(Date.now()-5*86400000).toISOString().slice(0,10),new Date(Date.now()+86400000).toISOString().slice(0,10),'invalid'])await check('cached transport does not rescue invalid rate date '+date,async()=>{assert.equal((await run({bodyDate:date})).scan.fx,null);});
for(const [name,opts]of [['wrong base',{base:'EUR'}],['wrong quote',{quote:'NZD'}],['HTTP500',{status:500}],['wrong MIME',{contentType:'text/html'}],['stale transport lower bound',{lowerAge:31}]])await check(name+' still fails closed',async()=>{assert.equal((await run(opts)).scan.fx,null);});
await check('changing response Age after immutable capture cannot reuse observation',async()=>{const {scan}=await run({change:async req=>{await q("select neptune_mv_private.observe_response('legacy',$1)",[req.request_id]);await q("update net._http_response set headers=jsonb_set(headers,'{Age}','\"10357\"') where id=$1",[req.request_id]);}});assert.equal(scan.fx,null);});
for(const [kind,asset,age,key]of [['metadata','',3601,'metadata'],['bars','ETH/USD',61,'bars'],['depth','ETH/USD',6,'book'],['trade','ETH/USD',6,'trade_at']])await check(kind+' cache bound unchanged',async()=>{const {scan}=await run({change:async()=>{const req=(await q('select request_id from neptune_v2_private.feed_requests where kind=$1 and asset=$2',[kind,asset]))[0];await q('update net._http_response set headers=$2 where id=$1',[req.request_id,JSON.stringify({Age:String(age)})]);}});assert.equal(scan.markets.find(m=>m.asset==='ETH/USD')[key],undefined);});
await check('native USDC/USD executable conversion remains5-second cache bound',async()=>{const {scan}=await run({change:async()=>{const req=(await q("select request_id from neptune_mv_private.requests where venue='USDC' and kind='fx'"))[0];assert(req);await q('update net._http_response set headers=$2 where id=$1',[req.request_id,JSON.stringify({Age:'6'})]);}});assert.equal(scan.quote_fx['USDC/USD'],undefined);});

for(const seconds of [1800,7200])await check('rejected replacement does not renew cached FX retrieval at age '+seconds,async()=>{
 const oldAt=new Date(Date.now()-seconds*1000).toISOString();const cached={base:'USD',quote:'AUD',rate:1.5,rate_date:fxDate,at:fxDate+'T00:00:00Z',fetched_at:oldAt,source:'Frankfurter ECB reference',feed_evidence:{http_age:'earlier-reference'}};
 await q('update neptune_v2_private.feed_control set fx_cache=$1',[JSON.stringify(cached)]);const {scan}=await run({age:'345601'});assert.deepEqual(scan.fx,cached);assert.deepEqual((await q('select fx_cache from neptune_v2_private.feed_control'))[0].fx_cache,cached);
 if(seconds>3600){const p=(await q('select payload from public.neptune_paper_v2_status'))[0].payload;assert.equal(p.account.fx,null);assert(p.decisions.some(d=>d.reason==='missing_or_stale_fx'));}
});

console.log(JSON.stringify({passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length}));await db.close();if(results.some(x=>!x.pass))process.exitCode=1;
