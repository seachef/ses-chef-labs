import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COINS, SOCIALS, decimalSum, displayDecimal, aud, groupHoldings, portfolioTotal, historyPoints, coinMetadata, socialURL, snapshotFreshness, valuationContext, partitionHoldings, pricedHoldingsSummary } from '../portfolio/model.mjs';
import {createPortfolioAdapter} from '../portfolio/adapter.mjs';
// Synthetic values only. No personal fixtures or real wallet addresses.
const snapshot={id:'fixture',status:'complete',observed_at:'2026-10-01T10:00:00Z',expected_wallets:2,observed_wallets:2,unpriced_assets:0,usd_to_aud:'1.5',fx_observed_at:'2026-10-01T09:00:00Z',fx_source:'Test source',held_value_aud:'15'};
const balance=(raw,extra={})=>({chain_id:1,asset_id:COINS[2].assetId,symbol:'HEX',decimals:8,balance_raw:raw,price_usd:'2',price_status:'observed',price_observed_at:'2026-10-01T09:00:00Z',price_source:'Fixture',...extra});
const model={snapshot,balances:[balance('100000000'),balance('200000000')],stakes:[{...balance('0'),principal_raw:'200000000',status:'active'}],rewardEstimates:[{symbol:'HDRN',amount_raw:'99999999999999999999999'}],history:[snapshot]};
test('aggregation uses exact integer token units and keeps staked principal separate',()=>{const [h]=groupHoldings(model);assert.equal(h.liquid,'3');assert.equal(h.staked,'2');assert.equal(h.quantity,'5');assert.equal(h.aud,'15');assert.equal(h.usd,'10');});
test('unminted rewards never enter held totals',()=>{assert.deepEqual(groupHoldings({...model,rewardEstimates:[]}),groupHoldings(model));assert.equal(portfolioTotal(model),'15');});
test('contract identity prevents same-symbol logo collisions',()=>{const [real]=groupHoldings(model);assert.equal(coinMetadata(real).symbol,'HEX');assert.equal(coinMetadata({...real,assetId:'different'}),null);assert.equal(coinMetadata({...real,chainId:2}),null);assert.equal(coinMetadata({...real,decimals:18}),null);const groups=groupHoldings({...model,balances:[...model.balances,balance('10',{asset_id:'other'})]});assert.equal(groups.length,2);});
test('missing price and FX remain null, never zero',()=>{assert.equal(groupHoldings({...model,balances:[balance('100000000',{price_status:'missing',price_usd:null})]})[0].aud,null);assert.equal(groupHoldings({...model,snapshot:{...snapshot,usd_to_aud:null}})[0].aud,null);assert.equal(portfolioTotal({...model,snapshot:{...snapshot,fx_source:null}}),null);assert.equal(aud(null),'—');});
test('unlocked stakes excluded and staked-only assets are not zero valued',()=>{assert.equal(groupHoldings({...model,stakes:[{...model.stakes[0],status:'unlocked'}]})[0].staked,'0');const [h]=groupHoldings({...model,balances:[balance('0')]});assert.equal(h.staked,'2');assert.equal(h.aud,'6');const [missing]=groupHoldings({...model,balances:[]});assert.equal(missing.aud,null);});
test('partial snapshots cannot imply a complete portfolio total or line segment',()=>{for(const patch of [{status:'partial'},{observed_wallets:1},{unpriced_assets:1}]){const s={...snapshot,...patch};assert.equal(portfolioTotal({...model,snapshot:s}),null);assert.equal(historyPoints([s],30,Date.parse('2026-10-01T11:00:00Z'))[0].value,null);}});
test('no fabricated history before the first snapshot',()=>{assert.deepEqual(historyPoints([],30),[]);const rows=historyPoints([snapshot],30,Date.parse('2026-10-01T11:00:00Z'));assert.equal(rows.length,1);assert.equal(rows[0].at,snapshot.observed_at);});
test('large and tiny quantities preserve meaning',()=>{assert.equal(decimalSum(['9007199254740993.01','0.09']),'9007199254740993.1');assert.equal(displayDecimal('9007199254740993.12345678'),'9,007,199,254,740,993.123456');assert.equal(displayDecimal('0.0000001'),'<0.000001');assert.equal(aud('999.999'),'A$1,000.00');assert.throws(()=>decimalSum(['NaN']));});
test('unconfigured adapter makes no requests and never supplies mock balances',async()=>{const adapter=createPortfolioAdapter();assert.deepEqual(await adapter.readPortfolio(),{status:'not-configured',model:null});assert.deepEqual(await adapter.getSocialLinks(),{});});
test('signed-out clients never read private tables',async()=>{const client={auth:{getUser:async()=>({data:{user:null}})},from(){throw Error('must not query')}};assert.equal((await createPortfolioAdapter(client).readPortfolio()).status,'signed-out');});
test('public shell has honest state, no HBAR seed, wallets, private owner labels or return scenarios',()=>{const html=fs.readFileSync('index.html','utf8');for(const forbidden of ['const stake=1000','0x','28,460','120,000,000','80,000,000','APY','Return Scenarios'])assert.equal(html.includes(forbidden),false,forbidden);for(const expected of ['Not connected','Refresh balances','No wallet signing','portfolio.mjs'])assert.ok(html.includes(expected),expected);});
test('private frontend never persists portfolio data or uses wallet signing',()=>{for(const file of ['portfolio.mjs','portfolio/adapter.mjs','portfolio/model.mjs']){const code=fs.readFileSync(file,'utf8');for(const forbidden of ['localStorage','indexedDB','eth_sendTransaction','personal_sign','service_role','setInterval'])assert.equal(code.includes(forbidden),false,file+': '+forbidden);}});
test('social links are platform allowlisted and generic by default',()=>{assert.equal(SOCIALS.length,13);assert.equal(socialURL('x','https://x.com/example'),'https://x.com/example');for(const url of ['javascript:alert(1)','https://x.com.evil.test/','https://evil.test/','https://a:b@x.com/'])assert.equal(socialURL('x',url),null);});
test('retired research navigation is not exposed in the portfolio',()=>{const html=fs.readFileSync('index.html','utf8');assert.equal(html.includes('researchView'),false);assert.equal(html.includes('../../index.html'),false);});
test('official source assets exist and source provenance is retained',()=>{const provenance=JSON.parse(fs.readFileSync('assets/coins/provenance.json','utf8'));for(const coin of COINS){assert.ok(fs.statSync('assets/coins/'+coin.icon).size>0);assert.ok(provenance.some(p=>p.ticker===coin.symbol&&p.source_page.startsWith('https://')));}});
function mockClient({tables={},expireAfter=null}={}){const calls=[];let authCalls=0;return {calls,auth:{getUser:async()=>({data:{user:expireAfter!=null&&++authCalls>expireAfter?null:{id:'owner-fixture'}}}),signOut:async()=>({error:null})},from(table){const call={table,filters:{}};calls.push(call);const query={select(){return query;},eq(k,v){call.filters[k]=v;return query;},order(k,o){call.order={k,o};return query;},range(start,end){call.range=[start,end];return Promise.resolve({data:(tables[table]||[]).slice(start,end+1),error:null});}};return query;}};}
test('authenticated adapter filters every table by current owner, account and snapshot',async()=>{const client=mockClient({tables:{portfolio_accounts:[{id:'account-fixture',owner_id:'owner-fixture',kind:'smsf'}],portfolio_wallets:[{id:'wallet-fixture'}],portfolio_snapshots:[snapshot],portfolio_balance_snapshots:[balance('1')]}});const result=await createPortfolioAdapter(client).readPortfolio();assert.equal(result.status,'ready');assert.equal(result.model.balances.length,1);for(const c of client.calls){assert.equal(c.filters.owner_id,'owner-fixture');if(c.table!=='portfolio_accounts')assert.equal(c.filters.account_id,'account-fixture');if(['portfolio_balance_snapshots','portfolio_stake_snapshots','portfolio_reward_estimates'].includes(c.table))assert.equal(c.filters.snapshot_id,'fixture');}});
test('session expiration discards all fetched private rows',async()=>{for(const history of [[snapshot],[]]){const client=mockClient({expireAfter:1,tables:{portfolio_accounts:[{id:'account-fixture',owner_id:'owner-fixture',kind:'smsf'}],portfolio_wallets:[{id:'wallet-fixture'}],portfolio_snapshots:history}});assert.deepEqual(await createPortfolioAdapter(client).readPortfolio(),{status:'signed-out',model:null});}});
test('adapter paginates rather than silently dropping private balances',async()=>{const balances=Array.from({length:501},()=>balance('1'));const client=mockClient({tables:{portfolio_accounts:[{id:'account-fixture',owner_id:'owner-fixture',kind:'smsf'}],portfolio_snapshots:[snapshot],portfolio_balance_snapshots:balances}});const result=await createPortfolioAdapter(client).readPortfolio();assert.equal(result.model.balances.length,501);assert.deepEqual(client.calls.filter(c=>c.table==='portfolio_balance_snapshots').map(c=>c.range),[[0,499],[500,999]]);});
test('requested shortcut groups are separate from watched wallets and contain no email addresses',()=>{const html=fs.readFileSync('index.html','utf8');for(const word of ['My shortcuts','Conversations shortcuts','Watched wallets','Wallets &amp; trading','https://email.telstra.com/','https://mail.google.com/','https://web.whatsapp.com/','https://app.zerion.io/'])assert.ok(html.includes(word),word);assert.equal(/mailto:|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html),false);assert.equal(html.includes('Messenger'),false);});

