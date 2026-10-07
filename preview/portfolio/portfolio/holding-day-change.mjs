/**
 * Public, read-only GeckoTerminal hourly USD comparisons and private local math.
 * Never pass a holding, wallet, balance, owner, account, quantity or saved FX to
 * the source. Only chainId, assetId and a public poolAddress are source inputs.
 * An hourly endpoint is a completed candle close, not a live executable price.
 */
import { decimal, decimalText, subtract, multiply, compare, percentageChange, parseLosslessJson } from './exact-decimal.mjs';

const ORIGIN = 'https://api.geckoterminal.com';
const PREFIX = `${ORIGIN}/api/v2/networks/eth/pools/`;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HOUR = 3600;
const DAY = 86400;
const MAX_BYTES = 512 * 1024;
export const COMPLETION_GRACE_MS = 90 * 1000;
export const MAX_ENDPOINT_AGE_MS = 90 * 60 * 1000;
export const WETH_CONTRACT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC_CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH_POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
const SHOGUN = '0xfd4cb1294df23920e683e046963117cae6c807d9';
const KNOWN_POOLS = Object.freeze({
  native: WETH_POOL,
  [WETH_CONTRACT]: WETH_POOL,
  '0x2b591e99afe9f32eaa6214f7b7629768c40eeb39': '0x55d5c232d921b9eaa6b37b5845e439acd04b4dba',
  '0x3819f64f282bf135d62168c1e513280daf905e06': '0x4a97b4da0d43e1d36952e239cfda8922e8643931',
  '0x96a5399d07896f757bd4c6ef56461f58db951862': '0x25215d9ba4403b3da77ce50606b54577a71b7895',
  '0xfc4913214444af5c715cc9f7b52655e788a569ed': '0x82de4db279ce9b7d8494af416671ea9b6134ad03',
});
class DayChangeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new DayChangeError(code); };
const address = value => typeof value === 'string' && ADDRESS.test(value.toLowerCase()) ? value.toLowerCase() : null;
const milliseconds = value => {
  if (!Number.isSafeInteger(value) || value <= 0) fail('invalid_clock');
  return value;
};
const iso = seconds => new Date(seconds * 1000).toISOString();
const reasonOf = error => error instanceof DayChangeError ? error.code : 'invalid_response';

/** Select exact Ethereum identity; native ETH always carries an explicit WETH proxy. */
export function holdingDayChangeTarget({ chainId, assetId, poolAddress } = {}) {
  if (chainId !== 1) fail('unsupported_network');
  const asset = assetId === 'native' ? 'native' : address(assetId);
  if (!asset) fail('invalid_asset');
  if (asset === SHOGUN) fail('unreliable_asset');
  const pool = poolAddress == null ? KNOWN_POOLS[asset] : address(poolAddress);
  if (!pool || (asset === 'native' && pool !== WETH_POOL)) fail('unverified_pool');
  return Object.freeze({
    chainId: 1, network: 'eth', assetId: asset, poolAddress: pool,
    tokenAddress: asset === 'native' ? WETH_CONTRACT : asset,
    proxy: asset === 'native',
    proxyNote: asset === 'native' ? 'Native ETH uses canonical WETH in the Ethereum WETH/USDC pool as a price proxy.' : null,
  });
}

export function holdingDayChangeUrls(input) {
  const target = holdingDayChangeTarget(input);
  return Object.freeze({
    metadata: `${PREFIX}multi/${target.poolAddress}`,
    ohlcv: `${PREFIX}${target.poolAddress}/ohlcv/hour?aggregate=1&limit=100&currency=usd&token=${target.tokenAddress}&include_empty_intervals=false`,
  });
}

function unavailable(reason, target = null) {
  return Object.freeze({ status: 'unavailable', reason, currentPriceUsd: null, baselinePriceUsd: null,
    endpointAt: null, baselineAt: null, spanSeconds: null, target,
    source: 'GeckoTerminal', sourceUrl: target ? holdingDayChangeUrls(target).ohlcv : null,
    proxyNote: target?.proxyNote || null });
}

function relationshipToken(value) {
  if (value?.type !== 'token' || typeof value.id !== 'string' || !value.id.startsWith('eth_')) fail('pool_identity_mismatch');
  const token = address(value.id.slice(4));
  if (!token) fail('pool_identity_mismatch');
  return token;
}

