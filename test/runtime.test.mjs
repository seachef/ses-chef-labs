import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialDocument, openStore } from '../src/store.mjs';
import { applyCommand } from '../src/runtime.mjs';
import { walkJournal } from '../src/journal.mjs';
import { toView } from '../src/view.mjs';

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return openStore(directory);
}
function snapshot(id, at, bid = 100, productId = 'BTC-USD') {
  return { schemaVersion: 1, eventId: id, source: 'synthetic-fixture', provenance: 'synthetic', productId,
    base: productId.split('-')[0], quote: 'USD', sourceAt: at, observedAt: at,
    bids: [[bid, 10]], asks: [[bid + 0.1, 10]], change24hPct: null,
    history: { low: bid, from: at - 60000, to: at, samples: 60, intervalMs: 1000, complete: false, description: 'Synthetic closed observation window' } };
}
const initialize = config => ({ type: 'initialize-fixture', now: 100000, wallTime: 100000, armed: true, config });

test('runtime: segmented durable replay matches uncompacted economics across products and repeated rollovers', t => {
  const store = temporaryStore(t);
  store.dispatch(initialize({ maxEvents: 3 }));
  let reference = applyCommand(initialDocument(), initialize({ maxEvents: 10000 }));
  const observedIds = new Set();
  function both(command) {
    const result = store.dispatch(command);
    reference = applyCommand(reference, command, { hasEvent: id => observedIds.has(id) });
    if (command.type === 'snapshot') observedIds.add(command.snapshot.eventId);
    assert.deepEqual(result.engine.account, reference.engine.account);
    assert.deepEqual(result.engine.control, reference.engine.control);
    assert.deepEqual(result.engine.riskHalt, reference.engine.riskHalt);
    assert.deepEqual(result.engine.lastSourceAtByProduct, reference.engine.lastSourceAtByProduct);
    assert.equal(result.engine.totalFillCount, reference.engine.totalFillCount);
    assert.equal(result.engine.totalEventCount, reference.engine.totalEventCount);
    assert.ok(result.engine.ledger.length <= 3); assert.ok(result.engine.seenEvents.length <= 3);
    return result;
  }
  for (let i = 0; i < 140; i++) {
    const at = 100000 + i * 1000;
    if (i === 3) both({ type: 'stop', wallTime: at, reason: 'Rollover fixture entry pause' });
    if (i === 20) both({ type: 'resume-fixture', wallTime: at });
    const productId = i % 2 ? 'ETH-USD' : 'BTC-USD';
    both({ type: 'snapshot', snapshot: snapshot(`segmented-${i}`, at, i % 6 === 4 || i % 6 === 5 ? 98 : 100, productId), now: at, wallTime: at });
  }
  const reopened = openStore(store.directory);
  assert.deepEqual(reopened.read(), store.read());
  const audit = reopened.auditJournal();
  assert.equal(audit.ok, true, JSON.stringify(audit.errors)); assert.equal(audit.completeHistory, true);
  assert.equal(audit.records, 143);
  const segments = fs.readdirSync(path.join(store.directory, 'journal')).filter(name => /^\d+$/.test(name));
  assert.equal(segments.length, 2);
});

test('runtime: rejected inputs and duplicate attempts retain exact input and WHY; rollover keeps last recorded fill visible', t => {
  const store = temporaryStore(t);
  store.dispatch(initialize({ maxEvents: 1 }));
  store.dispatch({ type: 'snapshot', snapshot: snapshot('entry', 100000), now: 100000, wallTime: 100000 });
  const expectedFill = store.read().engine.lastFill;
  store.dispatch({ type: 'snapshot', snapshot: snapshot('hold', 101000), now: 101000, wallTime: 101000 });
  assert.equal(store.read().engine.ledger.length, 0);
  assert.equal(toView(store.read(), { now: 101000 }).executions[0].id, expectedFill.id);
  const invalid = snapshot('invalid-currency', 102000); invalid.quote = 'USDT';
  store.dispatch({ type: 'snapshot', snapshot: invalid, now: 102000, wallTime: 102000 });
  const oldIdNewTime = snapshot('entry', 103000);
  store.dispatch({ type: 'snapshot', snapshot: oldIdNewTime, now: 103000, wallTime: 103000 });
  assert.equal(store.read().engine.totalFillCount, 1);
  assert.match(store.read().engine.decision.reason, /Duplicate.*archive/);
  const records = [...walkJournal(store.directory, store.read().journal)].map(value => value.record);
  assert.equal(records[0].decision.action, 'REJECT');
  assert.deepEqual(records[0].command.snapshot, oldIdNewTime);
  assert.deepEqual(records[1].command.snapshot, invalid);
  assert.match(records[1].decision.reason, /currency/);
  assert.equal(store.auditJournal().ok, true);
});

test('runtime: generic state writes cannot bypass journaled engine commands or silently change starting cash', t => {
  const store = temporaryStore(t);
  store.dispatch(initialize({ maxEvents: 2 }));
  const before = store.read();
  assert.throws(() => store.transact(document => { document.engine.account.cash += 1; return document; }), /TYPED_COMMAND_REQUIRED/);
  assert.throws(() => store.dispatch({ ...initialize({ maxEvents: 2 }), initialCash: 9000 }), /initial cash cannot change/);
  assert.throws(() => store.dispatch(initialize({ maxEvents: 4 })), /configuration cannot change/);
  assert.deepEqual(store.read(), before);
  assert.equal(store.auditJournal().ok, true);
});
