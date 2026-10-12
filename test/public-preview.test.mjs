import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createPublicSession, retryAfterTime, MIN_REFRESH_MS, MAX_ACTIVITY } from '../src/market/public-session.mjs';
import { publicView } from '../src/market/public-view.mjs';
import { mountPublicPreview, compactSummary } from '../public-preview.mjs';
import { quoteFreshness } from '../ui.mjs';

// Deliberately fabricated endpoint fixtures. No network, public quotes or fills.
const START = Date.parse('2026-10-11T12:01:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(custom = null, options = {}) {
  let clock = START;
  const requests = [];
  function fixture(url) {
    const u = new URL(url), product = u.pathname.split('/')[2];
    const time = new Date(clock - 1000).toISOString();
    if (u.pathname.endsWith('/book')) return { bids: [['99','2',1],['98','1',1]], asks: [['100','3',1],['101','4',1]], sequence: 10, time, auction_mode: false };
    if (u.pathname.endsWith('/ticker')) return { price: '100', bid: '99', ask: '100', size: '1', volume: '20', trade_id: 12, time };
    if (u.pathname.endsWith('/stats')) return { open: '95', last: '100', low: '90', high: '110', volume: '20' };
    if (u.pathname.endsWith('/candles')) return [[Math.floor(clock / 3600000) * 3600 - 3600, 90, 110, 95, 100, 10]];
    return { id: product, base_currency: product.split('-')[0], quote_currency: 'USD', status: 'online', base_increment: '0.00000001', quote_increment: '0.01', post_only: false, limit_only: false, cancel_only: false, auction_mode: false, trading_disabled: false };
  }
  const normal = url => new Response(JSON.stringify(fixture(url)), { headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return custom ? custom(url, init, normal, fixture) : normal(url); };
  const session = createPublicSession({ fetchImpl, now: () => clock, ...options });
  return { session, requests, fetchImpl, now: () => clock, advance: ms => { clock += ms; }, set: value => { clock = value; } };
}

test('public session makes only ten bounded credential-free GETs and projects no execution/account', async () => {
  const h = harness();
  const first = h.session.refresh();
  assert.equal(await h.session.refresh(), false);
  await first;
  assert.equal(h.requests.length, 10);
  for (const { url, init } of h.requests) {
    assert.equal(new URL(url).origin, 'https://api.exchange.coinbase.com');
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
  }
  const state = h.session.getState(), view = publicView(state, h.now());
  assert.equal(state.phase, 'completed'); assert.equal(state.activity.length, 20);
  assert.equal(view.market.length, 2); assert.equal(view.market[0].liquidityUsd, 1000);
  assert.ok(Math.abs(view.market[0].spreadBps - 10000 / 99.5) < 1e-9);
  assert.equal(view.account, null); assert.deepEqual(view.executions, []); assert.deepEqual(view.pendingOrders, []);
  assert.equal(view.decisions[0].action, 'WAIT'); assert.equal(view.stopped, true);
  assert.equal(state.nextAllowedAt, START + MIN_REFRESH_MS);
  assert.equal(await h.session.refresh(), false); assert.equal(h.requests.length, 10);
});

test('projection expires source/book/receipt independently and cannot create unknown history', async () => {
  const h = harness(); await h.session.refresh();
  const state = h.session.getState();
  assert.ok(publicView(state, START).market.every(m => !m.stale));
  assert.ok(publicView(state, START + 9001).market.every(m => m.stale));
  for (const field of ['sourceAt','bookSourceAt','observedAt']) {
    for (const value of [null, START + 1, START - 10001]) {
      const altered = structuredClone(state); altered.observations[0][field] = value;
      const view = publicView(altered, START);
      assert.equal(quoteFreshness(view.market[0], view, START).current, false);
    }
  }
  const unknown = structuredClone(state);
  unknown.observations[0].history = { low: null, samples: 0, missingBuckets: 168, from: null, to: null };
  assert.equal(publicView(unknown, START).market[0].distanceFromLowPct, null);
});

test('compact summary hides expired prices, keeps actual event time and reports failure/recovery without execution', async () => {
  let fail = false;
  const h = harness((url, init, normal) => { if (fail) throw new TypeError('offline'); return normal(url); });
  const summary = () => compactSummary(h.session.getState(), publicView(h.session.getState(), h.now()), h.now());
  assert.equal(summary().market, 'UNKNOWN · no verified prices');
  assert.equal(summary().engine, 'IDLE · browser only\nNo requests yet');
  await h.session.refresh();
  assert.equal(summary().market, 'BTC 100 USD · FRESH\nETH 100 USD · FRESH');
  assert.equal(summary().engine, 'COMPLETED · browser only\n12:01:00Z GET received 200');
  h.advance(60000);
  assert.equal(summary().market, 'BTC — · STALE\nETH — · STALE');
  assert.match(summary().engine, /12:01:00Z GET received 200$/);
  fail = true; await h.session.refresh();
  assert.equal(summary().market, 'UNKNOWN · no verified prices');
  assert.equal(summary().engine, 'FAILED · browser only\n12:02:00Z GET failed');
  assert.equal(summary().decision, 'WAIT · strategy off');
  assert.equal(summary().execution, 'MANUAL · review on exchange');
  assert.equal(summary().account, 'UNKNOWN · no account');
  h.advance(60000); fail = false; await h.session.refresh();
  assert.equal(summary().market, 'BTC 100 USD · FRESH\nETH 100 USD · FRESH');
  assert.equal(summary().engine, 'COMPLETED · browser only\n12:03:00Z GET received 200');
});

test('network failure clears previous marks, enforces backoff and permits explicit recovery', async () => {
  let fail = false;
  const h = harness((url, init, normal) => { if (fail) throw new TypeError('offline'); return normal(url); });
  await h.session.refresh(); h.advance(60000); fail = true; await h.session.refresh();
  assert.equal(h.session.getState().phase, 'failed'); assert.deepEqual(h.session.getState().observations, []);
  const count = h.requests.length; assert.equal(await h.session.refresh(), false); assert.equal(h.requests.length, count);
  h.advance(60000); fail = false; await h.session.refresh();
  assert.equal(h.session.getState().phase, 'completed'); assert.equal(h.session.getState().observations.length, 2);
  assert.deepEqual(h.session.getState().errors, []);
});

test('429 honors readable Retry-After without retrying; repeated failures back off to ten minutes', async () => {
  let retry = '180';
  const h = harness(() => new Response('{}', { status: 429, headers: retry ? { 'Retry-After': retry } : {} }));
  await h.session.refresh();
  assert.equal(h.session.getState().nextAllowedAt, START + 180000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.session.getState().activity.at(-1).status, 429);
  h.advance(179999); assert.equal(await h.session.refresh(), false);
  h.advance(1); retry = null; await h.session.refresh();
  assert.equal(h.session.getState().nextAllowedAt - h.now(), 120000);
  for (const wait of [240000,480000,600000,600000]) {
    h.set(h.session.getState().nextAllowedAt); await h.session.refresh();
    assert.equal(h.session.getState().nextAllowedAt - h.now(), wait);
  }
  assert.ok(h.session.getState().activity.length <= MAX_ACTIVITY);
});

test('Retry-After supports dates, rejects malformed values, and 503 respects a longer server delay', async () => {
  assert.equal(retryAfterTime(new Date(START + 3600000).toUTCString(), START), START + 3600000);
  for (const value of [null, '', 'invalid', '-2', '9999999999999999999999']) assert.equal(retryAfterTime(value, START), 0);
  const h = harness(() => new Response('{}', { status: 503, headers: { 'Retry-After': '7200' } }));
  await h.session.refresh(); assert.equal(h.session.getState().nextAllowedAt, START + 7200000);
});

test('cancellation aborts fetch, rejects late completion, and prevents the next product', async () => {
  let resolve;
  const h = harness((url, init, normal) => new Promise(done => { resolve = () => done(normal(url)); }));
  const pending = h.session.refresh(); await tick(); h.session.cancel(); await pending;
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.equal(h.session.getState().phase, 'canceled'); assert.deepEqual(h.session.getState().observations, []);
  resolve(); await tick();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.session.getState().observations, []);
});

