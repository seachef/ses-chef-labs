import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { openStore, recoverInterruptedLock, initialDocument } from '../src/store.mjs';
import { createCoinbaseObserver } from '../src/market/coinbase.mjs';
import { createState, step, stop, resume, proposeTrade, assessRisk, executePaper, auditState } from '../src/engine/index.mjs';
import { replay } from '../src/cli.mjs';
import { pauseEntries } from '../src/server.mjs';
import { toView } from '../src/view.mjs';
import { quoteFreshness } from '../ui.mjs';

// Authored by the independent reviewer. All inputs are local, invented fixtures.
const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: openStore(directory) };
}
function childStore(directory, body) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {openStore} from ${JSON.stringify(storeUrl)}; const store=openStore(${JSON.stringify(directory)}); ${body}`],
  { encoding: 'utf8', timeout: 5000 });
}

test('independent: a stop committed before engine initialization survives reopen', (t) => {
  const { directory, store } = temporaryStore(t);
  store.transact((document) => {
    document.control = { stopped: true, stopRequested: true };
    return document;
  });
  assert.deepEqual(openStore(directory).read().control, { stopped: true, stopRequested: true });
  assert.equal(openStore(directory).read().engine, null);
});

test('independent: failed and asynchronous transactions cannot change acknowledged state', (t) => {
  const { store } = temporaryStore(t);
  const committed = store.transact((document) => document);
  assert.throws(() => store.transact((document) => {
    document.control.stopped = false;
    throw new Error('fixture interruption');
  }), /fixture interruption/);
  assert.deepEqual(store.read(), committed);
  assert.throws(() => store.transact(async (document) => document), /synchronously/);
  assert.deepEqual(store.read(), committed);
});

test('independent: a second process cannot write while a transaction owns the lock', (t) => {
  const { directory, store } = temporaryStore(t);
  store.transact((document) => {
    const child = childStore(directory, 'try {store.transact(x=>x);process.exit(90)} catch(e) {process.stdout.write(e.message)}');
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /STORE_LOCKED/);
    return document;
  });
  assert.equal(store.read().revision, 1);
});

test('independent: crash during a transaction retains previous snapshot and requires explicit recovery', (t) => {
  const { directory, store } = temporaryStore(t);
  const committed = store.transact((document) => document);
  const child = childStore(directory, 'store.transact(x=>{x.control.stopped=false;process.exit(71)})');
  assert.equal(child.status, 71, child.stderr);
  assert.deepEqual(store.read(), committed);
  assert.throws(() => store.transact((document) => document), /STORE_LOCKED/);
  const recovered = recoverInterruptedLock(directory);
  assert.equal(recovered.recovered, true);
  assert.ok(fs.existsSync(recovered.retained));
  assert.deepEqual(store.read(), committed);
  assert.equal(store.transact((document) => document).revision, 2);
});

test('independent: lock recovery refuses an existing process', (t) => {
  const { directory, store } = temporaryStore(t);
  store.transact((document) => {
    assert.throws(() => recoverInterruptedLock(directory), /lock owner still exists/);
    return document;
  });
});

test('independent: an active or interrupted recovery guard blocks both writers and another recoverer', (t) => {
  const { directory, store } = temporaryStore(t);
  const before = store.transact((document) => document);
  fs.writeFileSync(path.join(directory, 'recovery.lock'), JSON.stringify({ fixture: 'interrupted recovery' }));
  assert.throws(() => store.transact((document) => document), /STORE_LOCKED.*recovery/);
  assert.throws(() => recoverInterruptedLock(directory), /RECOVERY_BLOCKED/);
  assert.deepEqual(store.read(), before);
});

test('independent: checksum corruption never falls back to an empty account', (t) => {
  const { directory, store } = temporaryStore(t);
  store.transact((document) => document);
  const statePath = path.join(directory, 'state.json');
  const envelope = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  envelope.payload += ' ';
  fs.writeFileSync(statePath, JSON.stringify(envelope));
  assert.throws(() => store.read(), /STATE_CORRUPT/);
  assert.throws(() => store.transact((document) => document), /STATE_CORRUPT/);
});

test('independent: an unavailable state destination fails rather than acknowledging a write', (t) => {
  const { directory, store } = temporaryStore(t);
  fs.mkdirSync(path.join(directory, 'state.json'));
  assert.throws(() => store.transact((document) => document));
  assert.equal(fs.existsSync(path.join(directory, 'transaction.lock')), false);
});

const MARKET_TIME = Date.UTC(2026, 9, 11, 9, 30);
const HOUR = 3_600_000;
const CLOSED_TO = Math.floor(MARKET_TIME / HOUR) * HOUR;
function publicFixtures() {
  return {
    product: { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online',
      base_increment: '0.00000001', quote_increment: '0.01', post_only: false, limit_only: false,
      cancel_only: false, auction_mode: false, trading_disabled: false },
    book: { sequence: 42, bids: [['99.9', '5', 1]], asks: [['100', '5', 1]] },
    ticker: { trade_id: 17, time: new Date(MARKET_TIME).toISOString(), price: '99.95',
      size: '1', bid: '99.9', ask: '100', volume: '1000' },
    stats: { open: '99', last: '100', low: '98', high: '101', volume: '1000' },
    candles: [[(CLOSED_TO - HOUR) / 1000, 99, 101, 100, 100, 10]],
  };
}
function observerFor(fixtures = publicFixtures(), options = {}) {
  const calls = [];
  const observer = createCoinbaseObserver({ now: () => MARKET_TIME,
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      const last = new URL(url).pathname.split('/').at(-1);
      const key = last === 'BTC-USD' ? 'product' : last;
      assert.ok(Object.hasOwn(fixtures, key), `Unexpected public path: ${url}`);
      return { ok: true, status: 200, json: async () => structuredClone(fixtures[key]) };
    }, ...options });
  return { observer, calls };
}

test('independent: read-only market receipt does not manufacture book source freshness or executable liquidity', async () => {
  const { observer, calls } = observerFor();
  const result = await observer.observe('BTC-USD');
  assert.equal(result.sourceAt, MARKET_TIME);
  assert.equal(result.bookSourceAt, null);
  assert.equal(result.freshness.bookTimeKnown, false);
  assert.equal(result.freshness.bookAgeMs, null);
  assert.equal(result.evidence.executable, false);
  assert.equal(result.evidence.atomic, false);
  assert.equal(result.history.complete, false);
  assert.equal(result.history.missingBuckets, 167);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ request }) => request.method === 'GET'));
});

test('independent: fresh browser receipt cannot rehabilitate a stale source trade or known stale book', async () => {
  for (const field of ['ticker', 'book']) {
    const fixture = publicFixtures();
    fixture[field].time = new Date(MARKET_TIME - 30_001).toISOString();
    await assert.rejects(observerFor(fixture).observer.observe('BTC-USD'), /stale source time/);
  }
});

test('independent: product identity, quote currency, unknown support and restricted status fail closed', async () => {
  for (const mutate of [
    f => { f.product.base_currency = 'ETH'; },
    f => { f.stats.quote_currency = 'USDT'; },
    f => { f.product.post_only = true; },
    f => { delete f.product.auction_mode; },
  ]) {
    const fixture = publicFixtures(); mutate(fixture);
    await assert.rejects(observerFor(fixture).observer.observe('BTC-USD'));
  }
  const { observer, calls } = observerFor();
  await assert.rejects(observer.observe('DOGE-USD'), /Only BTC-USD and ETH-USD/);
  assert.equal(calls.length, 0);
});

test('independent: malformed, duplicated, crossed and nonfinite book levels cannot become market evidence', async () => {
  for (const mutate of [
    f => { f.book.bids[0][1] = '0'; },
    f => { f.book.bids.push(['99.9', '1', 1]); },
    f => { f.book.asks[0][0] = '99'; },
    f => { f.book.asks[0][0] = Infinity; },
    f => { f.book.bids[0][2] = '1'; },
    f => { f.book.bids[0][0] = ' '; },
  ]) {
    const fixture = publicFixtures(); mutate(fixture);
    await assert.rejects(observerFor(fixture).observer.observe('BTC-USD'));
  }
});

test('independent: partial current and out-of-window candles cannot lower the reported closed-window low', async () => {
  const fixture = publicFixtures();
  fixture.candles.push([(CLOSED_TO - 169 * HOUR) / 1000, 1, 101, 100, 100, 10]);
  fixture.candles.push([CLOSED_TO / 1000, 0.1, 101, 100, 100, 10]);
  const { history } = await observerFor(fixture).observer.observe('BTC-USD');
  assert.equal(history.low, 99);
  assert.equal(history.samples, 1);
  assert.equal(history.excludedBuckets, 2);
  assert.equal(history.complete, false);
  assert.match(history.description, /Not an all-time low/);
});

test('independent: future and duplicate candle buckets, plus future tickers, are rejected', async () => {
  for (const mutate of [
    f => { f.candles.push([(CLOSED_TO + HOUR) / 1000, 99, 101, 100, 100, 10]); },
    f => { f.candles.push([...f.candles[0]]); },
    f => { f.ticker.time = new Date(MARKET_TIME + 1001).toISOString(); },
  ]) {
    const fixture = publicFixtures(); mutate(fixture);
    await assert.rejects(observerFor(fixture).observer.observe('BTC-USD'));
  }
});

test('independent: HTTP failure and timeout produce errors with no fallback market', async () => {
  await assert.rejects(observerFor(publicFixtures(), {
    fetchImpl: async () => ({ ok: false, status: 429 }),
  }).observer.observe('BTC-USD'), /HTTP 429/);
  await assert.rejects(observerFor(publicFixtures(), {
    timeoutMs: 5, fetchImpl: () => new Promise(() => {}),
  }).observer.observe('BTC-USD'), /timed out/);
});

const FIXTURE_TIME = 1_000_000;
function quote({ eventId = 'independent-1', now = FIXTURE_TIME, ...overrides } = {}) {
  return { schemaVersion: 1, eventId, source: 'synthetic-fixture', provenance: 'synthetic',
    productId: 'BTC-USD', base: 'BTC', quote: 'USD', sourceAt: now, observedAt: now,
    bids: [[99.9, 10]], asks: [[100, 10]], change24hPct: null,
    history: { low: 99.5, from: now - 60_000, to: now, samples: 7, intervalMs: 10_000,
      complete: false, description: 'Invented seven-point audit fixture; not market evidence' }, ...overrides };
}
function engine(config = {}) {
  return createState({ initialCash: 1000, now: FIXTURE_TIME,
    config: { maxOrderNotional: 200, maxPositionNotional: 500, maxExposurePct: 100,
      maxSlippageBps: 200, feeBps: 10, maxSpreadBps: 200, minDepthNotional: 1, ...config } });
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from independently calculated ${expected}`); }

