import test from 'node:test';
import assert from 'node:assert/strict';
import { ATH_MAX_AGE, ATH_SOURCE, isFreshATH, parseATHMarkets, readATHMarkets } from '../portfolio/entry-ath.mjs';
const now=Date.parse('2026-10-08T05:00:00Z');
const row=()=>({id:'doublezero',symbol:'2z',ath:0.893679,current_price:0.03875592,ath_date:'2025-10-02T05:11:45Z',last_updated:new Date(now).toISOString()});
test('uses reported all-time high and matching USD quote, not an exchange cycle peak',()=>{
 const data=row(),copy=structuredClone(data),ath=parseATHMarkets([data],now).get('2Z');
 assert.equal(ath.ath,0.893679);assert.equal(ath.belowLabel,'95.7%');assert.equal(ath.currency,'USD');assert.equal(ath.at,Date.parse(data.ath_date));assert.equal(ath.source,'https://www.coingecko.com/en/coins/doublezero');assert.deepEqual(data,copy);
});
test('requires exact ID and symbol; partial or duplicate records fail closed per coin',()=>{
 assert.equal(parseATHMarkets([{...row(),id:'another-coin'}],now).size,0);
 assert.equal(parseATHMarkets([{...row(),symbol:'open'}],now).size,0);
 assert.equal(parseATHMarkets([row(),row()],now).size,0);
 assert.equal(parseATHMarkets([row(),{...row(),id:'openledger-2',symbol:'open',ath:1.82}],now).size,2);
});
test('rejects missing, invalid, future or stale all-time records without substituting peaks',()=>{
 for(const patch of [{ath:null},{ath:'0.89'},{ath:0},{ath:Infinity},{current_price:0},{current_price:1},{ath_date:null},{ath_date:'2027-01-01'},{last_updated:new Date(now+1).toISOString()},{last_updated:new Date(now-ATH_MAX_AGE).toISOString()}])assert.equal(parseATHMarkets([{...row(),...patch}],now).size,0,JSON.stringify(patch));
 assert.equal(isFreshATH({observedAt:now},now+ATH_MAX_AGE-1),true);assert.equal(isFreshATH({observedAt:now},now+ATH_MAX_AGE),false);
});
test('formats exact and almost all-time-high without a misleading zero',()=>{
 assert.equal(parseATHMarkets([{...row(),current_price:row().ath}],now).get('2Z').belowLabel,'At ATH');
 assert.equal(parseATHMarkets([{...row(),current_price:row().ath*0.9999}],now).get('2Z').belowLabel,'<0.1%');
});
test('public batched GET sends no credentials or referrer',async()=>{
 const r=await readATHMarkets({now:()=>now,fetchImpl:async(url,options)=>{assert.equal(url,ATH_SOURCE);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');return {ok:true,url,text:async()=>JSON.stringify([row()])};}});assert.equal(r.size,1);
});
test('HTTP failures, redirects, oversized payloads and cancellation never yield ATH',async()=>{
 for(const response of [{ok:false},{ok:true,redirected:true},{ok:true,url:'https://other.test'},{ok:true,text:async()=>' '.repeat(65537)}])await assert.rejects(readATHMarkets({fetchImpl:async()=>response,now:()=>now}));
 const c=new AbortController();c.abort();await assert.rejects(readATHMarkets({fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify([row()])}),signal:c.signal,now:()=>now}));
});
