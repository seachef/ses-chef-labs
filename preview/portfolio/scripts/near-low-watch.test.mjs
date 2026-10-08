import test from 'node:test';
import assert from 'node:assert/strict';
import { CYCLE_QUOTE_AGE, isNearCycleLow } from '../portfolio/entry-cycle.mjs';
import { LOW_WATCH_ASSETS, applyWatchMarket, readLowWatch, watchMarketSources } from '../portfolio/near-low-watch.mjs';

const NOW=Date.parse('2026-10-08T00:00:00Z');
const quote=()=>({asset:'2Z',current:'1.05',low:'1',retrievedAt:NOW,sources:['https://example.test/history']});
const ticker=()=>({symbol:'2ZUSDT',lastPrice:'1.05',quoteVolume:'1000000',bidPrice:'1.04',askPrice:'1.05',closeTime:NOW});
const info=()=>({symbols:[{symbol:'2ZUSDT',baseAsset:'2Z',quoteAsset:'USDT',status:'TRADING',isSpotTradingAllowed:true}]});

test('only the exact 0–10% band qualifies, regardless of rounded labels',()=>{
 for(const current of ['1','1.000000001','1.1'])assert.equal(isNearCycleLow({...quote(),current},NOW),true);
 for(const current of ['0.999999999','1.100000000000000001','4.75','0','bad'])assert.equal(isNearCycleLow({...quote(),current,percentLabel:'+10%'},NOW),false);
 assert.equal(isNearCycleLow({...quote(),low:'0'},NOW),false);
});
test('missing, expired and future quotes never qualify',()=>{
 assert.equal(isNearCycleLow(null,NOW),false);
 assert.equal(isNearCycleLow(quote(),NOW+CYCLE_QUOTE_AGE-1),true);
 assert.equal(isNearCycleLow(quote(),NOW+CYCLE_QUOTE_AGE),false);
 assert.equal(isNearCycleLow(quote(),NOW-1),false);
 assert.equal(isNearCycleLow({...quote(),retrievedAt:NaN},NOW),false);
});
test('replacement pool excludes all five superseded watch coins',()=>{
 assert.ok(LOW_WATCH_ASSETS.length>0);
 for(const asset of ['RENDER','POL','TAO','APT','AKT'])assert.equal(LOW_WATCH_ASSETS.includes(asset),false);
 assert.throws(()=>watchMarketSources('RENDER'),/Unsupported/);
});
test('spot check uses the fresh exact price without mutating history',()=>{
 const history=quote(),copy=structuredClone(history),market=ticker();market.lastPrice='1.1';market.closeTime=NOW-1000;
 const q=applyWatchMarket(history,market,info(),NOW);
 assert.equal(q.current,'1.1');assert.equal(q.percentLabel,'+10%');assert.equal(q.retrievedAt,NOW-1000);assert.equal(isNearCycleLow(q,NOW),true);assert.deepEqual(history,copy);
 market.lastPrice='1.10000000001';assert.equal(isNearCycleLow(applyWatchMarket(history,market,info(),NOW),NOW),false);
 market.lastPrice='1';assert.equal(applyWatchMarket(history,market,info(),NOW).percentLabel,'At low');
});
test('thin, suspended, mismatched, stale or inconsistent markets fail closed',()=>{
 for(const changes of [{quoteVolume:'999999.99'},{bidPrice:'1',askPrice:'1.01000001'},{askPrice:'1'},{bidPrice:'0'},{lastPrice:'0.9'},{symbol:'OTHERUSDT'},{closeTime:NOW-CYCLE_QUOTE_AGE},{closeTime:NOW+1}])assert.throws(()=>applyWatchMarket(quote(),{...ticker(),...changes},info(),NOW));
 for(const changes of [{status:'BREAK'},{isSpotTradingAllowed:false},{quoteAsset:'USD'},{baseAsset:'OTHER'}]){const listing=info();Object.assign(listing.symbols[0],changes);assert.throws(()=>applyWatchMarket(quote(),ticker(),listing,NOW));}
 assert.throws(()=>applyWatchMarket(quote(),ticker(),{},NOW));
});
test('market lookup rejects source failures and unsupported assets',async()=>{
 await assert.rejects(readLowWatch('RENDER',{fetchImpl:()=>{throw Error('must not fetch');}}),/Unsupported/);
 await assert.rejects(readLowWatch('2Z',{fetchImpl:async()=>({ok:false})}),/unavailable/);
});
