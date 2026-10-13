import { EPSILON } from './config.mjs';
import { assessArrival } from './causal-risk.mjs';

export function executePending(state, order, snapshot, book, options) {
  const risk = assessArrival(state, order, snapshot, book, options);
  if (!risk.ok) return { fill: null, rejection: risk.reasons.join('; ') };
  const direction = order.side === 'BUY' ? 1 : -1;
  const levels = order.side === 'BUY' ? snapshot.asks : snapshot.bids;
  const arrivalPrice = levels[0][0];
  const limitPrice = order.side === 'BUY' ? order.expectedPrice * (1 + state.config.maxSlippageBps / 10000)
    : Math.max(order.reason === 'take-profit' ? order.targetPrice : 0, arrivalPrice * (1 - state.config.maxSlippageBps / 10000));
  const legs = [];
  let quantity = 0, notional = 0, observedNotional = 0;
  for (const [observedPrice, available] of levels) {
    const price = observedPrice * (1 + direction * state.config.slippageBps / 10000);
    if (order.side === 'BUY' ? price > limitPrice || price <= order.stopPrice || price >= order.targetPrice : price < limitPrice) break;
    const taken = Math.min(available, order.quantity - quantity);
    if (taken <= EPSILON) break;
    quantity += taken; notional += taken * price; observedNotional += taken * observedPrice;
    legs.push({ price, observedPrice, quantity: taken });
  }
  if (quantity <= EPSILON) return { fill: null, rejection: 'First eligible book has no depth inside immutable limits; IOC canceled' };
  const fee = notional * state.config.feeBps / 10000;
  if (order.side === 'BUY' && notional + fee > order.reservedCash + EPSILON) return { fill: null, rejection: 'Fill would exceed the original reserved cash' };
  const decisionDriftCost = direction * quantity * (arrivalPrice - order.expectedPrice);
  const depthImpactCost = direction * (observedNotional - quantity * arrivalPrice);
  const assumedSlippageCost = direction * (notional - observedNotional);
  return { rejection: null, fill: {
    id: `fill:${order.id}`, orderId: order.id, eventId: snapshot.eventId, decisionEventId: order.decisionEventId,
    arrivalEventId: snapshot.eventId, arrivalObservedAt: snapshot.observedAt, productId: order.productId, side: order.side, quantity,
    requestedQuantity: order.quantity, averagePrice: notional / quantity, expectedPrice: order.expectedPrice,
    arrivalPrice, notional, fee, slippageCost: decisionDriftCost + depthImpactCost + assumedSlippageCost,
    decisionDriftCost, depthImpactCost, assumedSlippageCost,
    status: quantity + EPSILON < order.quantity ? 'partial' : 'filled', canceledQuantity: Math.max(0, order.quantity - quantity), legs,
    sourceAt: snapshot.sourceAt, decidedAt: order.decisionAt, decisionAt: order.decisionAt,
    eligibleAt: order.eligibleAt, expiresAt: order.expiresAt, executedAt: options.now, simulatedFillAt: options.now,
    decisionBook: structuredClone(order.decisionBook), arrivalBook: structuredClone(book),
    stopPrice: order.stopPrice, targetPrice: order.targetPrice, provenance: 'synthetic',
    assumption: `Causal ${state.config.latencyMs} ms assumed latency; first eligible later book, IOC with ${state.config.slippageBps} bps adverse assumption; no guaranteed liquidity`,
  } };
}