test('cancellation while reading a body aborts promptly and does not resurrect marks', async () => {
  let canceled = false;
  const h = harness(() => new Response(new ReadableStream({ cancel() { canceled = true; } })));
  const pending = h.session.refresh(); await tick(); h.session.cancel(); await pending; await tick();
  assert.equal(canceled, true); assert.equal(h.session.getState().phase, 'canceled');
  assert.equal(h.requests.length, 1); assert.deepEqual(h.session.getState().observations, []);
});

test('adapter deadline covers a hung body, and oversized/malformed bodies fail closed', async t => {
  await t.test('hung body', async () => {
    const h = harness(() => new Response(new ReadableStream()), { timeoutMs: 10 });
    await h.session.refresh(); assert.equal(h.session.getState().phase, 'failed');
    assert.equal(h.requests[0].init.signal.aborted, true);
  });
  for (const body of ['x'.repeat(5000001), '{broken']) await t.test(body.length > 100 ? 'oversized body' : 'invalid JSON', async () => {
    const h = harness(() => new Response(body)); await h.session.refresh();
    assert.equal(h.session.getState().phase, 'failed'); assert.deepEqual(h.session.getState().observations, []);
  });
});

test('failed second product clears a successful first product rather than retaining partial old coverage', async () => {
  const h = harness((url, init, normal) => url.includes('ETH-USD') ? new Response('{}', { status: 500 }) : normal(url));
  await h.session.refresh(); assert.equal(h.requests.length, 6);
  assert.equal(h.session.getState().phase, 'failed'); assert.deepEqual(h.session.getState().observations, []);
});

