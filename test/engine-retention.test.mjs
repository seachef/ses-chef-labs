import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditState, compactState, createState, executePaper, proposeTrade, step, stop, upgradeState } from '../src/engine/index.mjs';
import { checkpointDigest } from '../src/engine/checkpoint.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/synthetic-market.json', import.meta.url), 'utf8'));
function quote(number, extra = {}) {
  return { ...structuredClone(fixture.snapshots[0]), eventId: `retention-${number}`,
    observedAt: 100000 + number, sourceAt: 100000 + number, ...extra };
}
const archived = now => ({ now, knownDuplicate: false, durableArchive: true });

test('retention: explicit archive compaction preserves held basis, cumulative accounting and safety state', () => {
  let state = step(createState({ config: { maxEvents: 1, maxDrawdownPct: 0.001 } }), quote(0), { now: 100000 });
  state = stop(state, { now: 100000, reason: 'Preserve operator pause across archive boundary' });
  const compacted = compactState(state, { durableArchive: true });
  assert.deepEqual(compacted.account, state.account);
  assert.deepEqual(compacted.control, state.control);
  assert.deepEqual(compacted.riskHalt, state.riskHalt);
  assert.equal(compacted.riskHalt.active, true);
  assert.deepEqual(compacted.lastSourceAtByProduct, state.lastSourceAtByProduct);
  assert.equal(compacted.totalFillCount, 1);
  assert.equal(compacted.totalEventCount, 1);
  assert.deepEqual(compacted.ledger, []);
  assert.deepEqual(compacted.seenEvents, []);
  assert.deepEqual(auditState(compacted), { ok: true, errors: [] });
  const exited = step(compacted, quote(1, { bids: [[98, 10]], asks: [[98.1, 10]], history: null }), archived(100001));
  assert.equal(exited.execution.side, 'SELL');
  assert.equal(exited.ledger[0].sequence, 2);
  assert.equal(exited.totalFillCount, 2);
  assert.equal(exited.account.initialCash, 10000);
  assert.equal(exited.account.positions['BTC-USD'], undefined);
  assert.equal(exited.control.entryPaused, true);
  assert.equal(exited.riskHalt.active, true);
});

test('retention: more than 10000 consumed events remain bounded and protective exit crosses full capacity', () => {
  let state = step(createState({ config: { maxEvents: 5 } }), quote(0), archived(100000));
  const entryCash = state.account.cash;
  const basis = state.account.positions['BTC-USD'].costBasis;
  state = stop(state, { now: 100000 });
  for (let index = 1; index < 10030; index++) {
    state = step(state, quote(index, { history: null }), archived(100000 + index));
    assert.ok(state.seenEvents.length <= 5);
    assert.ok(state.ledger.length <= 5);
    assert.equal(state.totalFillCount, 1);
    assert.equal(state.account.cash, entryCash);
    assert.equal(state.account.positions['BTC-USD'].costBasis, basis);
  }
  assert.equal(state.seenEvents.length, 5);
  state = step(state, quote(10030, { bids: [[98, 10]], asks: [[98.1, 10]], history: null }), archived(110030));
  assert.equal(state.execution.side, 'SELL');
  assert.equal(state.totalEventCount, 10031);
  assert.equal(state.totalFillCount, 2);
  assert.equal(state.seenEvents.length, 1);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].sequence, 2);
  assert.equal(auditState(state).ok, true);
});

