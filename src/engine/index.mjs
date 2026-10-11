import { configuration, EPSILON, SUPPORTED_PRODUCTS } from './config.mjs';
import { validateSnapshot, screenMarket, retainSnapshot } from './market.mjs';
import { proposeTrade, STRATEGY_VERSION } from './strategy.mjs';
import { assessRisk } from './risk.mjs';
import { executePaper } from './execution.mjs';
import { auditState } from './audit.mjs';
import { genesisCheckpoint, makeCheckpoint } from './checkpoint.mjs';
export { validateSnapshot, screenMarket, proposeTrade, assessRisk, executePaper, auditState, STRATEGY_VERSION };

function requireAudit(state) {
  const audit = auditState(state);
  if (!audit.ok) throw new Error(`State audit failed: ${audit.errors.join('; ')}`);
}
function requireCurrentVersion(state) {
  requireAudit(state);
  if (state.schemaVersion !== 2) throw new Error('Explicit upgradeState is required before changing a legacy engine state');
}
function clock(now, previous = 0) {
  if (!Number.isSafeInteger(now) || now < previous) throw new Error('Clock must be an explicit nondecreasing nonnegative integer');
}

export function createState({ initialCash = 10000, now = 0, config = {} } = {}) {
  clock(now);
  if (!Number.isFinite(initialCash) || initialCash <= 0) throw new Error('Initial synthetic cash must be positive and finite');
  const state = {
    schemaVersion: 2, mode: 'synthetic-paper', strategyVersion: STRATEGY_VERSION,
    accountingBasis: 'Configured synthetic USD cash; synthetic fixture performance only. Bid marks include paid fees, exclude prospective exit fees.',
    config: configuration(config), createdAt: now, asOf: now,
    account: { initialCash, cash: initialCash, positions: {}, realizedPnl: 0, unrealizedPnl: 0,
      equity: initialCash, marketValue: 0, feesPaid: 0, peakEquity: initialCash, drawdownPct: 0, netReturnPct: 0, valuationComplete: true },
    control: { emergencyStop: false, entryPaused: false, version: 0, stoppedAt: null, stopReason: null, resumedAt: null, exitPolicy: 'fresh-synthetic-protective-exits' },
    riskHalt: { active: false, reasons: [] }, marketByProduct: {}, seenEvents: [], lastSourceAtByProduct: {}, ledger: [],
    totalFillCount: 0, totalEventCount: 0, lastFill: null, checkpoint: null,
    decision: { action: 'WAIT', reason: 'No validated source event has been processed', at: now, productId: null },
    execution: { status: 'idle', reason: 'No execution attempted', at: now },
    engine: { status: 'idle', lastEventAt: null, lastEventId: null, lastError: null, workerStatus: 'not-running' },
  };
  state.checkpoint = genesisCheckpoint(state);
  requireAudit(state); return state;
}

export function upgradeState(legacy) {
  requireAudit(legacy);
  const state = structuredClone(legacy);
  if (state.schemaVersion === 2) return state;
  state.schemaVersion = 2;
  state.totalFillCount = state.ledger.length;
  state.totalEventCount = state.seenEvents.length;
  state.lastFill = structuredClone(state.ledger.at(-1) ?? null);
  state.checkpoint = genesisCheckpoint(state);
  requireAudit(state); return state;
}

export function compactState(previous, { durableArchive = false } = {}) {
  requireCurrentVersion(previous);
  if (durableArchive !== true) throw new Error('Compaction requires explicit durable archive acknowledgement; history cannot be silently evicted');
  const state = structuredClone(previous);
  if (state.seenEvents.length === 0 && state.ledger.length === 0) return state;
  state.checkpoint = makeCheckpoint(state);
  state.ledger = [];
  state.seenEvents = [];
  requireAudit(state); return state;
}

function markAccount(state, now) {
  const a = state.account;
  let marketValue = 0, basis = 0, complete = true;
  for (const [productId, position] of Object.entries(a.positions)) {
    const snapshot = state.marketByProduct[productId];
    const fresh = snapshot && snapshot.provenance === 'synthetic' && snapshot.sourceAt <= now && now - snapshot.sourceAt <= state.config.maxSnapshotAgeMs;
    position.markPrice = fresh ? snapshot.bids[0][0] : null;
    position.markAsOf = snapshot?.sourceAt ?? null;
    position.markStatus = fresh ? 'observed-bid' : 'unknown-or-stale';
    if (fresh) marketValue += position.quantity * position.markPrice;
    else complete = false;
    basis += position.costBasis;
  }
  a.valuationComplete = complete;
  if (!complete) {
    a.marketValue = a.equity = a.unrealizedPnl = a.drawdownPct = a.netReturnPct = null;
    return;
  }
  a.marketValue = marketValue; a.equity = a.cash + marketValue; a.unrealizedPnl = marketValue - basis;
  a.peakEquity = Math.max(a.peakEquity, a.equity);
  a.drawdownPct = Math.max(0, (a.peakEquity - a.equity) / a.peakEquity * 100);
  a.netReturnPct = (a.equity / a.initialCash - 1) * 100;
  const reasons = [];
  if (a.drawdownPct >= state.config.maxDrawdownPct) reasons.push('Maximum drawdown reached');
  if (a.equity - a.initialCash <= -state.config.maxLossUsd) reasons.push('Maximum net loss reached');
  if (reasons.length) state.riskHalt = { active: true, reasons: [...new Set([...state.riskHalt.reasons, ...reasons])] };
}

