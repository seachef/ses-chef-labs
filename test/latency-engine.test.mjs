import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, step, stop, resume, advanceTime, compactState, auditState, executePending } from '../src/engine/index.mjs';
import { normalizeBookIdentity } from '../src/book-identity.mjs';

const options = now => ({ now, knownDuplicate: false, knownBookConsumed: false, knownTradeDuplicate: false, archivedBook: null, durableArchive: true });
function book(sequence, at, extra = {}) {
  return { schemaVersion: 1, eventId: `event-${sequence}-${at}`, source: 'synthetic-fixture', provenance: 'synthetic',
    productId: 'BTC-USD', base: 'BTC', quote: 'USD', observedAt: at, sourceAt: at, bookSequence: sequence,
    bookSourceAt: at, bookId: `book-${sequence}`, tradeId: `trade-${sequence}-${at}`,
    bids: [[99.9, 10]], asks: [[100, 10]], change24hPct: null,
    history: { low: 99.5, from: 0, to: at, samples: 11, intervalMs: 100, complete: false, description: 'Invented synthetic samples, no venue performance' }, ...extra };
}
const initial = config => createState({ config: { latencyMs: 250, minHistoryWindowMs: 100, ...config } });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function buy() { return step(step(initial(), book(1, 1000), options(1000)), book(2, 1250), options(1250)); }

test('causal engine: no decision-book fill; actual processing time is distinct from planned eligibility', () => {
  const pending = step(initial(), book(1, 1000), options(1000));
  assert.equal(pending.schemaVersion, 3);
  assert.equal(pending.ledger.length, 0);
  assert.equal(pending.account.cash, 10000);
  assert.equal(pending.pendingOrders['BTC-USD'].eligibleAt, 1250);
  near(pending.reservations.buyCash, 100.5006);
  near(pending.account.availableCash, 9899.4994);
  const arrival = book(2, 1280, { bookSourceAt: 1260 });
  const filled = step(pending, arrival, options(1280));
  assert.equal(filled.ledger.length, 1);
  assert.equal(filled.lastFill.eligibleAt, 1250);
  assert.equal(filled.lastFill.executedAt, 1280);
  assert.equal(filled.lastFill.arrivalBook.sourceAt, 1260);
  assert.equal(filled.reservations.buyCash, 0);
  assert.equal(filled.account.availableCash, filled.account.cash);
  assert.equal(auditState(filled).ok, true);
});

test('causal engine: late receipt of pre-arrival book cannot fill or extend deadline', () => {
  let state = step(initial(), book(1, 1000), options(1000));
  const expiry = state.pendingOrders['BTC-USD'].expiresAt;
  state = step(state, book(2, 1300, { bookSourceAt: 1100 }), options(1300));
  assert.equal(state.totalFillCount, 0);
  assert.equal(state.pendingOrders['BTC-USD'].expiresAt, expiry);
  state = step(state, book(3, 1360, { bookSourceAt: 1350 }), options(1360));
  assert.equal(state.lastFill.executedAt, 1360);
  assert.equal(state.lastFill.decisionAt, 1000);
});

test('causal engine: first adverse eligible book cancels rather than selecting a favorable later book', () => {
  let state = step(initial(), book(1, 1000), options(1000));
  const orderId = state.pendingOrders['BTC-USD'].id;
  state = step(state, book(2, 1250, { bids: [[100.4, 10]], asks: [[100.5, 10]] }), options(1250));
  assert.equal(state.totalFillCount, 0);
  assert.equal(state.lastOrderTransition.id, orderId);
  assert.equal(state.lastOrderTransition.status, 'CANCELED');
  assert.match(state.lastOrderTransition.lifecycleReason, /entry cap/);
  assert.equal(state.reservations.buyCash, 0);
  assert.equal(state.consumedBooks['BTC-USD'].sequence, 2);
  state = step(state, book(3, 1300), options(1300));
  assert.equal(state.totalFillCount, 0);
  assert.notEqual(state.pendingOrders['BTC-USD'].id, orderId);
  assert.equal(state.pendingOrders['BTC-USD'].eligibleAt, 1550);
});

test('causal engine: global buy reservation bound and STOP cancellation survive resume and cached books', () => {
  let state = step(initial(), book(1, 1000), options(1000));
  const original = state.pendingOrders['BTC-USD'].id;
  state = step(state, book(1, 1100, { productId: 'ETH-USD', base: 'ETH', eventId: 'eth-entry' }), options(1100));
  assert.equal(Object.keys(state.pendingOrders).length, 1);
  assert.equal(state.pendingOrders['ETH-USD'], undefined);
  assert.match(state.decision.reason, /global pending buy/);
  state = stop(state, { now: 1150 });
  assert.equal(state.pendingOrders['BTC-USD'], undefined);
  assert.equal(state.reservations.buyCash, 0);
  assert.equal(state.lastOrderTransition.id, original);
  state = resume(state, { now: 1150 });
  state = step(state, book(2, 1300), options(1300));
  assert.equal(state.totalFillCount, 0);
  assert.notEqual(state.pendingOrders['BTC-USD'].id, original);
  assert.equal(state.pendingOrders['BTC-USD'].entryVersion, state.control.version);
});

