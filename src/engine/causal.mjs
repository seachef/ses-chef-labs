import { SUPPORTED_PRODUCTS } from './config.mjs';
import { retainSnapshot, validateSnapshot } from './market.mjs';
import { proposeTrade } from './strategy.mjs';
import { normalizeBookIdentity, compareBookProgress, tradeIdentity } from '../book-identity.mjs';
import { assessAdmission } from './causal-risk.mjs';
import { executePending } from './causal-execution.mjs';
import { expireOrders, orderIntentHash, refreshReservations, terminalOrder } from './causal-state.mjs';

export function advanceCausal(previous, { now, endOfInput = false } = {}, helpers) {
  helpers.requireAudit(previous); helpers.clock(now, previous.asOf);
  if (typeof endOfInput !== 'boolean') throw new Error('End-of-input flag must be boolean');
  const state = structuredClone(previous); state.asOf = now;
  helpers.markAccount(state, now);
  const ended = expireOrders(state, now, endOfInput);
  state.decision = { action: 'WAIT', reason: endOfInput ? 'Synthetic input ended; pending orders canceled, held positions remain exposed' : 'Synthetic clock advanced without manufacturing market data', at: now, productId: null, proposal: null };
  state.execution = { status: ended.size ? 'canceled' : Object.keys(state.pendingOrders).length ? 'pending' : 'idle', reason: ended.size ? state.lastOrderTransition.lifecycleReason : state.decision.reason, at: now };
  refreshReservations(state); helpers.requireAudit(state); return state;
}

export function cancelEntryOrders(state, now) {
  expireOrders(state, now);
  for (const order of Object.values(state.pendingOrders)) if (order.side === 'BUY') terminalOrder(state, order, 'CANCELED', 'Operator STOP canceled entry and released its reservation', now);
}

function admit(state, proposal, snapshot, book, now, options) {
  const checked = assessAdmission(state, proposal, snapshot, book, { ...options, now });
  if (!checked.ok) return { order: null, reason: checked.reasons.join('; ') };
  const sequence = state.totalOrderCount + 1;
  const order = {
    id: `order:${snapshot.productId}:${snapshot.eventId}:${state.control.version}:${sequence}`, sequence,
    productId: snapshot.productId, base: snapshot.base, quote: snapshot.quote, source: snapshot.source, provenance: snapshot.provenance,
    side: proposal.side, quantity: proposal.quantity, expectedPrice: proposal.expectedPrice, stopPrice: proposal.stopPrice,
    targetPrice: proposal.targetPrice, reason: proposal.reason, decisionEventId: snapshot.eventId, decisionSourceAt: snapshot.sourceAt,
    decisionAt: now, eligibleAt: now + state.config.latencyMs, expiresAt: now + state.config.maxSignalAgeMs,
    decisionBook: structuredClone(book), entryVersion: state.control.version, exitPolicyVersion: state.exitPolicyVersion,
    positionGeneration: state.account.positions[snapshot.productId]?.positionGeneration ?? 0,
    reservedCash: proposal.side === 'BUY' ? proposal.quantity * proposal.expectedPrice * (1 + state.config.maxSlippageBps / 10000) * (1 + state.config.feeBps / 10000) : 0,
    reservedQuantity: proposal.side === 'SELL' ? proposal.quantity : 0, status: 'PENDING',
  };
  order.intentDigest = orderIntentHash(order);
  state.totalOrderCount = sequence;
  state.pendingOrders[order.productId] = order;
  state.lastOrderTransition = { ...structuredClone(order), lifecycleReason: 'Admitted and reserved; awaiting a distinct eligible later book', at: now, arrivalEventId: null, arrivalBook: null };
  refreshReservations(state);
  return { order, reason: state.lastOrderTransition.lifecycleReason };
}

