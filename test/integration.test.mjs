import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.mjs';
import { replay, observe } from '../src/cli.mjs';
import { createServer, pauseEntries } from '../src/server.mjs';
import { toView } from '../src/view.mjs';

function storage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-integration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return openStore(directory);
}
function snapshot(id, at, bid = 100, ask = 100.1) {
  return { schemaVersion: 1, eventId: id, source: 'synthetic-fixture', provenance: 'synthetic', productId: 'BTC-USD', base: 'BTC', quote: 'USD',
    observedAt: at, sourceAt: at, bids: [[bid, 10]], asks: [[ask, 10]], change24hPct: null,
    history: { low: 100, from: at - 60000, to: at, samples: 60, intervalMs: 1000, complete: false, description: 'Synthetic 60 second sample window; not market performance' } };
}

test('integration: idle preview has no invented account; STOP acknowledges durable state and rejects cross-origin writes', async t => {
  const store = storage(t), server = createServer(store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /src="\.\/loopback\.mjs"/);
  const entry = await fetch(`${origin}/loopback.mjs`);
  assert.equal(entry.status, 200);
  assert.match(entry.headers.get('content-type'), /^text\/javascript/);
  assert.match(await entry.text(), /mountDashboard\(document\)/);
  assert.equal((await fetch(`${origin}/public-preview.mjs`)).status, 404);
  const initial = await (await fetch(`${origin}/api/state`)).json();
  assert.equal(initial.account, null); assert.equal(initial.mode, 'idle'); assert.equal(initial.stopped, true);
  const denied = await fetch(`${origin}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://unrelated.example' }, body: '{}' });
  assert.equal(denied.status, 403); assert.equal(store.read().revision, 0);
  const stopped = await fetch(`${origin}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}' });
  assert.equal(stopped.status, 200); assert.equal((await stopped.json()).stopPersisted, true);
  assert.equal(openStore(store.directory).read().control.stopRequested, true);
});

test('integration: failed durable STOP gives no successful acknowledgement', async t => {
  const store = storage(t), server = createServer(store);
  fs.writeFileSync(path.join(store.directory, 'transaction.lock'), 'interrupted');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 503); assert.equal((await response.json()).stopPersisted, undefined);
});

test('integration: replay retries conserve ledger; historical-clock STOP permits a later protective exit without resuming entries', async t => {
  const store = storage(t), buy = snapshot('integration-entry', 1_000_000), exit = snapshot('integration-exit', 1_001_000, 97, 97.1);
  await replay({ store, input: [buy], armFixture: true });
  assert.equal(store.read().engine.ledger.length, 1);
  pauseEntries(store);
  const generation = store.read().engine.control.version;
  await replay({ store, input: [buy, exit], armFixture: true });
  const result = store.read();
  assert.equal(result.engine.ledger.length, 2); assert.equal(result.engine.ledger[1].side, 'SELL');
  assert.equal(result.control.stopped, true); assert.equal(result.engine.control.version, generation);
  const cash = result.engine.account.cash;
  await replay({ store, input: [buy, exit] });
  assert.equal(store.read().engine.account.cash, cash); assert.equal(store.read().engine.ledger.length, 2);
});

test('integration: public observation can never initialize paper execution and failed refresh clears old observations', async t => {
  const store = storage(t), publicSnapshot = { ...snapshot('observation', 1_000_000), source: 'coinbase-exchange', provenance: 'public' };
  await assert.rejects(replay({ store, input: [publicSnapshot], armFixture: true }), /only explicit synthetic/);
  assert.equal(store.read().engine, null);
  await observe({ store, observer: async ({ productId }) => {
    if (productId === 'ETH-USD') throw new Error('Unavailable'); return publicSnapshot;
  } });
  assert.equal(store.read().observations.length, 1); assert.equal(store.read().engine, null);
  await observe({ store, observer: async () => { throw new Error('API outage'); } });
  assert.deepEqual(store.read().observations, []); assert.equal(store.read().errors.length, 2);
  await assert.rejects(replay({ store, input: [snapshot('fixture', 1_000_000)], armFixture: true }), /Separate data directory/);
});

test('integration: stale open-position valuation hides aggregate profit but preserves cash and realized accounting', async t => {
  const store = storage(t);
  await replay({ store, input: [snapshot('mark', 1_000_000)], armFixture: true });
  const document = store.read();
  const current = toView(document, { now: 1_000_000 });
  assert.equal(current.valuationIncomplete, false); assert.ok(Number.isFinite(current.account.equity));
  const stale = toView(document, { now: 2_000_000 });
  assert.equal(stale.account.equity, null); assert.equal(stale.account.netPnl, null);
  assert.equal(stale.account.cash, document.engine.account.cash); assert.equal(stale.account.realizedPnl, document.engine.account.realizedPnl);
  assert.equal(stale.market[0].stale, true);
});
