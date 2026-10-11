export const CAUSAL_FIELDS = ['pendingOrders', 'reservations', 'consumedBooks', 'bookHighWaterByProduct',
  'positionGenerationByProduct', 'exitPolicyVersion', 'exitObligations', 'lastOrderTransition', 'totalOrderCount'];

export function initializeCausal(state) {
  Object.assign(state, { pendingOrders: {}, reservations: { buyCash: 0, sellQuantityByProduct: {} },
    consumedBooks: {}, bookHighWaterByProduct: {}, positionGenerationByProduct: {}, exitPolicyVersion: 1,
    exitObligations: {}, lastOrderTransition: null, totalOrderCount: 0 });
  state.account.availableCash = state.account.cash;
}

export function causalAnchor(state) {
  return Object.fromEntries(CAUSAL_FIELDS.map(key => [key, structuredClone(state[key])]));
}

export function refreshReservations(state) {
  const reservations = { buyCash: 0, sellQuantityByProduct: {} };
  for (const order of Object.values(state.pendingOrders)) {
    if (order.side === 'BUY') reservations.buyCash += order.reservedCash;
    else reservations.sellQuantityByProduct[order.productId] = order.reservedQuantity;
  }
  state.reservations = reservations;
  state.account.availableCash = state.account.cash - reservations.buyCash;
}

export function terminalOrder(state, order, status, lifecycleReason, now, arrival = null) {
  if (state.pendingOrders[order.productId]?.id !== order.id) throw new Error('Order reservation ownership mismatch');
  delete state.pendingOrders[order.productId];
  state.lastOrderTransition = { ...structuredClone(order), status, lifecycleReason: lifecycleReason.slice(0, 4096), at: now,
    arrivalEventId: arrival?.eventId ?? null, arrivalBook: arrival?.book ?? null };
  refreshReservations(state);
}

export function expireOrders(state, now, endOfInput = false) {
  const terminated = new Set();
  for (const order of Object.values(state.pendingOrders)) {
    if (endOfInput || now >= order.expiresAt) {
      terminalOrder(state, order, endOfInput ? 'CANCELED' : 'EXPIRED', endOfInput ? 'End of synthetic input; no invented fill' : 'Order lifetime expired without an eligible execution', now);
      terminated.add(order.productId);
    }
  }
  return terminated;
}
import { createHash } from 'node:crypto';

export const ORDER_INTENT_FIELDS = ['id', 'sequence', 'productId', 'base', 'quote', 'source', 'provenance',
  'side', 'quantity', 'expectedPrice', 'stopPrice', 'targetPrice', 'reason', 'decisionEventId', 'decisionSourceAt',
  'decisionAt', 'eligibleAt', 'expiresAt', 'decisionBook', 'entryVersion', 'exitPolicyVersion',
  'positionGeneration', 'reservedCash', 'reservedQuantity'];
export function orderIntentHash(order) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(ORDER_INTENT_FIELDS.map(key => [key, order[key]])))).digest('hex');
}
