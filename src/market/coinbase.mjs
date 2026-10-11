// Read-only Coinbase Exchange adapter. Importing this module performs no I/O.
const ORIGIN = 'https://api.exchange.coinbase.com';
const HOUR = 3_600_000;
const HISTORY_HOURS = 168;
export const SUPPORTED_PRODUCTS = Object.freeze(['BTC-USD', 'ETH-USD']);

export class MarketDataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MarketDataError';
    this.code = code;
  }
}

function requireValue(condition, message, code = 'INVALID_DATA') {
  if (!condition) throw new MarketDataError(code, message);
}

function decimal(value, label, zeroAllowed = false) {
  requireValue(typeof value === 'number' || (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)), `${label}: invalid decimal`);
  const result = Number(value);
  requireValue(Number.isFinite(result) && (zeroAllowed ? result >= 0 : result > 0), `${label}: invalid amount`);
  return result;
}

function integer(value, label) {
  requireValue(Number.isSafeInteger(value) && value >= 0, `${label}: invalid integer`);
  return value;
}

function timestamp(value, label) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value), `${label}: UTC timestamp required`);
  const result = Date.parse(value);
  requireValue(Number.isSafeInteger(result) && result > 0, `${label}: invalid timestamp`);
  requireValue(new Date(result).toISOString().slice(0, 19) === value.slice(0, 19), `${label}: invalid calendar date`);
  return result;
}

function object(value, label) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  return value;
}

function checkIdentity(value, productId) {
  if ('product_id' in value) requireValue(value.product_id === productId, 'Payload product identity mismatch');
  if ('quote_currency' in value) requireValue(value.quote_currency === 'USD', 'Payload quote currency mismatch');
  if ('base_currency' in value) requireValue(value.base_currency === productId.split('-')[0], 'Payload base currency mismatch');
}

function productDetails(payload, productId) {
  object(payload, 'product');
  checkIdentity(payload, productId);
  requireValue(payload.id === productId && payload.base_currency === productId.split('-')[0] && payload.quote_currency === 'USD', 'Product identity/currency mismatch');
  requireValue(payload.status === 'online', 'Product is not online', 'UNAVAILABLE_PRODUCT');
  for (const flag of ['post_only', 'limit_only', 'cancel_only', 'auction_mode']) {
    requireValue(payload[flag] === false, `Product ${flag} is restricted or unknown`, 'UNAVAILABLE_PRODUCT');
  }
  if ('trading_disabled' in payload) requireValue(payload.trading_disabled === false, 'Product trading is disabled or unknown', 'UNAVAILABLE_PRODUCT');
  return {
    id: productId, base: payload.base_currency, quote: payload.quote_currency, status: payload.status,
    baseIncrement: decimal(payload.base_increment, 'base_increment'),
    quoteIncrement: decimal(payload.quote_increment, 'quote_increment'),
    minMarketFunds: payload.min_market_funds === undefined ? null : decimal(payload.min_market_funds, 'min_market_funds'),
    tradingDisabled: payload.trading_disabled ?? null,
  };
}

function levels(payload, label, descending) {
  requireValue(Array.isArray(payload) && payload.length > 0 && payload.length <= 100_000, `${label}: nonempty bounded book required`);
  return payload.map((row, index) => {
    requireValue(Array.isArray(row) && row.length === 3, `${label}: expected price/size/order-count`);
    const price = decimal(row[0], `${label} price`);
    const quantity = decimal(row[1], `${label} quantity`);
    requireValue(Number.isFinite(price * quantity), `${label}: nonfinite notional`);
    requireValue(integer(row[2], `${label} order count`) > 0, `${label}: zero order count`);
    if (index > 0) {
      const previous = Number(payload[index - 1][0]);
      requireValue(descending ? previous > price : previous < price, `${label}: duplicate or unsorted prices`);
    }
    return [price, quantity];
  });
}

