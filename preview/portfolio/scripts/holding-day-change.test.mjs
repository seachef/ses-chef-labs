import test from 'node:test';
import assert from 'node:assert/strict';
import { decimal, decimalText, parseLosslessJson, percentageChange } from '../portfolio/exact-decimal.mjs';
import { createHoldingDayChangeSource, holdingDayChangeTarget, holdingDayChangeUrls, parseHoldingDayChange, calculateHoldingDayChange as computeHoldingDayChange, WETH_CONTRACT } from '../portfolio/holding-day-change.mjs';

// Synthetic fixtures only. No stored balances, wallets, credentials or network calls.
const TOKEN = `0x${'1'.repeat(40)}`, POOL = `0x${'2'.repeat(40)}`, QUOTE = `0x${'3'.repeat(40)}`;
const OTHER_TOKEN = `0x${'4'.repeat(40)}`, OTHER_POOL = `0x${'5'.repeat(40)}`;
const target = { chainId: 1, assetId: TOKEN, poolAddress: POOL };
const NOW = Date.parse('2026-10-07T12:15:00Z');
const calculateHoldingDayChange = input => computeHoldingDayChange({ nowMs: NOW, ...input });
const END_START = Date.parse('2026-10-07T11:00:00Z') / 1000;
const BASE_START = END_START - 86400;
const meta = ({ asset = TOKEN, opposite = QUOTE, pool = POOL, quoteSide = false } = {}) => ({
  data: [{ type: 'pool', id: `eth_${pool}`, attributes: { address: pool }, relationships: {
    base_token: { data: { type: 'token', id: `eth_${quoteSide ? opposite : asset}` } },
    quote_token: { data: { type: 'token', id: `eth_${quoteSide ? asset : opposite}` } },
  } }],
});
const row = (at, close, { open = close, high = close, low = close, volume = '1' } = {}) => `[${at},${open},${high},${low},${close},${volume}]`;
const ohlcv = (rows = [row(END_START, '110'), row(BASE_START, '100')], { asset = TOKEN, opposite = QUOTE } = {}) =>
  `{"data":{"type":"ohlcv_request_response","attributes":{"ohlcv_list":[${rows.join(',')}]}},"meta":{"base":{"address":"${asset}"},"quote":{"address":"${opposite}"}}}`;
const parse = (extra = {}) => parseHoldingDayChange({ metadataText: JSON.stringify(meta()), ohlcvText: ohlcv(), target, nowMs: NOW, ...extra });
const reply = (text, init = {}) => new Response(text, { headers: { 'content-type': 'application/json' }, ...init });
const sourceWith = (extra = {}) => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return reply(url.includes('/multi/') ? JSON.stringify(meta()) : ohlcv()); };
  return { calls, source: createHoldingDayChangeSource({ fetchImpl, now: () => NOW, ...extra }) };
};

test('lossless JSON keeps large, tiny and exponent number lexemes, strings and escapes intact', () => {
  const parsed = parseLosslessJson('{"a":9007199254740993.001,"b":5.6034082342082e-9,"c":"quote \\\" 15","d":null,"e":true}');
  assert.equal(parsed.a, '9007199254740993.001');
  assert.equal(parsed.b, '5.6034082342082e-9');
  assert.equal(parsed.c, 'quote " 15');
  assert.equal(parsed.d, null); assert.equal(parsed.e, true);
  assert.equal(decimalText(decimal(parsed.b, { exponent: true })), '0.0000000056034082342082');
  for (const text of ['{"a":01}', '{"a":NaN}', '{"a":1.}', '{"a":1e}', '{"a":+1}', '{"a":Infinity}']) assert.throws(() => parseLosslessJson(text));
  for (const value of [5, 'NaN', 'Infinity', '1e1001', '01', '-1']) assert.throws(() => decimal(value, { exponent: true }));
});

