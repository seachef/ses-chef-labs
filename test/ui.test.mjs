import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { quoteFreshness, validateState, unavailableState, renderState, mountDashboard, dateTime } from '../ui.mjs';

// Minimal DOM exercises text output and async control behavior; not browser layout.
class Node {
  constructor() { this.children = []; this.text = ''; this.attributes = {}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
  get firstChild() { return this.children[0]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {}
  removeEventListener() {}
}
function documentStub() {
  const elements = new Map();
  return {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Node()); return elements.get(id); },
    createElement() { return new Node(); },
  };
}
const now = Date.parse('2026-10-11T09:00:00Z');
const quote = { symbol: 'FIX-USD', quoteCurrency: 'USD', source: 'synthetic test', price: 123, observedAt: now - 1000, sourceAt: now - 1000, bookSourceAt: now - 1000, stale: false };
const state = {
  mode: 'observe', stopped: true, worker: { status: 'finished', lastCycleAt: now }, freshnessMaxAgeMs: 5000,
  market: [quote], decisions: [], executions: [], account: {}, risk: { status: 'blocked' }, errors: [],
};
const response = (body, ok = true, status = 200) => ({ ok, status, async json() { return body; } });
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('quote freshness depends on source time, explicit stale flag, and configured maximum age', () => {
  assert.equal(quoteFreshness(quote, state, now).current, true);
  assert.equal(quoteFreshness(quote, state, now + 5000).label, 'STALE');
  assert.equal(quoteFreshness({ ...quote, stale: undefined }, state, now).label, 'UNVERIFIED');
  assert.equal(quoteFreshness({ ...quote, observedAt: now + 1 }, state, now).current, false);
  assert.equal(quoteFreshness(quote, { ...state, freshnessMaxAgeMs: undefined }, now).current, false);
  assert.equal(quoteFreshness({ ...quote, observedAt: null }, state, now).current, false);
  assert.equal(dateTime(Number.MAX_VALUE), 'UNKNOWN');
});

test('an old public source or book expires before a fresh HTTP receipt', () => {
  for (const field of ['sourceAt', 'bookSourceAt']) {
    const nearlyExpired = { ...quote, observedAt: now, [field]: now - 4900 };
    assert.equal(quoteFreshness(nearlyExpired, state, now).current, true);
    assert.equal(quoteFreshness(nearlyExpired, state, now + 101).label, 'STALE');
    assert.equal(quoteFreshness({ ...quote, [field]: null }, state, now).label, 'UNVERIFIED');
    assert.equal(quoteFreshness({ ...quote, [field]: now + 1 }, state, now).current, false);
  }
});

test('cached running status loses confirmation when its last-cycle heartbeat expires', () => {
  const doc = documentStub();
  const running = { ...state, worker: { status: 'running', lastCycleAt: now } };
  renderState(doc, running, now);
  assert.equal(doc.getElementById('worker').textContent, 'running · read-only observation');
  renderState(doc, running, now + 5001);
  assert.match(doc.getElementById('worker').textContent, /UNKNOWN.*heartbeat stale/);
  assert.equal(running.worker.status, 'running');
  renderState(doc, { ...running, worker: { status: 'running', lastCycleAt: null } }, now);
  assert.match(doc.getElementById('worker').textContent, /UNKNOWN.*heartbeat stale/);
});

test('fixture quotes remain recorded, never current public quotes', () => {
  assert.deepEqual(quoteFreshness(quote, { ...state, mode: 'fixture-replay' }, now), { current: false, label: 'FIXTURE / RECORDED' });
  assert.equal(quoteFreshness(quote, { ...state, account: { provenance: 'synthetic' } }, now + 5000).label, 'STALE');
});

test('malformed engine state fails closed', () => {
  for (const bad of [[], null, {}, { ...state, mode: 'live' }, { ...state, stopped: 'true' }, { ...state, worker: {} }, { ...state, market: {} }]) {
    assert.throws(() => validateState(bad));
  }
  assert.equal(validateState(state), state);
});

test('stale observations hide prices, spreads, and mark-dependent account metrics', () => {
  const doc = documentStub();
  renderState(doc, { ...state, account: { currency: 'USD', cash: 100, unrealizedPnl: 50 } }, now);
  assert.match(doc.getElementById('market-rows').textContent, /123 USD/);
  renderState(doc, { ...state, account: { currency: 'USD', cash: 100, unrealizedPnl: 50 } }, now + 5000);
  assert.doesNotMatch(doc.getElementById('market-rows').textContent, /123 USD/);
  assert.match(doc.getElementById('market-rows').textContent, /STALE/);
  assert.equal(doc.getElementById('unrealized').textContent, 'UNKNOWN');
  assert.equal(doc.getElementById('cash').textContent, '100 USD');
});

test('a failed refresh clears earlier marks and marks stop unconfirmed', async () => {
  const doc = documentStub();
  let fail = false;
  const app = mountDashboard(doc, async () => { if (fail) throw new Error('offline'); return response(state); }, () => now);
  try {
    await settle();
    assert.match(doc.getElementById('market-rows').textContent, /123 USD/);
    fail = true;
    await app.refresh();
    assert.doesNotMatch(doc.getElementById('market-rows').textContent, /123 USD/);
    assert.match(doc.getElementById('stop-state').textContent, /UNCONFIRMED/);
    assert.equal(doc.getElementById('cash').textContent, 'UNKNOWN');
  } finally { app.destroy(); }
});