test('independent: depth-walk fees, slippage and net cash reconcile to hand-calculated round trip', () => {
  const start = engine();
  const bought = step(start, quote({ asks: [[100, 1], [101, 1]] }), { now: FIXTURE_TIME });
  assert.equal(bought.ledger.length, 1);
  near(bought.ledger[0].quantity, 2);
  near(bought.ledger[0].notional, 201);
  near(bought.ledger[0].fee, 0.201);
  near(bought.ledger[0].slippageCost, 1);
  near(bought.account.cash, 798.799);
  const sold = step(bought, quote({ eventId: 'independent-exit', now: FIXTURE_TIME + 1,
    bids: [[99, 1], [98.01, 1]], asks: [[99.1, 10]] }), { now: FIXTURE_TIME + 1 });
  assert.equal(sold.ledger.length, 2);
  near(sold.ledger[1].notional, 197.01);
  near(sold.ledger[1].fee, 0.19701);
  near(sold.ledger[1].slippageCost, 0.99);
  near(sold.account.cash, 995.61199);
  near(sold.account.realizedPnl, -4.38801);
  near(sold.account.feesPaid, 0.39801);
  near(sold.account.equity, sold.account.initialCash + sold.account.realizedPnl + sold.account.unrealizedPnl);
  assert.equal(Object.keys(sold.account.positions).length, 0);
  assert.equal(auditState(sold).ok, true);
  assert.deepEqual(start, engine(), 'Pure engine must leave the original state unchanged');
});