test('exact 24h completed close pair has explicit interval boundaries and provenance', () => {
  const result = parse();
  assert.equal(result.status, 'ready'); assert.equal(result.currentPriceUsd, '110'); assert.equal(result.baselinePriceUsd, '100');
  assert.equal(result.endpointAt, '2026-10-07T12:00:00.000Z'); assert.equal(result.baselineAt, '2026-10-06T12:00:00.000Z');
  assert.equal(result.endpointCandleStartAt, '2026-10-07T11:00:00.000Z'); assert.equal(result.spanSeconds, 86400);
  assert.equal(result.endpointAgeMs, 900000); assert.equal(result.quoteCurrency, 'USD'); assert.equal(result.identityVerified, true);
  assert.ok(result.sourceUrl.includes(`token=${TOKEN}&include_empty_intervals=false`));
});

test('forming hourly candle never becomes the endpoint, including exactly at its start', () => {
  const ohlcvText = ohlcv([row(END_START + 3600, '999'), row(END_START, '110'), row(BASE_START, '100')]);
  for (const nowMs of [NOW, Date.parse('2026-10-07T12:01:30Z')]) {
    const result = parse({ ohlcvText, nowMs });
    assert.equal(result.currentPriceUsd, '110'); assert.equal(result.endpointAt, '2026-10-07T12:00:00.000Z');
  }
  assert.equal(parse({ ohlcvText: ohlcv([row(END_START + 3600, '999')]) }).reason, 'no_completed_candle');
});

test('requires exact baseline hour, never forward-fills or substitutes a nearby candle', () => {
  const result = parse({ ohlcvText: ohlcv([row(END_START, '110'), row(BASE_START + 3600, '102'), row(BASE_START - 3600, '99')]) });
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'missing_24h_baseline');
  assert.equal(result.currentPriceUsd, null);
});

test('stale pair retains actual endpoints and never acquires a current status from retrieval', () => {
  const ohlcvText = ohlcv([row(END_START - 7200, '110'), row(BASE_START - 7200, '100')]);
  const result = parse({ ohlcvText });
  assert.equal(result.status, 'stale'); assert.equal(result.reason, 'stale_endpoint'); assert.equal(result.endpointAt, '2026-10-07T10:00:00.000Z');
  assert.equal(calculateHoldingDayChange({ quantity: '3', comparison: result }).status, 'stale');
  assert.equal(parse({ nowMs: Date.parse('2026-10-07T13:30:00Z') }).status, 'ready');
  assert.equal(parse({ nowMs: Date.parse('2026-10-07T13:30:00.001Z') }).status, 'stale');
});

test('matching duplicate closes are accepted even when other valid OHLC fields differ', () => {
  const result = parse({ ohlcvText: ohlcv([
    row(END_START, '110'), row(END_START, '1.10e2', { open: '109', high: '111', low: '100' }),
    row(BASE_START, '100'), row(BASE_START, '100.000', { high: '101' }),
  ]) });
  assert.equal(result.status, 'ready'); assert.equal(result.currentPriceUsd, '110');
});

test('conflicting selected timestamp closes fail closed; irrelevant older duplicate conflicts do not alter selected prices', () => {
  assert.equal(parse({ ohlcvText: ohlcv([row(END_START, '110'), row(END_START, '111'), row(BASE_START, '100')]) }).reason, 'conflicting_endpoint');
  assert.equal(parse({ ohlcvText: ohlcv([row(END_START, '110'), row(BASE_START, '100'), row(BASE_START, '101')]) }).reason, 'conflicting_baseline');
  assert.equal(parse({ ohlcvText: ohlcv([row(END_START, '110'), row(BASE_START, '100'), row(BASE_START - 3600, '99'), row(BASE_START - 3600, '98')]) }).status, 'ready');
});

