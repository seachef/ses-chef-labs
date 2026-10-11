import { FEED_ENDPOINTS } from './feed-normalizers.mjs';
import { MAX_RAW_BYTES, certifyPublicResponse } from './public-boundary.mjs';
export const READ_POLICY = Object.freeze({ timeoutMs: 1200, requestsPerCycle: 2, retries: 0 });
// Public HTTPS GETs only; never credentials, private endpoints, order APIs or FX.
async function get(kind, { fetchImpl, now, signal }) {
  const url = FEED_ENDPOINTS[kind], requestStartedAtMs = now();
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) abort.abort();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(Error('PUBLIC_READ_TIMEOUT')); }, READ_POLICY.timeoutMs); });
  try { return await Promise.race([timeout, (async () => {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: abort.signal });
    if (abort.signal.aborted) throw Error('PUBLIC_READ_INTERRUPTED');
    if (response.url !== url || response.redirected || response.status !== 200) throw Error('PUBLIC_RESPONSE_IDENTITY_OR_STATUS');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error('NON_JSON_RESPONSE');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RAW_BYTES)) throw Error('PUBLIC_EVIDENCE_SIZE_LIMIT');
    if (!response.body) throw Error('MISSING_PUBLIC_RESPONSE_BODY');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let rawText = '', bytes = 0;
    try { while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RAW_BYTES || abort.signal.aborted) { await reader.cancel(); throw Error('PUBLIC_BODY_LIMIT_OR_INTERRUPTED'); }
      rawText += decoder.decode(chunk.value, { stream: true });
    } rawText += decoder.decode(); } finally { reader.releaseLock(); }
    if (abort.signal.aborted) throw Error('PUBLIC_READ_INTERRUPTED');
    return { rawText, url, method: 'GET', httpStatus: response.status,
      httpDate: response.headers.get('date'), requestStartedAtMs, receivedAtMs: now() };
  })()]); } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export async function readPublicEvidence({ sessionId, localOrdinal, fetchImpl = globalThis.fetch, now = Date.now, signal } = {}) {
  const pairs = await get('pairs', { fetchImpl, now, signal });
  // Validate discovery before requesting depth, using the same normalizer.
  const { normalizeKrakenAssetPairs } = await import('./feed-normalizers.mjs');
  normalizeKrakenAssetPairs(JSON.parse(pairs.rawText), { ...pairs, ...(pairs.httpDate === null ? { httpDate: undefined } : {}), nowMs: pairs.receivedAtMs, transport: 'rest', continuityIntent: 'independent_snapshot', sessionId, localObservationCounter: 1 });
  if (signal?.aborted) throw Error('PUBLIC_READ_INTERRUPTED');
  const depth = await get('depth', { fetchImpl, now, signal });
  const evidence = { schema: 'PUBLIC_REST_PAPER_EVIDENCE_V1', pairs, depth, sessionId, localOrdinal };
  certifyPublicResponse(evidence, now()); return evidence;
}
