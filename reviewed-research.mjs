// Controlled public research snapshots, not live execution prices or account data.
import { destinationFor } from './exchange-destinations.mjs';
export const RESEARCH_PATHS = Object.freeze(['/research-setups.json', '/research-reviews.json']);
export const RESEARCH_MAX_BYTES = 65536;
export const SOURCE_MAX_AGE_MS = 300000; // Research snapshot ceiling; owner checks current venue price.
const FEE_MAX_AGE_MS = 86400000;
const fail = () => { throw new Error('INVALID_REVIEWED_RESEARCH'); };
const must = x => { if (!x) fail(); };
const exact = (x, names) => { must(x && Object.getPrototypeOf(x) === Object.prototype); const keys = Reflect.ownKeys(x); must(keys.every(k => typeof k === 'string' && Object.getOwnPropertyDescriptor(x, k)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), 'value'))); must(JSON.stringify(keys.sort()) === JSON.stringify(names.split(' ').sort())); };
const text = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(x);
const clock = x => Number.isSafeInteger(x) && x > 0;
const positive = x => Number.isFinite(x) && x > 0 && x <= 1e12;
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x) && !/^0+$/.test(x);
const list = (x, max) => {
  must(Array.isArray(x) && Object.getPrototypeOf(x) === Array.prototype && x.length <= max);
  const keys = Reflect.ownKeys(x);
  must(keys.length === x.length + 1 && keys.every(k => k === 'length' || typeof k === 'string' && /^(0|[1-9][0-9]*)$/.test(k) && Number(k) < x.length && Object.getOwnPropertyDescriptor(x, k)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), 'value')));
};
export function canonicalResearch(x) {
  if (Array.isArray(x)) return '[' + x.map(canonicalResearch).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonicalResearch(x[k])).join(',') + '}';
  must(x === null || ['string', 'boolean'].includes(typeof x) || typeof x === 'number' && Number.isFinite(x));
  return JSON.stringify(x);
}
export async function researchDigest(value) {
  const bytes = new TextEncoder().encode(canonicalResearch(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function identity(x, s) { must(x.venue === s.venue && x.pair === s.pair && x.quoteCurrency === s.quoteCurrency && x.product === 'spot'); }
function checkRecord(s) {
  exact(s, 'id venue pair quoteCurrency entry stop targets expiresAt market fees costs');
  must(text(s.id) && destinationFor(s.venue, s.pair) && s.quoteCurrency === s.pair.split('-')[1]);
  list(s.targets, 5);
  must(positive(s.entry) && positive(s.stop) && s.stop < s.entry && s.targets.length > 0);
  let previous = s.entry; for (const target of s.targets) { must(positive(target) && target > previous); previous = target; }
  const m = s.market, f = s.fees, c = s.costs;
  exact(m, 'venue pair quoteCurrency product sourceUrl sourceAt receivedAt bid ask askDepthQuantity captureSha256'); identity(m, s);
  must(m.sourceUrl === destinationFor(s.venue, s.pair).url && clock(m.sourceAt) && clock(m.receivedAt) && m.sourceAt <= m.receivedAt);
  must(positive(m.bid) && positive(m.ask) && m.bid <= m.ask && s.entry === m.ask && positive(m.askDepthQuantity) && sha(m.captureSha256));
  exact(f, 'venue pair quoteCurrency product sourceUrl checkedAt expiresAt basis orderType buyBps sellBps captureSha256'); identity(f, s);
  must(clock(f.checkedAt) && clock(f.expiresAt) && f.expiresAt > f.checkedAt && f.expiresAt - f.checkedAt <= FEE_MAX_AGE_MS && sha(f.captureSha256));
  must(f.orderType === 'market' && [f.buyBps, f.sellBps].every(x => Number.isFinite(x) && x >= 0 && x < 1000));
  if (s.venue === 'coinspot') must(f.sourceUrl === 'https://www.coinspot.com.au/markets' && f.basis === 'coinspot-markets' && f.buyBps === 10 && f.sellBps === 10);
  else must(f.sourceUrl === destinationFor(s.venue, s.pair).url && f.basis === 'okx-personal-pair-confirmed');
  exact(c, 'model quantity slippageBps');
  must(c.model === 'market-both-sides-adverse-v1' && positive(c.quantity) && c.quantity <= m.askDepthQuantity && Number.isFinite(c.slippageBps) && c.slippageBps >= 0 && c.slippageBps <= 500);
  must(clock(s.expiresAt) && s.expiresAt > m.receivedAt && s.expiresAt <= m.sourceAt + SOURCE_MAX_AGE_MS && s.expiresAt <= f.expiresAt);
  const buy = s.entry * (1 + c.slippageBps / 10000) * (1 + f.buyBps / 10000);
  const proceeds = price => price * (1 - c.slippageBps / 10000) * (1 - f.sellBps / 10000);
  must(Number.isFinite(buy * c.quantity) && proceeds(s.targets[0]) > buy && proceeds(s.stop) < buy);
  return Object.freeze({ buyCost: buy * c.quantity, targetNet: (proceeds(s.targets[0]) - buy) * c.quantity,
    stopNet: (proceeds(s.stop) - buy) * c.quantity, spreadBps: (m.ask - m.bid) / ((m.ask + m.bid) / 2) * 10000 });
}
function current(s, a, now) {
  return clock(now) && [s.market.sourceAt, s.market.receivedAt, s.fees.checkedAt, a.reviewedAt].every(at => at <= now)
    && now - s.market.sourceAt <= SOURCE_MAX_AGE_MS && now - s.market.receivedAt <= SOURCE_MAX_AGE_MS
    && now < s.expiresAt && now < a.expiresAt && now < s.fees.expiresAt;
}
export async function validateResearch(feed, manifest, { now } = {}) {
  // JSON input only: reject unknown/private fields before cloning or hashing.
  exact(feed, 'schemaVersion contract revision setups'); exact(manifest, 'schemaVersion contract revision approvals');
  must(feed.schemaVersion === 1 && manifest.schemaVersion === 1 && feed.contract === 'public-spot-research-v1' && manifest.contract === 'exact-research-review-v1');
  must(text(feed.revision) && feed.revision === manifest.revision && clock(now));
  list(feed.setups, 8); list(manifest.approvals, 8);
  must(manifest.approvals.length === feed.setups.length);
  const ids = new Set(), tuples = new Set(), approvals = new Map();
  for (const a of manifest.approvals) {
    exact(a, 'setupId setupDigest marketDigest feeDigest reviewerId decision reviewedAt expiresAt');
    must(text(a.setupId) && text(a.reviewerId) && a.decision === 'approved' && clock(a.reviewedAt) && clock(a.expiresAt) && a.reviewedAt < a.expiresAt);
    must([a.setupDigest, a.marketDigest, a.feeDigest].every(sha) && !approvals.has(a.setupId)); approvals.set(a.setupId, a);
  }
  const accepted = [], revision = feed.revision;
  for (const s of feed.setups) {
    const economics = checkRecord(s), key = s.venue + ':' + s.pair;
    must(!ids.has(s.id) && !tuples.has(key)); ids.add(s.id); tuples.add(key);
    const a = approvals.get(s.id); must(a && a.reviewedAt >= s.market.receivedAt && a.reviewedAt >= s.fees.checkedAt && a.expiresAt <= s.expiresAt);
    must([s.market.sourceAt, s.market.receivedAt, s.fees.checkedAt, a.reviewedAt].every(at => at <= now));
    // Snapshot every descriptor-checked record before the first async boundary.
    accepted.push({ s: JSON.parse(JSON.stringify(s)), a: JSON.parse(JSON.stringify(a)), economics });
  }
  for (const { s, a } of accepted) {
    const [recordHash, marketHash, feeHash] = await Promise.all([researchDigest(s), researchDigest(s.market), researchDigest(s.fees)]);
    must(recordHash === a.setupDigest && marketHash === a.marketDigest && feeHash === a.feeDigest);
    // The separately controlled review attests source capture inspection and
    // fact extraction. The browser hashes ALL normalized public evidence and
    // validates its identity/semantics; it does not independently prove remote
    // capture truth or an owner's fee tier from a URL/capture-hash string.
  }
  let lastClock = now, invalidClock = false;
  return Object.freeze({ revision, evaluate(venue, pair, at) {
    if (!clock(at) || at < lastClock) invalidClock = true; else lastClock = at;
    const row = accepted.find(x => x.s.venue === venue && x.s.pair === pair);
    if (invalidClock) return { status: 'WAIT', reason: 'Research clock changed; reload reviewed research.', setup: null };
    if (!row) return { status: 'WAIT', reason: 'No reviewed setup for this venue and pair.', setup: null };
    if (!current(row.s, row.a, at)) return { status: 'WAIT', reason: 'Reviewed research expired or has invalid timing.', setup: null };
    return { status: 'READY', reason: 'Reviewed research snapshot; confirm current price and fees on the exchange.',
      setup: JSON.parse(JSON.stringify(row.s)), review: JSON.parse(JSON.stringify(row.a)), economics: { ...row.economics } };
  } });
}
export function createResearchSession({ origin, fetchImpl = globalThis.fetch, now = Date.now, onChange = () => {}, timeoutMs = 5000 } = {}) {
  let approved = null, phase = 'idle', generation = 0, controller = null, destroyed = false, lastError = null;
  let validOrigin = false;
  try { validOrigin = typeof origin === 'string' && /^https:\/\/[^/?#@]+$/.test(origin) && new URL(origin).origin === origin; } catch { /* Fail closed before any request. */ }
  const evaluate = (venue, pair, at = now()) => approved?.evaluate(venue, pair, at) ?? { status: 'WAIT', setup: null,
    reason: phase === 'loading' ? 'Loading reviewed research…' : lastError ?? 'No reviewed research loaded.' };
  async function read(url, signal) {
    const r = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
    if (!r.ok || r.redirected || r.url && r.url !== url || !/^application\/json(?:;|$)/i.test(r.headers.get('content-type') ?? '')) throw Error('Research response unavailable.');
    const declared = Number(r.headers.get('content-length'));
    if (declared > RESEARCH_MAX_BYTES) throw Error('Research response too large.');
    const reader = r.body.getReader(), chunks = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > RESEARCH_MAX_BYTES) throw Error('Research response too large.'); chunks.push(value); } }
    finally { if (size > RESEARCH_MAX_BYTES) void reader.cancel(); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  async function refresh() {
    if (destroyed || phase === 'loading') return false;
    approved = null; lastError = null; phase = 'loading'; const token = ++generation; controller = new AbortController(); onChange();
    let timer;
    try {
      if (!validOrigin) throw Error('Reviewed research connection unavailable.');
      const currentController = controller, signal = currentController.signal;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { currentController.abort(); reject(Error('Reviewed research timed out.')); }, timeoutMs); });
      const work = (async () => { const [feed, manifest] = await Promise.all(RESEARCH_PATHS.map(p => read(origin + p, signal))); return validateResearch(feed, manifest, { now: now() }); })();
      const candidate = await Promise.race([work, deadline]);
      if (destroyed || token !== generation || signal.aborted) return false;
      approved = candidate; phase = 'loaded';
    } catch { if (!destroyed && token === generation) { approved = null; phase = 'failed'; lastError = 'Reviewed research unavailable or invalid; WAIT.'; controller?.abort(); } }
    finally { clearTimeout(timer); if (!destroyed && token === generation) onChange(); }
    return phase === 'loaded';
  }
  function cancel() { ++generation; controller?.abort(); approved = null; phase = 'unavailable'; lastError = 'Reload reviewed research after returning to this page.'; if (!destroyed) onChange(); }
  return { evaluate, refresh, cancel, getState: () => Object.freeze({ phase }), destroy() { destroyed = true; cancel(); } };
}