function verifyPool(metadata, target) {
  const pools = Array.isArray(metadata?.data) ? metadata.data : metadata?.data?.type === 'pool' ? [metadata.data] : null;
  if (!Array.isArray(pools) || pools.length !== 1) fail('pool_identity_mismatch');
  const pool = pools[0];
  if (pool?.type !== 'pool' || pool.id !== `eth_${target.poolAddress}` || address(pool.attributes?.address) !== target.poolAddress) fail('pool_identity_mismatch');
  if (pool.relationships?.network?.data && pool.relationships.network.data.id !== 'eth') fail('pool_identity_mismatch');
  const base = relationshipToken(pool.relationships?.base_token?.data);
  const quote = relationshipToken(pool.relationships?.quote_token?.data);
  if (base === quote || (target.tokenAddress !== base && target.tokenAddress !== quote)) fail('token_not_in_pool');
  if (target.proxy && (base !== WETH_CONTRACT || quote !== USDC_CONTRACT)) fail('proxy_identity_mismatch');
  return { base, quote, opposite: target.tokenAddress === base ? quote : base };
}

function candle(row, nowMs) {
  if (!Array.isArray(row) || row.length !== 6 || typeof row[0] !== 'string' || !/^[1-9]\d{0,11}$/.test(row[0])) fail('invalid_candle');
  const at = Number(row[0]); // Integral epoch seconds only; never a price or quantity.
  if (!Number.isSafeInteger(at) || at % HOUR !== 0 || at > Math.floor(nowMs / (HOUR * 1000)) * HOUR) fail('invalid_candle_time');
  let open, high, low, close;
  try {
    [open, high, low, close] = row.slice(1, 5).map(value => decimal(value, { positive: true, exponent: true }));
    decimal(row[5], { exponent: true });
  } catch { fail('invalid_candle_price'); }
  if (compare(low, high) > 0 || compare(high, open) < 0 || compare(high, close) < 0 || compare(low, open) > 0 || compare(low, close) > 0) fail('invalid_candle_range');
  return { at, close: decimalText(close) };
}

function withFreshness(comparison, nowMs) {
  if (comparison.status === 'unavailable') return comparison;
  const endpointAgeMs = nowMs - Date.parse(comparison.endpointAt);
  if (endpointAgeMs < 0 || nowMs < Date.parse(comparison.retrievedAt)) return unavailable('invalid_clock', comparison.target);
  const stale = endpointAgeMs > MAX_ENDPOINT_AGE_MS;
  return Object.freeze({ ...comparison, status: stale ? 'stale' : 'ready', reason: stale ? 'stale_endpoint' : null, endpointAgeMs });
}

/**
 * Parse raw provider texts losslessly. Candle timestamps are interval starts;
 * endpointAt/baselineAt expose interval END times. No missing hour is filled.
 * Conflicting selected closes fail; equal closes tolerate duplicate OHLC rows.
 */
export function parseHoldingDayChange({ metadataText, ohlcvText, target: input, nowMs = Date.now(), retrievedAt = null, metadataSourceUrl = null } = {}) {
  let target;
  try {
    milliseconds(nowMs);
    target = holdingDayChangeTarget(input);
    const metadataUrl = metadataSourceUrl || holdingDayChangeUrls(target).metadata;
    if (metadataUrl !== holdingDayChangeUrls(target).metadata && metadataUrl !== `${PREFIX}${target.poolAddress}?include=base_token,quote_token`) fail('invalid_metadata_source');
    const retrievedMs = retrievedAt == null ? nowMs : Date.parse(retrievedAt);
    if (!Number.isSafeInteger(retrievedMs) || retrievedMs > nowMs || retrievedMs <= 0) fail('invalid_retrieval_time');
    const pool = verifyPool(parseLosslessJson(metadataText), target);
    const payload = parseLosslessJson(ohlcvText);
    if (payload?.data?.type !== 'ohlcv_request_response' || address(payload.meta?.base?.address) !== target.tokenAddress || address(payload.meta?.quote?.address) !== pool.opposite) fail('ohlcv_identity_mismatch');
    const rows = payload.data.attributes?.ohlcv_list;
    if (!Array.isArray(rows) || rows.length > 200) fail('invalid_candles');
    const closes = new Map();
    let previousAt = Infinity;
    for (const row of rows) {
      const point = candle(row, nowMs);
      if (point.at > previousAt) fail('unordered_candles');
      previousAt = point.at;
      if ((point.at + HOUR) * 1000 > nowMs - COMPLETION_GRACE_MS) continue; // Also allow the public provider cache to cross the hour boundary.
      const values = closes.get(point.at) || new Set();
      values.add(point.close); closes.set(point.at, values);
    }
    if (!closes.size) fail('no_completed_candle');
    const endpointStart = Math.max(...closes.keys()), baselineStart = endpointStart - DAY;
    const endpoint = closes.get(endpointStart), baseline = closes.get(baselineStart);
    if (endpoint.size !== 1) fail('conflicting_endpoint');
    if (!baseline) fail('missing_24h_baseline');
    if (baseline.size !== 1) fail('conflicting_baseline');
    if ((endpointStart + HOUR) * 1000 > retrievedMs) fail('invalid_retrieval_time');
    const comparison = {
      status: 'ready', reason: null, currentPriceUsd: [...endpoint][0], baselinePriceUsd: [...baseline][0],
      endpointAt: iso(endpointStart + HOUR), baselineAt: iso(baselineStart + HOUR), spanSeconds: DAY,
      endpointCandleStartAt: iso(endpointStart), baselineCandleStartAt: iso(baselineStart),
      intervalSeconds: HOUR, quoteCurrency: 'USD', method: 'completed_hourly_close', identityVerified: true,
      retrievedAt: new Date(retrievedMs).toISOString(), target, source: 'GeckoTerminal',
      sourceUrl: holdingDayChangeUrls(target).ohlcv, metadataSourceUrl: metadataUrl,
      proxyNote: target.proxyNote,
      sourceNote: 'Indicative USD pool candle closes, exactly 24 hours apart. Last observed completed hourly candle after a 90-second cache grace; boundaries are not exact trade times.',
    };
    return withFreshness(comparison, nowMs);
  } catch (error) { return unavailable(reasonOf(error), target); }
}

