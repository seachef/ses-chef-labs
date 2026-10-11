// Public read-only observations. No network side effects, orders, signals, or core imports.
// An observation is deliberately NOT a synthetic PaperEngine market/FX event.
export const FEED_ENDPOINTS = Object.freeze({
  pairs: 'https://api.kraken.com/0/public/AssetPairs?pair=ETHUSD&execution_venue=international',
  ticker: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD',
  trades: 'https://api.kraken.com/0/public/Trades?pair=ETHUSD&count=5',
  depth: 'https://api.kraken.com/0/public/Depth?pair=ETHUSD&count=10',
  fx: 'https://api.frankfurter.dev/v2/providers/ecb/rate/usd/aud',
});
export const KRAKEN_ETH_USD = Object.freeze({ venue: 'KRAKEN_SPOT_INTERNATIONAL',
  asset: 'ETH', quote: 'USD', restPair: 'XETHZUSD', altname: 'ETHUSD',
  wsname: 'ETH/USD', baseCode: 'XETH', quoteCode: 'ZUSD' });
export const FEED_LIMITS = Object.freeze({ transportMs: 10_000, receiptAgeMs: 5_000,
  clockSkewMs: 10_000, registryAgeMs: 86_400_000, tradeAgeMs: 30_000,
  topLevelAgeMs: 30_000, maximumLevels: 10, maximumTrades: 5 });
