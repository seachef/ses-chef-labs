import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState, step, stop, resume, auditState, validateSnapshot, proposeTrade, assessRisk, executePaper } from '../src/engine/index.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/synthetic-market.json', import.meta.url), 'utf8'));
const snapshot = (overrides = {}) => ({ ...structuredClone(fixture.snapshots[0]), ...overrides });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('deterministic synthetic depth walk and gap stop reconcile after fees', () => {
  const first = step(createState(), fixture.snapshots[0], { now: 100000 });
  assert.equal(first.decision.action, 'BUY');
  assert.equal(first.ledger.length, 1);
  near(first.execution.notional, 100.12);
  near(first.execution.fee, 0.20024);
  near(first.execution.slippageCost, 0.12);
  near(first.account.cash, 9899.67976);
  const second = step(first, fixture.snapshots[1], { now: 101000 });
  near(second.execution.averagePrice, 98);
  near(second.account.cash, 9997.48376);
  near(second.account.realizedPnl, -2.51624);
  assert.deepEqual(second.account.positions, {});
  assert.deepEqual(auditState(second), { ok: true, errors: [] });
  assert.deepEqual(second, step(step(createState(), fixture.snapshots[0], { now: 100000 }), fixture.snapshots[1], { now: 101000 }));
});

test('partial depth fill cancels remaining quantity without reusing event liquidity', () => {
  const quote = snapshot({ asks: [[100, 0.4], [101, 20]] });
  const state = step(createState(), quote, { now: 100000 });
  assert.equal(state.execution.status, 'partial');
  near(state.execution.quantity, 0.4);
  near(state.execution.canceledQuantity, 0.6);
  const retry = step(state, quote, { now: 100001 });
  assert.equal(retry.decision.action, 'REJECT');
  assert.deepEqual(retry.ledger, state.ledger);
  near(retry.account.cash, state.account.cash);
});

test('public observations and mismatched identities never execute', () => {
  const publicQuote = snapshot({ source: 'coinbase-exchange', provenance: 'public' });
  const observed = step(createState(), publicQuote, { now: 100000 });
  assert.equal(observed.ledger.length, 0);
  assert.match(observed.decision.reason, /observation-only/);
  for (const bad of [{ base: 'DOGE' }, { quote: 'USDT' }, { source: 'coinbase-exchange' }, { productId: 'DOGE-USD' }]) {
    assert.equal(validateSnapshot(snapshot(bad), { now: 100000 }).ok, false);
  }
  const proposed = proposeTrade(createState(), publicQuote, { now: 100000 }).proposal;
  assert.equal(executePaper(createState(), proposed, publicQuote, { now: 100000 }).fill, null);
  const entered = step(createState(), snapshot(), { now: 100000 });
  const publicMark = step(entered, { ...publicQuote, eventId: 'public-new', sourceAt: 100001, observedAt: 100001 }, { now: 100001 });
  assert.equal(publicMark.account.equity, null, 'Real public data cannot invent synthetic portfolio performance');
  assert.equal(publicMark.ledger.length, 1);
});

test('explicit additional adverse slippage and fees match the independent arithmetic example', () => {
  const config = { maxOrderNotional: 200, maxExposurePct: 50, maxSpreadBps: 200, slippageBps: 100, maxSlippageBps: 100, feeBps: 10 };
  const entry = snapshot({ bids: [[99.9, 10]], asks: [[100, 10]] });
  const bought = step(createState({ initialCash: 1000, config }), entry, { now: 100000 });
  near(bought.execution.quantity, 2);
  near(bought.execution.averagePrice, 101);
  near(bought.account.cash, 797.798);
  const exit = snapshot({ eventId: 'explicit-slippage-exit', sourceAt: 101000, observedAt: 101000, bids: [[99, 10]], asks: [[99.1, 10]], history: null });
  const sold = step(bought, exit, { now: 101000 });
  near(sold.execution.averagePrice, 98.01);
  near(sold.account.cash, 993.62198);
  near(sold.account.realizedPnl, -6.37802);
});

test('stale/future/malformed books and untrusted history fail closed', () => {
  for (const bad of [
    { sourceAt: 1 }, { observedAt: 100001 }, { bids: [] }, { asks: [[100, -1]] },
    { bids: [[101, 1]] }, { asks: [[100, 1], [99, 1]] },
    { history: { ...snapshot().history, to: 100001 } }, { change24hPct: NaN },
  ]) {
    const state = step(createState(), snapshot(bad), { now: 100000 });
    assert.equal(state.decision.action, 'REJECT');
    assert.equal(state.ledger.length, 0);
  }
  const unknown = step(createState(), snapshot({ history: null }), { now: 100000 });
  assert.equal(unknown.decision.action, 'WAIT');
});

