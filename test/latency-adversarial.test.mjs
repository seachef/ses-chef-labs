import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as engine from '../src/engine/index.mjs';
import { executePending } from '../src/engine/causal-execution.mjs';
import { normalizeBookIdentity } from '../src/book-identity.mjs';
import { openStore, recoverInterruptedLock } from '../src/store.mjs';

// Independent invented inputs; these tests never fetch prices or place orders.
const T = 100_000;
const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
const config = { latencyMs: 250, maxSignalAgeMs: 2000, maxExposurePct: 50,
  maxSpreadBps: 1000, minDepthNotional: 1, maxSlippageBps: 100, feeBps: 10 };

function quote({ eventId = 'decision', now = T, bookSequence = 1, ...extra } = {}) {
  return { schemaVersion: 1, eventId, source: 'synthetic-fixture', provenance: 'synthetic',
    productId: 'BTC-USD', base: 'BTC', quote: 'USD', observedAt: now, sourceAt: now,
    bookSequence, bookSourceAt: now, bids: [[99.9, 10]], asks: [[100, 10]],
    change24hPct: null, history: { low: 99.5, from: T - 60_000, to: T,
      samples: 7, intervalMs: 10_000, complete: false, description: 'Invented independent latency fixture' }, ...extra };
}
function initial(overrides = {}) {
  return engine.createState({ now: T, initialCash: 1000, config: { ...config, ...overrides } });
}
function processEvent(state, snapshot, now = snapshot.observedAt) {
  return engine.step(state, snapshot, { now, knownDuplicate: false, knownBookConsumed: false,
    knownTradeDuplicate: false, archivedBook: null, durableArchive: true });
}
function pending(state, productId = 'BTC-USD') { return state.pendingOrders[productId]; }
function near(actual, expected) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8,
    `${actual} differs from independently calculated ${expected}`);
}
function audited(state) {
  const result = engine.auditState(state);
  assert.equal(result.ok, true, result.errors.join('; '));
}
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-latency-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function initialize(store, overrides = {}) {
  return store.dispatch({ type: 'initialize-fixture', wallTime: T, now: T, armed: true,
    initialCash: 1000, config: { ...config, ...overrides }, pid: process.pid, host: os.hostname() });
}
function command(snapshot, now = snapshot.observedAt) {
  return { type: 'snapshot', snapshot, now, wallTime: now };
}
function submit(store, snapshot, now = snapshot.observedAt) { return store.dispatch(command(snapshot, now)); }
function bought(overrides = {}) {
  let state = processEvent(initial(overrides), quote());
  return processEvent(state, quote({ eventId: 'entry-arrival', now: T + 250, bookSequence: 2 }));
}

test('latency independent: admission reserves cash without inventing a fill, and later receipt determines fill time', () => {
  let state = processEvent(initial(), quote());
  assert.equal(state.totalFillCount, 0);
  near(state.account.cash, 1000);
  const order = structuredClone(pending(state));
  assert.equal(order.decisionAt, T);
  assert.equal(order.eligibleAt, T + 250);
  assert.equal(order.expiresAt, T + 2000);
  near(state.reservations.buyCash, 100 * 1.01 * 1.001);
  near(state.account.availableCash, 1000 - 100 * 1.01 * 1.001);
  state = processEvent(state, quote({ eventId: 'late-old-book', now: T + 300,
    bookSequence: 2, bookSourceAt: T + 100 }));
  assert.equal(state.totalFillCount, 0);
  assert.equal(pending(state).eligibleAt, order.eligibleAt);
  assert.equal(pending(state).expiresAt, order.expiresAt);
  state = processEvent(state, quote({ eventId: 'first-arrival', now: T + 320,
    bookSequence: 3, bookSourceAt: T + 260 }));
  assert.equal(state.totalFillCount, 1);
  assert.equal(state.lastFill.simulatedFillAt, T + 320);
  assert.equal(state.lastFill.decidedAt, T);
  near(state.account.cash, 899.9);
  near(state.reservations.buyCash, 0);
  near(state.account.availableCash, state.account.cash);
  audited(state);
});

