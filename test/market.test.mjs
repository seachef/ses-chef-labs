import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinbaseObserver, fetchObservation, SUPPORTED_PRODUCTS } from '../src/market/coinbase.mjs';

// Fabricated API fixtures only; these are not public observations or performance evidence.
const NOW = Date.UTC(2026, 9, 11, 9, 30);
const HOUR = 3_600_000;
const END = Math.floor(NOW / HOUR) * HOUR;

function fixtures(productId = 'BTC-USD') {
  return {
    product: {
      id: productId, base_currency: productId.split('-')[0], quote_currency: 'USD', status: 'online',
      post_only: false, limit_only: false, cancel_only: false, auction_mode: false, trading_disabled: false,
      base_increment: '0.00000001', quote_increment: '0.01', min_market_funds: '1',
    },
    book: { sequence: 20, time: new Date(NOW - 100).toISOString(), auction_mode: false, bids: [['99', '2', 3], ['98', '4', 7]], asks: [['101', '2', 4], ['102', '3', 2]] },
    ticker: { trade_id: 10, time: new Date(NOW - 200).toISOString(), price: '100', size: '1', bid: '99', ask: '101', volume: '1000' },
    stats: { open: '95', last: '100', low: '90', high: '110', volume: '1000' },
    candles: Array.from({ length: 168 }, (_, index) => [(END - (index + 1) * HOUR) / 1000, 90 + index / 1000, 110, 99, 100, 20]),
  };
}

function setup(mutate = () => {}, options = {}) {
  const data = fixtures(options.productId);
  mutate(data);
  const requests = [];
  const fetchImpl = async (url, requestOptions) => {
    requests.push({ url, options: requestOptions });
    const parsed = new URL(url);
    const suffix = parsed.pathname.split('/').at(-1);
    const key = suffix.includes('-') ? 'product' : suffix;
    return { ok: true, status: 200, json: async () => structuredClone(data[key]) };
  };
  return { data, requests, fetchImpl, observer: createCoinbaseObserver({ now: () => NOW, fetchImpl, ...options }) };
}

test('constructor has no network side effects; explicit observation has five public GETs and stable identity', async () => {
  const { observer, requests } = setup();
  assert.equal(requests.length, 0);
  const first = await observer.observe('BTC-USD');
  const second = await observer.observe('BTC-USD');
  assert.equal(requests.length, 10);
  assert.equal(first.eventId, second.eventId);
  assert.equal(first.eventId, 'coinbase-exchange:BTC-USD:20:10');
  assert.equal(first.provenance, 'public');
  assert.equal(first.evidence.executable, false);
  assert.equal(first.evidence.atomic, false);
  assert.equal(first.sourceAt, NOW - 200);
  assert.equal(first.observedAt, NOW);
  assert.equal(first.bookSourceAt, NOW - 100);
  assert.deepEqual(first.bids[0], [99, 2]); // Size is already aggregated; order count is not a multiplier.
  assert.equal(first.product.quote, 'USD');
  assert.equal(first.history.samples, 168);
  assert.equal(first.history.complete, false);
  assert.equal(first.history.missingBuckets, 0);
  assert.equal(first.history.low, 90);
  assert.ok(Math.abs(first.change24hPct - 5.263157894736836) < 1e-10);
  assert.ok(requests.every(request => request.url.startsWith('https://api.exchange.coinbase.com/products/BTC-USD') && request.options.method === 'GET' && request.options.redirect === 'error' && !('Authorization' in request.options.headers)));
  const candleUrl = new URL(requests.find(request => request.url.includes('/candles')).url);
  assert.equal(candleUrl.searchParams.get('granularity'), '3600');
  assert.equal(Date.parse(candleUrl.searchParams.get('end')), END);
  assert.equal(Date.parse(candleUrl.searchParams.get('start')), END - 168 * HOUR);
});