test('entry pause persists, invalidates proposals, and allows fresh protective exits', () => {
  const initial = createState();
  const proposed = proposeTrade(initial, snapshot(), { now: 100000 }).proposal;
  const paused = stop(initial, { now: 100000 });
  assert.equal(paused.control.entryPaused, true);
  assert.equal(assessRisk(paused, proposed, snapshot(), { now: 100000 }).ok, false);
  assert.equal(step(paused, snapshot(), { now: 100000 }).ledger.length, 0);
  assert.equal(stop(paused, { now: 100001 }).control.version, paused.control.version);
  assert.equal(resume(paused, { now: 100001 }).control.version, paused.control.version + 1);
  const entered = step(initial, snapshot(), { now: 100000 });
  const exited = step(stop(entered, { now: 100001 }), fixture.snapshots[1], { now: 101000 });
  assert.equal(exited.execution.side, 'SELL');
  assert.equal(exited.control.entryPaused, true);
  assert.equal(exited.account.positions['BTC-USD'], undefined);
});

test('risk independently rejects oversized, forged, and stale proposals', () => {
  const state = createState();
  const proposed = proposeTrade(state, snapshot(), { now: 100000 }).proposal;
  for (const changes of [{ quantity: 100 }, { eventId: 'forged' }, { createdAt: 97000 }, { expectedPrice: 1 }, { controlVersion: 4 }]) {
    const result = executePaper(state, { ...proposed, ...changes }, snapshot(), { now: 100000 });
    assert.equal(result.fill, null);
    assert.ok(result.rejection);
  }
  for (const config of [{ maxPositionNotional: 50 }, { maxExposurePct: 0.5 }]) {
    assert.equal(step(createState({ config }), snapshot(), { now: 100000 }).decision.action, 'REJECT');
  }
  assert.equal(step(createState({ initialCash: 100 }), snapshot(), { now: 100000 }).decision.action, 'REJECT');
});

test('missing/stale held-product marks make total equity unknown and prevent new entries', () => {
  const entered = step(createState(), snapshot(), { now: 100000 });
  const next = snapshot({ eventId: 'eth-fresh', productId: 'ETH-USD', base: 'ETH', observedAt: 200000, sourceAt: 200000, history: { ...snapshot().history, to: 200000 } });
  const state = step(entered, next, { now: 200000 });
  assert.equal(state.account.valuationComplete, false);
  assert.equal(state.account.equity, null);
  assert.equal(state.account.drawdownPct, null);
  assert.equal(state.decision.action, 'REJECT');
  assert.equal(state.ledger.length, 1);
  assert.equal(auditState(state).ok, true);
});

test('loss/drawdown halt latches and still permits risk-reducing exits', () => {
  const entered = step(createState({ config: { maxLossUsd: 1, maxDrawdownPct: 0.01 } }), snapshot(), { now: 100000 });
  const exited = step(entered, fixture.snapshots[1], { now: 101000 });
  assert.equal(exited.riskHalt.active, true);
  assert.equal(exited.ledger.length, 2);
  const next = snapshot({ eventId: 'later-entry', observedAt: 102000, sourceAt: 102000, history: { ...snapshot().history, to: 102000 } });
  const rejected = step(resume(exited, { now: 102000 }), next, { now: 102000 });
  assert.equal(rejected.decision.action, 'REJECT');
  assert.equal(rejected.ledger.length, 2);
});

test('audit detects ledger, cash and position corruption; transitions refuse corrupt state', () => {
  const state = step(createState(), snapshot(), { now: 100000 });
  for (const corrupt of [s => { s.account.cash += 1; }, s => { s.ledger[0].fee = 0; }, s => { s.account.positions['BTC-USD'].quantity += 1; }]) {
    const modified = structuredClone(state); corrupt(modified);
    assert.equal(auditState(modified).ok, false);
    assert.throws(() => stop(modified, { now: 100001 }), /audit failed/);
  }
});

test('out-of-order events, clock reversal, bounded journal and bad configuration fail safely', () => {
  const state = step(createState({ config: { maxEvents: 1 } }), snapshot(), { now: 100000 });
  const older = step(state, snapshot({ eventId: 'older', sourceAt: 99999, history: null }), { now: 100000 });
  assert.match(older.decision.reason, /Out-of-order/);
  const full = step(state, fixture.snapshots[1], { now: 101000 });
  assert.match(full.decision.reason, /capacity/);
  assert.equal(full.ledger.length, 1);
  assert.throws(() => step(state, snapshot(), { now: 99999 }), /Clock/);
  for (const config of [{ feeBps: -1 }, { maxExposurePct: 101 }, { latencyMs: 250 }, { unexpected: 1 }]) assert.throws(() => createState({ config }));
});
