import { isDeepStrictEqual } from 'node:util';
import { EPSILON, close } from './config.mjs';
import { auditState } from './audit.mjs';
import { screenMarket, validateSnapshot } from './market.mjs';
import { compareBookProgress, normalizeBookIdentity } from '../book-identity.mjs';

function sourceChecks(state, snapshot, book, now) {
  const result = validateSnapshot(snapshot, { now, config: state.config });
  const reasons = [...result.errors];
  if (!Number.isSafeInteger(now) || now < state.asOf) reasons.push('Execution clock must be an explicit nondecreasing safe integer');
  if (!result.ok) return reasons;
  try { if (!isDeepStrictEqual(book, normalizeBookIdentity(snapshot, { requireExplicit: true }))) reasons.push('Supplied book identity does not match independently normalized arrival evidence'); }
  catch (error) { reasons.push(error.message); }
  if (snapshot.provenance !== 'synthetic' || snapshot.source !== 'synthetic-fixture') reasons.push('Public observations cannot admit or execute synthetic orders');
  if (!book?.explicit || !Number.isSafeInteger(book.sourceAt) || book.sourceAt > snapshot.observedAt || book.sourceAt > now || now - book.sourceAt > state.config.maxSnapshotAgeMs) reasons.push('Executable book source time is missing, future, or stale');
  return reasons;
}

function buyLimits(state, proposal, snapshot, now, ownReservation = 0) {
  const reasons = [];
  const config = state.config, account = state.account;
  if (state.control.entryPaused) reasons.push('STOP blocks new entries');
  if (state.riskHalt.active) reasons.push('Persistent risk halt blocks entries');
  if (!account.valuationComplete) reasons.push('Incomplete portfolio valuation blocks entries');
  for (const [productId] of Object.entries(account.positions)) {
    const mark = state.marketByProduct[productId];
    if (!mark || mark.provenance !== 'synthetic' || !Number.isSafeInteger(mark.bookSourceAt) || now - mark.bookSourceAt > config.maxSnapshotAgeMs || mark.bookSourceAt > now) reasons.push(`Missing or stale independent book mark for ${productId}`);
  }
  if (account.positions[proposal.productId]) reasons.push('Position already held; adding exposure is disabled');
  reasons.push(...screenMarket(snapshot, config).reasons);
  const notional = proposal.quantity * proposal.expectedPrice;
  const cappedNotional = notional * (1 + config.maxSlippageBps / 10000);
  const reservedCash = cappedNotional * (1 + config.feeBps / 10000);
  if (!Number.isFinite(notional) || notional > config.maxOrderNotional + EPSILON) reasons.push('Order size limit exceeded');
  if (reservedCash > account.cash - state.reservations.buyCash + ownReservation + EPSILON) reasons.push('Insufficient unreserved cash including fees and price cap');
  if (cappedNotional > config.maxPositionNotional + EPSILON) reasons.push('Position exposure limit exceeded');
  const heldExposure = Object.values(account.positions).reduce((sum, position) => sum + position.quantity * (position.markPrice ?? 0), 0);
  const otherPendingExposure = (state.reservations.buyCash - ownReservation) / (1 + config.feeBps / 10000);
  if (heldExposure + otherPendingExposure + cappedNotional > account.equity * config.maxExposurePct / 100 + EPSILON) reasons.push('Held and reserved exposure exceeds total limit');
  if (account.drawdownPct !== null && account.drawdownPct >= config.maxDrawdownPct) reasons.push('Drawdown limit reached');
  if (account.equity !== null && account.equity - account.initialCash <= -config.maxLossUsd) reasons.push('Net loss limit reached');
  if (!Number.isFinite(proposal.stopPrice) || proposal.stopPrice <= 0 || proposal.stopPrice >= proposal.expectedPrice || !Number.isFinite(proposal.targetPrice) || proposal.targetPrice <= proposal.expectedPrice) reasons.push('Invalid immutable protective geometry');
  return reasons;
}