test('stop succeeds only with a durable acknowledgment and failures stay explicit', async () => {
  for (const [ack, confirmed] of [[{ ...state, stopped: true }, false], [{ ...state, stopped: false, stopPersisted: true }, false], [{ ...state, stopped: true, stopPersisted: true }, true]]) {
    const doc = documentStub();
    const app = mountDashboard(doc, async (path, options) => {
      assert.ok(path === '/api/state' || path === '/api/stop');
      if (path === '/api/stop') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.deepEqual(JSON.parse(options.body), {});
        return response(ack);
      }
      return response(state);
    }, () => now);
    try {
      await settle();
      await app.stop();
      assert.equal(doc.getElementById('request-status').textContent.includes('Emergency stop persisted.'), confirmed);
      assert.equal(doc.getElementById('stop-state').textContent.includes('UNCONFIRMED'), !confirmed);
    } finally { app.destroy(); }
  }
});

test('a pre-stop GET completing late cannot overwrite the persisted stop', async () => {
  const doc = documentStub();
  let resolveGet;
  const app = mountDashboard(doc, async (path) => path === '/api/state' ? new Promise((resolve) => { resolveGet = resolve; }) : response({ ...state, stopped: true, stopPersisted: true }), () => now);
  try {
    await app.stop();
    resolveGet(response({ ...state, stopped: false }));
    await settle();
    assert.equal(doc.getElementById('stop-state').textContent, 'STOP · new entries blocked');
    assert.match(doc.getElementById('request-status').textContent, /Emergency stop persisted/);
  } finally { app.destroy(); }
});

test('initial unavailable state does not invent an account or worker', () => {
  const doc = documentStub();
  renderState(doc, unavailableState('no API'), now);
  assert.equal(doc.getElementById('worker').textContent, 'UNKNOWN');
  assert.equal(doc.getElementById('cash').textContent, 'UNKNOWN');
  assert.equal(doc.getElementById('net-return').textContent, 'UNKNOWN');
  assert.match(doc.getElementById('stop-state').textContent, /UNCONFIRMED/);
});

test('the document has exactly five sections and no external data endpoint', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const module = await readFile(new URL('../ui.mjs', import.meta.url), 'utf8');
  assert.equal((html.match(/<section\b/g) || []).length, 5);
  for (const label of ['MARKET', 'DECISION', 'EXECUTION', 'ACCOUNT', 'ENGINE']) assert.ok(html.includes(`>${label}</h2>`));
  assert.doesNotMatch(html + module, /https?:\/\//);
});

test('native iPhone/iPad/desktop layout, keyboard and screen reader verification', { skip: 'Native hardware remains unavailable; the single permitted sandboxed Chromium probe failed (sandbox helper misconfigured). No unsandboxed launch permitted.' }, () => {});

test('public display distinguishes ticker, book and observation clocks and retains a sub-cent-bps spread', () => {
  const doc = documentStub();
  const realShape = { ...quote, sourceAt: now - 2200, bookSourceAt: now - 3300, observedAt: now - 1000, spreadBps: 0.0012055506680904195 };
  renderState(doc, { ...state, market: [realShape] }, now);
  assert.match(doc.getElementById('market-source').textContent, /ticker source 2026-10-11 08:59:57.800Z/);
  assert.match(doc.getElementById('market-source').textContent, /book source 2026-10-11 08:59:56.700Z/);
  assert.match(doc.getElementById('market-source').textContent, /observed 2026-10-11 08:59:59 UTC/);
  assert.match(doc.getElementById('market-rows').textContent, /0\.001206 bps/);
  renderState(doc, { ...state, market: [{ ...realShape, bookSourceAt: null }] }, now);
  assert.match(doc.getElementById('market-source').textContent, /book source UNKNOWN/);
  assert.doesNotMatch(doc.getElementById('market-rows').textContent, /0\.001206 bps/);
});

test('request activity is bounded, timestamped, and does not invent heartbeat events', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const doc = documentStub();
  let clock = now, calls = 0, fail = false;
  const app = mountDashboard(doc, async () => { calls++; if (fail) throw new Error('offline'); return response({ ...state, revision: 7 }); }, () => clock);
  try {
    await settle();
    const first = doc.getElementById('activity').textContent;
    assert.equal(first.split('\n').length, 2);
    assert.match(first, /2026-10-11 09:00:00 UTC · GET \/api\/state started/);
    assert.match(first, /received · revision 7 · finished/);
    clock += 60000;
    t.mock.timers.tick(60000);
    assert.equal(doc.getElementById('activity').textContent, first);
    assert.equal(calls, 1);
    assert.match(doc.getElementById('market-rows').textContent, /STALE/);
    fail = true;
    await app.refresh();
    assert.match(doc.getElementById('activity').textContent, /2026-10-11 09:01:00 UTC.*failed/);
    for (let i = 0; i < 15; i++) await app.refresh();
    assert.equal(doc.getElementById('activity').textContent.split('\n').length, 20);
    assert.doesNotMatch(doc.getElementById('activity').textContent, /09:00:00/);
  } finally { app.destroy(); }
});

test('activity reports only confirmed stop acknowledgements as persisted', async () => {
  for (const [ack, success] of [[{ ...state, stopped: true }, false], [{ ...state, stopped: true, stopPersisted: true }, true]]) {
    const doc = documentStub();
    const app = mountDashboard(doc, async path => response(path === '/api/stop' ? ack : state), () => now);
    try {
      await settle();
      await app.stop();
      assert.match(doc.getElementById('activity').textContent, /POST \/api\/stop requested · persistence unconfirmed/);
      assert.equal(doc.getElementById('activity').textContent.includes('acknowledged · emergency entry pause persisted'), success);
      assert.equal(doc.getElementById('activity').textContent.includes('POST /api/stop failed · STOP unconfirmed'), !success);
    } finally { app.destroy(); }
  }
});