function commitFill(state, fill) {
  const a = state.account;
  if (fill.side === 'BUY') {
    a.cash -= fill.notional + fill.fee;
    a.positions[fill.productId] = { quantity: fill.quantity, costBasis: fill.notional + fill.fee,
      stopPrice: fill.stopPrice, targetPrice: fill.targetPrice, openedAt: fill.simulatedFillAt,
      markPrice: null, markAsOf: null, markStatus: 'unknown-or-stale' };
  } else {
    const position = a.positions[fill.productId];
    const removedBasis = position.costBasis * fill.quantity / position.quantity;
    a.cash += fill.notional - fill.fee;
    a.realizedPnl += fill.notional - fill.fee - removedBasis;
    position.quantity -= fill.quantity; position.costBasis -= removedBasis;
    if (position.quantity <= EPSILON) delete a.positions[fill.productId];
  }
  a.feesPaid += fill.fee;
  state.totalFillCount += 1;
  state.lastFill = { ...fill, sequence: state.totalFillCount, cashAfter: a.cash };
  state.ledger.push(structuredClone(state.lastFill));
}

export function step(previous, snapshot, { now, knownDuplicate, durableArchive = false } = {}) {
  requireCurrentVersion(previous); clock(now, previous.asOf);
  let state = structuredClone(previous); state.asOf = now;
  markAccount(state, now);
  const reject = reason => {
    const productId = typeof snapshot?.productId === 'string' && Object.hasOwn(SUPPORTED_PRODUCTS, snapshot.productId) ? snapshot.productId : null;
    state.decision = { action: 'REJECT', reason, at: now, productId };
    state.execution = { status: 'blocked', reason, at: now };
    state.engine = { ...state.engine, status: 'blocked', lastError: reason };
    requireAudit(state); return state;
  };
  const validation = validateSnapshot(snapshot, { now, config: state.config });
  if (!validation.ok) return reject(validation.errors.join('; '));
  if (knownDuplicate === true) return reject('Duplicate source event found in durable archive; no accounting effect');
  if (state.checkpoint.totalEventCount > 0 && knownDuplicate !== false) return reject('Durable archive duplicate lookup is required after history compaction');
  if (state.seenEvents.includes(snapshot.eventId)) return reject('Duplicate source event; no accounting effect');
  if (snapshot.sourceAt <= (state.lastSourceAtByProduct[snapshot.productId] ?? -1)) return reject('Out-of-order or repeated source timestamp; no accounting effect');
  if (state.seenEvents.length >= state.config.maxEvents) {
    if (durableArchive !== true || knownDuplicate !== false) return reject('Active event capacity reached; durable archive and duplicate lookup are required before continuing');
    state = compactState(state, { durableArchive: true });
  }
  state.marketByProduct[snapshot.productId] = retainSnapshot(snapshot);
  markAccount(state, now);
  let outcome = proposeTrade(state, snapshot, { now });
  if (snapshot.provenance === 'public') outcome = { action: 'WAIT', reason: 'Public venue book is observation-only; no public-price simulated executions are enabled', proposal: null };
  state.decision = { action: outcome.action === 'SELL' ? 'WAIT' : outcome.action, reason: outcome.reason, at: now, productId: snapshot.productId, proposal: outcome.proposal };
  state.execution = { status: 'idle', reason: outcome.reason, at: now };
  if (outcome.proposal) {
    const result = executePaper(state, outcome.proposal, snapshot, { now, knownDuplicate });
    if (result.fill) {
      commitFill(state, result.fill);
      state.execution = { ...result.fill, at: now, entry: outcome.proposal.expectedPrice, size: outcome.proposal.quantity,
        stop: outcome.proposal.stopPrice, target: outcome.proposal.targetPrice };
    } else {
      state.decision = { ...state.decision, action: 'REJECT', reason: result.rejection };
      state.execution = { status: 'blocked', reason: result.rejection, at: now };
    }
  }
  state.seenEvents.push(snapshot.eventId);
  state.totalEventCount += 1;
  state.lastSourceAtByProduct[snapshot.productId] = snapshot.sourceAt;
  state.engine = { ...state.engine, status: state.execution.status === 'blocked' ? 'blocked' : 'processed',
    lastEventAt: now, lastEventId: snapshot.eventId, lastError: state.execution.status === 'blocked' ? state.execution.reason : null };
  markAccount(state, now); requireAudit(state); return state;
}

export function stop(previous, { now, reason = 'Operator entry pause' } = {}) {
  requireCurrentVersion(previous); clock(now, previous.asOf);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 4096) throw new Error('STOP reason must be a nonempty string of at most 4096 characters');
  const state = structuredClone(previous); state.asOf = now;
  if (!state.control.emergencyStop) state.control = { ...state.control, emergencyStop: true, entryPaused: true,
    version: state.control.version + 1, stoppedAt: now, stopReason: reason };
  state.decision = { action: 'WAIT', reason: 'ENTRY PAUSED; fresh synthetic protective exits remain eligible', at: now, productId: null, proposal: null };
  state.execution = { status: 'idle', reason: 'Prior proposals invalidated; no outstanding orders', at: now };
  markAccount(state, now); requireAudit(state); return state;
}

export function resume(previous, { now } = {}) {
  requireCurrentVersion(previous); clock(now, previous.asOf);
  const state = structuredClone(previous); state.asOf = now;
  if (state.control.emergencyStop) state.control = { ...state.control, emergencyStop: false, entryPaused: false,
    version: state.control.version + 1, resumedAt: now };
  state.decision = { action: 'WAIT', reason: 'Entry pause released; persistent risk limits still apply and a new source event is required', at: now, productId: null, proposal: null };
  state.execution = { status: 'idle', reason: 'Awaiting a new validated event', at: now };
  markAccount(state, now); requireAudit(state); return state;
}
