import { close, configuration, EPSILON, SUPPORTED_PRODUCTS } from './config.mjs';
import { checkpointDigest } from './checkpoint.mjs';
import { isDeepStrictEqual } from 'node:util';
import { auditCausalState } from './causal-audit.mjs';
import { compareBookProgress } from '../book-identity.mjs';

// Ledger arithmetic is independently replayed here, rather than calling the
// transition/accounting implementation. Floating point tolerance is explicit.
export function auditState(state) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  try {
    require([1, 2, 3].includes(state.schemaVersion) && state.mode === 'synthetic-paper', 'Invalid engine schema or mode');
    const validatedConfig = configuration(state.config);
    if (state.schemaVersion !== 3) require(state.config.latencyMs === 0, 'Legacy engine schema cannot claim delayed execution');
    require(Object.keys(state.config).length === Object.keys(validatedConfig).length, 'Incomplete risk configuration');
    require(Number.isSafeInteger(state.asOf) && state.asOf >= 0 && Number.isSafeInteger(state.createdAt) && state.createdAt <= state.asOf, 'Invalid state clock');
    require(typeof state.riskHalt.active === 'boolean' && Array.isArray(state.riskHalt.reasons) && state.riskHalt.reasons.every(reason => typeof reason === 'string'), 'Invalid risk halt state');
    const a = state.account;
    require(Number.isFinite(a.initialCash) && a.initialCash > 0, 'Invalid initial cash');
    require(Array.isArray(state.ledger), 'Missing ledger');
    require(state.ledger.length <= state.config.maxEvents, 'Active ledger capacity exceeded');
    require(Array.isArray(state.seenEvents) && new Set(state.seenEvents).size === state.seenEvents.length, 'Duplicate consumed events');
    require(state.seenEvents.every(id => typeof id === 'string' && id.trim() && id.length <= 200), 'Invalid consumed event identity');
    require(state.seenEvents.length <= state.config.maxEvents, 'Event capacity exceeded');
    require(Number.isSafeInteger(state.control.version) && state.control.version >= 0, 'Invalid control generation');
    require(typeof state.control.emergencyStop === 'boolean' && state.control.entryPaused === state.control.emergencyStop, 'Invalid entry pause state');
    require(state.control.exitPolicy === 'fresh-synthetic-protective-exits', 'Unsupported protective exit policy');
    require(Object.keys(state.marketByProduct).every(productId => Object.hasOwn(SUPPORTED_PRODUCTS, productId)), 'Unknown retained market identity');
    require(Object.entries(state.lastSourceAtByProduct).every(([productId, time]) => Object.hasOwn(SUPPORTED_PRODUCTS, productId) && Number.isSafeInteger(time) && time >= 0 && time <= state.asOf), 'Invalid source high-water mark');
    let cash = a.initialCash, realized = 0, fees = 0;
    let positions = {}, fillOffset = 0;
    if ([2, 3].includes(state.schemaVersion)) {
      const c = state.checkpoint;
      require(c.schemaVersion === 1 && ['genesis', 'durable-archive'].includes(c.kind), 'Invalid accounting checkpoint schema');
      require(typeof c.digest === 'string' && c.digest === checkpointDigest(c), 'Accounting checkpoint digest mismatch');
      require(Number.isSafeInteger(c.asOf) && c.asOf >= state.createdAt && c.asOf <= state.asOf, 'Invalid checkpoint clock');
      require(close(c.initialCash, a.initialCash), 'Checkpoint changed original initial cash');
      require(Number.isFinite(c.cash) && c.cash >= -EPSILON && Number.isFinite(c.realizedPnl) && Number.isFinite(c.feesPaid) && c.feesPaid >= 0, 'Invalid checkpoint financial totals');
      require(Number.isFinite(c.peakEquity) && c.peakEquity >= a.initialCash && a.peakEquity + EPSILON >= c.peakEquity, 'Checkpoint equity peak was lost');
      require([c.totalFillCount, c.totalEventCount, state.totalFillCount, state.totalEventCount].every(count => Number.isSafeInteger(count) && count >= 0), 'Invalid lifetime accounting counts');
      require(c.totalFillCount <= c.totalEventCount && state.totalFillCount <= state.totalEventCount, 'Fill count exceeds consumed event count');
      require(state.totalFillCount === c.totalFillCount + state.ledger.length && state.totalEventCount === c.totalEventCount + state.seenEvents.length, 'Lifetime accounting counts do not match retained history');
      if (c.totalFillCount === 0) require(c.lastFill === null, 'Empty checkpoint must not invent a latest fill');
      else require(c.lastFill && c.lastFill.sequence === c.totalFillCount && c.lastFill.provenance === 'synthetic' && Number.isSafeInteger(c.lastFill.simulatedFillAt) && c.lastFill.simulatedFillAt <= c.asOf && close(c.lastFill.cashAfter, c.cash), 'Invalid checkpoint latest fill');
      require(isDeepStrictEqual(state.lastFill, state.ledger.at(-1) ?? c.lastFill), 'Latest fill differs from retained ledger or checkpoint');
      require(state.totalFillCount === 0 ? state.lastFill === null : state.lastFill?.sequence === state.totalFillCount, 'Latest fill does not match lifetime fill count');
      require(c.positions && typeof c.positions === 'object' && !Array.isArray(c.positions), 'Invalid checkpoint positions');
      let anchoredBasis = 0;
      for (const [productId, position] of Object.entries(c.positions)) {
        require(Object.hasOwn(SUPPORTED_PRODUCTS, productId), 'Unknown checkpoint position');
        require([position.quantity, position.costBasis, position.stopPrice, position.targetPrice].every(value => Number.isFinite(value) && value > 0) && position.targetPrice > position.stopPrice, 'Invalid checkpoint quantity, basis or protective levels');
        require(Number.isSafeInteger(position.openedAt) && position.openedAt >= state.createdAt && position.openedAt <= c.asOf, 'Invalid checkpoint position opening time');
        anchoredBasis += position.costBasis;
      }
      require(close(c.cash + anchoredBasis, c.initialCash + c.realizedPnl), 'Checkpoint cash and cost-basis conservation failed');
      require(Object.entries(c.lastSourceAtByProduct).every(([productId, time]) => Object.hasOwn(SUPPORTED_PRODUCTS, productId) && Number.isSafeInteger(time) && time >= 0 && time <= c.asOf && state.lastSourceAtByProduct[productId] >= time), 'Checkpoint source high-water mark was lost');
      require(Number.isSafeInteger(c.controlVersion) && c.controlVersion >= 0 && state.control.version >= c.controlVersion, 'Checkpoint control generation was lost');
      require(typeof c.riskHalt.active === 'boolean' && Array.isArray(c.riskHalt.reasons) && c.riskHalt.reasons.every(reason => typeof reason === 'string'), 'Invalid checkpoint risk halt');
      require(!c.riskHalt.active || state.riskHalt.active, 'Checkpoint risk halt was cleared');
      require(c.riskHalt.reasons.every(reason => state.riskHalt.reasons.includes(reason)), 'Checkpoint risk halt reasons were lost');
      if (c.kind === 'genesis') require(c.asOf === state.createdAt && close(c.cash, a.initialCash) && c.realizedPnl === 0 && c.feesPaid === 0 && c.peakEquity === a.initialCash && c.totalFillCount === 0 && c.totalEventCount === 0 && Object.keys(c.positions).length === 0 && Object.keys(c.lastSourceAtByProduct).length === 0 && c.controlVersion === 0 && !c.riskHalt.active && c.riskHalt.reasons.length === 0, 'Genesis checkpoint must preserve the original empty account');
      cash = c.cash; realized = c.realizedPnl; fees = c.feesPaid;
      positions = structuredClone(c.positions); fillOffset = c.totalFillCount;
    }
    const fillIds = new Set(), eventIds = new Set();
    for (const [index, fill] of state.ledger.entries()) {
      require(fill.sequence === fillOffset + index + 1, 'Ledger sequence is not lifetime-contiguous');
      require(!fillIds.has(fill.id) && !eventIds.has(fill.eventId), 'Duplicate ledger execution');
      fillIds.add(fill.id); eventIds.add(fill.eventId);
      require(state.seenEvents.includes(fill.eventId), 'Fill source event not consumed');
      require(Object.hasOwn(SUPPORTED_PRODUCTS, fill.productId) && fill.provenance === 'synthetic', 'Unverified ledger identity/provenance');
      require(['BUY', 'SELL'].includes(fill.side) && Number.isFinite(fill.quantity) && fill.quantity > 0, 'Invalid fill side or quantity');
      require(Number.isFinite(fill.averagePrice) && fill.averagePrice > 0 && Number.isFinite(fill.notional) && fill.notional > 0, 'Invalid fill price/notional');
      require(Number.isFinite(fill.expectedPrice) && fill.expectedPrice > 0 && Number.isFinite(fill.requestedQuantity) && fill.requestedQuantity > 0, 'Invalid fill expectation');
      require(Number.isFinite(fill.stopPrice) && fill.stopPrice > 0 && Number.isFinite(fill.targetPrice) && fill.targetPrice > fill.stopPrice, 'Invalid fill protective levels');
      require([fill.sourceAt, fill.decidedAt, fill.simulatedFillAt].every(time => Number.isSafeInteger(time) && time >= 0 && time <= state.asOf), 'Invalid fill timestamp');
      require(Array.isArray(fill.legs) && fill.legs.length > 0 && fill.legs.every(leg => Number.isFinite(leg.price) && leg.price > 0 && Number.isFinite(leg.observedPrice) && leg.observedPrice > 0 && Number.isFinite(leg.quantity) && leg.quantity > 0), 'Invalid depth leg');
      require(fill.legs.every(leg => close(leg.price, leg.observedPrice * (1 + (fill.side === 'BUY' ? 1 : -1) * state.config.slippageBps / 10000))), 'Adverse price assumption mismatch');
      require(['filled', 'partial'].includes(fill.status) && (fill.status === 'filled') === (fill.quantity + EPSILON >= fill.requestedQuantity), 'Fill status mismatch');
      require(Number.isFinite(fill.fee) && fill.fee >= 0 && close(fill.fee, fill.notional * state.config.feeBps / 10000), 'Fee mismatch');
      require(close(fill.notional, fill.averagePrice * fill.quantity), 'Fill notional mismatch');
      require(close(fill.legs.reduce((sum, leg) => sum + leg.quantity, 0), fill.quantity) && close(fill.legs.reduce((sum, leg) => sum + leg.quantity * leg.price, 0), fill.notional), 'Depth leg mismatch');
      require(close(fill.slippageCost, (fill.side === 'BUY' ? 1 : -1) * (fill.notional - fill.quantity * fill.expectedPrice)) && (state.schemaVersion === 3 || fill.slippageCost >= -EPSILON), 'Execution cost mismatch');
      require(fill.quantity <= fill.requestedQuantity + EPSILON && close(fill.canceledQuantity, fill.requestedQuantity - fill.quantity), 'Canceled remainder mismatch');
      if (state.schemaVersion === 3) {
        require(fill.decidedAt === fill.decisionAt && fill.eligibleAt === fill.decisionAt + state.config.latencyMs && fill.expiresAt === fill.decisionAt + state.config.maxSignalAgeMs && fill.executedAt === fill.simulatedFillAt && fill.executedAt >= fill.eligibleAt && fill.executedAt < fill.expiresAt && fill.sourceAt <= fill.executedAt && Number.isSafeInteger(fill.arrivalObservedAt) && fill.arrivalObservedAt <= fill.executedAt, 'Unsupported causal fill time');
        require(fill.decisionBook.sourceAt <= fill.decisionAt && fill.arrivalBook.sourceAt >= fill.eligibleAt && fill.arrivalBook.sourceAt <= fill.arrivalObservedAt && compareBookProgress(fill.decisionBook, fill.arrivalBook).status === 'new' && fill.arrivalEventId === fill.eventId && fill.decisionEventId !== fill.arrivalEventId, 'Causal fill did not use a distinct eligible later book');
        const direction = fill.side === 'BUY' ? 1 : -1;
        const observed = fill.legs.reduce((sum, leg) => sum + leg.observedPrice * leg.quantity, 0);
        require(close(fill.decisionDriftCost, direction * fill.quantity * (fill.arrivalPrice - fill.expectedPrice)) && close(fill.depthImpactCost, direction * (observed - fill.quantity * fill.arrivalPrice)) && close(fill.assumedSlippageCost, direction * (fill.notional - observed)) && fill.depthImpactCost >= -EPSILON && fill.assumedSlippageCost >= -EPSILON && close(fill.slippageCost, fill.decisionDriftCost + fill.depthImpactCost + fill.assumedSlippageCost), 'Causal drift/depth/slippage decomposition failed');
      } else require(fill.simulatedFillAt === fill.decidedAt && fill.sourceAt <= fill.decidedAt, 'Unsupported or anticipatory fill time');
      fees += fill.fee;
      if (fill.side === 'BUY') {
        require(!positions[fill.productId], 'Ledger adds to an existing position');
        cash -= fill.notional + fill.fee;
        positions[fill.productId] = { quantity: fill.quantity, costBasis: fill.notional + fill.fee, stopPrice: fill.stopPrice, targetPrice: fill.targetPrice };
      } else if (fill.side === 'SELL') {
        const held = positions[fill.productId];
        require(!!held && fill.quantity <= (held?.quantity ?? 0) + EPSILON, 'Ledger oversells position');
        if (!held) continue;
        const removed = held.costBasis * fill.quantity / held.quantity;
        realized += fill.notional - fill.fee - removed;
        cash += fill.notional - fill.fee;
        held.quantity -= fill.quantity; held.costBasis -= removed;
        if (held.quantity <= EPSILON) delete positions[fill.productId];
      }
      require(cash >= -EPSILON && close(fill.cashAfter, cash), 'Cash after fill mismatch or negative');
    }
    require(close(a.cash, cash) && a.cash >= -EPSILON, 'Cash reconciliation failed');
    require(close(a.realizedPnl, realized), 'Realized P/L reconciliation failed');
    require(close(a.feesPaid, fees), 'Fee reconciliation failed');
    require(Object.keys(a.positions).length === Object.keys(positions).length, 'Position count mismatch');
    let marketValue = 0, remainingBasis = 0, complete = true;
    for (const [productId, p] of Object.entries(positions)) {
      const actual = a.positions[productId];
      require(!!actual && close(actual.quantity, p.quantity) && close(actual.costBasis, p.costBasis), 'Position quantity/cost reconciliation failed');
      require(!!actual && close(actual.stopPrice, p.stopPrice) && close(actual.targetPrice, p.targetPrice), 'Position protective levels changed');
      if (!actual) continue;
      const quote = state.marketByProduct[productId];
      const markAt = state.schemaVersion === 3 ? quote?.bookSourceAt : quote?.sourceAt;
      const usable = !!quote && quote.provenance === 'synthetic' && Number.isFinite(quote.bids?.[0]?.[0]) && Number.isSafeInteger(markAt) && markAt <= state.asOf && state.asOf - markAt <= state.config.maxSnapshotAgeMs;
      if (!usable) { complete = false; require(actual.markPrice === null, 'Stale/missing position mark must be unknown'); }
      else { require(close(actual.markPrice, quote.bids[0][0]) && (state.schemaVersion !== 3 || actual.markAsOf === markAt), 'Position mark differs from observed bid/time'); marketValue += p.quantity * actual.markPrice; }
      remainingBasis += p.costBasis;
    }
    require(a.valuationComplete === complete, 'Valuation completeness mismatch');
    require(Number.isFinite(a.peakEquity) && a.peakEquity >= a.initialCash, 'Invalid equity peak');
    if (complete) {
      require(close(a.marketValue, marketValue) && close(a.equity, cash + marketValue), 'Equity reconciliation failed');
      require(close(a.unrealizedPnl, marketValue - remainingBasis), 'Unrealized P/L reconciliation failed');
      require(close(a.equity, a.initialCash + a.realizedPnl + a.unrealizedPnl), 'Accounting conservation failed');
      require(a.peakEquity + EPSILON >= a.equity && close(a.drawdownPct, Math.max(0, (a.peakEquity - a.equity) / a.peakEquity * 100)), 'Drawdown mismatch');
      require(close(a.netReturnPct, (a.equity / a.initialCash - 1) * 100), 'Net return mismatch');
    } else require([a.marketValue, a.equity, a.unrealizedPnl, a.drawdownPct, a.netReturnPct].every(v => v === null), 'Incomplete aggregate valuation must be unknown');
    if (state.schemaVersion === 3) auditCausalState(state, require);
  } catch (error) { errors.push(`Malformed state: ${error.message}`); }
  return { ok: errors.length === 0, errors };
}