test('untrusted source-time strings cannot forge terminal lines or expand the bounded log', async () => {
  const h = harness((url, init, normal, fixture) => {
    const data = fixture(url);
    if (/\/products\/[^/]+$/.test(new URL(url).pathname)) data.time = 'x'.repeat(1000000) + '\n2026-10-11T12:00:00Z · GET received /invented · HTTP 200';
    return new Response(JSON.stringify(data));
  });
  await h.session.refresh();
  assert.equal(h.session.getState().phase, 'completed');
  for (const event of h.session.getState().activity) {
    if (event.sourceTime) assert.match(event.sourceTime, /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/);
    assert.ok(JSON.stringify(event).length < 300);
  }
  const invalid = harness((url, init, normal, fixture) => {
    const data = fixture(url);
    if (url.endsWith('/ticker')) data.time = 'invalid\n' + 'x'.repeat(1000000);
    return new Response(JSON.stringify(data));
  });
  await invalid.session.refresh();
  assert.equal(invalid.session.getState().phase, 'failed');
  assert.ok(JSON.stringify(invalid.session.getState()).length < 6000);
  const error = harness(() => { throw new Error('untrusted\n' + 'x'.repeat(1000000)); });
  await error.session.refresh();
  assert.ok(error.session.getState().errors[0].length <= 240);
  assert.doesNotMatch(error.session.getState().errors[0], /\n/);
});

test('destroy cancels pending work, suppresses further callbacks and disables refresh', async () => {
  let changes = 0;
  const h = harness(() => new Promise(() => {}), { onChange: () => { changes++; } });
  const pending = h.session.refresh(); await tick(); h.session.destroy(); const count = changes;
  await pending; assert.equal(changes, count); assert.equal(await h.session.refresh(), false);
  assert.equal(h.requests[0].init.signal.aborted, true);
});

