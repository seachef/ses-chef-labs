// The only public input boundary. Raw transport evidence is re-normalized on admission
// AND recovery. Hashes establish consistency, not exchange/source authentication.
import { normalizeKrakenAssetPairs, FEED_ENDPOINTS } from './feed-normalizers.mjs';
import { bridgeDepth } from './bridge.mjs';
import { fingerprint } from './core/core.mjs';
const insist = (ok, code) => { if (!ok) throw new Error(code); };
const exact = (value, fields) => value && Object.keys(value).sort().join() === fields.split(',').sort().join();
export const MAX_RAW_BYTES = 32_768;
function context(kind, item, sessionId) {
  insist(exact(item, 'rawText,url,method,httpStatus,httpDate,requestStartedAtMs,receivedAtMs'), 'INVALID_PUBLIC_TRANSPORT_FIELDS');
  insist(item.url === FEED_ENDPOINTS[kind] && item.method === 'GET' && item.httpStatus === 200, 'PUBLIC_ENDPOINT_MISMATCH');
  insist(typeof item.rawText === 'string', 'RAW_RESPONSE_REQUIRED');
  return { url: item.url, method: item.method, httpStatus: item.httpStatus,
    ...(item.httpDate === null ? {} : { httpDate: item.httpDate }),
    requestStartedAtMs: item.requestStartedAtMs, receivedAtMs: item.receivedAtMs,
    nowMs: item.receivedAtMs, transport: 'rest', continuityIntent: 'independent_snapshot',
    sessionId, localObservationCounter: 1 };
}
export function certifyPublicResponse(evidence, now) {
  insist(exact(evidence, 'schema,pairs,depth,sessionId,localOrdinal') && evidence.schema === 'PUBLIC_REST_PAPER_EVIDENCE_V1', 'RAW_PUBLIC_EVIDENCE_REQUIRED');
  insist(/^[A-Za-z0-9_-]{1,48}$/.test(evidence.sessionId) && Number.isSafeInteger(evidence.localOrdinal) && evidence.localOrdinal > 0 && evidence.localOrdinal <= 1e12, 'INVALID_LOCAL_OBSERVATION_IDENTITY');
  const pairContext = context('pairs', evidence.pairs, evidence.sessionId), depthContext = context('depth', evidence.depth, evidence.sessionId);
  insist(new TextEncoder().encode(evidence.pairs.rawText + evidence.depth.rawText).length <= MAX_RAW_BYTES, 'PUBLIC_EVIDENCE_SIZE_LIMIT');
  insist(Number.isSafeInteger(now) && now >= depthContext.receivedAtMs, 'FUTURE_PUBLIC_RECEIPT');
  const pair = normalizeKrakenAssetPairs(JSON.parse(evidence.pairs.rawText), pairContext);
  const bridged = bridgeDepth(JSON.parse(evidence.depth.rawText), pair, depthContext);
  // Every REST response is independently normalized. This ordinal belongs to the
  // local durable account, not the venue. Core admission checks exact +1 and clocks.
  return { ...structuredClone(bridged.snapshot), localOrdinal: evidence.localOrdinal,
    publicEvidence: structuredClone(evidence) };
}
export function verifyPublicBook(book) {
  const reconstructed = certifyPublicResponse(book.publicEvidence, book.receivedAtMs);
  insist(fingerprint(reconstructed) === fingerprint(book), 'PUBLIC_NORMALIZATION_MISMATCH');
}