test('latency independent: unknown, future and relabelled decision books cannot fill a pending order', () => {
  for (const [name, fields] of [
    ['unknown book time', { bookSourceAt: null, bookSequence: 2 }],
    ['future book time', { bookSourceAt: T + 301, bookSequence: 2 }],
    ['unknown sequence', { bookSequence: undefined }],
    ['same cached book', { bookSequence: 1, bookSourceAt: T }],
  ]) {
    const admitted = processEvent(initial(), quote());
    const state = processEvent(admitted, quote({ eventId: name, now: T + 300, ...fields }));
    assert.equal(state.totalFillCount, 0, name);
    near(state.account.cash, 1000);
    assert.equal(Object.keys(state.account.positions).length, 0);
    audited(state);
  }
});

test('latency independent: two distinct trade events at one timestamp are consumed without replenishing their shared book', () => {
  let state = processEvent(initial(), quote({ eventId: 'trade-101', tradeId: 101 }));
  const first = structuredClone(pending(state));
  state = processEvent(state, quote({ eventId: 'trade-102', tradeId: 102 }));
  assert.equal(state.totalEventCount, 2);
  assert.ok(state.seenEvents.includes('trade-101'));
  assert.ok(state.seenEvents.includes('trade-102'));
  assert.equal(state.totalFillCount, 0);
  assert.equal(pending(state).id, first.id);
  near(state.reservations.buyCash, first.reservedCash);
  audited(state);
});

test('latency independent: a new qualifying book can fill even when its cached trade ID and trade timestamp are unchanged', () => {
  let state = processEvent(initial(), quote({ eventId: 'trade-and-book-one', tradeId: 101 }));
  state = processEvent(state, quote({ eventId: 'same-trade-new-book', tradeId: 101,
    now: T + 250, sourceAt: T, bookSequence: 2 }));
  assert.equal(state.totalEventCount, 2);
  assert.equal(state.totalFillCount, 1);
  near(state.account.cash, 899.9);
  assert.equal(state.lastFill.simulatedFillAt, T + 250);
  audited(state);
});

test('latency independent: elapsed latency is counted once when an eligible book arrives near the intent deadline', () => {
  let state = processEvent(initial(), quote());
  state = processEvent(state, quote({ eventId: 'near-expiry-arrival', now: T + 1900, bookSequence: 2 }));
  assert.equal(state.totalFillCount, 1);
  assert.equal(state.lastFill.simulatedFillAt, T + 1900);
  near(state.account.cash, 899.9);
  audited(state);
});

test('latency independent: STOP releases a pending buy exactly once and resume cannot revive that intent', () => {
  let state = processEvent(initial(), quote());
  const canceledId = pending(state).id;
  state = engine.stop(state, { now: T + 100, reason: 'Independent pending-entry STOP' });
  assert.equal(pending(state), undefined);
  near(state.reservations.buyCash, 0);
  near(state.account.availableCash, 1000);
  const generation = state.control.version;
  state = engine.stop(state, { now: T + 100, reason: 'Repeated STOP' });
  assert.equal(state.control.version, generation);
  near(state.reservations.buyCash, 0);
  state = processEvent(state, quote({ eventId: 'late-canceled-arrival', now: T + 300, bookSequence: 2 }));
  assert.equal(state.totalFillCount, 0);
  state = engine.resume(state, { now: T + 300 });
  assert.equal(pending(state), undefined);
  state = processEvent(state, quote({ eventId: 'resumed-decision', now: T + 301, bookSequence: 3 }));
  assert.notEqual(pending(state).id, canceledId);
  assert.equal(pending(state).eligibleAt, T + 551);
  assert.equal(state.totalFillCount, 0);
  state = processEvent(state, quote({ eventId: 'resumed-arrival', now: T + 551, bookSequence: 4 }));
  assert.equal(state.totalFillCount, 1);
  near(state.account.cash, 899.9);
  audited(state);
});