export function stepCausal(previous, snapshot, options, helpers) {
  const { now, knownDuplicate, knownBookConsumed, knownTradeDuplicate, archivedBook, durableArchive = false } = options;
  helpers.requireAudit(previous); helpers.clock(now, previous.asOf);
  let state = structuredClone(previous); state.asOf = now;
  helpers.markAccount(state, now);
  const terminated = expireOrders(state, now);
  const productId = typeof snapshot?.productId === 'string' && Object.hasOwn(SUPPORTED_PRODUCTS, snapshot.productId) ? snapshot.productId : null;
  const reject = (reason, cancelInvalidArrival = false) => {
    const pending = productId && state.pendingOrders[productId];
    if (cancelInvalidArrival && pending && now >= pending.eligibleAt) terminalOrder(state, pending, 'CANCELED', `Invalid arrival input: ${reason}`, now);
    state.decision = { action: 'REJECT', reason, at: now, productId };
    state.execution = { status: 'blocked', reason, at: now };
    state.engine = { ...state.engine, status: 'blocked', lastError: reason };
    refreshReservations(state); helpers.requireAudit(state); return state;
  };
  const validation = validateSnapshot(snapshot, { now, config: state.config });
  if (!validation.ok) return reject(validation.errors.join('; '), true);
  if (knownDuplicate === true || state.seenEvents.includes(snapshot.eventId)) return reject('Duplicate source event; pending intent and cash cannot execute twice');
  if (state.checkpoint.totalEventCount > 0 && knownDuplicate !== false) return reject('Durable archive event lookup is required after compaction');
  let book;
  try { book = normalizeBookIdentity(snapshot, { requireExplicit: true }); tradeIdentity(snapshot); }
  catch (error) { return reject(error.message, true); }
  if (book.sourceAt > snapshot.observedAt || book.sourceAt > now || now - book.sourceAt > state.config.maxSnapshotAgeMs) return reject('Book source time is future or stale independently of ticker receipt', true);
  let progress;
  try {
    progress = compareBookProgress(state.bookHighWaterByProduct[productId], book);
    if (archivedBook && compareBookProgress(archivedBook, book).status === 'conflict') return reject('Archived book identity was relabelled or its depth/time was changed', true);
  } catch (error) { return reject(error.message, true); }
  if (progress.status === 'conflict') return reject(progress.reason, true);
  if (progress.status === 'regression') return reject(progress.reason);
  if (state.seenEvents.length >= state.config.maxEvents) {
    if (durableArchive !== true || knownDuplicate !== false || knownBookConsumed !== false && knownBookConsumed !== true) return reject('Active event capacity requires durable event and book archive checks');
    state = helpers.compactState(state, { durableArchive: true });
  }
  const newBook = progress.status === 'new';
  if (newBook) {
    state.bookHighWaterByProduct[productId] = structuredClone(book);
    state.marketByProduct[productId] = retainSnapshot(snapshot, { includeBookIdentity: true });
    helpers.markAccount(state, now);
  }
  let reason = newBook ? 'New source book received' : 'Cached or older book grants no additional executable capacity';
  state.execution = { status: 'idle', reason, at: now };
  state.decision = { action: 'WAIT', reason, at: now, productId, proposal: null };
  const held = state.account.positions[productId];
  if (newBook && snapshot.provenance === 'synthetic' && held && snapshot.bids[0][0] <= held.stopPrice && !state.exitObligations[productId]) {
    state.exitObligations[productId] = { reason: 'protective-stop', positionGeneration: held.positionGeneration, triggeredAt: now, triggerEventId: snapshot.eventId };
  }
  const pending = state.pendingOrders[productId];
  if (pending && newBook && now >= pending.eligibleAt && book.sourceAt >= pending.eligibleAt && !terminated.has(productId)) {
    const consumed = state.consumedBooks[productId];
    if (knownBookConsumed === true || consumed && compareBookProgress(consumed, book).status !== 'new') {
      state.execution = { status: 'pending', reason: 'Arrival book capacity was already consumed; original deadline unchanged', at: now };
    } else {
      const result = executePending(state, pending, snapshot, book, options);
      state.consumedBooks[productId] = structuredClone(book);
      if (result.fill) {
        helpers.commitFill(state, result.fill);
        terminalOrder(state, pending, result.fill.status === 'partial' ? 'PARTIAL_AND_CANCELED' : 'FILLED', result.fill.status === 'partial' ? 'IOC partial fill; unfilled remainder and reservation canceled' : 'Filled on first eligible later book', now, { eventId: snapshot.eventId, book });
        if (!state.account.positions[productId]) delete state.exitObligations[productId];
        state.execution = { ...result.fill, at: now, entry: pending.expectedPrice, size: pending.quantity, stop: pending.stopPrice, target: pending.targetPrice };
      } else {
        terminalOrder(state, pending, 'CANCELED', result.rejection, now, { eventId: snapshot.eventId, book });
        state.execution = { status: 'canceled', reason: result.rejection, at: now };
        state.decision = { action: 'REJECT', reason: result.rejection, at: now, productId, proposal: null };
      }
      terminated.add(productId);
    }
  }
  if (!terminated.has(productId) && newBook && !state.pendingOrders[productId] && snapshot.provenance === 'synthetic' && knownBookConsumed !== true) {
    const consumed = state.consumedBooks[productId];
    if (!consumed || compareBookProgress(consumed, book).status === 'new') {
      let outcome = proposeTrade(state, snapshot, { now });
      const position = state.account.positions[productId];
      if (position && state.exitObligations[productId]) outcome = { action: 'SELL', reason: 'Latched protective stop remains due even after a rebound', proposal: {
        eventId: snapshot.eventId, productId, createdAt: now, sourceAt: snapshot.sourceAt, controlVersion: state.control.version,
        side: 'SELL', quantity: position.quantity, expectedPrice: snapshot.bids[0][0], stopPrice: position.stopPrice, targetPrice: position.targetPrice, reason: 'protective-stop',
      } };
      state.decision = { action: outcome.action === 'SELL' ? 'WAIT' : outcome.action, reason: outcome.reason, at: now, productId, proposal: outcome.proposal };
      if (outcome.proposal) {
        const admitted = admit(state, outcome.proposal, snapshot, book, now, options);
        state.execution = admitted.order ? { status: 'pending', orderId: admitted.order.id, side: admitted.order.side, entry: admitted.order.expectedPrice,
          size: admitted.order.quantity, stop: admitted.order.stopPrice, target: admitted.order.targetPrice,
          eligibleAt: admitted.order.eligibleAt, expiresAt: admitted.order.expiresAt, reason: admitted.reason, at: now }
          : { status: 'blocked', reason: admitted.reason, at: now };
        if (!admitted.order) state.decision = { ...state.decision, action: 'REJECT', reason: admitted.reason };
      }
    }
  } else if (state.pendingOrders[productId] && state.execution.status === 'idle') {
    const order = state.pendingOrders[productId];
    state.execution = { status: 'pending', orderId: order.id, side: order.side, eligibleAt: order.eligibleAt, expiresAt: order.expiresAt,
      reason: 'Waiting for a distinct book sourced at or after eligibility; original deadline unchanged', at: now };
  }
  if (snapshot.provenance === 'public' && !terminated.has(productId)) state.decision = { action: 'WAIT', reason: 'Public observations cannot admit or execute synthetic orders', at: now, productId, proposal: null };
  state.seenEvents.push(snapshot.eventId); state.totalEventCount += 1;
  state.lastSourceAtByProduct[productId] = Math.max(snapshot.sourceAt, state.lastSourceAtByProduct[productId] ?? -1);
  state.engine = { ...state.engine, status: 'processed', lastEventAt: now, lastEventId: snapshot.eventId,
    lastTradeDuplicate: knownTradeDuplicate === true, lastError: state.execution.status === 'blocked' || state.execution.status === 'canceled' ? state.execution.reason : null };
  helpers.markAccount(state, now); refreshReservations(state); helpers.requireAudit(state); return state;
}