test('old and future snapshot timestamps are not presented as fresh',()=>{const now=Date.parse('2026-10-03T11:00:00Z');assert.equal(snapshotFreshness(snapshot,now),'stale');assert.equal(snapshotFreshness(snapshot,Date.parse('2026-10-01T11:00:00Z')),'dated');assert.equal(snapshotFreshness(snapshot,Date.parse('2026-09-30T11:00:00Z')),'unverified-time');});
test('permanent dark startup and actual rounded font do not depend on OS theme',()=>{const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('portfolio.css','utf8');assert.ok(html.includes('<meta name="color-scheme" content="dark">'));assert.ok(html.indexOf('<style>html,body{background:#030b11')<html.indexOf('rel="stylesheet"'));assert.ok(css.includes("font-family:'Nunito'"));assert.ok(css.includes("url('assets/fonts/nunito-latin-wght-normal.woff2')"));assert.equal(css.includes('prefers-color-scheme:light'),false);assert.ok(fs.statSync('assets/fonts/nunito-latin-wght-normal.woff2').size<50000);assert.ok(css.includes('font-size:clamp(29px,2.7vw,37px)'));});
test('partial-data UI distinguishes missing FX from unpriced assets and incomplete history',()=>{const js=fs.readFileSync('portfolio.mjs','utf8');for(const expected of ['AUD FX unavailable','Price unavailable','Saved partial snapshot'])assert.ok(js.includes(expected),expected);});