test('both exact venue products use explicit base and USD quote', async () => {
  for (const productId of SUPPORTED_PRODUCTS) {
    const { fetchImpl } = setup(() => {}, { productId });
    const observed = await fetchObservation({ productId, fetchImpl, now: () => NOW });
    assert.equal(observed.productId, productId);
    assert.equal(observed.base, productId.split('-')[0]);
  }
  const { observer, requests } = setup();
  await assert.rejects(observer.observe('BTC-USDT'), { code: 'UNSUPPORTED_PRODUCT' });
  assert.equal(requests.length, 0);
});

test('wrong product identity, currency, status, restrictions and unknown flags fail closed', async t => {
  for (const [field, value] of [['id', 'ETH-USD'], ['base_currency', 'XBT'], ['quote_currency', 'USDT'], ['status', 'offline'], ['post_only', true], ['limit_only', true], ['cancel_only', true], ['auction_mode', true], ['trading_disabled', true], ['auction_mode', undefined]]) {
    await t.test(`${field}=${value}`, async () => {
      const { observer, requests } = setup(data => { data.product[field] = value; });
      await assert.rejects(observer.observe('BTC-USD'));
      assert.equal(requests.length, 1);
    });
  }
});

test('book rejects indicative, missing, crossed, unsorted, duplicate and invalid levels', async t => {
  const cases = [
    ['auction', data => { data.book.auction_mode = true; }],
    ['empty bids', data => { data.book.bids = []; }],
    ['crossed', data => { data.book.bids[0][0] = '102'; }],
    ['locked', data => { data.book.bids[0][0] = '101'; }],
    ['unsorted', data => { data.book.bids.reverse(); }],
    ['duplicate', data => { data.book.asks[1][0] = '101'; }],
    ['NaN', data => { data.book.bids[0][0] = NaN; }],
    ['Infinity', data => { data.book.asks[0][1] = Infinity; }],
    ['zero size', data => { data.book.asks[0][1] = '0'; }],
    ['negative', data => { data.book.bids[0][1] = '-1'; }],
    ['empty decimal', data => { data.book.bids[0][0] = ''; }],
    ['boolean', data => { data.book.bids[0][0] = true; }],
    ['zero orders', data => { data.book.bids[0][2] = 0; }],
    ['unsafe sequence', data => { data.book.sequence = Number.MAX_SAFE_INTEGER + 1; }],
    ['wrong embedded identity', data => { data.book.product_id = 'ETH-USD'; }],
  ];
  for (const [label, mutate] of cases) await t.test(label, async () => {
    await assert.rejects(setup(mutate).observer.observe('BTC-USD'));
  });
});

test('fresh receipt cannot launder stale/future ticker or book time', async t => {
  for (const endpoint of ['ticker', 'book']) for (const [label, offset, code] of [['stale', -30_001, 'STALE_DATA'], ['future', 1001, 'FUTURE_DATA']]) {
    await t.test(`${endpoint} ${label}`, async () => {
      const { observer } = setup(data => { data[endpoint].time = new Date(NOW + offset).toISOString(); });
      await assert.rejects(observer.observe('BTC-USD'), { code });
    });
  }
});

test('missing book time remains unknown, and invalid supplied book time fails', async () => {
  const { observer } = setup(data => { delete data.book.time; });
  const snapshot = await observer.observe('BTC-USD');
  assert.equal(snapshot.bookSourceAt, null);
  assert.equal(snapshot.freshness.bookAgeMs, null);
  assert.equal(snapshot.freshness.bookTimeKnown, false);
  assert.equal(snapshot.evidence.executable, false);
  await assert.rejects(setup(data => { data.book.time = 'yesterday'; }).observer.observe('BTC-USD'));
});