class Element {
  constructor() { this.children = []; this.text = ''; this.listeners = new Map(); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(x => x.textContent).join(' '); }
  get firstChild() { return this.children[0]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute() {}
  removeAttribute() {}
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
}
function documentStub() {
  const nodes = new Map();
  return { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement() { return new Element(); } };
}

function historicalReport() {
  const html = fs.readFileSync(new URL('../public.html', import.meta.url), 'utf8');
  const brief = html.match(/<span id="paper-snapshot-brief"[^>]*>(.*?)<\/span>/s)?.[1];
  const body = html.match(/<div id="paper-snapshot"[^>]*>(.*?)<\/div>/s)?.[1];
  assert.ok(brief && body, 'A historical report must be present without JavaScript');
  return { html, brief, body };
}

// These fixed report facts come from the independently verified public simulation.
// The transport fixtures used elsewhere in this file remain fabricated and offline.
test('historical report preserves verified facts and clocks without publishing account or runtime identifiers', () => {
  const { html, brief, body } = historicalReport();
  assert.equal(brief, 'LAST RUN · 12 OCT 13:34 AWST\nENDED · STALE');
  const clocks = [...body.matchAll(/<time datetime="([^"]+)">/g)].map(match => match[1]);
  assert.deepEqual(clocks, [
    '2026-10-12T05:33:40.297Z', '2026-10-12T05:34:42.025Z',
    '2026-10-12T05:34:36.104Z', '2026-10-12T05:34:38.038Z',
  ]);
  const [start, end, btc, eth] = clocks.map(Date.parse);
  assert.ok(start < btc && btc < eth && eth < end);
  const displayed = [...body.matchAll(/<time datetime="[^"]+">([^<]+)<\/time>/g)].map(match => match[1]);
  assert.deepEqual(displayed, ['12 Oct 2026 · 13:33:40.297', '13:34:42.025', '12 Oct 2026 · 13:34:36.104', '13:34:38.038']);
  assert.match(body, /Session · Perth \(AWST\)/); assert.match(body, /Last receipts · Perth \(AWST\)/);
  assert.match(body, /61\.718 seconds including cleanup · 60-second observation limit · 11 rounds · BTC-USD 11 \/ ETH-USD 10 accepted observations/);
  assert.match(body, /21 accepted observations · 21 WAIT · 0 simulated fills · 1 feed error: stale ETH ticker rejected/);
  assert.match(body, /unchanged 0–1% entry band: BTC 4\.233–4\.294%, ETH 6\.065–6\.151%/);
  assert.match(body, /48 journal records replayed · independent reconciliation passed/);
  assert.match(body, /Coinbase Exchange · 70 successful HTTP 200 responses/);
  assert.match(body, /No trades; profitability untested/);
  assert.match(body, /not a live engine connection or an Emergency STOP acknowledgement/);
  assert.match(body, /Refresh updates browser quotes only/);
  assert.match(body, /No continuous coverage/);
  assert.match(body, /Public quotes are observations, not fills/);
  assert.doesNotMatch(body, /\b(?:cash|equity|balance|account|wallet|credential|password|secret|token|pid|hostname|sessionId|sourceCommit)\b|10000|10,000|\/workspace|\/tmp|https?:|[a-f\d]{40,}|[a-f\d]{8}-[a-f\d-]{27,}/i);
  assert.doesNotMatch(body, /<(?:script|iframe|img|a|button|input|form)\b|\bon\w+\s*=|\b(?:src|href)\s*=/i);
  assert.match(html, /<title>2\.0<\/title>/); assert.match(html, /<h1>2\.0<\/h1>/);
  const engine = html.match(/<section id="engine-section" aria-labelledby="engine-title">(.*?)<\/section>/s)?.[1];
  assert.ok(engine?.includes(body));
  assert.match(engine, /<div id="engine-details">/);
});

test('quote refresh, clock aging, failure and cancellation cannot refresh the historical report or add controls', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let behavior = 'ok';
  const h = harness((url, init, normal) => {
    if (behavior === 'offline') throw new TypeError('offline');
    if (behavior === 'pending') return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')), { once: true }));
    return normal(url);
  });
  const doc = documentStub(), host = new Element(), report = historicalReport();
  const brief = doc.getElementById('paper-snapshot-brief'), body = doc.getElementById('paper-snapshot');
  brief.textContent = report.brief; body.textContent = report.body;
  const unchanged = () => {
    assert.equal(doc.getElementById('paper-snapshot-brief'), brief); assert.equal(brief.textContent, report.brief);
    assert.equal(doc.getElementById('paper-snapshot'), body); assert.equal(body.textContent, report.body);
    assert.equal(doc.getElementById('stop').disabled, true); assert.equal(doc.getElementById('stop').listeners.size, 0);
    assert.equal(doc.getElementById('cash').textContent, 'UNKNOWN');
    assert.equal(doc.getElementById('handoff-buy').disabled, true);
    assert.equal(doc.getElementById('handoff-sell').disabled, true);
    assert.equal(doc.getElementById('handoff-buy').listeners.size, 0);
    assert.equal(doc.getElementById('handoff-sell').listeners.size, 0);
  };
  const app = mountPublicPreview(doc, { fetchImpl: h.fetchImpl, now: h.now, host });
  try {
    for (let i = 0; i < 20 && app.session.getState().phase === 'fetching'; i++) await tick();
    assert.equal(h.requests.length, 10); unchanged();
    h.advance(61000); t.mock.timers.tick(61000); assert.equal(h.requests.length, 10); unchanged();
    await app.session.refresh(); assert.equal(h.requests.length, 20); unchanged();
    h.advance(61000); behavior = 'offline'; await app.session.refresh();
    assert.equal(app.session.getState().phase, 'failed'); unchanged();
    h.advance(600000); behavior = 'pending'; const pending = app.session.refresh(); await tick();
    app.session.cancel(); await pending; unchanged();
    const count = h.requests.length; h.advance(600000); t.mock.timers.tick(600000);
    assert.equal(h.requests.length, count); unchanged();
    for (const { url, init } of h.requests) {
      assert.equal(new URL(url).origin, 'https://api.exchange.coinbase.com');
      assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
    }
  } finally { app.destroy(); }
});

test('browser UI is read-only, ages prices without polling/logging, and logs only real request events', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness(), doc = documentStub(), host = new Element();
  const app = mountPublicPreview(doc, { fetchImpl: h.fetchImpl, now: h.now, host });
  try {
    for (let i = 0; i < 20 && app.session.getState().phase === 'fetching'; i++) await tick();
    assert.equal(app.session.getState().phase, 'completed'); assert.equal(h.requests.length, 10);
    assert.equal(doc.getElementById('stop').disabled, true); assert.equal(doc.getElementById('stop').listeners.size, 0);
    assert.match(doc.getElementById('market-note').textContent, /initial integration markets only, not final coverage or picks/);
    assert.equal(doc.getElementById('cash').textContent, 'UNKNOWN'); assert.match(doc.getElementById('market-rows').textContent, /100 USD/);
    const log = doc.getElementById('activity').textContent;
    assert.match(log, /GET received.*HTTP 200/); assert.doesNotMatch(log, /\/api\/state|heartbeat/);
    const engine = doc.getElementById('engine-details');
    const summary = doc.getElementById('engine-brief');
    assert.match(doc.getElementById('market-brief').textContent, /100 USD · FRESH/);
    h.advance(61000); t.mock.timers.tick(61000);
    assert.equal(h.requests.length, 10); assert.equal(doc.getElementById('activity').textContent, log);
    assert.match(doc.getElementById('market-rows').textContent, /STALE/); assert.doesNotMatch(doc.getElementById('market-rows').textContent, /100 USD/);
    assert.equal(doc.getElementById('refresh').disabled, false);
    assert.equal(doc.getElementById('engine-details'), engine);
    assert.equal(doc.getElementById('engine-brief'), summary);
    assert.equal(summary.textContent, 'COMPLETED · browser only\n12:01:00Z GET received 200');
    assert.equal(doc.getElementById('market-brief').textContent, 'BTC — · STALE\nETH — · STALE');
  } finally { app.destroy(); }
  assert.equal(host.listeners.size, 0);
});