test('visible identity is Portfolio with a clean text brand',()=>{const html=fs.readFileSync('index.html','utf8');assert.ok(html.includes('<h1 id="portfolioTitle"><a'));assert.ok(html.includes('Portfolio <img'));assert.equal(/class="brand"[^>]*>\s*<img/.test(html),false);assert.equal(html.includes('Personal'),false);});


test('carried-forward valuation never refreshes the balance date or creates complete history',()=>{
  const carried={...snapshot,observed_at:'2026-10-02T01:20:00Z',provenance:{valuation:{basis:'carried_forward_balances',balances_refreshed:false,balance_as_of_start:'2026-10-01T10:32:35Z',balance_as_of_end:'2026-10-01T11:09:31Z',valued_at:'2026-10-02T01:20:00Z'}}};
  assert.equal(valuationContext(carried).balanceStart,'2026-10-01T10:32:35Z');
  assert.equal(snapshotFreshness(carried,Date.parse('2026-10-03T00:00:00Z')),'stale');
  assert.equal(portfolioTotal({...model,snapshot:carried}),null);
  assert.equal(historyPoints([carried],30,Date.parse('2026-10-02T02:00:00Z'))[0].value,null);
  assert.equal(valuationContext({...carried,provenance:{valuation:{basis:'carried_forward_balances'}}}).balanceStart,null);
});
test('partial valuations retain individual AUD values and explicit quote flags',()=>{
  const quote={confidence:'low',low_liquidity:true,held_valuation_eligible:true,provider_as_of:null,retrieved_at:'2026-10-02T01:20:00Z'};
  const partial={...model,snapshot:{...snapshot,status:'partial',unpriced_assets:1},balances:[balance('100000000',{provenance:{quote}})]};
  const [h]=groupHoldings(partial);assert.equal(h.aud,'9');assert.equal(h.quote.low_liquidity,true);assert.equal(h.quote.provider_as_of,null);assert.equal(portfolioTotal(partial),null);
  const [excluded]=groupHoldings({...partial,balances:[balance('100000000',{provenance:{quote:{...quote,held_valuation_eligible:false}}})]});assert.equal(excluded.usd,null);assert.equal(excluded.aud,null);
});


test('staking grouping is an exact partition by verified token identity',()=>{
  const holdings=groupHoldings({...model,balances:[...model.balances,balance('1',{asset_id:COINS[0].assetId,symbol:'DRAGONX',decimals:18}),balance('2',{asset_id:'unrecognized',symbol:'HEX'})]});
  const split=partitionHoldings(holdings);
  assert.equal(split.staking.length,1);assert.equal(split.staking[0].symbol,'HEX');assert.equal(split.main.length,2);
  assert.equal(new Set([...split.main,...split.staking].map(h=>h.key)).size,holdings.length);
  assert.equal(pricedHoldingsSummary([...split.main,...split.staking]).value,pricedHoldingsSummary(holdings).value);
});
test('priced subtotal is exact, excludes missing values and never completes a partial total',()=>{
  const holdings=[{quantity:'1',aud:'9007199254740993.01'},{quantity:'2',aud:'0.09'},{quantity:'5',aud:null},{quantity:'0',aud:'0'}];
  assert.deepEqual(pricedHoldingsSummary(holdings),{value:'9007199254740993.1',pricedAssets:2,unpricedAssets:1});
  assert.equal(pricedHoldingsSummary([{quantity:'5',aud:null}]).value,null);
  const actual=groupHoldings({...model,snapshot:{...snapshot,status:'partial'}});assert.equal(pricedHoldingsSummary(actual).value,'15');assert.equal(portfolioTotal({...model,snapshot:{...snapshot,status:'partial'}}),null);
  assert.equal(pricedHoldingsSummary(groupHoldings({...model,rewardEstimates:[]})).value,pricedHoldingsSummary(groupHoldings(model)).value);
});

