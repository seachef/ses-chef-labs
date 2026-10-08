import { decimal, decimalText, compare, percentageChange } from './exact-decimal.mjs';

const WEEK = 7 * 86400000;
export const CYCLE_START = Date.parse('2024-01-01T00:00:00Z');
export const CYCLE_QUOTE_AGE = 5 * 60000;
const BINANCE = 'https://data-api.binance.vision/api/v3/klines';
const KRAKEN = 'https://api.kraken.com/0/public/OHLC';
export const CYCLE_ASSETS = Object.freeze({
  RENDER: { venue: 'Binance', currency: 'USDT', pairs: ['RNDRUSDT', 'RENDERUSDT'], earliest: CYCLE_START, migration: 'https://www.binance.com/en/support/announcement/detail/7aa2bb48ab194bb9aebbc3f72b5819ed' },
  POL: { venue: 'Binance', currency: 'USDT', pairs: ['MATICUSDT', 'POLUSDT'], earliest: CYCLE_START, migration: 'https://www.binance.com/en/support/announcement/detail/619c4929fc3f4a0d9df7f9ae1d4519a5' },
  TAO: { venue: 'Binance', currency: 'USDT', pairs: ['TAOUSDT'], earliest: Date.parse('2024-04-08T00:00:00Z') },
  APT: { venue: 'Binance', currency: 'USDT', pairs: ['APTUSDT'], earliest: CYCLE_START },
  AKT: { venue: 'Kraken', currency: 'USD', pairs: ['AKTUSD'], earliest: CYCLE_START },
});

function positive(value) {
  if (typeof value !== 'string' || value.length > 96) throw Error('Invalid price');
  return decimalText(decimal(value, { positive: true }));
}
export function cycleSource(asset, pair) {
  const spec = CYCLE_ASSETS[asset];
  if (!spec || !spec.pairs.includes(pair)) throw Error('Unsupported watch coin');
  const url = new URL(spec.venue === 'Binance' ? BINANCE : KRAKEN);
  if (spec.venue === 'Binance') {
    for (const [key, value] of Object.entries({ symbol: pair, interval: '1w', startTime: CYCLE_START, limit: 1000 })) url.searchParams.set(key, value);
  } else {
    for (const [key, value] of Object.entries({ pair, interval: 10080, since: CYCLE_START / 1000 })) url.searchParams.set(key, value);
  }
  return url.href;
}

export function parseCycleCandles(payload, asset, pair, now) {
  const spec = CYCLE_ASSETS[asset];
  if (!spec || !spec.pairs.includes(pair)) throw Error('Unsupported watch coin');
  let rows = payload;
  if (spec.venue === 'Kraken') {
    if (!Array.isArray(payload?.error) || payload.error.length || !Array.isArray(payload.result?.[pair])) throw Error('Price history unavailable');
    rows = payload.result[pair];
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw Error('Price history unavailable');
  let previous = -Infinity;
  return rows.map(row => {
    if (!Array.isArray(row) || row.length < (spec.venue === 'Binance' ? 7 : 8)) throw Error('Invalid candle');
    const at = row[0] * (spec.venue === 'Kraken' ? 1000 : 1);
    if (!Number.isSafeInteger(at) || at < CYCLE_START || at > now || at <= previous) throw Error('Invalid candle time');
    previous = at;
    const open = positive(row[1]), high = positive(row[2]), low = positive(row[3]), close = positive(row[4]);
    if ([open, close, low].some(x => compare(decimal(x), decimal(high)) > 0) || [open, close].some(x => compare(decimal(x), decimal(low)) < 0)) throw Error('Invalid OHLC range');
    if (spec.venue === 'Binance' && (!Number.isSafeInteger(row[6]) || row[6] < at || row[6] >= at + WEEK)) throw Error('Invalid close time');
    return { at, end: at + WEEK, open, high, low, close, pair };
  });
}

/** Reproducible cycle reference, not a declaration that a market bottom is final.
 * Anchor: strongest completed weekly close in available history since Jan 2024.
 * Floor: lowest traded wick in the following weeks, including the current week.
 * Weekly closes avoid using Binance TAO's brief 2024 listing spike as the anchor.
 * 1:1 RNDR/RENDER and MATIC/POL histories are joined; venue migration gaps remain.
 */
export function deriveCycleReference(asset, segments, now = Date.now()) {
  const spec = CYCLE_ASSETS[asset];
  if (!spec || segments.length !== spec.pairs.length) throw Error('Incomplete cycle history');
  const combined = new Map();
  for (let i = 0; i < segments.length; i++) {
    const rows = parseCycleCandles(segments[i], asset, spec.pairs[i], now);
    for (const row of rows) {
      const earlier = combined.get(row.at);
      // A migration can split one week between the old and new ticker.
      combined.set(row.at, earlier ? { ...row, open: earlier.open,
        high: compare(decimal(row.high), decimal(earlier.high)) > 0 ? row.high : earlier.high,
        low: compare(decimal(row.low), decimal(earlier.low)) < 0 ? row.low : earlier.low } : row);
    }
  }
  const candles = [...combined.values()].sort((a, b) => a.at - b.at);
  if (candles.length < 52 || candles[0].at > spec.earliest + WEEK) throw Error('Cycle history too short');
  for (let i = 1; i < candles.length; i++) if (candles[i].at - candles[i - 1].at !== WEEK) throw Error('Cycle history has a gap');
  const live = candles.at(-1);
  if (live.at > now || live.end <= now || live.pair !== spec.pairs.at(-1)) throw Error('Current price unavailable');
  const completed = candles.filter(c => c.end <= now);
  const peak = completed.reduce((best, c) => compare(decimal(c.close), decimal(best.close)) > 0 ? c : best);
  const following = candles.filter(c => c.at > peak.at);
  if (following.length < 13) throw Error('Post-peak history too short');
  const low = following.reduce((best, c) => compare(decimal(c.low), decimal(best.low)) < 0 ? c : best);
  const comparison = percentageChange(decimal(live.close), decimal(low.low), 1);
  const above = compare(decimal(live.close), decimal(low.low));
  if (above < 0) throw Error('Current price below reported low');
  return { asset, current: live.close, low: low.low, percent: comparison.value,
    percentLabel: above === 0 ? 'At low' : comparison.value === '0' ? '+<0.1%' : comparison.value + '%',
    currency: spec.currency, venue: spec.venue, peakAt: peak.at, peakClose: peak.close,
    lowAt: low.at, lowEnd: low.end, retrievedAt: now, startsAt: candles[0].at,
    sources: spec.pairs.map(pair => cycleSource(asset, pair)), migration: spec.migration || null };
}

export async function readCycleReference(asset, { fetchImpl = globalThis.fetch, signal, now = Date.now } = {}) {
  const spec = CYCLE_ASSETS[asset];
  if (!spec) throw Error('Unsupported watch coin');
  const payloads = await Promise.all(spec.pairs.map(async pair => {
    const url = cycleSource(asset, pair);
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal });
    if (!response.ok || response.redirected || (response.url && response.url !== url) || Number(response.headers?.get('content-length') || 0) > 512000) throw Error('Price source unavailable');
    const text = await response.text();
    if (text.length > 512000) throw Error('Price response too large');
    return JSON.parse(text);
  }));
  if (signal?.aborted) throw Error('Price request cancelled');
  return deriveCycleReference(asset, payloads, now());
}