test('bad order, timestamps, prices, volumes and OHLC ranges produce neutral gaps', () => {
  const cases = [
    [row(BASE_START, '100'), row(END_START, '110')],
    [row(END_START + 1, '110'), row(BASE_START, '100')],
    [row(END_START + 7200, '110'), row(BASE_START, '100')],
    [row(END_START, '0'), row(BASE_START, '100')],
    [row(END_START, '-1'), row(BASE_START, '100')],
    [row(END_START, '1e1001'), row(BASE_START, '100')],
    [row(END_START, '110', { volume: '-1' }), row(BASE_START, '100')],
    [row(END_START, '110', { high: '109' }), row(BASE_START, '100')],
    [row(END_START, '110', { low: '111' }), row(BASE_START, '100')],
    [row(END_START, '110', { open: '112', high: '111' }), row(BASE_START, '100')],
  ];
  for (const rows of cases) {
    const result = parse({ ohlcvText: ohlcv(rows) });
    assert.equal(result.status, 'unavailable', rows.join(',')); assert.equal(result.currentPriceUsd, null);
  }
});

test('quote-side held contract is verified in the pool and becomes meta.base in the selected series', () => {
  assert.equal(parse({ metadataText: JSON.stringify(meta({ quoteSide: true })) }).status, 'ready');
  assert.equal(parse({ ohlcvText: ohlcv(undefined, { asset: QUOTE, opposite: TOKEN }) }).reason, 'ohlcv_identity_mismatch');
  assert.equal(parse({ ohlcvText: ohlcv(undefined, { opposite: OTHER_TOKEN }) }).reason, 'ohlcv_identity_mismatch');
});

test('wrong network, pool, token association, ambiguous metadata and source type fail closed', () => {
  const wrongNetwork = meta(); wrongNetwork.data[0].id = `polygon_pos_${POOL}`;
  const wrongType = meta(); wrongType.data[0].type = 'token';
  const ambiguous = meta(); ambiguous.data.push(ambiguous.data[0]);
  const cases = [wrongNetwork, wrongType, ambiguous, meta({ asset: OTHER_TOKEN }), meta({ pool: OTHER_POOL }), meta({ opposite: TOKEN })];
  for (const metadata of cases) assert.equal(parse({ metadataText: JSON.stringify(metadata) }).status, 'unavailable');
  assert.equal(parse({ ohlcvText: ohlcv().replace('ohlcv_request_response', 'pool') }).status, 'unavailable');
  assert.equal(parse({ target: { ...target, chainId: 137 } }).reason, 'unsupported_network');
  assert.equal(parse({ target: { ...target, assetId: 'ETH' } }).reason, 'invalid_asset');
});

