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

// These checks run the exact release policy. No all-venue override is loaded.
const expectedPolicy={native_entry_venues:['hyperliquid'],native_collection_venues:['hyperliquid','USDC'],excluded_venues:{binance:'owner_disabled'}};
assert.deepEqual((await q('select neptune_v2_private.native_activation_policy() p'))[0].p,expectedPolicy);
await db.exec('begin');await q("update neptune_mv_private.control set metadata='{}'");await tick();
assert.deepEqual((await q('select venue,kind from neptune_mv_private.requests order by venue')).map(x=>[x.venue,x.kind]),[['USDC','metadata'],['hyperliquid','metadata']]);
assert((await q('select url from net.calls')).every(x=>!x.url.includes('binance')&&!x.url.includes('USDT')));await db.exec('rollback');ok('cold collector dispatches only Hyperliquid and USDC metadata; zero Binance or USDT reads');
await db.exec('begin');await tick();assert.equal((await q('select count(*) n from net.calls'))[0].n,24);
assert((await q('select url from net.calls')).every(x=>!x.url.includes('binance')&&!x.url.includes('USDT')));
await respond();await tick();const collected=(await scans())[0].payload;assert.equal(collected.markets.length,7);assert.deepEqual(Object.keys(collected.quote_fx),['USDC/USD']);
const status=(await q('select payload from public.neptune_paper_v2_status'))[0].payload;
assert.equal(status.scan_complete,true);assert.equal(status.account.cash,10000);assert.equal(status.account.equity,10000);
const bstatus=status.specialist_accounts.accounts.find(x=>x.id==='binance');assert.equal(bstatus.status,'stopped');assert.match(bstatus.readiness_reason,/Disabled by owner/);assert.equal(bstatus.cash,2000);assert.equal(bstatus.evidence_at,null);
assert.deepEqual(status.native_model.activation,expectedPolicy);assert.equal(status.specialist_accounts.accounts.length,5);assert.equal(status.specialist_accounts.accounts.find(x=>x.id==='base').status,'research_only');
for(const id of ['ethereum','solana'])assert.equal(status.specialist_accounts.accounts.find(x=>x.id===id).source_venue,'Kraken public spot');
await db.exec('rollback');ok('six legacy + Hyperliquid scan is complete, Binance stopped with its cash preserved, Base unchanged');
function evidence({signal='hyperliquid:@107',price=20.8,fx=true,includeBinance=false,legacySignal=false}={}){
 const ms=Date.now(),at=new Date(ms).toISOString(),t=Math.floor(ms/900000)*900000;
 const o={at,fx:fx?{base:'USD',quote:'AUD',rate:1.5,source:'Frankfurter ECB reference',at:new Date(ms-86400000).toISOString(),rate_date:new Date(ms-86400000).toISOString().slice(0,10),fetched_at:at}:null,markets:[],quote_fx:{}};
 for(const a of assets){const bars=Array.from({length:22},(_,i)=>({t:t-(22-i)*900000,o:100,h:103,l:97,c:100,v:100}));if(legacySignal&&a==='ETH/USD')Object.assign(bars.at(-1),{c:104,h:105,l:100,v:160});o.markets.push({asset:a,received_at:at,book:{at,bids:[[104,10000]],asks:[[104.01,10000]]},metadata:{asset:a,venue:'Kraken',kind:'spot',quote:'USD',status:'online',source:'https://api.kraken.com/0/public/AssetPairs',at,tick_size:.01,min_qty:.001,min_cost:1,qty_decimals:6},trade_at:at,volume_24h_usd:10000000,bars});}
 for(const orig of native.markets){if(orig.venue==='binance'&&!includeBinance)continue;const m=structuredClone(orig),hyper=m.venue==='hyperliquid',scale=hyper?.2:1,px=hyper?price:104;m.received_at=at;m.metadata.at=at;m.trade_at=at;m.book.at=at;m.book.bids=[[String(px),'100000']];m.book.asks=[[String(px+(hyper?.001:.01)),'100000']];m.avg_price={price:String(px),mins:5,at,received_at:at,source:'https://data-api.binance.vision/api/v3/avgPrice?symbol=SOLUSDT'};m.bars=Array.from({length:96},(_,i)=>({t:t-(96-i)*900000,o:100*scale,h:103*scale,l:97*scale,c:100*scale,v:1000}));if(signal===m.asset)Object.assign(m.bars.at(-1),{c:104*scale,h:105*scale,l:100*scale,v:1600});o.markets.push(m);}
 for(const [key,orig] of Object.entries(native.quote_fx)){if(key==='USDT/USD'&&!includeBinance)continue;const f=structuredClone(orig);f.asset=key;f.received_at=at;f.metadata.at=at;f.book.at=at;f.book.bids=[['0.999','100000000']];f.book.asks=[['1.001','100000000']];o.quote_fx[key]=f;}return o;
}
const engine=async o=>{await new Promise(r=>setTimeout(r,2));return(await q('select neptune_v2_private.tested_process_scan($1::jsonb) p',[JSON.stringify(o)]))[0].p;};
async function warm(){const previous=evidence().markets[0].bars.at(-1).t-900000;await q("update neptune_v2_private.account set state=jsonb_set(state,'{last_bar}',$1)",[JSON.stringify(Object.fromEntries([...assets,'binance:SOLUSDT','hyperliquid:@107'].map(a=>[a,previous])))]);}
await db.exec('begin');await warm();await engine(evidence({signal:'binance:SOLUSDT',includeBinance:true}));await engine(evidence({signal:'binance:SOLUSDT',includeBinance:true}));
assert.equal((await q("select count(*) n from neptune_v2_private.orders where payload->>'asset'='binance:SOLUSDT'"))[0].n,0);assert.equal((await q('select count(*) n from neptune_v2_private.fills'))[0].n,0);
assert((await q("select payload from neptune_v2_private.decisions where payload->>'asset'='binance:SOLUSDT'")).every(x=>x.payload.reason==='venue_disabled_by_owner'));
await q("update neptune_v2_private.account set state=jsonb_set(state,'{pending}',jsonb_build_object('binance:SOLUSDT',jsonb_build_object('side','buy','at',clock_timestamp()-interval '1 second')))");await engine(evidence({signal:false}));
assert.equal((await q("select state->'pending' p from neptune_v2_private.account"))[0].p['binance:SOLUSDT'],undefined);
assert((await q("select count(*) n from neptune_v2_private.decisions where payload->>'reason'='venue_disabled_by_owner' and payload->>'result'='cancelled'"))[0].n>0);
await db.exec('rollback');ok('perfect Binance signals and existing buy intents cannot create exposure; cancellation is audited');
await db.exec('begin');await assert.rejects(()=>q("select neptune_v2_private.execute_native_fill('synthetic',clock_timestamp(),'binance:SOLUSDT','{\"side\":\"buy\"}',1,100)"),/Native venue disabled by owner/);await db.exec('rollback');ok('direct internal native-fill buy path also rejects Binance');
await db.exec('begin');await warm();await engine(evidence());let r=await engine(evidence());assert.equal(r.account.fills,1);let f=(await q('select payload from neptune_v2_private.fills'))[0].payload;assert.equal(f.asset,'hyperliquid:@107');assert.equal(f.quote_currency,'USDC');assert.equal(f.fee_currency,'HYPE');assert.equal(r.specialist_accounts.accounts.find(x=>x.id==='binance').cash,2000);
await engine(evidence({signal:false,price:16,fx:false}));r=await engine(evidence({signal:false,price:15.8,fx:false}));assert.equal(r.account.fills,2);assert.equal((await q('select currency from neptune_v2_private.native_receivables'))[0].currency,'USDC');assert.equal(r.account.equity,null);
r=await engine(evidence({signal:false,price:15.8}));assert.equal((await q('select count(*) n from neptune_v2_private.native_settlement_attribution'))[0].n,1);const settledCash=r.account.cash;r=await engine(evidence({signal:false,price:15.8}));assert.equal(r.account.cash,settledCash);await q('select neptune_v2_private.native_scan_reconcile()');await db.exec('rollback');ok('production policy supports real engine Hyperliquid entry, protective exit, typed USDC, one later settlement');
await db.exec('begin');await warm();await engine(evidence({signal:false,legacySignal:true}));r=await engine(evidence({signal:false,legacySignal:true}));assert.equal(r.account.fills,1);assert.equal((await q('select payload from neptune_v2_private.fills'))[0].payload.asset,'ETH/USD');await q('select neptune_v2_private.native_scan_reconcile()');await db.exec('rollback');ok('existing Kraken Ethereum entry remains usable under exact production policy');
await db.exec('begin');await q("update neptune_mv_private.control set provider_blocked='{\"hyperliquid\":{\"permanent\":true,\"reason\":\"access_denied\"},\"kraken\":{\"permanent\":true,\"reason\":\"access_denied\"}}'");assert.equal((await q('select neptune_mv_private.dispatch(1) p'))[0].p,'providers_blocked');assert.equal((await q('select count(*) n from net.calls'))[0].n,0);await db.exec('rollback');ok('all enabled providers blocked returns without trying disabled Binance');