export function assessAdmission(state, proposal, snapshot, book, { now, knownDuplicate, knownBookConsumed }) {
  const audited = auditState(state);
  if (!audited.ok) return { ok: false, reasons: [`State audit failed: ${audited.errors.join('; ')}`] };
  const reasons = sourceChecks(state, snapshot, book, now);
  if (reasons.length) return { ok: false, reasons };
  if (state.schemaVersion !== 3 || !proposal || !['BUY', 'SELL'].includes(proposal.side)) return { ok: false, reasons: [...reasons, 'Causal schema and supported proposal required'] };
  if (!Number.isSafeInteger(now + state.config.maxSignalAgeMs)) reasons.push('Order deadline exceeds the supported clock range');
  if (proposal.controlVersion !== state.control.version) reasons.push('Prepared admission proposal was invalidated by an entry control transition');
  if (knownDuplicate === true || state.seenEvents.includes(snapshot.eventId) || state.ledger.some(fill => fill.eventId === snapshot.eventId)) reasons.push('Decision event already consumed');
  if (state.checkpoint.totalEventCount > 0 && knownDuplicate !== false) reasons.push('Archive event lookup is required for admission after compaction');
  if (knownBookConsumed === true || state.consumedBooks[snapshot.productId] && compareBookProgress(state.consumedBooks[snapshot.productId], book).status !== 'new') reasons.push('Decision book capacity was already attempted');
  if (state.checkpoint.totalEventCount > 0 && knownBookConsumed !== false) reasons.push('Archive book lookup is required for admission after compaction');
  if (state.bookHighWaterByProduct[snapshot.productId] && !['same', 'new'].includes(compareBookProgress(state.bookHighWaterByProduct[snapshot.productId], book).status)) reasons.push('Decision book regresses or conflicts with the retained source high-water mark');
  if (proposal.productId !== snapshot.productId || proposal.eventId !== snapshot.eventId || proposal.sourceAt !== snapshot.sourceAt || proposal.createdAt !== now) reasons.push('Proposal does not match decision observation');
  if (state.pendingOrders[proposal.productId]) reasons.push('Product already owns a pending order');
  if (!Number.isFinite(proposal.quantity) || proposal.quantity <= 0 || !Number.isFinite(proposal.expectedPrice) || proposal.expectedPrice <= 0) reasons.push('Invalid intent quantity or price');
  if (!close(proposal.expectedPrice, proposal.side === 'BUY' ? snapshot.asks[0][0] : snapshot.bids[0][0])) reasons.push('Intent benchmark does not match decision book');
  if (proposal.side === 'BUY') {
    if (Object.values(state.pendingOrders).some(order => order.side === 'BUY')) reasons.push('One global pending buy is already reserved');
    if (Object.keys(state.exitObligations).length) reasons.push('Latched protective exits have priority over new entries');
    reasons.push(...buyLimits(state, proposal, snapshot, now));
  } else {
    const held = state.account.positions[proposal.productId];
    if (!held || proposal.quantity > held.quantity + EPSILON || state.reservations.sellQuantityByProduct[proposal.productId]) reasons.push('Exit exceeds unreserved held quantity');
    const latched = state.exitObligations[proposal.productId];
    if (proposal.reason === 'protective-stop') {
      if (!latched || latched.positionGeneration !== held?.positionGeneration) reasons.push('Protective stop obligation is not latched for this holding');
    } else if (proposal.reason !== 'take-profit' || snapshot.bids[0][0] < held?.targetPrice) reasons.push('Take-profit trigger is absent');
  }
  return { ok: reasons.length === 0, reasons };
}

export function assessArrival(state, order, snapshot, book, { now, knownDuplicate, knownBookConsumed }) {
  const audited = auditState(state);
  if (!audited.ok) return { ok: false, reasons: [`State audit failed: ${audited.errors.join('; ')}`] };
  const reasons = sourceChecks(state, snapshot, book, now);
  if (reasons.length) return { ok: false, reasons };
  if (state.schemaVersion !== 3 || !order || !isDeepStrictEqual(state.pendingOrders[order.productId], order)) return { ok: false, reasons: [...reasons, 'Pending order or reservation owner does not match durable state'] };
  if (knownDuplicate === true || state.seenEvents.includes(snapshot.eventId)) reasons.push('Arrival event is already consumed');
  if (state.checkpoint.totalEventCount > 0 && knownDuplicate !== false) reasons.push('Archive event lookup is required after compaction');
  if (knownBookConsumed === true) reasons.push('Book capacity already consumed in the archive');
  if (state.checkpoint.totalEventCount > 0 && knownBookConsumed !== false) reasons.push('Archive book lookup is required after compaction');
  if (snapshot.productId !== order.productId || snapshot.base !== order.base || snapshot.quote !== order.quote || snapshot.source !== order.source || snapshot.provenance !== order.provenance) reasons.push('Arrival market identity differs from immutable intent');
  if (snapshot.eventId === order.decisionEventId || compareBookProgress(order.decisionBook, book).status !== 'new') reasons.push('Decision book cannot execute its own delayed intent');
  if (now < order.eligibleAt || book.sourceAt < order.eligibleAt || now >= order.expiresAt) reasons.push('Arrival is pre-eligible or outside the fixed lifetime');
  const consumed = state.consumedBooks[order.productId];
  if (consumed && compareBookProgress(consumed, book).status !== 'new') reasons.push('This book capacity was already attempted');
  if (order.side === 'BUY') {
    if (order.entryVersion !== state.control.version) reasons.push('Entry generation changed after admission');
    if (!close(state.reservations.buyCash, order.reservedCash)) reasons.push('Buy reservation no longer belongs exclusively to this order');
    reasons.push(...buyLimits(state, order, snapshot, now, order.reservedCash));
    const ask = snapshot.asks[0][0] * (1 + state.config.slippageBps / 10000);
    if (ask > order.expectedPrice * (1 + state.config.maxSlippageBps / 10000) + EPSILON) reasons.push('Arrival ask exceeds the immutable entry cap');
    if (ask <= order.stopPrice || ask >= order.targetPrice) reasons.push('Arrival price invalidates original stop/target geometry');
  } else {
    const held = state.account.positions[order.productId];
    if (order.exitPolicyVersion !== state.exitPolicyVersion) reasons.push('Protective exit policy generation changed');
    if (!held || held.positionGeneration !== order.positionGeneration || order.quantity > held.quantity + EPSILON || !close(state.reservations.sellQuantityByProduct[order.productId], order.reservedQuantity)) reasons.push('Held-position generation or sell reservation changed');
    if (order.reason === 'protective-stop') {
      if (state.exitObligations[order.productId]?.positionGeneration !== order.positionGeneration) reasons.push('Latched protective obligation is absent');
    } else if (order.reason !== 'take-profit' || snapshot.bids[0][0] * (1 - state.config.slippageBps / 10000) < order.targetPrice) reasons.push('Arrival no longer satisfies immutable take-profit minimum');
  }
  return { ok: reasons.length === 0, reasons };
}
