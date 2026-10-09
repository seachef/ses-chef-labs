// Local, synthetic paper-runtime regression tests. No external calls or real orders.
// Install @electric-sql/pglite and run with Node.js; SQL and fixture paths are relative.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),q=async(s,a=[])=>(await db.query(s,a)).rows,report=[],hashes={},loaded={};
await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;create table public.paper_control(id int,owner_id uuid)');
const files=['schema.sql','core.sql','owner-access.sql','native-economics.sql','native-ledger.sql','native-order-rules.sql','native-scanner-helpers.sql','native-audit.sql','native-public-projection.sql'];
for(const f of files){const code=await fs.readFile(new URL('../'+f,import.meta.url),'utf8');loaded[f]=code;hashes[f]=createHash('sha256').update(code).digest('hex');await db.exec(code);}
await db.exec("insert into neptune_v2_private.build_metadata values(6,repeat('b',64),'00f878a855d0b8f65b57473bc0d2c89efde617b72ca5643b14ed05aa55afa8f8',now());select neptune_v2_private.initialize('AUD');insert into public.neptune_paper_v2_control(id,owner_id) values('neptune-paper-v2','00000000-0000-0000-0000-000000000001');select neptune_v2_private.allocate_specialists();update public.neptune_paper_v2_control set enabled=true;select neptune_v2_private.sync_control();");
const native=JSON.parse(await fs.readFile(new URL('./fixtures/normalized-native.json',import.meta.url),'utf8'));
const assets=['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD'];
function fixture({price=104,signal=true,fx=true,cross=true,crossBid='0.999',crossAsk='1.001',metadata=true,legacySignal=null,legacyPrice=104,nativeSignals=['binance:SOLUSDT']}={}){
 const ms=Date.now(),at=new Date(ms).toISOString(),t=Math.floor(ms/900000)*900000;
 const out={at,fx:fx?{base:'USD',quote:'AUD',rate:1.5,source:'Frankfurter ECB reference',at:new Date(ms-86400000).toISOString(),rate_date:new Date(ms-86400000).toISOString().slice(0,10),fetched_at:at}:null,
 markets:assets.map(asset=>{const bars=Array.from({length:22},(_,i)=>({t:t-(22-i)*900000,o:100,h:103,l:97,c:100,v:100}));if((Array.isArray(legacySignal)?legacySignal:[legacySignal]).includes(asset))Object.assign(bars.at(-1),{c:104,h:105,l:100,v:160});return {asset,received_at:at,book:{at,bids:[[legacyPrice,10000]],asks:[[legacyPrice+.01,10000]]},metadata:{asset,venue:'Kraken',kind:'spot',quote:'USD',status:'online',source:'https://api.kraken.com/0/public/AssetPairs',at,tick_size:.01,min_qty:.001,min_cost:1,qty_decimals:6},trade_at:at,volume_24h_usd:10000000,bars};}),quote_fx:structuredClone(native.quote_fx)};
 for(const original of native.markets){const m=structuredClone(original);m.received_at=at;m.metadata.at=at;m.trade_at=at;m.book.at=at;m.book.bids=[[String(price),'100000']];m.book.asks=[[String(price+.01),'100000']];m.avg_price={price:String(price),mins:5,at,received_at:at,source:'https://data-api.binance.vision/api/v3/avgPrice?symbol=SOLUSDT'};m.bars=Array.from({length:96},(_,i)=>({t:t-(96-i)*900000,o:100,h:103,l:97,c:100,v:1000}));if(signal&&nativeSignals.includes(m.asset))Object.assign(m.bars.at(-1),{c:104,h:105,l:100,v:1600});if(m.asset==='hyperliquid:@107'){m.book.bids=[[String(price*0.2),'100000']];m.book.asks=[[String((price+.01)*0.2),'100000']];for(const b of m.bars)for(const k of ['o','h','l','c'])b[k]*=0.2;}if(!metadata)delete m.metadata;out.markets.push(m);}
 for(const [k,v]of Object.entries(out.quote_fx)){v.asset=k;v.received_at=at;v.metadata.at=at;v.book.at=at;v.book.bids=[[crossBid,'100000000']];v.book.asks=[[crossAsk,'100000000']];}
 if(!cross)delete out.quote_fx['USDT/USD'];return out;
}
const scan=async o=>{await new Promise(r=>setTimeout(r,2));return(await q('select neptune_v2_private.process_scan($1::jsonb) p',[JSON.stringify(o)]))[0].p;};
const position=async()=>(await q("select payload from neptune_v2_private.positions where asset='binance:SOLUSDT'"))[0]?.payload;
async function entry(){const previous=fixture().markets[0].bars.at(-1).t-900000;await q("update neptune_v2_private.account set state=jsonb_set(state,'{last_bar}',$1)",[Object.fromEntries([...assets,'binance:SOLUSDT','hyperliquid:@107'].map(a=>[a,previous]))]);await scan(fixture());const r=await scan(fixture());assert.equal(r.account.fills,1);return r;}
async function pendingExit(){await entry();const price=Math.floor((await position()).stop)-1;await scan(fixture({price,signal:false,cross:false,metadata:false}));const r=await scan(fixture({price,signal:false,cross:false,metadata:false}));assert.equal(r.account.fills,2);return r;}
async function check(name,fn){await db.exec('begin');try{await fn();report.push({name,result:'PASS'});}catch(e){report.push({name,result:'FAIL',reason:e.message});}finally{await db.exec('rollback');}}
await check('native process_scan entry debits the same root and specialist pool exactly once',async()=>{
 const r=await entry(),f=(await q('select payload from neptune_v2_private.fills'))[0].payload;
 assert.equal(f.quote_currency,'USDT');assert.equal(f.fee_currency,'SOL');assert(f.net_inventory_delta<f.gross_qty);
 assert.equal((await q('select (select cash from neptune_v2_private.account)=(select sum(cash) from neptune_v2_private.specialist_accounts) ok'))[0].ok,true);
 assert.equal((await q('select (select cash from neptune_v2_private.account)=(select sum(delta) from neptune_v2_private.cash_ledger) ok'))[0].ok,true);
 assert.equal(r.account.fills,(await q('select count(*) n from neptune_v2_private.fills'))[0].n);assert.equal(r.risk.max_positions,3);assert.equal(r.risk.aggregate_pct,.75);
 await q('select neptune_v2_private.native_scan_reconcile()');
});
await check('missing USDT conversion clears combined equity and freshness, preserving ordinary inventory',async()=>{
 await entry();const r=await scan(fixture({cross:false,signal:false,legacySignal:'ETH/USD'}));
 assert.equal(r.account.equity,null);assert.equal(r.account.valuation_at,null);assert.notEqual(r.status,'running');assert.equal(r.account.fills,1);assert((await position()).qty>0);
});
await check('a depeg above the original quote target cannot create a false AUD 2R target exit',async()=>{
 await entry();const p=await position(),price=Math.ceil(p.target)+1;
 await scan(fixture({price,crossBid:'0.4',crossAsk:'0.401',signal:false}));
 assert.equal((await q("select count(*) n from neptune_v2_private.orders where payload->>'asset'='binance:SOLUSDT' and payload->>'side'='sell'"))[0].n,0);
});
await check('an ordinary crashed holding below minimum notional is unavailable, never fee dust',async()=>{
 await entry();await scan(fixture({price:1,signal:false}));const r=await scan(fixture({price:1,signal:false}));
 assert.equal(r.account.equity,null);assert.equal(r.account.valuation_at,null);assert.equal(r.account.fills,1);
 const i=(await q('select * from neptune_v2_private.native_inventory'))[0];assert(Number(i.qty)>=Number(i.qty_step));
 assert.equal((await q('select neptune_v2_private.native_dust_cost() p'))[0].p,'0');assert((await position()).qty>0);
});
await check('protective sale survives missing metadata/cross and retains typed native proceeds plus verified fee dust',async()=>{
 const r=await pendingExit();assert.equal(r.account.equity,null);assert.equal(r.account.valuation_at,null);
 const p=(await q('select neptune_v2_private.native_projection() p'))[0].p;
 assert.equal(p.pending_native_proceeds.length,1);assert.equal(p.pending_native_proceeds[0].currency,'USDT');assert.equal(p.native_positions[0].verified_fee_dust,true);assert.equal(p.native_positions[0].conservative_risk_base,p.native_positions[0].cost_base);
 assert.equal((await q('select count(*) n from neptune_v2_private.usd_ledger'))[0].n,0);await q('select neptune_v2_private.native_scan_reconcile()');
});
await check('new contradictory lot rules cannot be overridden by persisted entry rules for a protective fill',async()=>{
 await entry();const price=Math.floor((await position()).stop)-1;
 const changed=()=>{const o=fixture({price,signal:false}),m=o.markets.find(x=>x.asset==='binance:SOLUSDT');m.metadata.qty_step='1';m.metadata.min_qty='1';m.metadata.qty_decimals=0;m.metadata.rules.lot_size={...m.metadata.rules.lot_size,minQty:'1',stepSize:'1'};m.metadata.rules.all_filters=m.metadata.rules.all_filters.map(f=>f.filterType==='LOT_SIZE'?{...f,minQty:'1',stepSize:'1'}:f);return o;};
 await scan(changed());const r=await scan(changed());assert.equal(r.account.fills,1);assert((await position()).qty>0);assert.equal(r.account.equity,null);
});
await check('fresh same-identity non-trading status blocks execution rather than falling back to old online rules',async()=>{
 await entry();const price=Math.floor((await position()).stop)-1;
 const halted=()=>{const o=fixture({price,signal:false}),m=o.markets.find(x=>x.asset==='binance:SOLUSDT');m.metadata.status='halted';m.metadata.instrument_identity.isSpotTradingAllowed=false;return o;};
 await scan(halted());const r=await scan(halted());assert.equal(r.account.fills,1);assert.equal(r.account.equity,null);assert((await position()).qty>0);
});
await check('routine metadata revision and receipt changes do not falsely block a held instrument',async()=>{
 await entry();const o=fixture({signal:false}),m=o.markets.find(x=>x.asset==='binance:SOLUSDT');m.metadata.revision='f'.repeat(64);m.metadata.feed_evidence={public_response_revision:'synthetic-refresh'};
 const r=await scan(o);assert(r.account.equity>0);assert.equal(r.account.fills,1);
});
await check('pending native costs are not presented as complete AUD totals',async()=>{
 const r=await pendingExit(),agent=r.specialist_accounts.accounts.find(x=>x.id==='binance');
 assert.equal(agent.costs_base,null);assert.equal(agent.realized_pnl,null);
 assert(r.account.fees===null||r.account.costs_complete===false,'root fees must be null or explicitly incomplete');
});
await check('later native settlement reconciles whole-account counters and remains an internal daily cash flow',async()=>{
 await pendingExit();const r=await scan(fixture({signal:false}));assert.equal(r.account.fills,2);
 assert.equal((await q('select count(*) n from neptune_v2_private.native_settlement_attribution'))[0].n,1);
 assert.equal((await q("select (select sum(realized_pnl) from neptune_v2_private.specialist_accounts)=(select (state->>'realized')::numeric from neptune_v2_private.account) ok"))[0].ok,true);
 assert.equal(r.daily_performance.status,'available');assert.equal(r.daily_performance.net_external_flows,0);
 const before=r.account.cash,again=await scan(fixture({signal:false}));assert.equal(again.account.cash,before);assert.equal(again.account.fills,2);
});
await check('native SOL holding excludes Kraken SOL before intent or fill',async()=>{
 await entry();await scan(fixture({signal:false,legacySignal:'SOL/USD'}));
 assert.equal((await q("select count(*) n from neptune_v2_private.orders where payload->>'asset'='SOL/USD'"))[0].n,0);
 assert((await q("select count(*) n from neptune_v2_private.decisions where payload->>'asset'='SOL/USD' and payload->>'reason'='blocked_duplicate_canonical_exposure'"))[0].n>0);
});
await check('missing ordinary root position is a reconciliation fault rather than a dust exemption',async()=>{
 await entry();await q("delete from neptune_v2_private.positions where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/Unmatched ordinary native inventory/);
});
await check('mutable root position cannot understate immutable-backed native risk',async()=>{
 await entry();await q("update neptune_v2_private.positions set payload=jsonb_set(payload,'{initial_risk_base}','0') where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('mutable inventory cannot change canonical SOL ownership without detection',async()=>{
 await entry();await q("update neptune_v2_private.native_inventory set canonical_exposure='HYPE' where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('mutable inventory cannot reassign the specialist owner without detection',async()=>{
 await entry();await q("update neptune_v2_private.native_inventory set agent_id='solana' where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('a missing risk field cannot bypass SQL null semantics',async()=>{
 await entry();await q("update neptune_v2_private.positions set payload=payload-'initial_risk_base' where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('an invented larger lot step cannot turn ordinary inventory into exempt dust',async()=>{
 await entry();await q("update neptune_v2_private.native_inventory set qty_step=100 where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('an extra native root position without immutable inventory is rejected',async()=>{
 await entry();await q("insert into neptune_v2_private.positions values('hyperliquid:@107','{\"asset\":\"hyperliquid:@107\",\"qty\":1,\"cost_base\":1,\"initial_risk_base\":1}')");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('persisted held rules cannot change the quote denomination',async()=>{
 await entry();await q("update neptune_v2_private.positions set payload=jsonb_set(payload,'{verified_entry_rules,quote}','\"USD\"') where asset='binance:SOLUSDT'");
 await assert.rejects(()=>q('select neptune_v2_private.native_scan_reconcile()'),/native|Native/);
});
await check('native marked equity contributes to the unchanged peak-drawdown latch',async()=>{
 await entry();await scan(fixture({price:5000,signal:false}));const r=await scan(fixture({price:104,signal:false}));
 assert.equal(r.risk.entry_paused,true);assert.equal(r.risk.pause_reason,'drawdown_limit');
 assert(r.risk.peak_equity>10000);assert.equal(r.risk.total_drawdown_pct,5);
});
await check('legacy and both native candidates share the same three-position ceiling and aggregate risk',async()=>{
 const options={legacySignal:['ETH/USD','LINK/USD'],nativeSignals:['binance:SOLUSDT','hyperliquid:@107']};
 const previous=fixture().markets[0].bars.at(-1).t-900000;
 await q("update neptune_v2_private.account set state=jsonb_set(state,'{last_bar}',$1)",[Object.fromEntries([...assets,'binance:SOLUSDT','hyperliquid:@107'].map(a=>[a,previous]))]);
 await scan(fixture(options));const r=await scan(fixture(options));
 const positions=await q("select payload from neptune_v2_private.positions where (payload->>'qty')::numeric>0");
 assert.equal(positions.length,3);assert.equal(r.account.fills,3);assert(positions.some(x=>x.payload.asset==='binance:SOLUSDT'));
 assert(positions.reduce((s,x)=>s+x.payload.initial_risk_base,0)<=r.account.equity*.0075);
 assert.equal((await q('select (select cash from neptune_v2_private.account)=(select sum(cash) from neptune_v2_private.specialist_accounts) ok'))[0].ok,true);
});
await check('mixed legacy/native FX-outage exits settle once and reconcile whole-account PnL and modeled-cost counters',async()=>{
 const previous=fixture().markets[0].bars.at(-1).t-900000;
 await q("update neptune_v2_private.account set state=jsonb_set(state,'{last_bar}',$1)",[Object.fromEntries([...assets,'binance:SOLUSDT','hyperliquid:@107'].map(a=>[a,previous]))]);
 await scan(fixture({legacySignal:'ETH/USD'}));await scan(fixture({legacySignal:'ETH/USD'}));
 const outage={price:80,legacyPrice:80,fx:false,signal:false};await scan(fixture(outage));const pending=await scan(fixture(outage));
 assert.equal(pending.account.fills,4);assert(pending.account.unsettled_usd>0);assert.equal((await q('select count(*) n from neptune_v2_private.native_receivables'))[0].n,1);
 const settled=await scan(fixture({signal:false}));assert.equal(settled.account.fills,4);assert.equal(settled.account.unsettled_usd,0);
 assert.equal((await q('select count(*) n from neptune_v2_private.settlements'))[0].n,2);
 const accounting=(await q("select (select sum(realized_pnl) from neptune_v2_private.specialist_accounts) pnl,(select sum(costs_base) from neptune_v2_private.specialist_accounts) costs,(state->>'realized')::numeric realized,(state->>'fees')::numeric fees,(state->>'fx_costs')::numeric fx_costs from neptune_v2_private.account"))[0];
 assert.equal((await q('select $1::numeric=$2::numeric ok',[accounting.pnl,accounting.realized]))[0].ok,true);assert(Math.abs(Number(accounting.costs)-Number(accounting.fees)-Number(accounting.fx_costs))<1e-9);
 const cash=settled.account.cash;const repeated=await scan(fixture({signal:false}));assert.equal(repeated.account.cash,cash);assert.equal(repeated.account.fills,4);
 await q('select neptune_v2_private.native_scan_reconcile()');
});
await check('Hyperliquid and Binance maintain separate received fees, inventories and pending quote currencies',async()=>{
 const previous=fixture().markets[0].bars.at(-1).t-900000;
 await q("update neptune_v2_private.account set state=jsonb_set(state,'{last_bar}',$1)",[Object.fromEntries([...assets,'binance:SOLUSDT','hyperliquid:@107'].map(a=>[a,previous]))]);
 const both={nativeSignals:['binance:SOLUSDT','hyperliquid:@107']};
 await scan(fixture(both));const r=await scan(fixture(both));assert.equal(r.account.fills,2,JSON.stringify(await q("select payload from neptune_v2_private.decisions where payload->>'asset'='hyperliquid:@107'"))); 
 const buys=await q('select payload from neptune_v2_private.fills');assert.deepEqual(new Set(buys.map(x=>x.payload.fee_currency)),new Set(['SOL','HYPE']));
 const outage={price:80,fx:false,signal:false};await scan(fixture(outage));await scan(fixture(outage));
 assert.deepEqual(new Set((await q('select currency from neptune_v2_private.native_receivables')).map(x=>x.currency)),new Set(['USDT','USDC']));
 await q('select neptune_v2_private.native_scan_reconcile()');
});
const unchanged={};for(const f of files)unchanged[f]=(await fs.readFile(new URL('../'+f,import.meta.url),'utf8'))===loaded[f];
await db.close();console.log(JSON.stringify({hashes,source_unchanged_during_test:unchanged,tests:report},null,2));if(report.some(x=>x.result==='FAIL'))process.exitCode=1;