test('independent: explicit one-percent adverse slippage and ten-basis-point fees match the requested reference arithmetic', () => {
  const start = engine({ slippageBps: 100, maxSlippageBps: 100 });
  const bought = step(start, quote(), { now: FIXTURE_TIME });
  near(bought.ledger[0].averagePrice, 101);
  near(start.account.cash - bought.account.cash, 202.202);
  const sold = step(bought, quote({ eventId: 'reference-exit', now: FIXTURE_TIME + 1,
    bids: [[99, 10]], asks: [[99.1, 10]] }), { now: FIXTURE_TIME + 1 });
  near(sold.ledger[1].averagePrice, 98.01);
  near(sold.account.cash - bought.account.cash, 195.82398);
  near(sold.account.cash, 993.62198);
  near(sold.account.realizedPnl, -6.37802);
  assert.equal(auditState(sold).ok, true);
});

test('independent: duplicate events and same-source depth under a new ID cannot execute twice', () => {
  const snapshot = quote();
  const first = step(engine(), snapshot, { now: FIXTURE_TIME });
  for (const retry of [snapshot, quote({ eventId: 'new-id-same-depth', observedAt: FIXTURE_TIME + 1 })]) {
    const result = step(first, retry, { now: FIXTURE_TIME + 1 });
    assert.deepEqual(result.ledger, first.ledger);
    assert.deepEqual(result.account, first.account);
    assert.equal(result.decision.action, 'REJECT');
  }
});