test('native ETH is explicitly canonical WETH/USDC proxy; generic WETH is exact token', () => {
  const native = holdingDayChangeTarget({ chainId: 1, assetId: 'native' });
  assert.equal(native.tokenAddress, WETH_CONTRACT); assert.equal(native.proxy, true); assert.match(native.proxyNote, /proxy/);
  assert.equal(holdingDayChangeTarget({ chainId: 1, assetId: WETH_CONTRACT }).proxy, false);
  const metadataText = JSON.stringify(meta({ asset: WETH_CONTRACT, opposite: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', pool: native.poolAddress }));
  const result = parse({ target: native, metadataText, ohlcvText: ohlcv(undefined, { asset: WETH_CONTRACT, opposite: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }) });
  assert.equal(result.status, 'ready'); assert.equal(result.proxyNote, native.proxyNote);
  assert.equal(parse({ target: native, metadataText: JSON.stringify(meta({ asset: WETH_CONTRACT, pool: native.poolAddress })), ohlcvText: ohlcv(undefined, { asset: WETH_CONTRACT }) }).reason, 'proxy_identity_mismatch');
  assert.throws(() => holdingDayChangeTarget({ chainId: 1, assetId: 'native', poolAddress: POOL }));
  assert.throws(() => holdingDayChangeTarget({ chainId: 1, assetId: '0xfd4cb1294df23920e683e046963117cae6c807d9', poolAddress: POOL }));
});

test('source requests are credential-free and contain only exact public asset/pool identity', async () => {
  const { source, calls } = sourceWith();
  const result = await source.get({ ...target, walletAddress: 'PRIVATE_WALLET', ownerId: 'PRIVATE_OWNER', quantity: 'PRIVATE_QUANTITY', accountId: 'PRIVATE_ACCOUNT' });
  assert.equal(result.status, 'ready'); assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.url), Object.values(holdingDayChangeUrls(target)));
  for (const { options } of calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.deepEqual(options.headers, { Accept: 'application/json' }); assert.equal(options.body, undefined);
  }
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE_/); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test('public caching uses identity and a bounded TTL, with no private caller state', async () => {
  let time = NOW;
  const { source, calls } = sourceWith({ now: () => time });
  await source.get(target); await source.get({ ...target, ownerId: 'another owner' });
  assert.equal(calls.length, 2);
  time += 60000; await source.get(target); assert.equal(calls.length, 4);
  source.clear(); await source.get(target); assert.equal(calls.length, 6);
});

test('public cache reassesses freshness before returning a cached pair', async () => {
  let time = Date.parse('2026-10-07T13:29:30Z');
  const { source, calls } = sourceWith({ now: () => time, cacheTtlMs: 120000 });
  assert.equal((await source.get(target)).status, 'ready');
  time += 60000;
  assert.equal((await source.get(target)).status, 'stale'); assert.equal(calls.length, 2);
});

test('cache entry count stays bounded and source identity failures stop before history request', async () => {
  let calls = 0;
  const source = createHoldingDayChangeSource({ now: () => NOW, maxEntries: 1, fetchImpl: async url => {
    calls++; const other = url.includes(OTHER_POOL);
    return reply(url.includes('/multi/') ? JSON.stringify(meta({ pool: other ? OTHER_POOL : POOL })) : ohlcv());
  } });
  await source.get(target); await source.get({ ...target, poolAddress: OTHER_POOL }); await source.get(target);
  assert.equal(calls, 6);
  const broken = sourceWith({ fetchImpl: async () => { calls++; return reply(JSON.stringify(meta({ asset: OTHER_TOKEN }))); } });
  const before = calls;
  assert.equal((await broken.source.get(target)).reason, 'token_not_in_pool'); assert.equal(calls, before + 1);
});

test('429 and other source failures do not retry or leak raw errors', async () => {
  for (const response of [reply('PRIVATE_BODY', { status: 429 }), reply('PRIVATE_BODY', { status: 500 }), reply('<html/>', { headers: { 'content-type': 'text/html' } })]) {
    let count = 0;
    const { source } = sourceWith({ fetchImpl: async () => { count++; return response; } });
    const result = await source.get(target);
    assert.equal(result.status, 'unavailable'); assert.equal(count, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_BODY/);
    assert.equal((await source.get(target)).status, 'unavailable'); assert.equal(count, 1);
  }
  const { source } = sourceWith({ fetchImpl: async () => { throw Error('PRIVATE_ERROR'); } });
  assert.equal((await source.get(target)).reason, 'request_failed');
});

test('redirected or unexpected source URLs are rejected', async () => {
  for (const property of [{ redirected: true }, { url: 'https://example.com/' }]) {
    const response = reply(JSON.stringify(meta()));
    for (const [key, value] of Object.entries(property)) Object.defineProperty(response, key, { value });
    const { source } = sourceWith({ fetchImpl: async () => response });
    assert.equal((await source.get(target)).reason, 'unexpected_response_url');
  }
});

test('size bounds apply to headers and actual streamed bytes', async () => {
  for (const response of [reply('{}', { headers: { 'content-type': 'application/json', 'content-length': '524289' } }), reply(' '.repeat(524289))]) {
    const { source } = sourceWith({ fetchImpl: async () => response });
    assert.equal((await source.get(target)).reason, 'response_too_large');
  }
});

test('request deadline and caller cancellation abort work, without retries', async () => {
  let seenSignal, calls = 0;
  const source = createHoldingDayChangeSource({ now: () => NOW, timeoutMs: 10, fetchImpl: async (_url, options) => {
    calls++; seenSignal = options.signal; return new Promise(() => {});
  } });
  assert.equal((await source.get(target)).reason, 'timeout'); assert.equal(calls, 1); assert.equal(seenSignal.aborted, true);
  source.clear();
  const controller = new AbortController(); controller.abort('PRIVATE_ABORT_REASON');
  const result = await source.get(target, { signal: controller.signal });
  assert.equal(result.reason, 'aborted'); assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ABORT/);
  const running = new AbortController();
  const pending = source.get(target, { signal: running.signal }); running.abort();
  assert.equal((await pending).reason, 'aborted'); assert.equal(seenSignal.aborted, true);
});

test('USD dollar movement uses current quantity exactly and is distinct from percentage', () => {
  const result = calculateHoldingDayChange({ quantity: '2.5', comparison: parse() });
  assert.equal(result.status, 'ready'); assert.equal(result.usdChange, '+25'); assert.equal(result.selectedCurrencyChange, '+25');
  assert.equal(result.percent, '+10'); assert.equal(result.direction, 'up'); assert.equal(result.fx, null);
  assert.match(result.calculationNote, /Not actual portfolio P&L/); assert.match(result.calculationNote, /rewards/);
  const loss = calculateHoldingDayChange({ quantity: '2.5', comparison: parse({ ohlcvText: ohlcv([row(END_START, '90'), row(BASE_START, '100')]) }) });
  assert.equal(loss.usdChange, '-25'); assert.equal(loss.percent, '-10'); assert.equal(loss.direction, 'down');
});

test('zero price movement and zero quantity never produce negative zero', () => {
  const flat = calculateHoldingDayChange({ quantity: '3', comparison: parse({ ohlcvText: ohlcv([row(END_START, '100'), row(BASE_START, '100')]) }) });
  assert.equal(flat.usdChange, '0'); assert.equal(flat.percent, '0'); assert.equal(flat.percentExact.denominator, '1'); assert.equal(flat.direction, 'flat');
  const none = calculateHoldingDayChange({ quantity: '0', comparison: parse() });
  assert.equal(none.usdChange, '0'); assert.equal(none.percent, '+10');
});

test('very large quantity and tiny price changes remain exact beyond IEEE precision', () => {
  const comparison = parse({ ohlcvText: ohlcv([row(END_START, '1.000000000000000001e-9'), row(BASE_START, '1e-9')]) });
  const result = calculateHoldingDayChange({ quantity: '1000000000000000000000000000', comparison });
  assert.equal(comparison.currentPriceUsd, '0.000000001000000000000000001'); assert.equal(result.usdChange, '+1');
  assert.equal(result.percent, '+0.0000000000000001');
  const huge = parse({ ohlcvText: ohlcv([row(END_START, '9007199254740993.001'), row(BASE_START, '9007199254740993')]) });
  assert.equal(calculateHoldingDayChange({ quantity: '1000', comparison: huge }).usdChange, '+1');
});

test('repeating percentage retains its exact rational value and marks its rounded decimal', () => {
  const result = percentageChange(decimal('4'), decimal('3'));
  assert.equal(result.value, '+33.333333333333333333'); assert.equal(result.numerator, '100'); assert.equal(result.denominator, '3'); assert.equal(result.approximate, true);
  assert.equal(percentageChange(decimal('2'), decimal('3')).value, '-33.333333333333333333');
});

test('AUD uses one verified saved FX at both endpoints and reports its date and source', () => {
  const result = calculateHoldingDayChange({ quantity: '2.5', comparison: parse(), currency: 'AUD', fx: { rate: '1.5001', date: '2026-10-06', source: 'Synthetic verified reference', verified: true } });
  assert.equal(result.usdChange, '+25'); assert.equal(result.selectedCurrencyChange, '+37.5025'); assert.equal(result.percent, '+10');
  assert.equal(result.fx.date, '2026-10-06'); assert.equal(result.fx.rate, '1.5001'); assert.match(result.fx.note, /FX movement is excluded/);
});

test('missing, unverified, invalid or future FX leaves AUD unavailable without relabeling USD', () => {
  for (const fx of [null, {}, { rate: '1.5', date: '2026-10-06', source: 'fixture' }, { rate: '1.5', date: '2026-02-30', source: 'fixture', verified: true }, { rate: '1.5', date: '2026-10-08', source: 'fixture', verified: true }, { rate: '0', date: '2026-10-06', source: 'fixture', verified: true }]) {
    const result = calculateHoldingDayChange({ quantity: '2', comparison: parse(), currency: 'AUD', fx });
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'fx_unavailable'); assert.equal(result.currency, 'AUD'); assert.equal(result.selectedCurrencyChange, null);
  }
});