async function readText(url, { fetchImpl, signal, timeoutMs }) {
  const controller = new AbortController();
  let timeout, abortListener;
  const work = async () => {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response || response.redirected || (response.url && response.url !== url)) fail('unexpected_response_url');
    if (!response.ok) fail(response.status === 429 ? 'rate_limited' : 'source_unavailable');
    const contentType = response.headers?.get?.('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json' && contentType !== 'application/vnd.api+json') fail('unexpected_content_type');
    const length = response.headers?.get?.('content-length');
    if (length && (!/^\d+$/.test(length) || BigInt(length) > BigInt(MAX_BYTES))) fail('response_too_large');
    if (!response.body?.getReader) fail('unreadable_response');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); fail('response_too_large'); }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally { reader.releaseLock(); }
  };
  try {
    if (signal?.aborted) fail('aborted');
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new DayChangeError('timeout')); }, timeoutMs);
        abortListener = () => { controller.abort(); reject(new DayChangeError('aborted')); };
        signal?.addEventListener('abort', abortListener, { once: true });
        if (signal?.aborted) abortListener();
      }),
    ]);
  } catch (error) {
    controller.abort();
    throw error instanceof DayChangeError ? error : new DayChangeError('request_failed');
  } finally {
    clearTimeout(timeout);
    if (abortListener) signal?.removeEventListener('abort', abortListener);
  }
}

/**
 * Each uncached get makes at most two public GETs, sequentially, with no retry.
 * Cache contains public inputs/results only and is limited by TTL and entry count.
 * Caller bounds concurrency and clears private UI/calculations on owner changes.
 */
export function createHoldingDayChangeSource({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000, cacheTtlMs = 60000, maxEntries = 32 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000 || !Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 300000 || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 128) throw new TypeError('Invalid public source configuration');
  const cache = new Map();
  const remember = (key, value, storedAt) => {
    cache.delete(key); cache.set(key, { value, storedAt });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return value;
  };
  return Object.freeze({
    clear() { cache.clear(); },
    async get(input, { signal } = {}) {
      let target, key, startedAt;
      try {
        target = holdingDayChangeTarget(input);
        if (signal?.aborted) fail('aborted');
        startedAt = milliseconds(now());
        key = `${target.chainId}:${target.assetId}:${target.poolAddress}`;
        const cached = cache.get(key);
        if (cached && startedAt >= cached.storedAt && startedAt - cached.storedAt < cacheTtlMs) return withFreshness(cached.value, startedAt);
        const urls = holdingDayChangeUrls(target);
        const context = { fetchImpl, signal, timeoutMs };
        const metadataText = await readText(urls.metadata, context);
        verifyPool(parseLosslessJson(metadataText), target); // Stop before history request on identity failure.
        const ohlcvText = await readText(urls.ohlcv, context);
        const retrievedAt = milliseconds(now());
        if (retrievedAt < startedAt) fail('invalid_clock');
        const result = parseHoldingDayChange({ metadataText, ohlcvText, target, nowMs: retrievedAt });
        return remember(key, result, retrievedAt);
      } catch (error) {
        // No raw errors, request headers, bodies or caller abort reasons escape.
        const result = unavailable(reasonOf(error), target);
        // A rerender must not turn HTTP 429 into an immediate automatic retry.
        if (key && Number.isSafeInteger(startedAt) && !['aborted', 'invalid_clock'].includes(result.reason)) return remember(key, result, startedAt);
        return result;
      }
    },
  });
}

