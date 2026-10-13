import { screenMarket } from './market.mjs';

export const STRATEGY_VERSION = 'observed-window-low-v1';

export function proposeTrade(state, snapshot, { now }) {
  const position = state.account.positions[snapshot.productId];
  const market = screenMarket(snapshot, state.config);
  const base = { eventId: snapshot.eventId, productId: snapshot.productId, createdAt: now,
    sourceAt: snapshot.sourceAt, controlVersion: state.control.version, strategyVersion: STRATEGY_VERSION };
  if (position) {
    if (market.bid <= position.stopPrice || market.bid >= position.targetPrice) {
      return { action: 'SELL', reason: market.bid <= position.stopPrice ? 'Protective stop reached on observed bid' : 'Target reached on observed bid',
        proposal: { ...base, side: 'SELL', quantity: position.quantity, expectedPrice: market.bid,
          stopPrice: position.stopPrice, targetPrice: position.targetPrice, reason: market.bid <= position.stopPrice ? 'protective-stop' : 'take-profit' } };
    }
    return { action: 'WAIT', reason: 'Position open; observed bid has reached neither protective stop nor target', proposal: null };
  }
  if (state.control.emergencyStop) return { action: 'WAIT', reason: 'STOP is active: new entries disabled; fresh synthetic protective exits remain eligible', proposal: null };
  if (!market.ok) return { action: 'REJECT', reason: market.reasons.join('; '), proposal: null };
  const h = snapshot.history;
  if (!h || h.samples < state.config.minHistorySamples || h.to - h.from < state.config.minHistoryWindowMs || snapshot.sourceAt - h.to > state.config.maxSnapshotAgeMs) {
    return { action: 'WAIT', reason: 'Insufficient recent stated history coverage for the deterministic entry rule', proposal: null };
  }
  if (market.distanceFromLowPct < 0 || market.distanceFromLowPct > state.config.buyDistanceFromLowPct) {
    return { action: 'WAIT', reason: `Ask is ${market.distanceFromLowPct.toFixed(3)}% from the reported window low; entry band is 0–${state.config.buyDistanceFromLowPct}%`, proposal: null };
  }
  return { action: 'BUY', reason: `Ask lies within ${state.config.buyDistanceFromLowPct}% of the explicitly reported ${h.samples}-sample window low; this is not an all-time low`,
    proposal: { ...base, side: 'BUY', quantity: state.config.maxOrderNotional / market.ask, expectedPrice: market.ask,
      stopPrice: market.ask * (1 - state.config.stopLossPct / 100), targetPrice: market.ask * (1 + state.config.takeProfitPct / 100), reason: 'observed-window-low' } };
}
