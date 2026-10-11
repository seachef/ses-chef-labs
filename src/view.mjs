import { hostname } from 'node:os';

const MAX_AGE_MS = 10000;
const finite = x => typeof x === 'number' && Number.isFinite(x);

function marketView(snapshot, now) {
  const bid = snapshot.bids?.[0]?.[0];
  const ask = snapshot.asks?.[0]?.[0];
  const mid = finite(bid) && finite(ask) ? (bid + ask) / 2 : null;
  const price = finite(snapshot.price) ? snapshot.price : mid;
  const age = now - snapshot.observedAt;
  const sourceAge = now - snapshot.sourceAt;
  const bookAge = finite(snapshot.bookSourceAt) ? now - snapshot.bookSourceAt : null;
  const stale = !finite(age) || age < 0 || age > MAX_AGE_MS || !finite(sourceAge) || sourceAge < 0 || sourceAge > MAX_AGE_MS ||
    (snapshot.provenance === 'public' && (!finite(bookAge) || bookAge < 0 || bookAge > MAX_AGE_MS));
  const depth = [...(snapshot.bids ?? []), ...(snapshot.asks ?? [])].reduce((sum, level) => sum + level[0] * level[1], 0);
  const low = snapshot.history?.low;
  const history = snapshot.history;
  const historyCoverage = history ? `${history.samples} observed samples; ${history.from === null ? 'unknown' : new Date(history.from).toISOString()} to ${history.to === null ? 'unknown' : new Date(history.to).toISOString()}. ${history.missingBuckets ?? 'Unknown'} missing buckets. ${history.description}` : 'Unknown; all-time low unavailable';
  return { symbol: snapshot.productId, quoteCurrency: snapshot.quote, price,
    change24hPct: snapshot.change24hPct ?? null, liquidityUsd: finite(depth) ? depth : null,
    spreadBps: mid > 0 ? (ask - bid) / mid * 10000 : null,
    distanceFromLowPct: price > 0 && low > 0 ? (price / low - 1) * 100 : null,
    historyCoverage,
    source: snapshot.source, observedAt: snapshot.observedAt, sourceAt: snapshot.sourceAt, stale,
    provenance: snapshot.provenance, bookSourceAt: snapshot.bookSourceAt ?? null };
}

function workerView(worker, now) {
  const result = { ...worker };
  if (result.status === 'running') {
    let alive = false;
    if (worker.host === hostname() && Number.isSafeInteger(worker.pid) && worker.pid > 0) {
      try { process.kill(worker.pid, 0); alive = true; } catch { /* Never infer a live worker from a saved status alone. */ }
    }
    if (!alive || now - worker.lastCycleAt > MAX_AGE_MS || now < worker.lastCycleAt) result.status = 'interrupted / heartbeat stale';
  }
  return result;
}

export function toView(document, { now = Date.now() } = {}) {
  const engine = document.engine;
  const snapshots = document.mode === 'observe' ? document.observations : Object.values(engine?.marketByProduct ?? {});
  const markets = snapshots.map(snapshot => marketView(snapshot, now));
  const account = engine ? { ...engine.account, currency: 'USD', provenance: 'synthetic', netPnl: finite(engine.account.equity) ? engine.account.equity - engine.account.initialCash : null } : null;
  const positions = account ? Object.entries(account.positions ?? {}).map(([productId, position]) => ({ ...position, productId, symbol: productId, costPerUnit: position.costBasis / position.quantity })) : [];
  if (account) account.positions = positions;
  const held = positions.filter(position => (position.quantity ?? position.qty ?? 0) > 0);
  const valuationIncomplete = held.some(position => !markets.some(market => market.symbol === position.productId && !market.stale));
  if (account && valuationIncomplete) {
    account.unrealizedPnl = null; account.equity = null; account.drawdownPct = null;
    account.netReturnPct = null; account.netPnl = null; account.valuationStatus = 'incomplete: current marks unavailable';
  }
  return { revision: document.revision, asOf: now, mode: document.mode,
    source: document.mode === 'observe' ? 'Coinbase Exchange public read-only snapshots; no simulated public-price trades' : 'Synthetic fixture only; no live market performance',
    worker: workerView(document.worker, now), stopped: document.control.stopped,
    stopPolicy: 'Entry pause: blocks new buys persistently; fresh synthetic protective exits remain enabled. No automatic liquidation.',
    freshnessMaxAgeMs: MAX_AGE_MS, market: markets,
    decisions: engine?.decision ? [{ ...engine.decision, symbol: engine.decision.productId }] : [{ action: 'WAIT', reason: 'Engine not initialized; public observation cannot trade.' }],
    executions: (engine?.lastFill ? [engine.lastFill] : engine?.ledger.slice(-1) ?? []).map(fill => ({ ...fill, symbol: fill.productId, entry: fill.averagePrice, size: fill.quantity, stop: fill.stopPrice, target: fill.targetPrice, fees: fill.fee, slippage: fill.slippageCost, currency: 'USD', at: fill.simulatedFillAt })), account,
    risk: { status: engine?.riskHalt?.active ? 'HALTED' : document.control.stopped ? 'ENTRY PAUSED' : 'Fixture limits active',
      ...(engine ? { limits: engine.config } : {}) },
    errors: document.errors, valuationIncomplete, journal: document.journal ?? null,
    history: document.history ?? null, lifetimeFillCount: engine?.totalFillCount ?? engine?.ledger.length ?? 0,
    counts: { configured: 2, monitored: markets.length, held: held.length, eligible: null, discovered: null } };
}