test('causal engine: protective gap and rebound exits retain latch through partial IOC and STOP', () => {
  let state = buy();
  state = step(state, book(3, 1300, { bids: [[98, 10]], asks: [[98.1, 10]], history: null }), options(1300));
  assert.equal(state.pendingOrders['BTC-USD'].side, 'SELL');
  const sell = structuredClone(state.pendingOrders['BTC-USD']);
  state = stop(state, { now: 1400 });
  assert.deepEqual(state.pendingOrders['BTC-USD'], sell);
  assert.equal(state.execution.status, 'pending');
  state = step(state, book(4, 1600, { bids: [[97, 0.4], [96, 10]], asks: [[97.1, 10]], history: null }), options(1600));
  assert.equal(state.lastFill.status, 'partial');
  near(state.lastFill.averagePrice, 97);
  near(state.lastFill.decisionDriftCost, 0.4);
  near(state.account.positions['BTC-USD'].quantity, 0.6);
  assert.equal(state.pendingOrders['BTC-USD'], undefined);
  assert.equal(state.reservations.sellQuantityByProduct['BTC-USD'], undefined);
  assert.ok(state.exitObligations['BTC-USD']);
  state = step(state, book(5, 1700, { bids: [[99.5, 10]], asks: [[99.6, 10]], history: null }), options(1700));
  assert.equal(state.pendingOrders['BTC-USD'].reason, 'protective-stop');
  state = step(state, book(6, 2000, { bids: [[99.8, 10]], asks: [[99.9, 10]], history: null }), options(2000));
  assert.equal(state.account.positions['BTC-USD'], undefined);
  assert.equal(state.exitObligations['BTC-USD'], undefined);
  assert.equal(state.totalFillCount, 3);
  near(state.account.cash, 9998.28264);
  near(state.account.realizedPnl, -1.71736);
  assert.ok(state.lastFill.decisionDriftCost < 0, 'Favorable rebound drift remains signed, not an extra arbitrary charge');
  assert.equal(auditState(state).ok, true);
});

test('causal engine: expiry and orderly end cancel once without fabricated market events', () => {
  const pending = step(initial(), book(1, 1000), options(1000));
  const expired = advanceTime(pending, { now: 3000 });
  assert.equal(expired.lastOrderTransition.status, 'EXPIRED');
  assert.equal(expired.totalEventCount, 1);
  assert.equal(expired.totalFillCount, 0);
  assert.equal(expired.reservations.buyCash, 0);
  assert.equal(advanceTime(expired, { now: 3000 }).account.cash, 10000);
  const ended = advanceTime(pending, { now: 1100, endOfInput: true });
  assert.equal(ended.lastOrderTransition.status, 'CANCELED');
  assert.match(ended.lastOrderTransition.lifecycleReason, /End of synthetic input/);
  assert.equal(ended.reservations.buyCash, 0);
});

test('causal engine: pending order/reservation/book/latch state survives audited compaction', () => {
  const pending = step(initial({ maxEvents: 1 }), book(1, 1000), options(1000));
  const compacted = compactState(pending, { durableArchive: true });
  assert.deepEqual(compacted.pendingOrders, pending.pendingOrders);
  assert.deepEqual(compacted.reservations, pending.reservations);
  assert.deepEqual(compacted.checkpoint.causal.pendingOrders, pending.pendingOrders);
  const filled = step(compacted, book(2, 1250), options(1250));
  assert.equal(filled.totalFillCount, 1);
  assert.equal(filled.lastFill.orderId, pending.pendingOrders['BTC-USD'].id);
  assert.equal(auditState(filled).ok, true);
  for (const damage of [s => { s.pendingOrders['BTC-USD'].expiresAt++; }, s => { s.reservations.buyCash++; }, s => { s.pendingOrders['BTC-USD'].decisionBook.sourceAt++; }]) {
    const corrupt = structuredClone(compacted); damage(corrupt);
    assert.equal(auditState(corrupt).ok, false);
  }
});

test('causal engine: independent executor rejects forged book identity and invalid execution clocks', () => {
  const state = step(initial(), book(1, 1000), options(1000));
  const pending = state.pendingOrders['BTC-USD'];
  const arrival = book(2, 1250);
  const identity = normalizeBookIdentity(arrival, { requireExplicit: true });
  const old = book(1, 1000, { eventId: 'relabeled-old-book', observedAt: 1250, sourceAt: 1250, tradeId: 'new-trade' });
  assert.equal(executePending(state, pending, old, identity, options(1250)).fill, null);
  for (const now of [1250.5, 999]) assert.equal(executePending(state, pending, arrival, identity, options(now)).fill, null);
});

test('causal engine: same-time genuine trades are distinct while cached depth remains single-use', () => {
  let state = step(initial(), book(1, 1000), options(1000));
  state = step(state, book(1, 1000, { eventId: 'another-trade-event', tradeId: 'another-genuine-trade' }), options(1000));
  assert.equal(state.totalEventCount, 2);
  assert.equal(state.totalOrderCount, 1);
  assert.equal(state.totalFillCount, 0);
  state = step(state, book(2, 1250), options(1250));
  const cash = state.account.cash;
  state = step(state, book(2, 1250, { eventId: 'cached-depth-trade', tradeId: 'distinct-trade-at-same-time' }), options(1250));
  assert.equal(state.totalFillCount, 1);
  assert.equal(state.account.cash, cash);
  assert.equal(state.totalEventCount, 4);
});
