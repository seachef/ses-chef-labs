import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { classifySignals, computeMarketCondition } from '../portfolio/market-condition.mjs';
const raw = JSON.parse(fs.readFileSync(new URL('../data/market-conditions.json', import.meta.url)));
const snap = {breadth:{universeId:raw.universe.id,universeSelectedAt:raw.universe.selectedAt,symbols:raw.universe.symbols,universeMode:raw.universe.mode}};
const nowMs = Date.parse('2026-10-07T12:23:00Z');
const input = { btcDailyBars: raw.btcDailyBars, breadthTickers: raw.breadthTickers, universe: { id: snap.breadth.universeId, selectedAt: snap.breadth.universeSelectedAt, symbols: snap.breadth.symbols }, nowMs };
test('Observed evidence: mixed positive BTC trend and weak breadth', () => { const r=computeMarketCondition(input); assert.equal(r.condition,'neutral'); assert.equal(r.score,1); assert.equal(r.breadth.advancing,17); assert.equal(r.breadth.declining,98); assert.equal(r.btc.close,85549.93); assert.ok(Math.abs(r.btc.sma50-79924.9116)<1e-8); assert.ok(Math.abs(r.btc.sma200-71693.2068)<1e-8); });
for (const [up, signal] of [[39,-1],[40,-1],[41,0],[59,0],[60,1],[61,1]]) test('Breadth boundary '+up+'%', () => assert.equal(classifySignals(0,0,up,100).breadthSignal,signal));
for (const [a,b,n,expected] of [[1,1,60,'bull'],[1,1,50,'bull'],[1,1,40,'neutral'],[-1,-1,40,'bear'],[-1,-1,50,'bear'],[-1,-1,60,'neutral'],[1,-1,100,'neutral'],[0,0,50,'neutral']]) test('Combination '+[a,b,n], () => assert.equal(classifySignals(a,b,n,100).condition,expected));
test('Missing ticker is Unknown, not Neutral', () => assert.equal(computeMarketCondition({...input,breadthTickers:input.breadthTickers.slice(1)}).condition,'unknown'));
test('Duplicate ticker is Unknown', () => assert.equal(computeMarketCondition({...input,breadthTickers:[...input.breadthTickers.slice(1),input.breadthTickers[1]]}).condition,'unknown'));
test('Missing BTC candle is Unknown', () => assert.equal(computeMarketCondition({...input,btcDailyBars:input.btcDailyBars.slice(1)}).condition,'unknown'));
test('Duplicate BTC candle is Unknown', () => assert.equal(computeMarketCondition({...input,btcDailyBars:[...input.btcDailyBars,input.btcDailyBars[0]]}).condition,'unknown'));
test('NaN is Unknown', () => { const t=structuredClone(input.breadthTickers);t[0].priceChange='NaN';assert.equal(computeMarketCondition({...input,breadthTickers:t}).condition,'unknown'); });
test('Blank value is Unknown', () => { const t=structuredClone(input.breadthTickers);t[0].priceChange='';assert.equal(computeMarketCondition({...input,breadthTickers:t}).condition,'unknown'); });
test('Future ticker is Unknown', () => { const t=structuredClone(input.breadthTickers); t[0].closeTime=nowMs+60001;t[0].openTime=t[0].closeTime-86400000;assert.equal(computeMarketCondition({...input,breadthTickers:t}).condition,'unknown'); });
test('Exactly 60 minutes remains valid', () => { const min=Math.min(...input.breadthTickers.map(x=>x.closeTime));assert.equal(computeMarketCondition({...input,nowMs:min+3600000}).condition,'neutral'); });
test('60 minutes plus 1 ms becomes Unknown', () => { const min=Math.min(...input.breadthTickers.map(x=>x.closeTime));assert.equal(computeMarketCondition({...input,nowMs:min+3600001}).condition,'unknown'); });
test('UTC day rollover requires fresh completed bar', () => assert.equal(computeMarketCondition({...input,nowMs:Date.parse('2026-10-08T00:00:00Z')}).condition,'unknown'));
test('Expired whitelist is Unknown', () => assert.equal(computeMarketCondition({...input,universe:{...input.universe,selectedAt:'2026-10-06T11:21:43.185Z'}}).condition,'unknown'));
test('Zero total rejected', () => assert.equal(classifySignals(1,1,0,0).condition,'unknown'));
test('Missing universe identity is Unknown', () => assert.equal(computeMarketCondition({...input,universe:{...input.universe,id:undefined}}).condition,'unknown'));
test('Negative advancers rejected', () => assert.equal(classifySignals(1,1,-1,100).condition,'unknown'));
test('BTC exact equality is neutral, without floating artifacts', () => { const b=structuredClone(input.btcDailyBars);for(const row of b) row[4]='0.10000000';const r=computeMarketCondition({...input,btcDailyBars:b});assert.equal(r.sma50Signal,0);assert.equal(r.sma200Signal,0);assert.equal(r.condition,'neutral'); });
test('Open daily candle excluded from SMA', () => { const b=structuredClone(input.btcDailyBars);const row=structuredClone(b.at(-1));row[0]+=86400000;row[6]+=86400000;row[4]='999999.00000000';b.push(row);assert.equal(computeMarketCondition({...input,btcDailyBars:b}).btc.close,85549.93); });
test('Fixed basket keeps original selection date with fresh next-day synthetic prices', () => {
  const next=structuredClone(input); next.nowMs+=86400000; next.universe.mode='fixed_basket';
  for(const row of next.btcDailyBars){row[0]+=86400000;row[6]+=86400000;}
  for(const row of next.breadthTickers){row.openTime+=86400000;row.closeTime+=86400000;}
  const r=computeMarketCondition(next);
  assert.equal(r.condition,'neutral'); assert.equal(r.breadth.universeSelectedAt,input.universe.selectedAt);
  assert.equal(r.breadth.universeMode,'fixed_basket'); assert.equal(r.btc.closedCandleDate,'2026-10-07');
  assert.equal(r.expiresAt,'2026-10-08T13:21:57.517Z');
});
test('Fixed basket does not waive ticker freshness', () => assert.equal(computeMarketCondition({...input,universe:{...input.universe,mode:'fixed_basket'},nowMs:input.nowMs+3600000}).condition,'unknown'));
test('Fixed basket does not waive complete source coverage', () => assert.equal(computeMarketCondition({...input,universe:{...input.universe,mode:'fixed_basket'},breadthTickers:input.breadthTickers.slice(1)}).condition,'unknown'));
test('Fixed basket rejects a future selection date', () => assert.equal(computeMarketCondition({...input,universe:{...input.universe,mode:'fixed_basket',selectedAt:'2026-10-08T11:21:43.185Z'}}).condition,'unknown'));
test('Unrecognized basket mode is Unknown', () => assert.equal(computeMarketCondition({...input,universe:{...input.universe,mode:'always_fresh'}}).condition,'unknown'));

