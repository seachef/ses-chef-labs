import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initialDocument, openStore } from '../src/store.mjs';
import { applyCommand } from '../src/runtime.mjs';
import { documentHash } from '../src/journal.mjs';
import { replay } from '../src/cli.mjs';
import { toView } from '../src/view.mjs';
import { renderState } from '../ui.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/synthetic-causal-market.json', import.meta.url))).snapshots;
const legacy = JSON.parse(fs.readFileSync(new URL('../fixtures/synthetic-market.json', import.meta.url))).snapshots;
const create = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-causal-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return openStore(directory);
};
const init = { type: 'initialize-fixture', now: 100000, wallTime: 100000, armed: true, config: { latencyMs: 250 } };
const send = (store, snapshot) => store.dispatch({ type: 'snapshot', snapshot, now: snapshot.observedAt, wallTime: snapshot.observedAt });

test('latency runtime: schema2 command hashes remain identical to the preserved journal-stage implementation', () => {
  // Generated from exact preserved source tree 6fe1eef92073280b78eb123304c192492a042824.
  const expected = ['539097f2dc65e92001ce58beac198a81ea96ae491ad36751ef3eadec9ba63180', '25fcfe1f520479b4b2d6881f2653cf53c0a01bdbfa689eb4450ba1f6aa0dd12e', 'f6d11b3213a91bc6523c0a51b6a7e4ef398a584eb27d25f74482c3846a4b44fe', 'ce8a228c7144fc909b978430a605bbe60299b91b2b176c11fe9120dcf5540278'];
  const commands = [{ type: 'initialize-fixture', now: legacy[0].observedAt, wallTime: 1000, armed: true },
    ...legacy.map((snapshot, i) => ({ type: 'snapshot', snapshot, now: snapshot.observedAt, wallTime: 1001 + i })),
    { type: 'stop', reason: 'Compatibility check', wallTime: 2000 }];
  let state = initialDocument(); const seen = new Set();
  commands.forEach((command, index) => {
    state = applyCommand(state, command, { hasEvent: id => seen.has(id) }); state.revision++;
    if (command.type === 'snapshot') seen.add(command.snapshot.eventId);
    assert.equal(documentHash(state), expected[index]);
  });
});

test('latency runtime: persisted clock expiry and orderly end release reservations without inventing fills', async t => {
  const store = create(t); store.dispatch(init); send(store, fixture[0]);
  assert.equal(Object.keys(store.read().engine.pendingOrders).length, 1);
  assert.ok(store.read().engine.reservations.buyCash > 0);
  store.dispatch({ type: 'advance-fixture', now: 102000, wallTime: 200000 });
  const expired = openStore(store.directory).read().engine;
  assert.equal(Object.keys(expired.pendingOrders).length, 0); assert.equal(expired.totalFillCount, 0);
  assert.equal(expired.reservations.buyCash, 0); assert.equal(expired.account.cash, 10000);
  assert.equal(store.auditJournal().ok, true);
  const finite = create(t);
  await replay({ store: finite, input: [fixture[0]], armFixture: true, config: { latencyMs: 250 } });
  const ended = finite.read().engine;
  assert.equal(Object.keys(ended.pendingOrders).length, 0); assert.equal(ended.reservations.buyCash, 0);
  assert.equal(ended.totalFillCount, 0); assert.equal(finite.read().worker.status, 'completed');
  assert.equal(finite.auditJournal().ok, true);
});

test('latency runtime: complete fixture, duplicate restart and journal replay preserve economic results', async t => {
  const store = create(t);
  await replay({ store, input: fixture, armFixture: true, config: { latencyMs: 250 } });
  const first = store.read();
  assert.equal(first.engine.totalFillCount, 2); assert.deepEqual(first.engine.account.positions, {});
  assert.ok(first.engine.account.cash < first.engine.account.initialCash);
  assert.equal(first.engine.lastFill.simulatedFillAt, 101280);
  await replay({ store: openStore(store.directory), input: fixture });
  assert.deepEqual(store.read().engine.account, first.engine.account);
  assert.equal(store.read().engine.totalFillCount, 2);
  assert.equal(store.auditJournal().ok, true);
});

class Element {
  constructor() { this.children = []; this.text = ''; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  get firstChild() { return this.children[0]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute() {}
}
test('latency runtime: pending timing and reserved cash are visible without displaying a fabricated fill', t => {
  const store = create(t); store.dispatch(init); send(store, fixture[0]);
  const view = toView(store.read(), { now: 100000 });
  assert.equal(view.pendingOrders.length, 1); assert.equal(view.executions.length, 0);
  const elements = new Map(); const document = { createElement: () => new Element(), getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); } };
  renderState(document, view, 100000);
  assert.match(document.getElementById('execution-note').textContent, /PENDING.*eligible.*expires/);
  assert.match(document.getElementById('account-note').textContent, /reserved for buys.*available/);
  assert.match(document.getElementById('execution-rows').textContent, /No simulated fills/);
});

test('latency runtime: a fresh ticker cannot make an old causal book a current portfolio mark', t => {
  const store = create(t); store.dispatch(init); send(store, fixture[0]); send(store, fixture[2]);
  const document = store.read();
  const cached = document.engine.marketByProduct['BTC-USD'];
  cached.observedAt = cached.sourceAt = 120000;
  const view = toView(document, { now: 120000 });
  assert.equal(view.market[0].stale, true);
  assert.equal(view.valuationIncomplete, true);
  assert.equal(view.account.equity, null); assert.equal(view.account.unrealizedPnl, null);
});

test('latency runtime: CLI opt-in validates numbers and cannot reconfigure an existing account', t => {
  const store = create(t);
  const run = args => spawnSync(process.execPath, ['src/cli.mjs', ...args], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  const input = 'fixtures/synthetic-causal-market.json';
  const good = run(['replay', '--input', input, '--data', store.directory, '--arm-fixture', '--latency-ms', '250']);
  assert.equal(good.status, 0, good.stderr);
  const before = store.read();
  const changed = run(['replay', '--input', input, '--data', store.directory, '--latency-ms', '300']);
  assert.equal(changed.status, 1); assert.match(changed.stderr, /configuration cannot change/);
  const invalid = run(['replay', '--input', input, '--data', store.directory, '--latency-ms', '0.25']);
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /requires an integer/);
  assert.deepEqual(store.read(), before);
});
