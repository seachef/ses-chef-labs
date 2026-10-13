import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateResearch,createResearchSession,researchDigest,RESEARCH_MAX_BYTES} from '../reviewed-research.mjs';
import {mountExchangeHandoff} from '../exchange-handoff.mjs';
import {AT,syntheticSetup,packet,documentStub} from './research-fixtures.mjs';
const response=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function setupUI(t,research,now=()=>AT){const doc=documentStub(),app=mountExchangeHandoff(doc,{research,now});t.after(()=>app.destroy());const get=k=>doc.getElementById('handoff-'+k);const select=(v,p)=>{get('venue').value=v;get('venue').dispatch('change');get('pair').value=p;get('pair').dispatch('change');};return {doc,app,get,select};}
test('controlled loader to qualified synthetic Buy: full review binding, displayed evidence and ordinary exact navigation',async t=>{
 const p=await packet();let at=AT;const calls=[];const research=createResearchSession({origin:'https://preview.example',now:()=>at,fetchImpl:async(url,init)=>{calls.push({url,init});return response(url.endsWith('research-setups.json')?p.feed:p.manifest);}});t.after(()=>research.destroy());assert.equal(await research.refresh(),true);
 const h=setupUI(t,research,()=>at);h.select('coinspot','BTC-AUD');assert.equal(h.get('buy').disabled,false);assert.equal(h.get('buy').getAttribute('href'),'https://www.coinspot.com.au/trade/BTC');assert.equal(h.get('buy').dispatch('click').defaultPrevented,false);
 assert.match(h.get('research').textContent,/entry 100 · stop 95 · targets 110 \/ 120/);assert.match(h.get('research').textContent,/modeled|Modeled/);assert.match(h.get('research').textContent,/Source .*received .*reviewed .*expires/);
 for(const c of calls){assert.equal(c.init.credentials,'omit');assert.equal(c.init.redirect,'error');assert.equal(c.init.method,'GET');assert.match(c.url,/^https:\/\/preview\.example\/research-(setups|reviews)\.json$/);}
 const before=research.evaluate('coinspot','BTC-AUD',at);for(let i=0;i<5;i++)assert.equal(h.get('buy').dispatch('click').defaultPrevented,false);assert.deepEqual(research.evaluate('coinspot','BTC-AUD',at),before);assert.equal(calls.length,2);
 at=p.feed.setups[0].expiresAt;assert.equal(h.get('buy').dispatch('click').defaultPrevented,true);assert.equal(h.get('buy').getAttribute('href'),null);assert.match(h.get('reason').textContent,/expired/);
});
test('expiry while displayed and clock rollback fail closed; caller mutation cannot alter accepted research',async t=>{
 const p=await packet(),approved=await validateResearch(p.feed,p.manifest,{now:AT});let at=AT;const h=setupUI(t,approved,()=>at);h.select('coinspot','BTC-AUD');p.feed.setups[0].entry=1;p.manifest.approvals[0].expiresAt=AT+999999;
 assert.equal(h.get('buy').disabled,false);at=AT+120000;h.app.paint();assert.equal(h.get('buy').disabled,true);at=AT;h.app.paint();assert.match(h.get('reason').textContent,/clock/);assert.equal(h.get('buy').disabled,true);
});
test('unreviewed record changes and exact evidence digest changes are rejected independently',async()=>{
 for(const mutate of [p=>p.feed.setups[0].targets[0]=111,p=>p.feed.setups[0].market.captureSha256='c'.repeat(64),p=>p.feed.setups[0].fees.captureSha256='d'.repeat(64),p=>p.manifest.approvals[0].marketDigest='e'.repeat(64),p=>p.manifest.approvals[0].feeDigest='f'.repeat(64),p=>p.manifest.approvals[0].decision='pending']){const p=await packet();mutate(p);await assert.rejects(validateResearch(p.feed,p.manifest,{now:AT}));}
});
test('even rehashed approvals cannot authorize malformed identities, price levels, source routes or incomplete costs',async t=>{
 const cases={venue:s=>s.market.venue='okx',currency:s=>s.market.quoteCurrency='USD',pair:s=>s.fees.pair='ETH-AUD',source:s=>s.market.sourceUrl='https://api.exchange.coinbase.com/products/BTC-USD/ticker',url:s=>s.market.sourceUrl+='?side=buy',future:s=>s.market.receivedAt=AT+1,entry:s=>s.entry=99,stop:s=>s.stop=101,targets:s=>s.targets=[120,110],net:s=>s.targets=[100.01],depth:s=>s.costs.quantity=3,fee:s=>s.fees.buyBps=null,product:s=>s.fees.basis='coinspot-instant',cost:s=>s.costs.slippageBps=-1,missing:s=>delete s.fees.captureSha256,private:s=>s.accountBalance=10000};
 for(const [name,mutate] of Object.entries(cases))await t.test(name,async()=>{const s=syntheticSetup();mutate(s);const p=await packet(s);await assert.rejects(validateResearch(p.feed,p.manifest,{now:AT}));});
});
test('duplicate records/reviews, unknown versions, mismatched revisions, unsupported private fields and future reviews fail',async()=>{
 const changes=[p=>p.feed.setups.push(p.feed.setups[0]),p=>p.manifest.approvals.push(p.manifest.approvals[0]),p=>p.feed.schemaVersion=2,p=>p.manifest.revision='other',p=>p.manifest.approvals[0].reviewedAt=AT+1,p=>p.manifest.approvals[0].accountId='private',p=>p.manifest.approvals[0].reviewerId='',p=>p.manifest.approvals=[]];
 for(const mutate of changes){const p=await packet();mutate(p);await assert.rejects(validateResearch(p.feed,p.manifest,{now:AT}));}
});
test('OKX requires independently bound pair-specific personal fee evidence; unknown fee never qualifies',async()=>{
 const s=syntheticSetup();s.venue=s.market.venue=s.fees.venue='okx';s.market.sourceUrl=s.fees.sourceUrl='https://www.okx.com/en-au/trade-spot/btc-aud';s.fees.basis='unknown';let p=await packet(s);await assert.rejects(validateResearch(p.feed,p.manifest,{now:AT}));
 // Still a fabricated offline fixture, never a statement of anyone's OKX rate.
 s.fees.basis='okx-personal-pair-confirmed';s.fees.buyBps=s.fees.sellBps=20;p=await packet(s);assert.equal((await validateResearch(p.feed,p.manifest,{now:AT})).evaluate('okx','BTC-AUD',AT).status,'READY');
});
test('owner-directed Sell requires matching session confirmation, survives buy expiry and never infers holdings from Buy',async t=>{
 const p=await packet(),approved=await validateResearch(p.feed,p.manifest,{now:AT});let at=AT;const h=setupUI(t,approved,()=>at);h.select('coinspot','BTC-AUD');h.get('buy').dispatch('click');assert.equal(h.get('sell').disabled,true);
 h.get('owner').checked=true;h.get('owner').dispatch('change');assert.equal(h.get('sell').disabled,false);at=AT+120000;h.app.paint();assert.equal(h.get('buy').disabled,true);assert.equal(h.get('sell').disabled,false);assert.equal(h.get('sell').dispatch('click').defaultPrevented,false);
 h.get('venue').value='okx';assert.equal(h.get('sell').dispatch('click').defaultPrevented,true);assert.equal(h.get('sell').getAttribute('href'),null);assert.equal(h.get('owner').checked,false);
 h.select('coinspot','BTC-AUD');assert.equal(h.get('sell').disabled,true);h.get('owner').checked=true;h.get('owner').dispatch('change');h.select('coinspot','ETH-AUD');assert.equal(h.get('sell').disabled,true);
});
test('Sell is available with empty/unavailable research only after owner confirmation; clear on reload',t=>{
 const h=setupUI(t,null);h.select('okx','ETH-USDT');h.get('owner').checked=true;h.get('owner').dispatch('change');assert.equal(h.get('sell').disabled,false);assert.equal(h.get('buy').disabled,true);assert.equal(h.get('sell').getAttribute('href'),'https://www.okx.com/en-au/trade-spot/eth-usdt');h.app.destroy();assert.equal(h.get('owner').checked,false);assert.equal(h.get('sell').getAttribute('href'),null);
});
test('loader fails closed for one-file failure, redirects, wrong media type, invalid/truncated JSON and excessive bodies',async()=>{
 const p=await packet();const bad=[()=>new Response('{}',{status:500}),()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>new Response(' '.repeat(RESEARCH_MAX_BYTES+1),{headers:{'content-type':'application/json'}}),()=>{const r=response(p.manifest);Object.defineProperty(r,'redirected',{value:true});return r;},()=>{const r=response(p.manifest);Object.defineProperty(r,'url',{value:'https://evil.example/reviews'});return r;}];
 for(const factory of bad){const session=createResearchSession({origin:'https://preview.example',now:()=>AT,fetchImpl:async url=>url.endsWith('setups.json')?response(p.feed):factory()});assert.equal(await session.refresh(),false);assert.equal(session.evaluate('coinspot','BTC-AUD',AT).status,'WAIT');session.destroy();}
});
test('failed refresh clears previous approval; canceled or timed-out late work cannot re-enable Buy',async()=>{
 const p=await packet();let mode='ok',release;const session=createResearchSession({origin:'https://preview.example',now:()=>AT,timeoutMs:20,fetchImpl:async url=>{if(mode==='failed')throw Error('offline');if(mode==='hung')return new Promise(done=>{release=()=>done(response(p.feed));});return response(url.endsWith('setups.json')?p.feed:p.manifest);}});
 await session.refresh();assert.equal(session.evaluate('coinspot','BTC-AUD',AT).status,'READY');mode='failed';await session.refresh();assert.equal(session.evaluate('coinspot','BTC-AUD',AT).status,'WAIT');mode='hung';const pending=session.refresh();session.cancel();await pending;release();await new Promise(r=>setImmediate(r));assert.equal(session.evaluate('coinspot','BTC-AUD',AT).status,'WAIT');session.destroy();
});
test('production feed and manifest are empty and contain no fixture or private account records',async()=>{
 const feed=JSON.parse(fs.readFileSync(new URL('../research-setups.json',import.meta.url))),manifest=JSON.parse(fs.readFileSync(new URL('../research-reviews.json',import.meta.url)));assert.deepEqual(feed.setups,[]);assert.deepEqual(manifest.approvals,[]);const r=await validateResearch(feed,manifest,{now:AT});assert.equal(r.evaluate('coinspot','BTC-AUD',AT).status,'WAIT');assert.doesNotMatch(JSON.stringify({feed,manifest}),/fabricated|synthetic|balance|account|wallet|quantity/i);
});
test('validation snapshots the full input before hashing; sparse, accessor and annotated arrays fail closed', async()=>{
 const p=await packet(), pending=validateResearch(p.feed,p.manifest,{now:AT});
 p.feed.revision='changed';p.feed.setups[0].entry=1;p.feed.setups[0].market.ask=1;p.feed.setups[0].targets[0]=100000;p.manifest.approvals[0].reviewerId='changed';
 const result=(await pending).evaluate('coinspot','BTC-AUD',AT);assert.equal(result.setup.entry,100);assert.equal(result.setup.targets[0],110);assert.equal(result.review.reviewerId,'synthetic-test-only');
 for(const mutate of [p=>delete p.feed.setups[0].targets[0],p=>p.feed.setups.accountBalance=10,p=>Object.defineProperty(p.manifest.approvals,'0',{get(){throw Error('MUST_NOT_READ_GETTER');}})]){const q=await packet();mutate(q);await assert.rejects(validateResearch(q.feed,q.manifest,{now:AT}),/INVALID_REVIEWED_RESEARCH/);}
});
test('malformed or untrusted origins fail before any network request',async()=>{
 let calls=0;for(const origin of [undefined,'http://preview.example','https://[','https://preview.example/path','https://user@preview.example','https://preview.example:443']){const s=createResearchSession({origin,fetchImpl:async()=>{calls++;throw Error('NO_IO');}});assert.equal(await s.refresh(),false);s.destroy();}assert.equal(calls,0);
});
