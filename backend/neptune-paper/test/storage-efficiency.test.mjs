// Paired local-only replay. Transport, private production and external APIs are never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const baselineCore=new URL('./fixtures/pre-storage-core.sql',import.meta.url);
const candidate=new URL('../',import.meta.url);
const modules=['schema.sql','core.sql','owner-access.sql','native-economics.sql','native-ledger.sql','native-order-rules.sql','native-scanner-helpers.sql','native-audit.sql','native-public-projection.sql','collector.sql','native-collector.sql','transport-observation.sql','collector-integration.sql'];
const assets=['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD'];
const native=JSON.parse(await fs.readFile(new URL('./fixtures/normalized-native.json',import.meta.url),'utf8'));
const start=Date.parse('2026-10-10T00:31:00Z');
async function setup(originalCore=false){const db=new PGlite();db.ms=start;db.q=async(s,a=[])=>(await db.query(s,a)).rows;
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create table public.paper_control(id int,owner_id uuid);
 create table public.test_clock(at timestamptz);insert into public.test_clock values('2026-10-10T00:31:00Z');create function public.test_now() returns timestamptz language sql stable as $$select at from public.test_clock$$;
 create schema cron;create table cron.job_run_details(jobid bigint,return_message text);create table cron.job(jobid bigint,jobname text,username text,database text,command text,active boolean);
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 create function cron.unschedule(job_id bigint) returns boolean language sql as $$update cron.job set active=false where jobid=$1 returning true$$;
 create schema net;create table net.calls(id bigserial,url text);create table net._http_response(id bigint,status_code int,content_type text,headers jsonb,content text,timed_out bool,error_msg text,created timestamptz);
 create function net.http_get(url text,params jsonb,headers jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.calls(url) values(url) returning id$$;
 create function net.http_post(url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds int) returns bigint language sql as $$insert into net.calls(url) values(url) returning id$$;`);
 for(const name of modules){
  let source=await fs.readFile(originalCore&&name==='core.sql'?baselineCore:new URL(name,candidate),'utf8');
  if(originalCore&&name==='core.sql'){
   // Compare storage semantics under the same intent-only reporting correction.
   // Retain the historical fixture unchanged. The separate exact-policy test
   // compares old/new reporting and proves unchanged executable economics.
   const oldRisk="'initial_risk_base',equity*.0025";
   assert.equal(source.split(oldRisk).length-1,1);
   source=source.replace(oldRisk,"'initial_risk_base',case when specialists then least(equity,neptune_v2_private.specialist_entry_budget(a))*.0025 else equity*.0025 end");
  }
  await db.exec(source.replaceAll('clock_timestamp()','public.test_now()'));
 }
 await db.exec("insert into neptune_v2_private.build_metadata values(6,repeat('b',64),'00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',public.test_now());select neptune_v2_private.initialize('AUD');insert into public.neptune_paper_v2_control(id,owner_id) values('neptune-paper-v2','00000000-0000-0000-0000-000000000001');select neptune_v2_private.allocate_specialists();update public.neptune_paper_v2_control set enabled=true;select neptune_v2_private.sync_control();");return db;}
function fixture(ms,{price=104,signal=null,fx=true,hyperprice=20.8}={}){const at=new Date(ms).toISOString(),t=Math.floor(ms/900000)*900000;
 const o={at,fx:fx?{base:'USD',quote:'AUD',rate:1.5,source:'Frankfurter ECB reference',at:'2026-10-09T00:00:00.000Z',rate_date:'2026-10-09',fetched_at:at}:null,markets:[],quote_fx:{},native_feed:{entry_capacity_paused:false,feed_terminal:false,provider_blocked:{},identity_blocked:{}}};
 for(const asset of assets){const bars=Array.from({length:22},(_,i)=>({t:t-(22-i)*900000,o:100,h:103,l:97,c:100,v:100}));if(signal===asset)Object.assign(bars.at(-1),{c:104,h:105,l:100,v:160});o.markets.push({asset,received_at:at,book:{at,bids:[[price,10000]],asks:[[price+.01,10000]]},metadata:{asset,venue:'Kraken',kind:'spot',quote:'USD',status:'online',source:'https://api.kraken.com/0/public/AssetPairs',at,tick_size:.01,min_qty:.001,min_cost:1,qty_decimals:6},trade_at:at,volume_24h_usd:10000000,bars,feed_evidence:{depth:{source:'https://api.kraken.com/0/public/Depth',request_id:ms}}});}
 const m=structuredClone(native.markets.find(m=>m.asset==='hyperliquid:@107'));m.received_at=at;m.metadata.at=at;m.trade_at=at;m.book.at=at;m.book.bids=[[String(hyperprice),'100000']];m.book.asks=[[String(hyperprice+.001),'100000']];m.bars=Array.from({length:96},(_,i)=>({t:t-(96-i)*900000,o:20,h:20.6,l:19.4,c:20,v:1000}));if(signal===m.asset)Object.assign(m.bars.at(-1),{c:20.8,h:21,l:20,v:1600});o.markets.push(m);
 for(const [key,orig] of Object.entries(native.quote_fx)){if(key!=='USDC/USD')continue;const f=structuredClone(orig);f.asset=key;f.received_at=at;f.metadata.at=at;f.book.at=at;f.book.bids=[['0.999','100000000']];f.book.asks=[['1.001','100000000']];o.quote_fx[key]=f;}return o;}
async function scan(db,options={},mutate=null){db.ms+=(db.stepMs||1000);const o=fixture(db.ms,options);if(mutate)mutate(o);await db.q('update public.test_clock set at=$1',[o.at]);const p=(await db.q('select neptune_v2_private.process_scan($1::jsonb) p',[JSON.stringify(o)]))[0].p;return{o,p};}
const pollCount=async(db,a='ETH/USD')=>Number((await db.q("select count(*) n from neptune_v2_private.decisions where payload->>'asset'=$1 and payload->>'reason'='no_new_completed_bar'",[a]))[0].n);
const close=async(...dbs)=>Promise.all(dbs.map(d=>d.close()));

test('first idle poll anchors immutable context, later prices/timestamps remain exactly reconstructable',async()=>{const db=await setup();try{
 await scan(db);await scan(db);assert.equal(await pollCount(db),1);const first=(await db.q("select payload from neptune_v2_private.decisions where payload->>'asset'='ETH/USD' and payload->>'reason'='no_new_completed_bar'"))[0].payload;assert.equal(first.poll_context.version,1);assert.match(first.poll_key,/^[a-f0-9]{64}$/);assert.match(first.poll_context.bars_hash,/^[a-f0-9]{64}$/);
 for(const price of [104.01,104.02,104.03]){const {o,p}=await scan(db,{price});assert.equal(await pollCount(db),1);const restored=(await db.q('select neptune_v2_private.resolve_observation(id) o from neptune_v2_private.observations order by at desc limit 1'))[0].o;assert.deepEqual(restored,o);assert.equal(Date.parse(p.heartbeat_at),Date.parse(o.at));assert.equal(Date.parse(p.scan_at),Date.parse(o.at));}
 assert.equal(Number((await db.q('select count(*) n from neptune_v2_private.observations'))[0].n),5);
 }finally{await close(db);}});

test('health, eligibility, metadata, bar evidence, feed source, control and build transitions retain fresh markers',async()=>{const db=await setup();try{
 await scan(db);await scan(db);let count=1;
 const recovery=async bad=>{await scan(db,{},bad);await scan(db);assert.equal(await pollCount(db),++count);await scan(db);assert.equal(await pollCount(db),count);};
 await recovery(o=>o.markets[0].trade_at='2026-10-09T00:00:00Z');
 await recovery(o=>o.markets[0].book.asks=[[106,10000]]);
 const changes=[o=>o.markets[0].metadata.min_cost=2,o=>o.markets[0].bars[0].h=103.1,o=>o.markets[0].feed_evidence.depth.source='https://api.kraken.com/0/public/Depth?version=2'];
 for(const mutate of changes){await scan(db,{},mutate);assert.equal(await pollCount(db),++count);await scan(db);assert.equal(await pollCount(db),++count);}
 await db.exec("insert into neptune_v2_private.build_metadata values(7,repeat('c',64),'00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',public.test_now())");await scan(db);assert.equal(await pollCount(db),++count);
 await db.exec("insert into neptune_v2_private.build_metadata values(8,repeat('c',64),repeat('d',64),public.test_now())");await scan(db);assert.equal(await pollCount(db),++count);
 await db.exec("update public.neptune_paper_v2_control set enabled=true;select neptune_v2_private.sync_control()");await scan(db); // owner Resume requires fresh warmup
 await scan(db);assert.equal(await pollCount(db),++count);
 // Cross the next completed-candle boundary naturally, not by mutating the ledger.
 db.stepMs=60000;while(Math.floor((db.ms+60000)/900000)===Math.floor(db.ms/900000))await scan(db);await scan(db);const afterBar=await pollCount(db);await scan(db);assert.equal(await pollCount(db),afterBar+1);
 }finally{await close(db);}});

test('missing/mismatched immutable anchor cannot suppress audit; restart breaks continuity',async()=>{const db=await setup();try{await scan(db);await scan(db);await db.exec("update neptune_v2_private.account set state=jsonb_set(state,'{idle_poll,ETH/USD,decision_id}','\"not-an-anchor\"')");await scan(db);assert.equal(await pollCount(db),2);db.ms+=180000;await scan(db);await scan(db);assert.equal(await pollCount(db),3);}finally{await close(db);}});

async function economic(db){const tables=['orders','fills','cash_ledger','usd_ledger','results','settlements','order_events','positions','specialist_accounts','specialist_fill_attribution','specialist_settlement_attribution','native_inventory','native_quote_ledger','native_fill_attribution','native_receivables','native_settlement_attribution'];const out={};for(const t of tables)out[t]=await db.q(`select to_jsonb(x) r from neptune_v2_private.${t} x order by to_jsonb(x)::text`);out.decisions=await db.q("select payload r from neptune_v2_private.decisions where payload->>'reason'<>'no_new_completed_bar' order by at,id");out.observations=await db.q('select id,at,payload from neptune_v2_private.observations order by at,id');out.state=(await db.q("select state-array['idle_poll','stored_bytes','relation_bytes'] s from neptune_v2_private.account"))[0].s;return out;}
test('paired pre-storage/current replay with aligned intent reporting preserves observations, decisions and all economics',async()=>{const a=await setup(true),b=await setup();a.stepMs=b.stepMs=60000;try{
 const step=async(options={})=>{await scan(a,options);await scan(b,options);assert.deepEqual(await economic(b),await economic(a));};
 await step();await step();await step({price:104.02});assert((await pollCount(a))>(await pollCount(b)));
 // A new candle creates Hyperliquid intent, then later source observation fills it.
 while(Math.floor((a.ms+60000)/900000)===Math.floor(a.ms/900000))await step();
 await step({signal:'hyperliquid:@107'});await step({signal:'hyperliquid:@107'});assert.equal(Number((await b.q('select count(*) n from neptune_v2_private.fills'))[0].n),1);
 const heldPolls=await pollCount(b);await step({hyperprice:20.9});assert.equal(await pollCount(b),heldPolls+1,'global exposure preserves every idle decision too');const pos=(await b.q("select payload p from neptune_v2_private.positions where asset='hyperliquid:@107'"))[0].p;await step({hyperprice:Number(pos.entry_price)+1.8*(Number(pos.entry_price)-Number(pos.stop))});assert(Number((await b.q("select count(*) n from neptune_v2_private.decisions where payload->>'reason'='trailing_stop_raised'"))[0].n)>0,'actual trailing update is preserved');
 await step({hyperprice:16,fx:false});await step({hyperprice:15.8,fx:false});assert.equal(Number((await b.q('select count(*) n from neptune_v2_private.fills'))[0].n),2);
 await step({hyperprice:15.8});await step({hyperprice:15.8});assert.equal(Number((await b.q('select count(*) n from neptune_v2_private.native_settlement_attribution'))[0].n),1);
 for(const row of await b.q('select id from neptune_v2_private.observations'))assert.deepEqual((await b.q('select neptune_v2_private.resolve_observation($1) o',[row.id]))[0].o,(await a.q('select neptune_v2_private.resolve_observation($1) o',[row.id]))[0].o);
 }finally{await close(a,b);}});

test('unchanged control acknowledgement performs no update; changed owner request still acknowledged',async()=>{const db=await setup();try{await db.exec("create table public.status_writes(n int);create function public.count_status_write() returns trigger language plpgsql as $$begin insert into public.status_writes values(1);return new;end$$;create trigger count_status after update on public.neptune_paper_v2_status for each row execute function public.count_status_write()");await db.exec('select neptune_v2_private.publish_control_ack();select neptune_v2_private.sync_control()');assert.equal(Number((await db.q('select count(*) n from public.status_writes'))[0].n),0);await db.exec('update public.neptune_paper_v2_control set enabled=false;select neptune_v2_private.sync_control()');assert(Number((await db.q('select count(*) n from public.status_writes'))[0].n)>0);assert.equal((await db.q("select payload#>>'{control,ack_status}' s from public.neptune_paper_v2_status"))[0].s,'applied');assert.equal((await db.q("select payload#>>'{control,enabled}' s from public.neptune_paper_v2_status"))[0].s,'false');}finally{await close(db);}});

test('source boundaries: protective loop, observation compression/resolver and 32/40 MiB limits stay untouched',async()=>{const original=await fs.readFile(baselineCore,'utf8'),current=await fs.readFile(new URL('core.sql',candidate),'utf8');const part=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));assert.equal(part(current,' -- Protective decisions/executions first.',' specialists:=exists'),part(original,' -- Protective decisions/executions first.',' specialists:=exists'));assert.equal(part(current,' -- Compression retains full input',' if neptune_v2_private.ts(s->'),part(original,' -- Compression retains full input',' if neptune_v2_private.ts(s->'));assert.equal(current.slice(current.indexOf('create function neptune_v2_private.resolve_observation')),original.slice(original.indexOf('create function neptune_v2_private.resolve_observation')));assert.equal(part(current,' select coalesce(sum(pg_total_relation_size',' obs:=md5'),part(original,' select coalesce(sum(pg_total_relation_size',' obs:=md5'));});


test('native model and quote-source metadata changes break polling continuity',async()=>{const db=await setup();try{await scan(db);await scan(db);const before=await pollCount(db,'hyperliquid:@107');await scan(db);assert.equal(await pollCount(db,'hyperliquid:@107'),before);await db.exec("create or replace function neptune_v2_private.native_model() returns jsonb language sql immutable security invoker set search_path='' as $$select jsonb_build_object('version','test-model','hash',repeat('e',64))$$");await scan(db);assert.equal(await pollCount(db,'hyperliquid:@107'),before+1);await scan(db,{},o=>o.quote_fx['USDC/USD'].metadata.revision='different-verified-source-revision');assert.equal(await pollCount(db,'hyperliquid:@107'),before+2);}finally{await close(db);}});

test('native enabled and provider equality guards skip only unchanged writes without changing dispatch outcomes',async()=>{const db=await setup();try{await db.exec("insert into neptune_mv_private.control(id,started_at,enabled,contract_verified,last_epoch,last_dispatch_at) values(true,public.test_now(),true,true,floor(extract(epoch from public.test_now())/60),public.test_now());create table public.native_writes(n int);create function public.count_native_write() returns trigger language plpgsql as $$begin insert into public.native_writes values(1);return new;end$$;create trigger count_native after update on neptune_mv_private.control for each row execute function public.count_native_write()");assert.equal((await db.q('select neptune_mv_private.dispatch(1) s'))[0].s,'rate_limited');await db.exec('select neptune_v2_private.shared_provider_preflight(1,public.test_now())');assert.equal(Number((await db.q('select count(*) n from public.native_writes'))[0].n),0);await db.exec("insert into cron.job values(9,'neptune-v2-feed-guard',current_user,current_database(),'set statement_timeout=''8s''; select neptune_v2_private.feed_tick();',true);insert into neptune_v2_private.feed_control(id,started_at,contract_verified,job_id,job_owner,job_database,last_epoch,last_dispatch_at) values(true,public.test_now(),true,9,current_user,current_database(),floor(extract(epoch from public.test_now())/60),public.test_now());select neptune_v2_private.feed_work()");assert.equal(Number((await db.q('select count(*) n from public.native_writes'))[0].n),0);await db.exec("update neptune_mv_private.control set enabled=false;select neptune_v2_private.feed_work()");assert.equal((await db.q('select enabled from neptune_mv_private.control'))[0].enabled,true);assert.equal(Number((await db.q('select count(*) n from net.calls'))[0].n),0);}finally{await close(db);}});