test('invalid calculation identity, denomination, timestamps or quantity is unavailable', () => {
  for (const change of [{ quoteCurrency: 'AUD' }, { identityVerified: false }, { sourceUrl: 'https://example.com' }, { method: 'h24' }, { baselineAt: '2026-10-06T11:00:00Z' }, { currentPriceUsd: 110 }, { currentPriceUsd: '-1' }]) {
    assert.equal(calculateHoldingDayChange({ quantity: '2', comparison: { ...parse(), ...change } }).status, 'unavailable');
  }
  for (const quantity of [undefined, 2, '-2', '1e9', 'NaN', 'Infinity', '0.0.1']) assert.equal(calculateHoldingDayChange({ quantity, comparison: parse() }).reason, 'invalid_quantity');
  assert.equal(calculateHoldingDayChange({ quantity: '2', comparison: parse(), currency: 'EUR' }).reason, 'unsupported_currency');
  assert.equal(calculateHoldingDayChange({ quantity: '2', comparison: parse({ ohlcvText: ohlcv([]) }) }).status, 'unavailable');
});

test('a retained ready comparison becomes stale at calculation time after 90 minutes', () => {
  const comparison = parse();
  assert.equal(calculateHoldingDayChange({ quantity: '1', comparison, nowMs: Date.parse('2026-10-07T13:30:00Z') }).status, 'ready');
  const stale = calculateHoldingDayChange({ quantity: '1', comparison, nowMs: Date.parse('2026-10-07T13:30:00.001Z') });
  assert.equal(stale.status, 'stale'); assert.equal(stale.reason, 'stale_endpoint'); assert.equal(stale.usdChange, '+10');
  assert.equal(stale.endpointAgeMs, 5400001);
  assert.equal(calculateHoldingDayChange({ quantity: '1', comparison, nowMs: Date.parse('2026-10-08T13:00:00Z') }).status, 'stale');
  assert.equal(calculateHoldingDayChange({ quantity: '1', comparison, nowMs: NOW - 1 }).reason, 'invalid_clock');
  assert.equal(parse({ retrievedAt: '2026-10-07T11:59:59Z' }).reason, 'invalid_retrieval_time');
  assert.equal(calculateHoldingDayChange({ quantity: '1', comparison: { ...comparison, retrievedAt: '2026-10-07T11:59:59Z' } }).reason, 'invalid_comparison');
});

test('a provider cache straddling the hour cannot turn its forming bucket into a completed close',()=>{
 const ohlcvText=ohlcv([row(END_START,'110'),row(END_START-3600,'109'),row(BASE_START,'100'),row(BASE_START-3600,'99')]);
 const r=parse({ohlcvText,nowMs:Date.parse('2026-10-07T12:00:30Z')});
 assert.equal(r.status,'ready');assert.equal(r.endpointAt,'2026-10-07T11:00:00.000Z');assert.equal(r.currentPriceUsd,'109');
 assert.equal(parse({ohlcvText,nowMs:Date.parse('2026-10-07T12:01:30Z')}).endpointAt,'2026-10-07T12:00:00.000Z');
});