test('static output keeps four compact rows above a permanently visible engine with natural scrolling', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-public-build-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  execFileSync(process.execPath, ['scripts/build-public-preview.mjs', directory], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest.json')));
  assert.equal(Object.keys(manifest.assets).length, 8);
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  assert.equal((html.match(/<section\b/g) ?? []).length, 5);
  assert.match(html, /src="\.\/public-preview\.mjs"/); assert.doesNotMatch(html, /loopback\.mjs/);
  assert.match(html, /id="stop" type="button" disabled/);
  assert.match(html, /PUBLIC OBSERVATIONS ONLY/); assert.doesNotMatch(html, /SIMULATED ONLY/);
  assert.equal(html, fs.readFileSync(new URL('../public.html', import.meta.url), 'utf8'));
  assert.match(html, /<body class="public-terminal">/);
  assert.equal((html.match(/<details\b/g) ?? []).length, 4);
  assert.equal((html.match(/<summary\b/g) ?? []).length, 4);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|[=>])/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale|autofocus/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) for (const id of match[1].split(' ')) assert.ok(ids.includes(id), `Missing accessible label ${id}`);
  for (const match of html.matchAll(/<summary\b[^>]*>(.*?)<\/summary>/gs)) assert.doesNotMatch(match[1], /<(button|a|input|select)\b/);
  const engineDetails = html.match(/<section id="engine-section" aria-labelledby="engine-title">(.*?)<\/section>/s)[1];
  assert.match(engineDetails, /<h2 id="engine-title">ENGINE<\/h2>/);
  assert.match(engineDetails, /<div id="engine-details">/);
  assert.doesNotMatch(engineDetails, /<(?:details|summary|button)\b|\b(?:hidden|inert|aria-expanded)\s*[=>]/);
  const engineStart = html.indexOf('<section id="engine-section"');
  for (const id of ['market-details', 'decision-details', 'execution-details', 'account-details', 'refresh', 'cancel', 'request-status']) {
    assert.ok(html.indexOf(`id="${id}"`) < engineStart, `${id} must stay above ENGINE`);
  }
  assert.equal(html.indexOf('<section', engineStart + 1), -1, 'ENGINE must be the final section');
  const css = fs.readFileSync(path.join(directory, 'style.css'), 'utf8');
  assert.match(css, /\.public-terminal #engine-section\s*\{\s*display:\s*block;\s*margin-top:\s*12px;\s*\}/);
  assert.doesNotMatch(css, /position:\s*(?:fixed|sticky)|(?:max-)?height:\s*\d+(?:vh|dvh)/);
  const flowRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => /(?:\bbody\b|\bmain\b|#engine-section|#engine-details|#activity)/.test(selector))
    .map(([, , declarations]) => declarations).join('\n');
  assert.doesNotMatch(flowRules, /(?:max-)?height:|overflow(?:-y)?:\s*(?:hidden|scroll)/);
  assert.ok(engineDetails.includes('id="activity"')); assert.ok(engineDetails.includes('id="market-source"') === false);
  for (const module of ['ui.mjs', 'public-preview.mjs']) {
    const source = fs.readFileSync(new URL('../' + module, import.meta.url), 'utf8');
    for (const m of source.matchAll(/(?:getElementById|\bset)\('([^']+)'/g)) assert.ok(ids.includes(m[1]), `Missing renderer element ${m[1]}`);
  }
  for (const [file, entry] of Object.entries(manifest.assets)) {
    const data = fs.readFileSync(path.join(directory, file));
    assert.equal(data.length, entry.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256);
    if (!file.endsWith('.mjs')) continue;
    const source = data.toString();
    assert.doesNotMatch(source, /from ['"]node:|import\(['"]node:/);
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      const resolved = path.relative(directory, path.resolve(directory, path.dirname(file), match[1])).split(path.sep).join('/');
      assert.ok(manifest.assets[resolved], `Missing or forbidden import ${resolved}`);
    }
  }
  assert.ok(!Object.keys(manifest.assets).some(f => /engine|store|journal|server|loopback/.test(f)));
  const ui = fs.readFileSync(path.join(directory, 'ui.mjs'), 'utf8');
  assert.doesNotMatch(ui, /if \(typeof document/);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url))).outputDirectory, 'dist');
});