// Reporting-only regression: compare both expressions in the exact release engine.
// All cash adjustments and the predecessor expression below are isolated fixtures.
const currentCore=await fs.readFile(new URL('../core.sql',import.meta.url),'utf8');
const correctedExpression="'initial_risk_base',case when specialists then least(equity,neptune_v2_private.specialist_entry_budget(a))*.0025 else equity*.0025 end";
const predecessorExpression="'initial_risk_base',equity*.0025";
assert.equal(currentCore.split(correctedExpression).length-1,1);
const currentScanner=currentCore.match(/create function neptune_v2_private\.process_scan\([\s\S]*?\$\$;/)[0]
 .replace('create function neptune_v2_private.process_scan','create or replace function neptune_v2_private.tested_process_scan');
const predecessorScanner=currentScanner.replace(correctedExpression,predecessorExpression);
for(const [asset,specialist] of [['ETH/USD','ethereum'],['hyperliquid:@107','hyperliquid']]){
 for(const cash of [2000,1000,3000,0]){
  const comparisons=[];
  for(const corrected of [false,true]){
   await db.exec('begin');
   try{
    await db.exec(corrected?currentScanner:predecessorScanner);
    await q('update neptune_v2_private.specialist_accounts set cash=$1 where id=$2',[cash,specialist]);
    await q("update neptune_v2_private.specialist_accounts set cash=cash+$1 where id='base'",[2000-cash]);
    await warm();
    const options={signal:asset==='ETH/USD'?false:asset,legacySignal:asset==='ETH/USD'};
    const pendingStatus=await engine(evidence(options));
    const order=(await q("select payload from neptune_v2_private.orders where payload->>'asset'=$1",[asset]))[0]?.payload;
    const decision=(await q("select payload from neptune_v2_private.decisions where payload->>'asset'=$1 and payload->>'result'='pending'",[asset]))[0]?.payload;
    const budget=Math.min(2000,cash)*.0025;
    // Existing native sizing/target gates reject the AUD 0 and AUD 1,000
    // fixtures before constructing an intent. Legacy zero-budget reporting
    // remains preliminary and the unchanged fill-time gate rejects it.
    const nativeBlocked=asset==='hyperliquid:@107'&&cash<=1000;
    if(nativeBlocked){assert.equal(order,undefined);assert.equal(decision,undefined);assert.equal((await q("select payload->>'reason' r from neptune_v2_private.decisions where payload->>'asset'=$1",[asset]))[0].r,'no_qualified_momentum');}
    else {
     assert(order,JSON.stringify({asset,cash,corrected,decisions:await q("select payload from neptune_v2_private.decisions where payload->>'asset'=$1",[asset])}));assert(decision);assert.equal(decision.risk_base,corrected?budget:25);
     assert.equal(order.initial_risk_base,decision.risk_base);
     assert.equal((await q("select state#>'{pending}' p from neptune_v2_private.account"))[0].p[asset].initial_risk_base,decision.risk_base);
    }
    const filled=await engine(evidence(options));
    const fill=(await q("select payload from neptune_v2_private.fills where payload->>'asset'=$1",[asset]))[0]?.payload;
    assert.equal(filled.account.fills,cash===0||nativeBlocked?0:1);
    if(fill){assert(fill.initial_risk_base<=budget);assert(-fill.cash_delta_base<=Math.min(2000,cash)*.1);}
    await q('select neptune_v2_private.native_scan_reconcile()');
    const economicKeys=['qty','gross_qty','price','cash_delta_base','initial_risk_base','gross_usd','fee_usd','net_usd','fee_currency','fee_native','gross_native','net_inventory_delta','fx_cost_base','fee_base','fx_applied_rate','accounting'];
    const economics=fill?Object.fromEntries(economicKeys.filter(k=>k in fill).map(k=>[k,fill[k]])):null;
    comparisons.push({economics,cash:filled.account.cash,fees:filled.account.fees,fx_costs:filled.account.fx_costs,realized_pnl:filled.account.realized_pnl});
   }finally{await db.exec('rollback');}
  }
  assert.deepEqual(comparisons[1],comparisons[0]);
  ok(`${asset} at AUD${cash} cash: intent allowance or existing no-intent gate is correct; executable economics are unchanged`);
 }
}

await db.close();console.log(JSON.stringify({groups_passed:passed,policy:'exact production Hyperliquid-only',live_mutations:false}));