function historyDetails(payload, from, to) {
  requireValue(Array.isArray(payload) && payload.length <= 300, 'candles: bounded array required');
  const seen = new Set();
  const candles = [];
  for (const row of payload) {
    requireValue(Array.isArray(row) && row.length === 6, 'candles: expected six OHLCV fields');
    const start = integer(row[0], 'candle time') * 1000;
    requireValue(Number.isSafeInteger(start) && start % HOUR === 0, 'candle time: invalid hourly boundary');
    requireValue(start <= to, 'candles: future bucket');
    requireValue(!seen.has(start), 'candles: duplicate bucket');
    seen.add(start);
    const low = decimal(row[1], 'candle low');
    const high = decimal(row[2], 'candle high');
    const open = decimal(row[3], 'candle open');
    const close = decimal(row[4], 'candle close');
    decimal(row[5], 'candle volume', true);
    requireValue(low <= Math.min(open, close) && high >= Math.max(open, close) && low <= high, 'candles: inconsistent OHLC');
    // The venue may return buckets before start. Never expand claimed coverage.
    if (start >= from && start < to) candles.push({ start, low });
  }
  candles.sort((a, b) => a.start - b.start);
  return {
    low: candles.length ? Math.min(...candles.map(candle => candle.low)) : null,
    from: candles[0]?.start ?? null,
    to: candles.length ? candles.at(-1).start + HOUR : null,
    samples: candles.length,
    intervalMs: HOUR,
    requestedFrom: from,
    requestedTo: to,
    expectedSamples: HISTORY_HOURS,
    missingBuckets: HISTORY_HOURS - candles.length,
    excludedBuckets: payload.length - candles.length,
    complete: false,
    description: 'Observed lows in up to 168 closed hourly Coinbase Exchange candles. Missing buckets remain unknown; venue history may be incomplete. Not an all-time low.',
  };
}

