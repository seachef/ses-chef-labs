import { close, EPSILON, SUPPORTED_PRODUCTS } from './config.mjs';
import { screenMarket, validateSnapshot } from './market.mjs';
import { auditState } from './audit.mjs';

export function assessRisk(state, proposal, snapshot, { now, knownDuplicate }) {
  const reasons = [];
  const audit = auditState(state);
  if (!audit.ok) return { ok: false, reasons: [`State audit failed: ${audit.errors.join('; ')}`] };
  if (state.schemaVersion !== 2) return { ok: false, reasons: ['Explicit legacy state upgrade is required before execution'] };
  if (knownDuplicate === true) reasons.push('Duplicate event found in durable archive');
  if (state.checkpoint.totalEventCount > 0 && knownDuplicate !== false) reasons.push('Durable archive duplicate lookup is required after history compaction');
  const validation = validateSnapshot(snapshot, { now, config: state.config });
  if (!validation.ok) return { ok: false, reasons: validation.errors };
  if (!proposal || typeof proposal !== 'object') return { ok: false, reasons: ['Missing proposal'] };
  if (snapshot.provenance !== 'synthetic' || snapshot.source !== 'synthetic-fixture') reasons.push('Public market observations are never executable in this local slice');
  if (!['BUY', 'SELL'].includes(proposal.side)) reasons.push('Unsupported order side');
  if (!Object.hasOwn(SUPPORTED_PRODUCTS, proposal.productId) || proposal.productId !== snapshot.productId || proposal.eventId !== snapshot.eventId || proposal.sourceAt !== snapshot.sourceAt) reasons.push('Proposal identity does not match the validated source event');
  if (proposal.controlVersion !== state.control.version) reasons.push('Proposal invalidated by STOP/resume control transition');
  if (!Number.isSafeInteger(proposal.createdAt) || proposal.createdAt < 0 || proposal.createdAt > now || now - proposal.createdAt + state.config.latencyMs > state.config.maxSignalAgeMs) reasons.push('Stale or future proposal');
  if (now - snapshot.sourceAt + state.config.latencyMs > state.config.maxSnapshotAgeMs) reasons.push('Source would be stale after simulated execution latency');
  if (state.seenEvents.includes(snapshot.eventId) || state.ledger.some(fill => fill.eventId === snapshot.eventId)) reasons.push('Duplicate event already consumed');
  if (snapshot.sourceAt <= (state.lastSourceAtByProduct[snapshot.productId] ?? -1)) reasons.push('Out-of-order or repeated source timestamp');
  if (!Number.isFinite(proposal.quantity) || proposal.quantity <= 0 || !Number.isFinite(proposal.expectedPrice) || proposal.expectedPrice <= 0) reasons.push('Invalid order quantity or expected price');
  const expectedPrice = proposal.side === 'SELL' ? snapshot.bids[0][0] : snapshot.asks[0][0];
  if (!close(proposal.expectedPrice, expectedPrice)) reasons.push('Proposal price does not match executable side');
  const notional = proposal.quantity * proposal.expectedPrice;
  if (!Number.isFinite(notional)) reasons.push('Invalid order notional');
  if (proposal.side === 'BUY') {
    if (!state.account.valuationComplete) reasons.push('Incomplete or stale portfolio valuation blocks entries');
    for (const productId of Object.keys(state.account.positions)) {
      const mark = state.marketByProduct[productId];
      if (!mark || mark.provenance !== 'synthetic' || now - mark.sourceAt > state.config.maxSnapshotAgeMs || mark.sourceAt > now) reasons.push(`Missing or stale synthetic mark for ${productId}`);
    }
    if (state.control.emergencyStop) reasons.push('STOP blocks new entries');
    if (state.riskHalt.active) reasons.push('Persistent risk halt blocks new entries');
    const market = screenMarket(snapshot, state.config);
    reasons.push(...market.reasons);
    if (state.account.positions[snapshot.productId]) reasons.push('Position already open; adding exposure is disabled');
    if (notional > state.config.maxOrderNotional + EPSILON) reasons.push('Maximum order size exceeded');
    const worstNotional = notional * (1 + state.config.maxSlippageBps / 10000);
    const worstCash = worstNotional * (1 + state.config.feeBps / 10000);
    if (worstCash > state.account.cash + EPSILON) reasons.push('Insufficient cash including conservative fee/slippage reserve');
    if (worstNotional > state.config.maxPositionNotional + EPSILON) reasons.push('Maximum position exposure exceeded');
    const exposure = Object.values(state.account.positions).reduce((sum, position) => sum + position.quantity * position.markPrice, 0);
    if (exposure + worstNotional > state.account.equity * state.config.maxExposurePct / 100 + EPSILON) reasons.push('Maximum total exposure exceeded');
    if (state.account.drawdownPct >= state.config.maxDrawdownPct) reasons.push('Drawdown limit reached');
    if (state.account.equity - state.account.initialCash <= -state.config.maxLossUsd) reasons.push('Net loss limit reached');
    if (!Number.isFinite(proposal.stopPrice) || proposal.stopPrice <= 0 || proposal.stopPrice >= proposal.expectedPrice || !Number.isFinite(proposal.targetPrice) || proposal.targetPrice <= proposal.expectedPrice) reasons.push('Invalid protective stop or target');
  } else if (proposal.side === 'SELL') {
    const position = state.account.positions[snapshot.productId];
    if (!position || proposal.quantity > position.quantity + EPSILON) reasons.push('Exit would exceed held quantity');
    if (!['protective-stop', 'take-profit'].includes(proposal.reason)) reasons.push('Only protective strategy exits are allowed');
    if (position && !((proposal.reason === 'protective-stop' && snapshot.bids[0][0] <= position.stopPrice) ||
      (proposal.reason === 'take-profit' && snapshot.bids[0][0] >= position.targetPrice))) reasons.push('Protective exit trigger is not present');
  }
  return { ok: reasons.length === 0, reasons };
}
