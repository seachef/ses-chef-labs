import { EPSILON } from './config.mjs';
import { assessRisk } from './risk.mjs';

// Synchronous immediate-or-cancel simulation: a partial remainder is canceled.
// Levels are a point-in-time observation, not a promise of available future liquidity.
export function executePaper(state, proposal, snapshot, { now, knownDuplicate }) {
  const risk = assessRisk(state, proposal, snapshot, { now, knownDuplicate });
  if (!risk.ok) return { fill: null, rejection: risk.reasons.join('; ') };
  const levels = proposal.side === 'BUY' ? snapshot.asks : snapshot.bids;
  const direction = proposal.side === 'BUY' ? 1 : -1;
  const limitPrice = proposal.expectedPrice * (1 + direction * state.config.maxSlippageBps / 10000);
  let quantity = 0, notional = 0;
  const legs = [];
  for (const [observedPrice, available] of levels) {
    const price = observedPrice * (1 + direction * state.config.slippageBps / 10000);
    if (proposal.side === 'BUY' ? price > limitPrice : price < limitPrice) break;
    const taken = Math.min(available, proposal.quantity - quantity);
    if (taken <= EPSILON) break;
    quantity += taken; notional += taken * price; legs.push({ price, observedPrice, quantity: taken });
  }
  if (quantity <= EPSILON) return { fill: null, rejection: 'No observed depth within the explicit slippage limit; order canceled' };
  const fee = notional * state.config.feeBps / 10000;
  return { rejection: null, fill: {
    id: `fill:${snapshot.eventId}`, eventId: snapshot.eventId, productId: proposal.productId,
    side: proposal.side, quantity, requestedQuantity: proposal.quantity, averagePrice: notional / quantity,
    expectedPrice: proposal.expectedPrice, notional, fee,
    slippageCost: direction * (notional - quantity * proposal.expectedPrice),
    status: quantity + EPSILON < proposal.quantity ? 'partial' : 'filled',
    canceledQuantity: Math.max(0, proposal.quantity - quantity), legs,
    sourceAt: snapshot.sourceAt, decidedAt: now, simulatedFillAt: now + state.config.latencyMs,
    stopPrice: proposal.stopPrice, targetPrice: proposal.targetPrice,
    provenance: 'synthetic', assumption: `Zero-latency immediate-or-cancel depth walk plus ${state.config.slippageBps} bps adverse price assumption, within ${state.config.maxSlippageBps} bps total cap; no future liquidity, queue or network latency prediction`,
  } };
}
