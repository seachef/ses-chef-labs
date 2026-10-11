import { DEFAULT_CONFIG, SUPPORTED_PRODUCTS } from './config.mjs';

export function validateSnapshot(snapshot, { now, config = DEFAULT_CONFIG } = {}) {
  const errors = [];
  if (!Number.isFinite(now)) errors.push('An explicit finite clock is required');
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { ok: false, errors: ['Snapshot must be an object'] };
  if (snapshot.schemaVersion !== 1) errors.push('Unsupported snapshot schema');
  if (typeof snapshot.eventId !== 'string' || !snapshot.eventId.trim() || snapshot.eventId.length > 200) errors.push('Missing or invalid event identity');
  if (typeof snapshot.productId !== 'string' || !Object.hasOwn(SUPPORTED_PRODUCTS, snapshot.productId) || SUPPORTED_PRODUCTS[snapshot.productId] !== snapshot.base || snapshot.quote !== 'USD') errors.push('Unverified product identity or currency');
  if (!((snapshot.source === 'synthetic-fixture' && snapshot.provenance === 'synthetic') ||
    (snapshot.source === 'coinbase-exchange' && snapshot.provenance === 'public'))) errors.push('Unsupported source/provenance pair');
  for (const key of ['observedAt', 'sourceAt']) {
    if (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0) errors.push(`Invalid ${key}`);
    else if (snapshot[key] > now) errors.push(`${key} is in the future`);
    else if (now - snapshot[key] > config.maxSnapshotAgeMs) errors.push(`Stale ${key}`);
  }
  if (snapshot.sourceAt > snapshot.observedAt) errors.push('Source time is later than receipt');
  for (const side of ['bids', 'asks']) {
    const levels = snapshot[side];
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > 1000) { errors.push(`Missing or excessive ${side} depth`); continue; }
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (!Array.isArray(level) || level.length !== 2 || !level.every(n => Number.isFinite(n) && n > 0)) { errors.push(`Invalid ${side} level`); continue; }
      if (!Number.isFinite(level[0] * level[1])) errors.push(`Overflowing ${side} notional`);
      if (i > 0 && Array.isArray(levels[i - 1]) && (side === 'bids' ? levels[i - 1][0] <= level[0] : levels[i - 1][0] >= level[0])) errors.push(`Unsorted or duplicate ${side} levels`);
    }
  }
  if (snapshot.bids?.[0]?.[0] >= snapshot.asks?.[0]?.[0]) errors.push('Crossed or locked book');
  if (snapshot.change24hPct !== null && !Number.isFinite(snapshot.change24hPct)) errors.push('24h change must be finite or explicitly unknown');
  const h = snapshot.history;
  if (h !== null && h !== undefined) {
    if (!Number.isFinite(h.low) || h.low <= 0 || !Number.isSafeInteger(h.from) || !Number.isSafeInteger(h.to) ||
      h.from < 0 || h.to < h.from || h.to > snapshot.sourceAt || !Number.isSafeInteger(h.samples) || h.samples < 1 ||
      !Number.isFinite(h.intervalMs) || h.intervalMs <= 0 || typeof h.complete !== 'boolean' || typeof h.description !== 'string' || !h.description.trim() || h.description.length > 1024) errors.push('Invalid history coverage');
  }
  return { ok: errors.length === 0, errors };
}

// Retain only validated fields. The caller's durable command journal retains
// the original input, including metadata that is not part of this contract.
export function retainSnapshot(snapshot) {
  const h = snapshot.history;
  return {
    schemaVersion: snapshot.schemaVersion, eventId: snapshot.eventId,
    source: snapshot.source, provenance: snapshot.provenance,
    productId: snapshot.productId, base: snapshot.base, quote: snapshot.quote,
    observedAt: snapshot.observedAt, sourceAt: snapshot.sourceAt,
    bids: snapshot.bids.map(([price, quantity]) => [price, quantity]),
    asks: snapshot.asks.map(([price, quantity]) => [price, quantity]),
    change24hPct: snapshot.change24hPct,
    history: h == null ? null : { low: h.low, from: h.from, to: h.to,
      samples: h.samples, intervalMs: h.intervalMs, complete: h.complete, description: h.description },
  };
}

export function screenMarket(snapshot, config = DEFAULT_CONFIG) {
  const bid = snapshot.bids[0][0], ask = snapshot.asks[0][0];
  const spreadBps = (ask - bid) / ((ask + bid) / 2) * 10000;
  const bidDepthUsd = snapshot.bids.reduce((sum, [price, quantity]) => sum + price * quantity, 0);
  const askDepthUsd = snapshot.asks.reduce((sum, [price, quantity]) => sum + price * quantity, 0);
  const reasons = [];
  if (!Number.isFinite(spreadBps) || spreadBps > config.maxSpreadBps) reasons.push(`Spread ${spreadBps.toFixed(2)} bps exceeds ${config.maxSpreadBps} bps`);
  if (![bidDepthUsd, askDepthUsd].every(Number.isFinite) || Math.min(bidDepthUsd, askDepthUsd) < config.minDepthNotional) reasons.push(`Observed depth below USD ${config.minDepthNotional} per side`);
  return { ok: reasons.length === 0, reasons, bid, ask, spreadBps, bidDepthUsd, askDepthUsd,
    distanceFromLowPct: snapshot.history ? (ask / snapshot.history.low - 1) * 100 : null,
    liquidityBasis: 'Notional in supplied order-book levels only; not total venue liquidity' };
}