test('independent: execution rechecks risk when a caller forges an oversized or stale proposal', () => {
  const state = engine();
  const snapshot = quote();
  const proposal = proposeTrade(state, snapshot, { now: FIXTURE_TIME }).proposal;
  assert.ok(proposal);
  for (const mutated of [
    { ...proposal, quantity: 1000 },
    { ...proposal, createdAt: FIXTURE_TIME - 2001 },
    { ...proposal, createdAt: FIXTURE_TIME + 1 },
    { ...proposal, expectedPrice: 1 },
    { ...proposal, productId: 'ETH-USD' },
    { ...proposal, quantity: NaN },
    { ...proposal, stopPrice: 101 },
  ]) {
    assert.equal(assessRisk(state, mutated, snapshot, { now: FIXTURE_TIME }).ok, false);
    assert.equal(executePaper(state, mutated, snapshot, { now: FIXTURE_TIME }).fill, null);
  }
  const publicQuote = { ...snapshot, source: 'coinbase-exchange', provenance: 'public' };
  assert.equal(executePaper(state, proposal, publicQuote, { now: FIXTURE_TIME }).fill, null);
  assert.equal(state.ledger.length, 0);
});

test('independent: repeated STOP is idempotent, invalidates a prepared buy, and preserves protective exits', () => {
  const state = engine();
  const snapshot = quote();
  const proposal = proposeTrade(state, snapshot, { now: FIXTURE_TIME }).proposal;
  const paused = stop(state, { now: FIXTURE_TIME });
  assert.equal(stop(paused, { now: FIXTURE_TIME }).control.version, paused.control.version);
  assert.equal(executePaper(paused, proposal, snapshot, { now: FIXTURE_TIME }).fill, null);
  assert.equal(step(paused, snapshot, { now: FIXTURE_TIME }).ledger.length, 0);
  const held = step(state, snapshot, { now: FIXTURE_TIME });
  const heldPaused = stop(held, { now: FIXTURE_TIME });
  const exited = step(heldPaused, quote({ eventId: 'stop-exit', now: FIXTURE_TIME + 1,
    bids: [[98.9, 10]], asks: [[99, 10]] }), { now: FIXTURE_TIME + 1 });
  assert.equal(exited.control.emergencyStop, true);
  assert.equal(exited.ledger.at(-1).side, 'SELL');
  assert.equal(Object.keys(exited.account.positions).length, 0);
  assert.ok(resume(paused, { now: FIXTURE_TIME }).control.version > paused.control.version);
});

test('independent: partial fills cancel the remainder and consumed depth cannot be reused', () => {
  const snapshot = quote({ asks: [[100, 0.5], [103, 10]] });
  const result = step(engine(), snapshot, { now: FIXTURE_TIME });
  assert.equal(result.execution.status, 'partial');
  near(result.execution.quantity, 0.5);
  near(result.execution.canceledQuantity, 1.5);
  const proposal = { ...proposeTrade(engine(), snapshot, { now: FIXTURE_TIME }).proposal };
  assert.equal(executePaper(result, proposal, snapshot, { now: FIXTURE_TIME }).fill, null);
});

test('independent: risk rejects insufficient cash, total exposure, and incomplete held-position valuation', () => {
  for (const config of [{ maxExposurePct: 10 }, { maxOrderNotional: 2000 }]) {
    const state = engine(config);
    const snapshot = quote();
    const result = step(state, snapshot, { now: FIXTURE_TIME });
    assert.equal(result.ledger.length, 0);
    assert.equal(result.decision.action, 'REJECT');
  }
  const bought = step(engine(), quote(), { now: FIXTURE_TIME });
  const later = FIXTURE_TIME + 20_000;
  const eth = quote({ now: later, eventId: 'other-market', productId: 'ETH-USD', base: 'ETH' });
  const result = step(bought, eth, { now: later });
  assert.equal(result.account.valuationComplete, false);
  assert.equal(result.account.equity, null);
  assert.equal(result.ledger.length, 1);
  assert.match(result.decision.reason, /valuation|marks/i);
});

