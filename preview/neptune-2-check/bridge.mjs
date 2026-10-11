// Pure bridge: full Kraken depth response -> explicitly LOCAL snapshot contract.
// Does not start an engine, create a signal, route an order, read FX, or perform I/O.
import { normalizeKrakenDepth } from './feed-normalizers.mjs';
import { INSTRUMENT, LIMITS, fingerprint } from './core/core.mjs';
const check = (ok, code) => { if (!ok) throw new Error(code); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export function decimalToMicros(text, rounding) {
  check(['down', 'up'].includes(rounding), 'INVALID_ROUNDING_POLICY');
  check(typeof text === 'string' && /^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(text), 'INVALID_DECIMAL');
  const [whole, fraction = ''] = text.split('.');
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
  const rounded = scaled + (rounding === 'up' && /[1-9]/.test(fraction.slice(6)) ? 1n : 0n);
  check(rounded > 0n && rounded <= 1_000_000_000_000n, 'UNREPRESENTABLE_MICRO_VALUE');
  return Number(rounded);
}
export function bridgeDepth(payload, pair, context) {
  const observation = normalizeKrakenDepth(payload, pair, context);
  const o = observation.observation, bid = observation.bids[0], ask = observation.asks[0];
  check(/^[A-Za-z0-9_-]{1,48}$/.test(o.sessionId), 'INVALID_CORE_SESSION');
  check(o.localCounter <= 1_000_000_000_000, 'INVALID_CORE_ORDINAL');
  check(context.nowMs - o.requestStartedAtMs <= LIMITS.quoteAgeMs, 'LOCAL_SNAPSHOT_TTL_EXPIRED');
  check(observation.snapshotTimestamp === null && observation.continuity.exchangeSequence === null, 'UNEXPECTED_SOURCE_CONTRACT');
  const snapshot = {
    synthetic: false, bookType: 'independent-rest-depth', instrument: { ...INSTRUMENT },
    sessionId: o.sessionId, localOrdinal: o.localCounter,
    requestStartedAtMs: o.requestStartedAtMs, receivedAtMs: o.receivedAtMs,
    exchangeSequence: null, sourceEventAtMs: null,
    bidMicros: decimalToMicros(bid.priceUsd, 'down'), askMicros: decimalToMicros(ask.priceUsd, 'up'),
    bidDepthMicroEth: decimalToMicros(bid.quantityEth, 'down'), askDepthMicroEth: decimalToMicros(ask.quantityEth, 'down'),
    bidUpdatedAtMs: bid.levelUpdatedAtMs, askUpdatedAtMs: ask.levelUpdatedAtMs,
    sourceDigest: fingerprint(observation),
  };
  check(snapshot.bidMicros < snapshot.askMicros, 'NON_POSITIVE_ROUNDED_SPREAD');
  return freeze({ snapshot, observation,
    policy: { localExpiryAtMs: o.requestStartedAtMs + LIMITS.quoteAgeMs,
      chronology: 'LOCAL_REQUEST_AND_RECEIPT_ONLY', continuity: 'UNPROVEN',
      sourceSnapshotFreshness: 'UNKNOWN', execution: 'PUBLIC_OBSERVATION_ONLY',
      rounding: 'bid-down-ask-up-depth-down', accountingCurrency: 'USD', audConversion: null } });
}