/** One explicit observation; no polling, writes, credentials, or execution. */
export function createCoinbaseObserver({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000, maxSourceAgeMs = 30_000, maxFutureSkewMs = 1000 } = {}) {
  requireValue(typeof fetchImpl === 'function' && typeof now === 'function', 'fetchImpl and now must be functions', 'INVALID_CONFIG');
  for (const [label, value] of Object.entries({ timeoutMs, maxSourceAgeMs, maxFutureSkewMs })) {
    requireValue(Number.isSafeInteger(value) && value >= (label === 'maxFutureSkewMs' ? 0 : 1), `${label}: invalid configuration`, 'INVALID_CONFIG');
  }

  function clock() {
    const value = now();
    requireValue(Number.isSafeInteger(value) && value > HISTORY_HOURS * HOUR && value <= 8_640_000_000_000_000, 'Local clock is invalid', 'INVALID_CLOCK');
    return value;
  }

  async function get(path) {
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new MarketDataError('TIMEOUT', `Public request timed out: ${path.split('?')[0]}`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(`${ORIGIN}${path}`, {
          method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal,
        });
        requireValue(response?.ok === true, `Public request failed with HTTP ${response?.status ?? 'unknown'}: ${path.split('?')[0]}`, 'HTTP_ERROR');
        const payload = await response.json();
        return { payload, receivedAt: clock() };
      })()]);
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      throw new MarketDataError('REQUEST_FAILED', `Public request failed: ${path.split('?')[0]} (${error.message})`);
    } finally {
      clearTimeout(timeout);
    }
  }

  function checkSourceTime(sourceAt, observedAt, label) {
    requireValue(sourceAt <= observedAt + maxFutureSkewMs, `${label}: future source time`, 'FUTURE_DATA');
    requireValue(observedAt - sourceAt <= maxSourceAgeMs, `${label}: stale source time`, 'STALE_DATA');
  }

  return Object.freeze({
    async observe(productId) {
      requireValue(SUPPORTED_PRODUCTS.includes(productId), 'Only BTC-USD and ETH-USD are in this adapter', 'UNSUPPORTED_PRODUCT');
      const startedAt = clock();
      const root = `/products/${productId}`;
      const productResponse = await get(root);
      const product = productDetails(productResponse.payload, productId);
      const to = Math.floor(startedAt / HOUR) * HOUR;
      const from = to - HISTORY_HOURS * HOUR;
      const query = new URLSearchParams({ granularity: '3600', start: new Date(from).toISOString(), end: new Date(to).toISOString() });
      const results = await Promise.allSettled([get(`${root}/book?level=2`), get(`${root}/ticker`), get(`${root}/stats`), get(`${root}/candles?${query}`)]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      const [bookResponse, tickerResponse, statsResponse, candlesResponse] = results.map(result => result.value);
      const book = object(bookResponse.payload, 'book');
      const ticker = object(tickerResponse.payload, 'ticker');
      const stats = object(statsResponse.payload, 'stats');
      for (const payload of [book, ticker, stats]) checkIdentity(payload, productId);
      if ('auction_mode' in book) requireValue(book.auction_mode === false, 'Book is indicative auction data', 'UNAVAILABLE_PRODUCT');
      const sequence = integer(book.sequence, 'book sequence');
      const bids = levels(book.bids, 'bids', true);
      const asks = levels(book.asks, 'asks', false);
      requireValue(bids[0][0] < asks[0][0], 'Book is crossed or locked');
      const tradeId = integer(ticker.trade_id, 'ticker trade_id');
      const price = decimal(ticker.price, 'ticker price');
      const tickerBid = decimal(ticker.bid, 'ticker bid');
      const tickerAsk = decimal(ticker.ask, 'ticker ask');
      requireValue(tickerBid < tickerAsk, 'Ticker is crossed or locked');
      decimal(ticker.size, 'ticker size');
      const volume24hBase = decimal(ticker.volume, 'ticker volume', true);
      const sourceAt = timestamp(ticker.time, 'ticker time');
      const bookSourceAt = book.time === undefined ? null : timestamp(book.time, 'book time');
      const observedAt = clock();
      requireValue(observedAt >= startedAt && [productResponse, bookResponse, tickerResponse, statsResponse, candlesResponse].every(response => response.receivedAt >= startedAt && response.receivedAt <= observedAt), 'Local clock moved backwards', 'INVALID_CLOCK');
      checkSourceTime(sourceAt, observedAt, 'ticker');
      if (bookSourceAt !== null) checkSourceTime(bookSourceAt, observedAt, 'book');
      requireValue(observedAt - startedAt <= maxSourceAgeMs, 'Observation requests exceeded freshness window', 'STALE_DATA');
      const open24h = decimal(stats.open, 'stats open');
      const last24h = decimal(stats.last, 'stats last');
      const statsLow = decimal(stats.low, 'stats low');
      const statsHigh = decimal(stats.high, 'stats high');
      decimal(stats.volume, 'stats volume', true);
      requireValue(statsLow <= Math.min(open24h, last24h) && statsHigh >= Math.max(open24h, last24h), 'stats: inconsistent range');
      const change24hPct = (last24h / open24h - 1) * 100;
      requireValue(Number.isFinite(change24hPct), 'stats: nonfinite change');
      const history = historyDetails(candlesResponse.payload, from, to);
      return {
        schemaVersion: 1,
        eventId: `coinbase-exchange:${productId}:${sequence}:${tradeId}`,
        source: 'coinbase-exchange', provenance: 'public',
        productId, base: product.base, quote: product.quote,
        observedAt, sourceAt, bookSourceAt, bids, asks, price, change24hPct,
        tickerBid, tickerAsk, volume24hBase, history,
        product: { ...product, verifiedAt: productResponse.receivedAt },
        freshness: {
          tickerAgeMs: Math.max(0, observedAt - sourceAt),
          bookAgeMs: bookSourceAt === null ? null : Math.max(0, observedAt - bookSourceAt),
          bookTimeKnown: bookSourceAt !== null,
          maxSourceAgeMs,
        },
        evidence: {
          origin: ORIGIN, bookSequence: sequence, tradeId, bookLevel: 2, atomic: false,
          startedAt, bookReceivedAt: bookResponse.receivedAt, tickerReceivedAt: tickerResponse.receivedAt,
          statsReceivedAt: statsResponse.receivedAt, candlesReceivedAt: candlesResponse.receivedAt,
          statsSourceAt: null, changeMethod: '(stats.last / stats.open - 1) * 100',
          identityMethod: 'Verified product response and same-product HTTPS paths; book/ticker/stats do not require embedded product identifiers.',
          executable: false,
          limitation: 'Read-only observation. REST snapshots are non-atomic; receipt freshness is not proof of source freshness or executable fills. Public observations cannot enter this slice’s paper ledger.',
        },
      };
    },
  });
}

export async function fetchObservation({ productId, ...options }) {
  return createCoinbaseObserver(options).observe(productId);
}