test('manual collector is signed-in only and never sends private scope in its request',async()=>{
 let calls=0;const client=mockClient();client.functions={invoke:async(name,options)=>{calls++;assert.equal(name,'portfolio-refresh');assert.deepEqual(options,{body:{},timeout:100000});return {data:{status:'saved',snapshot_id:'new-fixture',observed_at:'2026-10-02T06:00:00Z'},error:null};}};
 assert.equal((await createPortfolioAdapter(client).collectSnapshot()).status,'saved');assert.equal(calls,1);
 const expired=mockClient({expireAfter:0});expired.functions=client.functions;assert.equal((await createPortfolioAdapter(expired).collectSnapshot()).status,'signed-out');assert.equal(calls,1);
});
test('collector errors are bounded and raw provider messages are never returned',async()=>{
 for(const [status,body,expected] of [[503,{error:'ALCHEMY_KEY_NOT_CONFIGURED'},'unavailable'],[503,{error:'private upstream secret'},'unavailable'],[429,{error:'REFRESH_THROTTLED',retry_after_seconds:999999},'throttled'],[401,{error:'UNAUTHORIZED'},'signed-out'],[403,{error:'OWNER_NOT_PROVISIONED'},'forbidden']]){
  const client=mockClient();client.functions={invoke:async()=>({error:{context:{status,json:async()=>body}}})};const result=await createPortfolioAdapter(client).collectSnapshot();assert.equal(result.status,expected);assert.equal(JSON.stringify(result).includes('private upstream secret'),false);if(status===429)assert.equal(result.retryAfterSeconds,3600);
 }
 const client=mockClient({expireAfter:1});client.functions={invoke:async()=>({data:{status:'saved',snapshot_id:'new',observed_at:'2026-10-02T06:00:00Z'}})};assert.equal((await createPortfolioAdapter(client).collectSnapshot()).status,'signed-out');
});
test('snapshot selection has deterministic repeated-block tie breakers',async()=>{
 const client=mockClient({tables:{portfolio_accounts:[{id:'account-fixture',owner_id:'owner-fixture',kind:'smsf'}],portfolio_snapshots:[snapshot]}}),orders=[];const from=client.from.bind(client);client.from=table=>{const q=from(table);q.order=(column,options)=>{if(table==='portfolio_snapshots')orders.push([column,options]);return q;};return q;};
 await createPortfolioAdapter(client).readPortfolio();assert.deepEqual(orders.map(x=>x[0]),['observed_at','completed_at','id']);assert.ok(orders.every(x=>x[1].ascending===false&&x[1].nullsFirst===false));
});
test('pending and good-accounted stakes retain their held principal',()=>{for(const status of ['pending','good_accounted'])assert.equal(groupHoldings({...model,stakes:[{...model.stakes[0],status}]})[0].staked,'2');});

test('a transient final auth check discards new reads while preserving unavailable status',async()=>{
 const client=mockClient({tables:{portfolio_accounts:[{id:'account-fixture',owner_id:'owner-fixture',kind:'smsf'}],portfolio_snapshots:[snapshot]}});let calls=0;client.auth.getUser=async()=>++calls===1?{data:{user:{id:'owner-fixture'}}}:{error:{name:'AuthRetryableFetchError'}};
 assert.deepEqual(await createPortfolioAdapter(client).readPortfolio(),{status:'auth-unavailable',model:null});
});
test('explicit collector denial takes priority over a later auth service outage',async()=>{
 for(const status of [401,403]){const client=mockClient();let checks=0;client.auth.getUser=async()=>++checks===1?{data:{user:{id:'owner-fixture'}}}:{error:{name:'AuthRetryableFetchError'}};client.functions={invoke:async()=>({error:{context:{status,json:async()=>({error:'DENIED'})}}})};assert.equal((await createPortfolioAdapter(client).collectSnapshot()).status,status===401?'signed-out':'forbidden');assert.equal(checks,1);}
});