test('retention: no acknowledgement means no eviction, and archived IDs require disk lookup', () => {
  const state = step(createState({ config: { maxEvents: 1 } }), quote(0, { history: null }), { now: 100000 });
  assert.throws(() => compactState(state), /durable archive/);
  const blocked = step(state, quote(1), { now: 100001 });
  assert.match(blocked.decision.reason, /capacity/);
  assert.deepEqual(blocked.seenEvents, state.seenEvents);
  assert.deepEqual(blocked.ledger, state.ledger);
  const compacted = compactState(state, { durableArchive: true });
  assert.match(step(compacted, quote(1), { now: 100001 }).decision.reason, /duplicate lookup/);
  const oldIdWithNewTime = quote(1, { eventId: quote(0).eventId });
  const duplicate = step(compacted, oldIdWithNewTime, { now: 100001, knownDuplicate: true, durableArchive: true });
  assert.match(duplicate.decision.reason, /Duplicate/);
  assert.equal(duplicate.totalFillCount, 0);
  const proposal = proposeTrade(compacted, quote(1), { now: 100001 }).proposal;
  assert.equal(executePaper(compacted, proposal, quote(1), { now: 100001 }).fill, null);
  assert.equal(executePaper(compacted, proposal, quote(1), { now: 100001, knownDuplicate: true }).fill, null);
  assert.ok(executePaper(compacted, proposal, quote(1), { now: 100001, knownDuplicate: false }).fill);
  assert.match(step(compacted, quote(0, { eventId: 'changed-id' }), archived(100001)).decision.reason, /Out-of-order/);
});

test('retention: stale held positions compact without inventing valuation or resetting historical totals', () => {
  const entered = step(createState(), quote(0), { now: 100000 });
  const stale = stop(entered, { now: 200000 });
  assert.equal(stale.account.equity, null);
  const compacted = compactState(stale, { durableArchive: true });
  assert.deepEqual(compacted.account, stale.account);
  assert.equal(compacted.account.equity, null);
  assert.equal(compacted.account.drawdownPct, null);
  assert.equal(auditState(compacted).ok, true);
});

test('retention: latest fill survives WAIT rollover when the active ledger is empty', () => {
  const entered = step(createState({ config: { maxEvents: 1 } }), quote(0), archived(100000));
  const expectedFill = structuredClone(entered.ledger[0]);
  const waiting = step(entered, quote(1, { history: null }), archived(100001));
  assert.equal(waiting.decision.action, 'WAIT');
  assert.deepEqual(waiting.ledger, []);
  assert.equal(waiting.totalFillCount, 1);
  assert.deepEqual(waiting.lastFill, expectedFill);
  assert.deepEqual(waiting.checkpoint.lastFill, expectedFill);
  assert.equal(auditState(waiting).ok, true);
  const corrupt = structuredClone(waiting);
  corrupt.lastFill = null;
  assert.equal(auditState(corrupt).ok, false);
  const exited = step(waiting, quote(2, { bids: [[98, 10]], asks: [[98.1, 10]], history: null }), archived(100002));
  assert.equal(exited.lastFill.side, 'SELL');
  assert.equal(exited.lastFill.sequence, 2);
  assert.deepEqual(exited.lastFill, exited.ledger.at(-1));
});

test('retention: unrelated snapshot metadata stays out of active state without changing validated evidence', () => {
  const input = quote(0);
  input.unused = 'x'.repeat(2200000);
  input.history.unused = { deeply: ['y'.repeat(2200000)] };
  const state = step(createState(), input, archived(100000));
  const retained = state.marketByProduct['BTC-USD'];
  assert.equal(retained.unused, undefined);
  assert.equal(retained.history.unused, undefined);
  assert.deepEqual(retained.bids, input.bids);
  assert.deepEqual(retained.asks, input.asks);
  assert.equal(retained.history.description, input.history.description);
  assert.equal(state.totalFillCount, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 50000);
  assert.equal(input.unused.length, 2200000, 'The original command remains unchanged for its durable journal');
  assert.equal(input.history.unused.deeply[0].length, 2200000);
});

