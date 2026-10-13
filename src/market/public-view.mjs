// Browser-safe projection of validated public observations; no engine or account.
export const PUBLIC_FRESHNESS_MS = 10_000;
export function publicView(session, now = Date.now()) {
  const market = session.observations.map(s => {
    const bid = s.bids[0][0], ask = s.asks[0][0], mid = (bid + ask) / 2;
    const times = [s.sourceAt, s.bookSourceAt, s.observedAt];
    const stale = times.some(t => !Number.isSafeInteger(t) || t > now || now - t > PUBLIC_FRESHNESS_MS);
    const h = s.history;
    return { symbol: s.productId, quoteCurrency: s.quote, price: s.price,
      change24hPct: s.change24hPct, liquidityUsd: [...s.bids, ...s.asks].reduce((n, [p,q]) => n + p*q, 0),
      spreadBps: (ask-bid)/mid*10000, distanceFromLowPct: h.low > 0 ? (s.price/h.low-1)*100 : null,
      historyCoverage: `${h.samples} observed closed hourly buckets; ${h.missingBuckets} missing. ${h.from === null ? 'Unknown period' : `${new Date(h.from).toISOString()} to ${new Date(h.to).toISOString()}`}. Not an all-time low.`,
      source: s.source, observedAt: s.observedAt, sourceAt: s.sourceAt, bookSourceAt: s.bookSourceAt, stale, provenance: 'public' };
  });
  return { mode: 'observe', stopped: true, market, account: null, executions: [], pendingOrders: [],
    decisions: [{ action: 'WAIT', reason: 'Read-only public observations. No strategy or execution engine runs in this page.' }],
    worker: { status: `browser ${session.phase}`, lastCycleAt: session.completedAt },
    freshnessMaxAgeMs: PUBLIC_FRESHNESS_MS, errors: session.errors,
    risk: { status: 'EXECUTION DISABLED' }, stopPolicy: 'No execution exists in this public preview. Cancel stops only an in-flight data request.' };
}