test('ticker identity, timestamp, bid/ask and stats consistency are validated', async t => {
  for (const [label, mutate] of [
    ['wrong ticker quote', data => { data.ticker.quote_currency = 'USDT'; }],
    ['missing time', data => { delete data.ticker.time; }],
    ['impossible date', data => { data.ticker.time = '2026-02-30T09:30:00Z'; }],
    ['crossed ticker', data => { data.ticker.bid = '102'; }],
    ['invalid size', data => { data.ticker.size = '0'; }],
    ['invalid volume', data => { data.ticker.volume = null; }],
    ['invalid stats', data => { data.stats.open = '0'; }],
    ['inconsistent stats', data => { data.stats.high = '94'; }],
  ]) await t.test(label, async () => { await assert.rejects(setup(mutate).observer.observe('BTC-USD')); });
});

test('history reports gaps and excludes pre-window and current partial candles', async () => {
  const { observer } = setup(data => {
    data.candles.splice(1, 1);
    data.candles.push([(END - 169 * HOUR) / 1000, 1, 110, 99, 100, 20]);
    data.candles.push([END / 1000, 1, 110, 99, 100, 20]);
  });
  const { history } = await observer.observe('BTC-USD');
  assert.equal(history.samples, 167);
  assert.equal(history.missingBuckets, 1);
  assert.equal(history.excludedBuckets, 2);
  assert.equal(history.low, 90);
  assert.equal(history.complete, false);
  assert.match(history.description, /Not an all-time low/);
  const empty = await setup(data => { data.candles = []; }).observer.observe('BTC-USD');
  assert.equal(empty.history.low, null);
  assert.equal(empty.history.from, null);
  assert.equal(empty.history.to, null);
  assert.equal(empty.history.missingBuckets, 168);
});

test('history rejects malformed, duplicate, nonhourly, impossible OHLC and future candles', async t => {
  for (const [label, mutate] of [
    ['not array', data => { data.candles = {}; }],
    ['duplicate', data => { data.candles.push(data.candles[0]); }],
    ['not six fields', data => { data.candles[0].pop(); }],
    ['not hourly', data => { data.candles[0][0] += 1; }],
    ['OHLC', data => { data.candles[0][1] = 101; }],
    ['future', data => { data.candles[0][0] = (END + HOUR) / 1000; }],
  ]) await t.test(label, async () => { await assert.rejects(setup(mutate).observer.observe('BTC-USD')); });
});

test('HTTP, body parsing and network failures never return retained observations', async () => {
  const { fetchImpl } = setup();
  let failed = false;
  const observer = createCoinbaseObserver({ now: () => NOW, fetchImpl: (...args) => failed ? Promise.resolve({ ok: false, status: 429 }) : fetchImpl(...args) });
  await observer.observe('BTC-USD');
  failed = true;
  await assert.rejects(observer.observe('BTC-USD'), { code: 'HTTP_ERROR' });
  await assert.rejects(createCoinbaseObserver({ now: () => NOW, fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }) }).observe('BTC-USD'), { code: 'REQUEST_FAILED' });
  await assert.rejects(createCoinbaseObserver({ now: () => NOW, fetchImpl: async () => { throw new Error('offline'); } }).observe('BTC-USD'), { code: 'REQUEST_FAILED' });
});

test('timeout covers fetch and response body and aborts underlying request', async () => {
  let signal;
  const hungFetch = createCoinbaseObserver({ timeoutMs: 5, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(hungFetch.observe('BTC-USD'), { code: 'TIMEOUT' });
  assert.equal(signal.aborted, true);
  const hungBody = createCoinbaseObserver({ timeoutMs: 5, fetchImpl: async () => ({ ok: true, json: async () => new Promise(() => {}) }) });
  await assert.rejects(hungBody.observe('BTC-USD'), { code: 'TIMEOUT' });
});

test('local clock regression and invalid configuration fail closed', async () => {
  let call = 0;
  const { observer } = setup(() => {}, { now: () => ++call === 1 ? NOW : NOW - 1 });
  await assert.rejects(observer.observe('BTC-USD'), { code: 'INVALID_CLOCK' });
  assert.throws(() => createCoinbaseObserver({ timeoutMs: Infinity }), { code: 'INVALID_CONFIG' });
});