test('latency independent: pending protective exit survives STOP and a rebound cannot erase its obligation', () => {
  let state = bought();
  state = processEvent(state, quote({ eventId: 'stop-trigger', now: T + 300, bookSequence: 3,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  const sell = structuredClone(pending(state));
  assert.equal(sell.side, 'SELL');
  assert.equal(state.totalFillCount, 1);
  near(state.reservations.sellQuantityByProduct['BTC-USD'], 1);
  state = engine.stop(state, { now: T + 400 });
  assert.equal(pending(state).id, sell.id);
  assert.doesNotMatch(state.execution.reason, /no outstanding orders/i);
  state = processEvent(state, quote({ eventId: 'rebound-exit', now: T + 550, bookSequence: 4,
    bids: [[100.5, 10]], asks: [[100.6, 10]] }));
  assert.equal(state.totalFillCount, 2);
  assert.equal(state.lastFill.side, 'SELL');
  near(state.lastFill.averagePrice, 100.5);
  near(state.account.cash, 1000.2995);
  assert.equal(Object.keys(state.account.positions).length, 0);
  assert.equal(Object.keys(state.pendingOrders).length, 0);
  assert.equal(state.control.emergencyStop, true);
  audited(state);
});

test('latency independent: STOP at a pending sell deadline expires the reservation while preserving the unsold obligation', () => {
  let state = bought();
  state = processEvent(state, quote({ eventId: 'deadline-stop-trigger', now: T + 300, bookSequence: 3,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  const deadline = pending(state).expiresAt;
  state = engine.stop(state, { now: deadline, reason: 'STOP at exact sell expiry' });
  assert.equal(state.control.emergencyStop, true);
  assert.equal(pending(state), undefined);
  near(state.reservations.sellQuantityByProduct['BTC-USD'] ?? 0, 0);
  near(state.account.positions['BTC-USD'].quantity, 1);
  assert.ok(state.exitObligations['BTC-USD']);
  assert.equal(state.lastOrderTransition.status, 'EXPIRED');
  assert.equal(state.totalFillCount, 1);
  audited(state);
});

test('latency independent: first eligible price gap cancels entry instead of waiting for a favorable book', () => {
  let state = processEvent(initial(), quote());
  const originalId = pending(state).id;
  state = processEvent(state, quote({ eventId: 'adverse-first-arrival', now: T + 250, bookSequence: 2,
    bids: [[101.9, 10]], asks: [[102, 10]], history: null }));
  assert.equal(state.totalFillCount, 0);
  assert.equal(pending(state), undefined);
  near(state.reservations.buyCash, 0);
  assert.equal(state.lastOrderTransition.orderId ?? state.lastOrderTransition.id, originalId);
  state = processEvent(state, quote({ eventId: 'favorable-but-new-decision', now: T + 300, bookSequence: 3 }));
  assert.equal(state.totalFillCount, 0);
  assert.notEqual(pending(state).id, originalId);
  assert.equal(pending(state).eligibleAt, T + 550);
  audited(state);
});

test('latency independent: favorable arrival below immutable stop cancels the buy instead of changing its protection', () => {
  let state = processEvent(initial(), quote());
  const original = structuredClone(pending(state));
  state = processEvent(state, quote({ eventId: 'below-original-stop', now: T + 250, bookSequence: 2,
    bids: [[97.9, 10]], asks: [[98, 10]] }));
  assert.equal(state.totalFillCount, 0);
  assert.equal(pending(state), undefined);
  near(state.reservations.buyCash, 0);
  near(state.account.cash, 1000);
  assert.equal(original.stopPrice, 99);
  assert.equal(original.targetPrice, 102);
  audited(state);
});

test('latency independent: target exit respects its minimum arrival price while a stop exit remains latched', () => {
  let state = bought();
  state = processEvent(state, quote({ eventId: 'target-trigger', now: T + 300, bookSequence: 3,
    bids: [[102.1, 10]], asks: [[102.2, 10]] }));
  assert.equal(pending(state).reason, 'take-profit');
  state = processEvent(state, quote({ eventId: 'target-price-lost', now: T + 550, bookSequence: 4,
    bids: [[101.5, 10]], asks: [[101.6, 10]] }));
  assert.equal(state.totalFillCount, 1);
  near(state.account.positions['BTC-USD'].quantity, 1);
  assert.equal(pending(state), undefined);
  near(state.reservations.sellQuantityByProduct['BTC-USD'] ?? 0, 0);
  assert.equal(state.exitObligations['BTC-USD'], undefined);
  audited(state);
});

test('latency independent: new risk halt vetoes an admitted unrelated buy without disabling a protective exit', () => {
  let state = bought();
  state = processEvent(state, quote({ eventId: 'eth-admission', now: T + 300,
    productId: 'ETH-USD', base: 'ETH' }));
  assert.equal(pending(state, 'ETH-USD').side, 'BUY');
  state = processEvent(state, quote({ eventId: 'btc-drawdown', now: T + 400, bookSequence: 3,
    bids: [[49.9, 10]], asks: [[50, 10]] }));
  assert.equal(state.riskHalt.active, true);
  assert.equal(pending(state).side, 'SELL');
  state = processEvent(state, quote({ eventId: 'eth-arrival-during-halt', now: T + 600,
    productId: 'ETH-USD', base: 'ETH', bookSequence: 2 }));
  assert.equal(state.totalFillCount, 1);
  assert.equal(state.account.positions['ETH-USD'], undefined);
  assert.equal(pending(state, 'ETH-USD'), undefined);
  near(state.reservations.buyCash, 0);
  assert.equal(pending(state).side, 'SELL');
  audited(state);
});

test('latency independent: fresh arrival cannot override an unrelated stale portfolio mark', () => {
  let state = bought({ maxSignalAgeMs: 30_000 });
  state = processEvent(state, quote({ eventId: 'eth-before-stale-mark', now: T + 300,
    productId: 'ETH-USD', base: 'ETH' }));
  assert.equal(pending(state, 'ETH-USD').side, 'BUY');
  state = processEvent(state, quote({ eventId: 'eth-after-btc-stale', now: T + 16_000,
    productId: 'ETH-USD', base: 'ETH', bookSequence: 2 }));
  assert.equal(state.totalFillCount, 1);
  assert.equal(state.account.valuationComplete, false);
  assert.equal(state.account.equity, null);
  assert.equal(state.account.positions['ETH-USD'], undefined);
  assert.equal(pending(state, 'ETH-USD'), undefined);
  near(state.reservations.buyCash, 0);
  audited(state);
});

test('latency independent: execution independently binds book identity to actual arrival depth and source time', () => {
  const state = processEvent(initial(), quote());
  const oldInput = quote({ eventId: 'forged-book-time', now: T + 300,
    bookSequence: 1, bookSourceAt: T });
  const laterIdentity = normalizeBookIdentity(quote({ eventId: 'claimed-later-book', now: T + 300,
    bookSequence: 2 }), { requireExplicit: true });
  const result = executePending(state, pending(state), oldInput, laterIdentity,
    { now: T + 300, knownDuplicate: false, knownBookConsumed: false });
  assert.equal(result.fill, null);
  assert.match(result.rejection, /book|identity|source/i);
  near(state.account.cash, 1000);
  assert.equal(state.totalFillCount, 0);
});

test('latency independent: execution checks current mark age even if the caller has not refreshed cached state valuation', () => {
  let state = bought({ maxSignalAgeMs: 30_000 });
  state = processEvent(state, quote({ eventId: 'direct-eth-admission', now: T + 300,
    productId: 'ETH-USD', base: 'ETH' }));
  const arrival = quote({ eventId: 'direct-fresh-eth-stale-btc', now: T + 16_000,
    productId: 'ETH-USD', base: 'ETH', bookSequence: 2 });
  const result = executePending(state, pending(state, 'ETH-USD'), arrival,
    normalizeBookIdentity(arrival, { requireExplicit: true }),
    { now: T + 16_000, knownDuplicate: false, knownBookConsumed: false });
  assert.equal(result.fill, null);
  assert.match(result.rejection, /stale|valuation|mark/i);
  assert.equal(state.totalFillCount, 1);
});

test('latency independent: direct execution rejects fractional or regressed processing clocks', () => {
  const admitted = processEvent(initial(), quote());
  const advanced = engine.advanceTime(admitted, { now: T + 500 });
  const arrival = quote({ eventId: 'direct-clock-arrival', now: T + 300, bookSequence: 2 });
  const book = normalizeBookIdentity(arrival, { requireExplicit: true });
  for (const [state, now] of [[admitted, T + 300.5], [advanced, T + 300]]) {
    const result = executePending(state, pending(state), arrival, book,
      { now, knownDuplicate: false, knownBookConsumed: false });
    assert.equal(result.fill, null);
    assert.match(result.rejection, /clock|time|integer|regress/i);
  }
});

test('latency independent: independent admission rejects a consumed proposal from before same-clock STOP and resume', () => {
  const decision = quote();
  let state = processEvent(initial(), decision);
  const proposal = structuredClone(state.decision.proposal);
  state = engine.stop(state, { now: T });
  state = engine.resume(state, { now: T });
  const result = engine.assessAdmission(state, proposal, decision,
    normalizeBookIdentity(decision, { requireExplicit: true }), { now: T });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join('; '), /generation|STOP|consumed|duplicate/i);
});

test('latency independent: direct delayed execution cannot turn public observations into simulated orders', () => {
  const state = processEvent(initial(), quote());
  const publicInput = quote({ eventId: 'forbidden-public-arrival', now: T + 250,
    bookSequence: 2, source: 'coinbase-exchange', provenance: 'public' });
  const result = executePending(state, pending(state), publicInput,
    normalizeBookIdentity(publicInput, { requireExplicit: true }),
    { now: T + 250, knownDuplicate: false, knownBookConsumed: false });
  assert.equal(result.fill, null);
  assert.match(result.rejection, /public|synthetic|identity/i);
  near(state.account.cash, 1000);
});

test('latency independent: independent book age makes valuation unknown while the cached trade timestamp is still fresh', () => {
  let state = processEvent(initial(), quote());
  state = processEvent(state, quote({ eventId: 'slightly-later-trade', now: T + 280,
    sourceAt: T + 280, bookSourceAt: T + 260, bookSequence: 2 }));
  near(state.account.positions['BTC-USD'].markAsOf, T + 260);
  state = engine.advanceTime(state, { now: T + 15_270 });
  assert.ok(state.asOf - state.marketByProduct['BTC-USD'].sourceAt < state.config.maxSnapshotAgeMs);
  assert.ok(state.asOf - state.marketByProduct['BTC-USD'].bookSourceAt > state.config.maxSnapshotAgeMs);
  assert.equal(state.account.positions['BTC-USD'].markPrice, null);
  assert.equal(state.account.valuationComplete, false);
  assert.equal(state.account.equity, null);
  audited(state);
});

test('latency independent: reservation and immutable-intent mutations fail audit and cannot execute', () => {
  const original = processEvent(initial(), quote());
  const arrival = quote({ eventId: 'tampered-arrival', now: T + 250, bookSequence: 2 });
  const book = normalizeBookIdentity(arrival, { requireExplicit: true });
  for (const change of [
    state => { state.reservations.buyCash = 0; },
    state => { state.account.availableCash = state.account.cash; },
    state => { pending(state).quantity = 2; },
    state => { pending(state).expiresAt += 1; },
    state => { pending(state).decisionBook.sourceAt += 1; },
  ]) {
    const changed = structuredClone(original);
    change(changed);
    assert.equal(engine.auditState(changed).ok, false);
    const result = executePending(changed, pending(changed), arrival, book,
      { now: T + 250, knownDuplicate: false, knownBookConsumed: false });
    assert.equal(result.fill, null);
    assert.match(result.rejection, /audit|reservation|intent|cash/i);
  }
});

test('latency independent: expiry uses the original deadline, clock advance and orderly replay end release reservations', () => {
  for (const ending of ['exact-boundary', 'clock-only', 'end-of-input']) {
    let state = processEvent(initial(), quote());
    if (ending === 'exact-boundary') state = processEvent(state, quote({ eventId: 'expired-arrival',
      now: T + 2000, bookSequence: 2, history: null }));
    else state = engine.advanceTime(state, { now: ending === 'clock-only' ? T + 2000 : T + 100,
      endOfInput: ending === 'end-of-input' });
    assert.equal(state.totalFillCount, 0, ending);
    assert.equal(pending(state), undefined, ending);
    near(state.reservations.buyCash, 0);
    near(state.account.availableCash, 1000);
    audited(state);
  }
});

test('latency independent: buy reservation blocks another product without changing ledger cash or overspending', () => {
  let state = processEvent(initial(), quote());
  const reserved = state.reservations.buyCash;
  state = processEvent(state, quote({ eventId: 'competing-eth-entry', now: T + 1,
    productId: 'ETH-USD', base: 'ETH' }));
  assert.equal(Object.values(state.pendingOrders).filter(order => order.side === 'BUY').length, 1);
  assert.equal(pending(state, 'ETH-USD'), undefined);
  near(state.reservations.buyCash, reserved);
  near(state.account.cash, 1000);
  assert.equal(state.totalFillCount, 0);
  audited(state);
});

test('latency independent: STOP cancels one product entry while retaining the other product protective reservation', () => {
  let state = bought();
  state = processEvent(state, quote({ eventId: 'eth-pending-before-stop', now: T + 300,
    productId: 'ETH-USD', base: 'ETH' }));
  state = processEvent(state, quote({ eventId: 'btc-exit-before-stop', now: T + 350, bookSequence: 3,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  assert.equal(Object.keys(state.pendingOrders).length, 2);
  const protectiveId = pending(state).id;
  assert.ok(state.reservations.buyCash > 0);
  near(state.reservations.sellQuantityByProduct['BTC-USD'], 1);
  state = engine.stop(state, { now: T + 400 });
  assert.equal(pending(state, 'ETH-USD'), undefined);
  assert.equal(pending(state).id, protectiveId);
  near(state.reservations.buyCash, 0);
  near(state.account.availableCash, state.account.cash);
  near(state.reservations.sellQuantityByProduct['BTC-USD'], 1);
  state = processEvent(state, quote({ eventId: 'eth-canceled-arrival', now: T + 600,
    productId: 'ETH-USD', base: 'ETH', bookSequence: 2 }));
  assert.equal(state.totalFillCount, 1);
  state = processEvent(state, quote({ eventId: 'btc-preserved-arrival', now: T + 600, bookSequence: 4,
    bids: [[98.8, 10]], asks: [[98.9, 10]] }));
  assert.equal(state.totalFillCount, 2);
  near(state.account.cash, 1000 - 100 * 1.001 + 98.8 * 0.999);
  assert.equal(Object.keys(state.pendingOrders).length, 0);
  assert.equal(Object.keys(state.account.positions).length, 0);
  assert.equal(Object.keys(state.reservations.sellQuantityByProduct).length, 0);
  audited(state);
});

test('latency independent: multi-level entry and gap-stop partial fill conserve cash, proportional basis and fees', () => {
  let state = processEvent(initial({ slippageBps: 10 }), quote());
  state = processEvent(state, quote({ eventId: 'multi-level-buy', now: T + 250, bookSequence: 2,
    bids: [[100, 10]], asks: [[100.1, 0.4], [100.2, 0.6]] }));
  const buyNotional = (100.1 * 0.4 + 100.2 * 0.6) * 1.001;
  const buyFee = buyNotional * 0.001;
  near(state.account.cash, 1000 - buyNotional - buyFee);
  near(state.account.positions['BTC-USD'].costBasis, buyNotional + buyFee);
  near(state.lastFill.quantity, 1);
  near(state.lastFill.decisionDriftCost, 0.1);
  near(state.lastFill.depthImpactCost, 0.06);
  near(state.lastFill.assumedSlippageCost, 0.10016);
  near(state.lastFill.slippageCost, buyNotional - 100);
  state = processEvent(state, quote({ eventId: 'gap-stop-trigger', now: T + 300, bookSequence: 3,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  state = engine.stop(state, { now: T + 300 });
  state = processEvent(state, quote({ eventId: 'gap-stop-partial', now: T + 550, bookSequence: 4,
    bids: [[97, 0.25], [96.8, 0.25]], asks: [[97.1, 10]] }));
  const sellNotional = (97 * 0.25 + 96.8 * 0.25) * 0.999;
  const sellFee = sellNotional * 0.001;
  near(state.lastFill.quantity, 0.5);
  near(state.lastFill.canceledQuantity, 0.5);
  near(state.account.cash, 1000 - buyNotional - buyFee + sellNotional - sellFee);
  near(state.account.realizedPnl, sellNotional - sellFee - (buyNotional + buyFee) / 2);
  near(state.account.positions['BTC-USD'].quantity, 0.5);
  near(state.account.positions['BTC-USD'].costBasis, (buyNotional + buyFee) / 2);
  near(state.account.feesPaid, buyFee + sellFee);
  near(state.lastFill.decisionDriftCost, 0.95);
  near(state.lastFill.depthImpactCost, 0.05);
  near(state.lastFill.assumedSlippageCost, 0.04845);
  near(state.lastFill.slippageCost, 98.9 * 0.5 - sellNotional);
  assert.ok(state.exitObligations['BTC-USD']);
  assert.equal(state.lastFill.simulatedFillAt, T + 550);
  audited(state);
});

test('latency independent: a consumed shallow book cannot replenish through new order IDs, trade IDs, STOP or compaction', () => {
  let state = bought({ maxEvents: 2 });
  state = processEvent(state, quote({ eventId: 'shallow-trigger', now: T + 300, bookSequence: 3,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  state = engine.stop(state, { now: T + 300 });
  const shared = quote({ eventId: 'shallow-first-attempt', now: T + 550, bookSequence: 4,
    bookId: 'one-shallow-book', bids: [[98.8, 0.25]], asks: [[98.9, 10]] });
  state = processEvent(state, shared);
  near(state.account.positions['BTC-USD'].quantity, 0.75);
  const cash = state.account.cash, fillCount = state.totalFillCount;
  state = engine.compactState(state, { durableArchive: true });
  for (let index = 1; index <= 4; index++) {
    state = processEvent(state, { ...shared, eventId: `cached-relabel-${index}`, tradeId: index,
      sourceAt: T + 550 + index * 250, observedAt: T + 550 + index * 250 });
    assert.equal(state.totalFillCount, fillCount);
    near(state.account.positions['BTC-USD'].quantity, 0.75);
    near(state.account.cash, cash);
  }
  audited(state);
});

test('latency independent: checkpoint retains pending deadline, exact reservation, STOP generation and replay economics', (t) => {
  const directory = temp(t), store = openStore(directory);
  initialize(store, { maxEvents: 1 });
  const submitted = submit(store, quote());
  const order = structuredClone(pending(submitted.engine));
  const rollover = submit(store, quote({ eventId: 'same-book-other-trade', now: T + 1,
    bookSequence: 1, bookSourceAt: T }));
  assert.equal(pending(rollover.engine).id, order.id);
  assert.equal(pending(rollover.engine).eligibleAt, order.eligibleAt);
  near(rollover.engine.reservations.buyCash, order.reservedCash);
  const recovered = openStore(directory);
  const filled = submit(recovered, quote({ eventId: 'durable-arrival', now: T + 250, bookSequence: 2 }));
  assert.equal(filled.engine.totalFillCount, 1);
  near(filled.engine.account.cash, 899.9);
  near(filled.engine.reservations.buyCash, 0);
  const retry = submit(recovered, quote({ eventId: 'durable-arrival', now: T + 300, bookSequence: 3 }));
  assert.equal(retry.engine.totalFillCount, 1);
  near(retry.engine.account.cash, 899.9);
  const audit = recovered.auditJournal();
  assert.equal(audit.ok, true, audit.errors.join('; '));
});

test('latency independent: archive lookup rejects old book IDs relabelled with a larger sequence after intervening books and restart', t => {
  const directory = temp(t), store = openStore(directory);
  initialize(store, { maxEvents: 1 });
  submit(store, quote({ bookId: 'first-decision' }));
  submit(store, quote({ eventId: 'archived-entry', now: T + 250, bookSequence: 2, bookId: 'book-A' }));
  submit(store, quote({ eventId: 'archived-stop-trigger', now: T + 300, bookSequence: 3,
    bookId: 'stop-trigger', bids: [[98.9, 10]], asks: [[99, 10]] }));
  submit(store, quote({ eventId: 'archived-exit', now: T + 550, bookSequence: 4,
    bookId: 'book-B', bids: [[98.8, 10]], asks: [[98.9, 10]] }));
  const admitted = submit(store, quote({ eventId: 'new-entry-after-exit', now: T + 600,
    bookSequence: 5, bookId: 'new-entry' }));
  assert.equal(admitted.engine.totalFillCount, 2);
  assert.equal(pending(admitted.engine).side, 'BUY');
  const reopened = openStore(directory);
  const relabelled = submit(reopened, quote({ eventId: 'book-A-relabelled', now: T + 850,
    bookSequence: 6, bookId: 'book-A' }));
  assert.equal(relabelled.engine.totalFillCount, 2);
  near(relabelled.engine.account.cash, 1000 - 100 * 1.001 + 98.8 * 0.999);
  assert.equal(Object.keys(relabelled.engine.account.positions).length, 0);
  assert.match(relabelled.engine.decision.reason, /book|identity|conflict/i);
  assert.equal(reopened.auditJournal().ok, true);
});

// Real isolated process exits at filesystem boundaries; no permission changes.
function crashChild(directory, action, scenario) {
  const script = `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original=Object.fromEntries(['openSync','closeSync','writeFileSync','fsyncSync','renameSync','linkSync'].map(name=>[name,fs[name]]));
const paths=new Map();const spec=${JSON.stringify(scenario)};let armed=false,matched=0;
fs.openSync=function(file,...args){const fd=original.openSync.call(fs,file,...args);paths.set(fd,String(file));return fd;};
fs.closeSync=function(fd){try{return original.closeSync.call(fs,fd)}finally{paths.delete(fd)}};
const crash=()=>{process.stdout.write('CRASH_BOUNDARY_REACHED\\n');process.exit(93)};
fs[spec.operation]=function(...args){
 const target=['renameSync','linkSync'].includes(spec.operation)?String(args[1]):typeof args[0]==='number'?(paths.get(args[0])??''):String(args[0]);
 const hit=armed&&new RegExp(spec.pattern).test(target)&&++matched===(spec.occurrence??1);
 if(hit&&spec.phase==='before')crash();
 if(hit&&spec.phase==='during'){original.writeFileSync.call(fs,args[0],String(args[1]).slice(0,String(args[1]).length/2));crash()}
 const value=original[spec.operation].apply(fs,args);if(hit&&spec.phase==='after')crash();return value;
};
syncBuiltinESMExports();
const {openStore}=await import(${JSON.stringify(storeUrl)});
const store=openStore(${JSON.stringify(directory)});armed=true;
store.dispatch(${JSON.stringify(action)});process.stdout.write('UNEXPECTED_ACK\\n');
`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10_000 });
}

test('latency independent: crashes around order and fill publication recover one transition and release each reservation once', async t => {
  const scenarios = [
    { name: 'before journal preparation', operation: 'writeFileSync', pattern: '/journal/[^/]+/\\.prepared-', phase: 'before' },
    { name: 'partial journal preparation', operation: 'writeFileSync', pattern: '/journal/[^/]+/\\.prepared-', phase: 'during' },
    { name: 'after immutable evidence publication', operation: 'linkSync', pattern: '/journal/[^/]+/[^/]+\\.json$', phase: 'after' },
    { name: 'before authoritative state commit', operation: 'renameSync', pattern: '/state\\.json$', phase: 'before' },
    { name: 'after authoritative state commit', operation: 'renameSync', pattern: '/state\\.json$', phase: 'after', committed: true },
  ];
  for (const stage of ['order', 'fill']) for (const scenario of scenarios) {
    await t.test(`${stage}: ${scenario.name}`, t => {
      const directory = temp(t), store = openStore(directory);
      initialize(store);
      if (stage === 'fill') submit(store, quote());
      const input = stage === 'order' ? quote() : quote({ eventId: 'crash-fill-arrival', now: T + 250, bookSequence: 2 });
      const before = store.read();
      const child = crashChild(directory, command(input), scenario);
      assert.equal(child.status, 93, child.stderr);
      assert.match(child.stdout, /CRASH_BOUNDARY_REACHED/);
      assert.doesNotMatch(child.stdout, /UNEXPECTED_ACK/);
      const reopened = openStore(directory).read();
      assert.equal(reopened.revision, before.revision + (scenario.committed ? 1 : 0));
      assert.equal(reopened.engine.totalFillCount, stage === 'fill' && scenario.committed ? 1 : 0);
      near(reopened.engine.account.cash, stage === 'fill' && scenario.committed ? 899.9 : 1000);
      assert.throws(() => store.dispatch(command(input)), /STORE_LOCKED/);
      assert.ok(fs.existsSync(recoverInterruptedLock(directory).retained));
      let result = store.dispatch(command(input));
      if (stage === 'order') {
        assert.equal(result.engine.totalFillCount, 0);
        assert.equal(Object.keys(result.engine.pendingOrders).length, 1);
        near(result.engine.reservations.buyCash, 100 * 1.01 * 1.001);
        result = submit(store, quote({ eventId: 'post-crash-arrival', now: T + 250, bookSequence: 2 }));
      }
      assert.equal(result.engine.totalFillCount, 1);
      near(result.engine.account.cash, 899.9);
      near(result.engine.reservations.buyCash, 0);
      near(result.engine.account.availableCash, result.engine.account.cash);
      assert.equal(Object.keys(result.engine.pendingOrders).length, 0);
      assert.equal(store.auditJournal().ok, true);
    });
  }
});