test('independent: loss and drawdown halt survive STOP/resume and cannot be cleared by an operator resume', () => {
  const bought = step(engine({ maxLossUsd: 5, maxDrawdownPct: 1 }), quote(), { now: FIXTURE_TIME });
  const fallen = step(bought, quote({ eventId: 'loss', now: FIXTURE_TIME + 1,
    bids: [[80, 10]], asks: [[80.1, 10]] }), { now: FIXTURE_TIME + 1 });
  assert.equal(fallen.riskHalt.active, true);
  const resumed = resume(stop(fallen, { now: FIXTURE_TIME + 1 }), { now: FIXTURE_TIME + 1 });
  const next = step(resumed, quote({ eventId: 'after-loss', now: FIXTURE_TIME + 2 }), { now: FIXTURE_TIME + 2 });
  assert.equal(next.riskHalt.active, true);
  assert.equal(next.ledger.length, fallen.ledger.length);
  assert.match(next.decision.reason, /risk halt|loss limit|Drawdown/i);
});

test('independent: audit rejects balance corruption and impossible negative depth legs', () => {
  const bought = step(engine(), quote(), { now: FIXTURE_TIME });
  const badBalance = structuredClone(bought);
  badBalance.account.cash += 1;
  assert.equal(auditState(badBalance).ok, false);
  const badLegs = structuredClone(bought);
  const fill = badLegs.ledger[0];
  fill.legs = [{ price: fill.averagePrice, quantity: -1 }, { price: fill.averagePrice, quantity: fill.quantity + 1 }];
  assert.equal(auditState(badLegs).ok, false);
});

test('independent: fresh held positions remain valued, stale positions become unknown, inactive risk is not HALTED', () => {
  const document = initialDocument();
  document.mode = 'fixture-replay';
  document.engine = step(engine(), quote(), { now: FIXTURE_TIME });
  document.control.stopped = false;
  const fresh = toView(document, { now: FIXTURE_TIME });
  assert.equal(fresh.valuationIncomplete, false);
  assert.equal(typeof fresh.account.equity, 'number');
  assert.notEqual(fresh.risk.status, 'HALTED');
  const stale = toView(document, { now: FIXTURE_TIME + 20_000 });
  assert.equal(stale.valuationIncomplete, true);
  assert.equal(stale.account.equity, null);
  assert.equal(stale.account.netPnl, null);
});

test('independent: dashboard freshness expires at the oldest source time, never at renewed receipt time', () => {
  const state = { mode: 'observe', freshnessMaxAgeMs: 10_000 };
  const row = { observedAt: FIXTURE_TIME, sourceAt: FIXTURE_TIME - 9000,
    bookSourceAt: FIXTURE_TIME, stale: false };
  assert.equal(quoteFreshness(row, state, FIXTURE_TIME).current, true);
  assert.equal(quoteFreshness(row, state, FIXTURE_TIME + 1001).current, false);
  assert.equal(quoteFreshness({ ...row, sourceAt: FIXTURE_TIME, bookSourceAt: null }, state, FIXTURE_TIME).current, false);
});

test('independent: persisted operator STOP during historical replay allows only a fresh protective exit', async (t) => {
  const { store } = temporaryStore(t);
  await replay({ store, input: [quote()], armFixture: true });
  assert.equal(store.read().engine.ledger.length, 1);
  pauseEntries(store);
  await replay({ store, input: [quote({ eventId: 'persisted-stop-exit', now: FIXTURE_TIME + 1,
    bids: [[98.9, 10]], asks: [[99, 10]] })] });
  const persisted = store.read();
  assert.equal(persisted.control.stopped, true);
  assert.equal(persisted.engine.ledger.length, 2);
  assert.equal(persisted.engine.ledger.at(-1).side, 'SELL');
});

test('independent: a prior operator STOP cannot be erased by first-time replay arming', async (t) => {
  const { store } = temporaryStore(t);
  pauseEntries(store);
  await assert.rejects(replay({ store, input: [quote()], armFixture: true }), /STOP|stop|pause/i);
  assert.equal(store.read().control.stopped, true);
  assert.equal(store.read().engine, null);
});

test('independent: native browser and installed persistent-service verification', {
  skip: 'Unsupported native browser environment; no deployment or persistent service authorized in this slice.'
}, () => {});
