/** Pure, read-only adapter. No network, storage, accounts, orders or entry-qualification effects. */
export const METHOD = 'btc-50-200-breadth-40-60-v1';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const SCALE = 100_000_000n;
const fail = (reason) => ({ schemaVersion: 'market-condition-v1', methodologyVersion: METHOD, condition: 'unknown', conditionLabel: 'Unknown', score: null, reason });
const validMs = (x) => Number.isSafeInteger(x) && x > 0;
const decimal = (x) => typeof x === 'string' && /^-?\d+(?:\.\d+)?$/.test(x) && Number.isFinite(Number(x));
function units8(x) {
  if (typeof x !== 'string' || !/^\d+(?:\.\d{1,8})?$/.test(x)) throw new Error('Invalid BTC close');
  const [whole, fractional = ''] = x.split('.');
  const value = BigInt(whole) * SCALE + BigInt(fractional.padEnd(8, '0'));
  if (value <= 0n) throw new Error('Nonpositive BTC close');
  return value;
}
const sign = (value) => value > 0n ? 1 : value < 0n ? -1 : 0;

/** Equality is neutral. All three inputs are required. Thresholds are design choices, not a backtest. */
export function classifySignals(sma50Signal, sma200Signal, advancing, total) {
  if (![sma50Signal, sma200Signal].every((x) => [-1, 0, 1].includes(x)) ||
      !Number.isSafeInteger(advancing) || !Number.isSafeInteger(total) || total <= 0 || advancing < 0 || advancing > total) return fail('Invalid component');
  const breadthSignal = 5 * advancing >= 3 * total ? 1 : 5 * advancing <= 2 * total ? -1 : 0;
  const score = sma50Signal + sma200Signal + breadthSignal;
  return { condition: score >= 2 ? 'bull' : score <= -2 ? 'bear' : 'neutral', score, sma50Signal, sma200Signal, breadthSignal };
}

/**
 * Input source data: Binance UTC 1d klines; FULL 24h tickers; a frozen, reviewed symbol whitelist.
 * The timestamp injected by the caller must be trusted current UTC, not the bundled snapshot time.
 * The function returns Unknown for invalid/missing/stale data, without substituting Neutral.
 */
export function computeMarketCondition({ btcDailyBars, breadthTickers, universe, nowMs = Date.now() } = {}) {
  if (!validMs(nowMs)) return fail('Invalid current time');
  if (!universe || typeof universe.id !== 'string' || !universe.id.trim() ||
      typeof universe.selectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(universe.selectedAt) ||
      !Array.isArray(universe.symbols) || universe.symbols.length === 0 ||
      universe.symbols.some((s) => typeof s !== 'string' || !s.endsWith('USDT')) ||
      new Set(universe.symbols).size !== universe.symbols.length) return fail('Invalid universe');
  const selectedAt = Date.parse(universe.selectedAt);
  const universeMode = universe.mode ?? 'dated_screen';
  if (!['fixed_basket', 'dated_screen'].includes(universeMode)) return fail('Invalid universe mode');
  if (!validMs(selectedAt) || selectedAt > nowMs + 60_000) return fail('Invalid universe selection time');
  // A fixed reviewed basket keeps its original selection date as provenance. Fresh prices
  // describe that basket today; they do not assert today's liquidity eligibility.
  if (universeMode === 'dated_screen' && nowMs - selectedAt > DAY) return fail('Universe missing or older than 24 hours');
  if (!Array.isArray(btcDailyBars) || !Array.isArray(breadthTickers)) return fail('Missing source series');
  const expectedClose = Math.floor(nowMs / DAY) * DAY - 1;
  const eligible = btcDailyBars.filter((r) => Array.isArray(r) && validMs(r[6]) && r[6] <= expectedClose).sort((a,b) => a[0] - b[0]);
  if (new Set(eligible.map((r) => r[0])).size !== eligible.length) return fail('Duplicate BTC candle');
  const bars = eligible.slice(-200);
  if (bars.length !== 200 || bars.at(-1)[6] !== expectedClose) return fail('Need 200 completed BTC daily bars through yesterday UTC');
  let closes;
  try {
    if (bars.some((r, i) => !validMs(r[0]) || r[0] % DAY !== 0 || r[6] !== r[0] + DAY - 1 || (i > 0 && r[0] !== bars[i-1][0] + DAY))) return fail('Non-contiguous BTC daily series');
    closes = bars.map((r) => units8(r[4]));
  } catch { return fail('Invalid BTC close'); }
  const sum = (xs) => xs.reduce((a,b) => a+b, 0n);
  const close = closes.at(-1), sum50 = sum(closes.slice(-50)), sum200 = sum(closes);
  const expected = new Set(universe.symbols);
  const tickers = breadthTickers.filter((r) => r && expected.has(r.symbol));
  if (tickers.length !== expected.size || new Set(tickers.map((r) => r.symbol)).size !== expected.size) return fail('Incomplete or duplicate breadth coverage');
  if (tickers.some((r) => !decimal(r.priceChange) || !decimal(r.lastPrice) || Number(r.lastPrice) <= 0 || !validMs(r.openTime) || !validMs(r.closeTime) || Math.abs((r.closeTime-r.openTime)-DAY) > 60_000)) return fail('Invalid breadth ticker');
  const minClose = Math.min(...tickers.map((r) => r.closeTime)), maxClose = Math.max(...tickers.map((r) => r.closeTime));
  if (maxClose > nowMs + 60_000 || nowMs - minClose > HOUR) return fail('Breadth missing or older than 60 minutes');
  if (maxClose - minClose > 5 * 60_000) return fail('Breadth timestamps are not a coherent snapshot');
  const advancing = tickers.filter((r) => Number(r.priceChange) > 0).length;
  const declining = tickers.filter((r) => Number(r.priceChange) < 0).length;
  const result = classifySignals(sign(close * 50n - sum50), sign(close * 200n - sum200), advancing, tickers.length);
  return {
    schemaVersion: 'market-condition-v1', methodologyVersion: METHOD, dataStatus: 'snapshot', ...result,
    conditionLabel: { bull: 'Bull', neutral: 'Neutral', bear: 'Bear' }[result.condition],
    asOf: new Date(maxClose).toISOString(), oldestInputAsOf: new Date(minClose).toISOString(),
    expiresAt: new Date(Math.min(minClose + HOUR, universeMode === 'dated_screen' ? selectedAt + DAY : Infinity, expectedClose + 1 + DAY)).toISOString(),
    btc: { symbol: 'BTCUSDT', quoteUnit: 'USDT', closedCandleDate: new Date(bars.at(-1)[0]).toISOString().slice(0,10), closedAt: new Date(expectedClose).toISOString(), close: Number(close)/Number(SCALE), sma50: Number(sum50)/Number(SCALE)/50, sma200: Number(sum200)/Number(SCALE)/200, closedBars: 200 },
    breadth: { universeId: universe.id, universeMode, universeSelectedAt: universe.selectedAt, expected: expected.size, observed: tickers.length, advancing, declining, unchanged: tickers.length-advancing-declining, advancingRatio: advancing/tickers.length, window: 'rolling_24h', windowCloseMin: new Date(minClose).toISOString(), windowCloseMax: new Date(maxClose).toISOString() }
  };
}