test('retention: descriptions, rejected identities and STOP reasons cannot balloon active state', () => {
  const oversized = quote(0);
  oversized.history.description = 'x'.repeat(1025);
  const rejected = step(createState(), oversized, { now: 100000 });
  assert.equal(rejected.decision.action, 'REJECT');
  assert.match(rejected.decision.reason, /history/);
  assert.equal(rejected.totalFillCount, 0);
  for (const productId of ['x'.repeat(2200000), { metadata: 'x'.repeat(2200000) }]) {
    const invalid = step(createState(), quote(0, { productId }), { now: 100000 });
    assert.equal(invalid.decision.productId, null);
    assert.ok(Buffer.byteLength(JSON.stringify(invalid)) < 10000);
  }
  assert.throws(() => stop(createState(), { now: 0, reason: 'x'.repeat(4097) }), /4096/);
  assert.equal(stop(createState(), { now: 0, reason: 'x'.repeat(4096) }).control.stopReason.length, 4096);
});

test('retention: two supported 1000-level books and full-depth fills fit the compact two-MiB budget', () => {
  const book = {
    bids: Array.from({ length: 1000 }, (_, index) => [99.9 - index * 0.0001, 0.002]),
    asks: Array.from({ length: 1000 }, (_, index) => [100 + index * 0.0001, 0.001]),
  };
  let state = step(createState(), quote(0, book), archived(100000));
  state = step(state, quote(1, { ...book, productId: 'ETH-USD', base: 'ETH' }), archived(100001));
  assert.deepEqual(state.ledger.map(fill => fill.legs.length), [1000, 1000]);
  state = compactState(state, { durableArchive: true });
  assert.equal(state.totalFillCount, 2);
  assert.equal(state.lastFill.legs.length, 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 2 * 1024 * 1024);
  assert.equal(auditState(state).ok, true);
});

test('retention: checkpoint damage, lost basis/count/highwater/peak/control/risk are detected', () => {
  let state = step(createState({ config: { maxDrawdownPct: 0.001 } }), quote(0), { now: 100000 });
  state = stop(state, { now: 100000 });
  state = compactState(state, { durableArchive: true });
  for (const corrupt of [
    s => { s.checkpoint.cash += 1; },
    s => { s.checkpoint.positions['BTC-USD'].costBasis += 1; s.checkpoint.digest = checkpointDigest(s.checkpoint); },
    s => { s.totalFillCount += 1; },
    s => { s.totalEventCount += 1; },
    s => { s.lastSourceAtByProduct = {}; },
    s => { s.account.peakEquity = 9999; },
    s => { s.control.version = 0; },
    s => { s.riskHalt = { active: false, reasons: [] }; },
  ]) {
    const damaged = structuredClone(state); corrupt(damaged);
    assert.equal(auditState(damaged).ok, false);
    assert.throws(() => compactState(damaged, { durableArchive: true }), /audit failed/);
  }
});

test('retention: explicit legacy upgrade retains every existing ledger event and financial total', () => {
  const current = step(createState(), quote(0), { now: 100000 });
  const legacy = structuredClone(current);
  legacy.schemaVersion = 1;
  delete legacy.checkpoint; delete legacy.totalFillCount; delete legacy.totalEventCount; delete legacy.lastFill;
  assert.equal(auditState(legacy).ok, true);
  assert.throws(() => step(legacy, quote(1), { now: 100001 }), /upgradeState/);
  assert.throws(() => stop(legacy, { now: 100001 }), /upgradeState/);
  const upgraded = upgradeState(legacy);
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.checkpoint.kind, 'genesis');
  assert.equal(upgraded.checkpoint.totalFillCount, 0);
  assert.equal(upgraded.totalFillCount, 1);
  assert.deepEqual(upgraded.ledger, legacy.ledger);
  assert.deepEqual(upgraded.seenEvents, legacy.seenEvents);
  assert.deepEqual(upgraded.account, legacy.account);
  assert.deepEqual(upgraded.lastFill, legacy.ledger.at(-1));
  assert.equal(auditState(upgraded).ok, true);
  legacy.account.cash += 1;
  assert.throws(() => upgradeState(legacy), /audit failed/);
});