function validFx(fx) {
  if (!fx || fx.verified !== true || typeof fx.source !== 'string' || !fx.source.trim() || typeof fx.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fx.date)) fail('fx_unavailable');
  if (!Number.isFinite(Date.parse(`${fx.date}T00:00:00Z`)) || new Date(`${fx.date}T00:00:00Z`).toISOString().slice(0, 10) !== fx.date) fail('fx_unavailable');
  try { return decimal(fx.rate, { positive: true }); } catch { fail('fx_unavailable'); }
}

/**
 * Local only: current quantity × (endpoint USD close − baseline USD close).
 * Quantity includes eligible locked principal ONCE, prepared by the caller.
 * This is market movement on current quantity, not actual portfolio P&L.
 */
export function calculateHoldingDayChange({ quantity, comparison, currency = 'USD', fx = null, nowMs = Date.now() } = {}) {
  const empty = reason => Object.freeze({ status: 'unavailable', reason, currency, usdChange: null, selectedCurrencyChange: null, percent: null });
  try {
    if (!['USD', 'AUD'].includes(currency)) return empty('unsupported_currency');
    if (!comparison || !['ready', 'stale'].includes(comparison.status)) return empty(comparison?.reason || 'comparison_unavailable');
    const target = holdingDayChangeTarget(comparison.target);
    if (comparison.identityVerified !== true || comparison.source !== 'GeckoTerminal' || comparison.sourceUrl !== holdingDayChangeUrls(target).ohlcv || comparison.method !== 'completed_hourly_close' || comparison.intervalSeconds !== HOUR || comparison.quoteCurrency !== 'USD' || comparison.spanSeconds !== DAY) return empty('invalid_comparison');
    const endpointMs = Date.parse(comparison.endpointAt), baselineMs = Date.parse(comparison.baselineAt), retrievedMs = Date.parse(comparison.retrievedAt);
    if (!Number.isSafeInteger(endpointMs) || endpointMs % (HOUR * 1000) !== 0 || !Number.isSafeInteger(baselineMs) || baselineMs <= 0 || endpointMs - baselineMs !== DAY * 1000 || !Number.isSafeInteger(retrievedMs) || endpointMs > retrievedMs) return empty('invalid_comparison');
    const assessed = withFreshness(comparison, milliseconds(nowMs));
    if (assessed.status === 'unavailable') return empty(assessed.reason);
    let amount;
    try { amount = decimal(quantity); } catch { return empty('invalid_quantity'); }
    const endpoint = decimal(comparison.currentPriceUsd, { positive: true }), baseline = decimal(comparison.baselinePriceUsd, { positive: true });
    const usd = multiply(amount, subtract(endpoint, baseline));
    const percentage = percentageChange(endpoint, baseline);
    const usdChange = decimalText(usd, { sign: true });
    let selected = usd, fxApplied = null;
    if (currency === 'AUD') {
      const rate = validFx(fx);
      if (fx.date > comparison.retrievedAt.slice(0, 10)) fail('fx_unavailable');
      selected = multiply(usd, rate);
      fxApplied = Object.freeze({ rate: decimalText(rate), date: fx.date, source: fx.source,
        note: 'The same saved USD/AUD rate is used at both endpoints, so FX movement is excluded.' });
    }
    return Object.freeze({
      status: assessed.status, reason: assessed.reason, currency, usdChange,
      selectedCurrencyChange: decimalText(selected, { sign: true }), percent: percentage.value,
      percentExact: Object.freeze(percentage), direction: usd.integer > 0n ? 'up' : usd.integer < 0n ? 'down' : 'flat',
      endpointAt: comparison.endpointAt, baselineAt: comparison.baselineAt, spanSeconds: DAY,
      endpointAgeMs: assessed.endpointAgeMs, retrievedAt: comparison.retrievedAt,
      currentPriceUsd: comparison.currentPriceUsd, baselinePriceUsd: comparison.baselinePriceUsd,
      source: comparison.source, sourceUrl: comparison.sourceUrl, proxyNote: comparison.proxyNote,
      sourceNote: comparison.sourceNote, fx: fxApplied,
      calculationNote: '24h market movement on current quantity. Not actual portfolio P&L; flows, rewards, fees, tax, gas and slippage are excluded.',
    });
  } catch (error) { return empty(error instanceof DayChangeError ? error.code : 'invalid_comparison'); }
}