const DAY = 86_400_000;
const check = (condition, code) => { if (!condition) throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = n => Number.isSafeInteger(n) && n > 0 && n <= 8_000_000_000_000;
const canonical = value => object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : Array.isArray(value) ? value.map(canonical) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const frozen = value => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
function decimal(value) {
  check(typeof value === 'string' && /^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(value), 'MALFORMED_DECIMAL');
  check(Number.isFinite(Number(value)) && Number(value) > 0, 'NON_POSITIVE_VALUE');
  return value; // Preserve decimal precision; never silently round into core micro-units.
}
function compareDecimal(a, b) {
  const parts = x => { const [whole, fraction = ''] = x.split('.'); return BigInt(whole + fraction.padEnd(18, '0')); };
  const x = parts(a), y = parts(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
function krakenResult(payload, extra = []) {
  check(object(payload) && Array.isArray(payload.error) && payload.error.length === 0 && object(payload.result), 'KRAKEN_ERROR_OR_MALFORMED');
  check(Object.keys(payload.result).sort().join() === ['XETHZUSD', ...extra].sort().join(), 'PAIR_IDENTITY_MISMATCH');
  return payload.result;
}
function context(kind, c) {
  check(object(c), 'MISSING_CONTEXT');
  check(c.url === FEED_ENDPOINTS[kind] && c.method === 'GET', 'ENDPOINT_IDENTITY_MISMATCH');
  check(c.httpStatus === 200, 'HTTP_STATUS_NOT_OK');
  check(c.transport === 'rest' && c.continuityIntent === 'independent_snapshot', 'CONTINUITY_NOT_SUPPORTED');
  check(!c.executionIntent && !c.reconnect && !c.gapDetected, 'GAP_RECONNECT_OR_EXECUTION_FORBIDDEN');
  check([c.requestStartedAtMs, c.receivedAtMs, c.nowMs].every(time), 'INVALID_CLOCK');
  check(c.requestStartedAtMs <= c.receivedAtMs && c.receivedAtMs <= c.nowMs, 'FUTURE_OR_REVERSED_CLOCK');
  check(c.receivedAtMs - c.requestStartedAtMs <= FEED_LIMITS.transportMs && c.nowMs - c.receivedAtMs <= FEED_LIMITS.receiptAgeMs, 'STALE_TRANSPORT');
  if (c.httpDate !== undefined) {
    const serverMs = typeof c.httpDate === 'string' ? Date.parse(c.httpDate) : NaN;
    check(time(serverMs) && Math.abs(serverMs - c.receivedAtMs) <= FEED_LIMITS.clockSkewMs, 'HTTP_CLOCK_SKEW');
  }
  check(typeof c.sessionId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(c.sessionId), 'INVALID_SESSION');
  check(Number.isSafeInteger(c.localObservationCounter) && c.localObservationCounter > 0, 'INVALID_LOCAL_COUNTER');
  const previous = c.previous;
  if (previous !== null && previous !== undefined) {
    check(object(previous) && previous.schema === 'public-observation-v1' && previous.kind === kind && previous.sourceUrl === c.url && previous.readOnly === true, 'PREVIOUS_OBSERVATION_MISMATCH');
    check(kind === 'fx' ? previous.provider === 'ECB' && previous.base === 'USD' && previous.quote === 'AUD' : equal(previous.instrument, KRAKEN_ETH_USD), 'PREVIOUS_IDENTITY_MISMATCH');
    check(previous.observation?.sessionId === c.sessionId, 'RECONNECT_REQUIRES_NEW_READ_ONLY_SESSION');
    check(c.localObservationCounter === previous.observation.localCounter + 1, 'LOCAL_OBSERVATION_REPLAY_OR_GAP');
    check(c.requestStartedAtMs > previous.observation.requestStartedAtMs && c.receivedAtMs > previous.observation.receivedAtMs && c.nowMs >= previous.observation.validatedAtMs, 'OUT_OF_ORDER_OBSERVATION');
  } else check(c.localObservationCounter === 1, 'MISSING_LOCAL_OBSERVATION_HISTORY');
  return { schema: 'public-observation-v1', kind, readOnly: true, executable: false,
    strategySignal: null, sourceUrl: c.url, transport: 'REST',
    observation: { sessionId: c.sessionId, localCounter: c.localObservationCounter,
      counterMeaning: 'local-observation-only-NOT-exchange-sequence',
      requestStartedAtMs: c.requestStartedAtMs, receivedAtMs: c.receivedAtMs,
      validatedAtMs: c.nowMs, httpDate: c.httpDate ?? null },
    continuity: { exchangeSequence: null, marketContinuityProven: false,
      snapshotOnly: true, reconnectCarriesIntents: false },
  };
}
function pairIdentity(pair, c) {
  check(object(pair) && pair.kind === 'pairs' && pair.schema === 'public-observation-v1' &&
    pair.sourceUrl === FEED_ENDPOINTS.pairs && equal(pair.instrument, KRAKEN_ETH_USD) &&
    pair.executionVenue === 'international' && pair.status === 'online', 'UNVERIFIED_PAIR_IDENTITY');
  const discovered = pair.observation?.receivedAtMs;
  check(time(discovered) && discovered <= c.requestStartedAtMs && c.nowMs - discovered <= FEED_LIMITS.registryAgeMs, 'STALE_OR_FUTURE_PAIR_REGISTRY');
  return { ...KRAKEN_ETH_USD };
}
export function normalizeKrakenAssetPairs(payload, c) {
  const out = context('pairs', c), p = krakenResult(payload).XETHZUSD;
  check(object(p) && p.altname === 'ETHUSD' && p.wsname === 'ETH/USD' && p.base === 'XETH' && p.quote === 'ZUSD' &&
    p.aclass_base === 'currency' && p.aclass_quote === 'currency' && p.execution_venue === 'international', 'PAIR_IDENTITY_MISMATCH');
  check(p.status === 'online', 'PAIR_NOT_ONLINE');
  return frozen({ ...out, instrument: { ...KRAKEN_ETH_USD }, status: p.status,
    executionVenue: p.execution_venue, verifiedBy: 'AssetPairs exact response fields' });
}
export function normalizeKrakenTicker(payload, pair, c) {
  const out = context('ticker', c), instrument = pairIdentity(pair, c), p = krakenResult(payload).XETHZUSD;
  check(object(p) && Array.isArray(p.a) && p.a.length === 3 && Array.isArray(p.b) && p.b.length === 3 && Array.isArray(p.c) && p.c.length === 2, 'MALFORMED_TICKER');
  const ask = decimal(p.a[0]), bid = decimal(p.b[0]);
  check(compareDecimal(bid, ask) < 0, 'CROSSED_OR_LOCKED_QUOTE');
  check(/^\d+$/.test(p.a[1]) && /^\d+$/.test(p.b[1]), 'MALFORMED_TICKER_LOTS');
  return frozen({ ...out, instrument, quote: { bidUsd: bid, askUsd: ask,
    bidLotVolume: decimal(p.b[2]), askLotVolume: decimal(p.a[2]),
    lastTradePriceUsd: decimal(p.c[0]), lastTradeVolumeEth: decimal(p.c[1]) },
    sourceTimestamp: null, freshness: { transport: 'recent', market: 'unknown-no-source-timestamp' },
    limitation: 'Ticker has no exchange event timestamp or sequence; transport freshness is not market freshness.' });
}
function sourceSeconds(value, c) {
  check(typeof value === 'number' && Number.isFinite(value) && value > 0, 'INVALID_SOURCE_TIME');
  const ms = Math.floor(value * 1000);
  check(time(ms) && value * 1000 <= c.receivedAtMs && value * 1000 <= c.nowMs, 'FUTURE_SOURCE_TIME');
  return ms;
}
export function normalizeKrakenDepth(payload, pair, c) {
  const out = context('depth', c), instrument = pairIdentity(pair, c), p = krakenResult(payload).XETHZUSD;
  check(object(p) && Object.keys(p).sort().join() === 'asks,bids', 'MALFORMED_DEPTH');
  const side = (rows, direction) => {
    check(Array.isArray(rows) && rows.length > 0 && rows.length <= FEED_LIMITS.maximumLevels, 'MALFORMED_DEPTH_LENGTH');
    return rows.map((r, index) => {
      check(Array.isArray(r) && r.length === 3, 'MALFORMED_DEPTH_ROW');
      const priceUsd = decimal(r[0]), quantityEth = decimal(r[1]);
      const levelUpdatedAtMs = sourceSeconds(r[2], c);
      if (index > 0) check(compareDecimal(rows[index - 1][0], priceUsd) === direction, 'UNSORTED_OR_DUPLICATE_DEPTH');
      return { priceUsd, quantityEth, sourceTimestampSeconds: r[2], levelUpdatedAtMs };
    });
  };
  const asks = side(p.asks, -1), bids = side(p.bids, 1);
  check(compareDecimal(bids[0].priceUsd, asks[0].priceUsd) < 0, 'CROSSED_OR_LOCKED_QUOTE');
  check([asks[0], bids[0]].every(r => c.nowMs - r.levelUpdatedAtMs <= FEED_LIMITS.topLevelAgeMs), 'STALE_TOP_LEVEL');
  if (c.previous) {
    for (const [name, levels] of [['asks', asks], ['bids', bids]]) {
      check(Array.isArray(c.previous[name]), 'INVALID_PREVIOUS_DEPTH');
      for (const level of levels) {
        const prior = c.previous[name].find(row => compareDecimal(row.priceUsd, level.priceUsd) === 0);
        check(!prior || level.sourceTimestampSeconds >= prior.sourceTimestampSeconds, 'DEPTH_LEVEL_TIME_REGRESSION');
      }
    }
  }
  // Per-level update times can be old deeper in a valid snapshot; they are NOT snapshot time.
  return frozen({ ...out, instrument, asks, bids, snapshotTimestamp: null,
    freshness: { transport: 'recent', topLevels: 'recent-updates-only', snapshot: 'unknown-no-snapshot-timestamp' },
    limitation: 'Independent REST L2 observation; row times are level times, not an atomic cross-feed timestamp.' });
}
export function normalizeKrakenTrades(payload, pair, c) {
  const out = context('trades', c), instrument = pairIdentity(pair, c), result = krakenResult(payload, ['last']);
  check(typeof result.last === 'string' && /^\d{1,30}$/.test(result.last), 'INVALID_TRADE_CURSOR');
  const rows = result.XETHZUSD;
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= FEED_LIMITS.maximumTrades, 'MALFORMED_TRADE_LENGTH');
  const trades = rows.map((r, index) => {
    check(Array.isArray(r) && r.length === 7, 'MALFORMED_TRADE');
    const priceUsd = decimal(r[0]), quantityEth = decimal(r[1]), tradedAtMs = sourceSeconds(r[2], c);
    check(c.nowMs - tradedAtMs <= FEED_LIMITS.tradeAgeMs, 'STALE_TRADE');
    check(['b', 's'].includes(r[3]) && ['m', 'l'].includes(r[4]) && typeof r[5] === 'string' && r[5].length <= 32 && Number.isSafeInteger(r[6]) && r[6] > 0, 'MALFORMED_TRADE_FIELDS');
    if (index > 0) check(r[2] >= rows[index - 1][2] && r[6] > rows[index - 1][6], 'OUT_OF_ORDER_OR_DUPLICATE_TRADE');
    return { tradeId: String(r[6]), priceUsd, quantityEth, side: r[3] === 'b' ? 'buy' : 'sell',
      orderType: r[4] === 'm' ? 'market' : 'limit', misc: r[5], sourceTimestampSeconds: r[2], tradedAtMs };
  });
  if (c.previous) {
    check(BigInt(result.last) >= BigInt(c.previous.paginationCursor), 'TRADE_CURSOR_REGRESSION');
    const old = c.previous.trades;
    check(Array.isArray(old) && old.length > 0, 'INVALID_PREVIOUS_TRADES');
    check(BigInt(trades.at(-1).tradeId) >= BigInt(old.at(-1).tradeId) && trades.at(-1).sourceTimestampSeconds >= old.at(-1).sourceTimestampSeconds, 'TRADE_WINDOW_REGRESSION');
    for (const t of trades) {
      const match = old.find(x => x.tradeId === t.tradeId);
      check(!match || equal(match, t), 'CONFLICTING_TRADE_ID');
    }
  }
  return frozen({ ...out, instrument, trades, paginationCursor: result.last,
    freshness: { transport: 'recent', tradeEvents: 'recent' },
    limitation: 'Recent trade window may overlap or omit trades between polls; trade IDs/cursor are not a complete book sequence.' });
}
// Explicitly bounded, reviewed TARGET calendars. Unknown years fail closed.
const TARGET_CLOSED = Object.freeze({
  2026: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-25', '2026-12-26'],
  2027: ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-12-25', '2027-12-26'],
});
const dateOnly = value => {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_RATE_DATE');
  const ms = Date.parse(`${value}T00:00:00Z`);
  check(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value, 'INVALID_RATE_DATE');
  return ms;
};
const shiftDate = (day, by) => new Date(dateOnly(day) + by * DAY).toISOString().slice(0, 10);
function businessDay(day) {
  const year = day.slice(0, 4);
  check(Object.hasOwn(TARGET_CLOSED, year), 'UNVERIFIED_TARGET_CALENDAR_YEAR');
  const weekDay = new Date(dateOnly(day)).getUTCDay();
  return weekDay !== 0 && weekDay !== 6 && !TARGET_CLOSED[year].includes(day);
}
function frankfurtClock(nowMs) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(formatter.formatToParts(nowMs).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function expectedEcbRateDate(nowMs) {
  check(time(nowMs), 'INVALID_CLOCK');
  const local = frankfurtClock(nowMs);
  let day = local.date;
  // 16:00 Frankfurt local nominal release; a conservative 1h provider-ingestion grace.
  // Grace is adapter policy, not a provider SLA or an invented rate timestamp.
  if (local.minutes < 17 * 60) day = shiftDate(day, -1);
  for (let n = 0; n < 8; n++, day = shiftDate(day, -1)) if (businessDay(day)) return day;
  throw new Error('NO_VERIFIED_RATE_DATE');
}
export function normalizeEcbUsdAud(payload, c) {
  const out = context('fx', c);
  check(object(payload) && Object.keys(payload).sort().join() === 'base,date,quote,rate' && payload.base === 'USD' && payload.quote === 'AUD', 'FX_IDENTITY_MISMATCH');
  check(typeof payload.rate === 'number' && Number.isFinite(payload.rate) && payload.rate > 0 && payload.rate < 100, 'INVALID_FX_RATE');
  dateOnly(payload.date);
  const local = frankfurtClock(c.nowMs), expectedRateDate = expectedEcbRateDate(c.nowMs);
  check(payload.date <= local.date, 'FUTURE_RATE_DATE');
  check(businessDay(payload.date), 'NON_PUBLICATION_RATE_DATE');
  check(payload.date !== local.date || local.minutes >= 16 * 60, 'RATE_PRECEDES_NOMINAL_PUBLICATION');
  check(payload.date >= expectedRateDate, 'STALE_DAILY_FX');
  if (c.previous) {
    check(payload.date >= c.previous.rateDate, 'FX_DATE_REGRESSION');
    check(payload.date !== c.previous.rateDate || payload.rate === c.previous.audPerUsd, 'CONFLICTING_RATE_SAME_DATE');
  }
  return frozen({ ...out, provider: 'ECB', distributor: 'Frankfurter', base: 'USD', quote: 'AUD',
    audPerUsd: payload.rate, rateDate: payload.date, rateDatePrecision: 'calendar-day',
    rateTimestamp: null, fetchedAtMs: c.receivedAtMs,
    freshness: { dailyReference: 'current-for-publication-schedule', expectedRateDate,
      nominalPublicationZone: 'Europe/Berlin', nominalPublicationTime: '16:00',
      staleAfterLocalTime: '17:00', policyGraceMinutes: 60, intraday: false },
    limitation: 'Daily reference cross-rate only, not an executable quote or sub-minute FX observation.' });
}
export function requireReviewedExecutionBridge() {
  throw new Error('PUBLIC_FEED_BRIDGE_NOT_REVIEWED');
}
