// FABRICATED public-shaped responses for offline tests only. Never real prices.
import { FEED_ENDPOINTS } from '../feed-normalizers.mjs';
import { INSTRUMENT } from '../core/core.mjs';
export const T = Date.parse('2026-10-11T06:00:00Z');
export const registryPayload = () => ({ error: [], result: { XETHZUSD: { altname: 'ETHUSD', wsname: 'ETH/USD', base: 'XETH', quote: 'ZUSD', aclass_base: 'currency', aclass_quote: 'currency', execution_venue: 'international', status: 'online' } } });
export const depthPayload = (bid = 2000, ask = bid + 2, at = T) => ({ error: [], result: { XETHZUSD: { bids: [[String(bid), '10', at / 1000]], asks: [[String(ask), '10', at / 1000]] } } });
export function evidence(ordinal, at = T + ordinal * 100, bid = 2000, ask = bid + 2) {
  const item = (kind, payload, requested, received) => ({ rawText: JSON.stringify(payload), url: FEED_ENDPOINTS[kind], method: 'GET', httpStatus: 200, httpDate: null, requestStartedAtMs: requested, receivedAtMs: received });
  return { schema: 'PUBLIC_REST_PAPER_EVIDENCE_V1', sessionId: 'offline_fixture', localOrdinal: ordinal,
    pairs: item('pairs', registryPayload(), at - 20, at - 10), depth: item('depth', depthPayload(bid, ask, at), at, at + 10) };
}
export const start = (engine, now = T) => engine.start({ id: 'practice', acknowledgement: 'START_ONE_FINITE_PUBLIC_PRICE_PAPER_PRACTICE', now });
export function candidate(book, changes = {}) { return { synthetic: false, id: 'one', setupId: 'OWNER_PRACTICE', entryReason: 'One bounded paper mechanics exercise; no expected edge claimed.', expectedMoveBps: null, instrument: { ...INSTRUMENT }, snapshotOrdinal: book.localOrdinal, snapshotReceivedAtMs: book.receivedAtMs, snapshotAskMicros: book.askMicros, ...changes }; }
