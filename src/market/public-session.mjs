import { createCoinbaseObserver, SUPPORTED_PRODUCTS } from './coinbase.mjs';

export const MIN_REFRESH_MS = 60_000;
export const MAX_BACKOFF_MS = 600_000;
export const MAX_RESPONSE_BYTES = 5_000_000;
export const MAX_ACTIVITY = 20;
const ORIGIN = 'https://api.exchange.coinbase.com';
const aborted = () => new DOMException('Public observation canceled', 'AbortError');
const boundedText = value => String(value ?? 'Public observation failed').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
function sourceTimestamp(value, pathname) {
  if (!/\/(book|ticker)$/.test(pathname) || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? value : null;
}

export function retryAfterTime(value, now) {
  if (!value) return 0;
  const time = /^\d+(?:\.\d+)?$/.test(value.trim()) ? now + Math.ceil(Number(value) * 1000) : Date.parse(value);
  return Number.isSafeInteger(time) && time > now ? time : 0;
}

/** Explicit one-shot reads only. The clock/freshness timer never invokes refresh. */
export function createPublicSession({ fetchImpl = globalThis.fetch, now = Date.now, onChange = () => {}, timeoutMs = 5000 } = {}) {
  let active = null, disposed = false, failures = 0;
  let state = { phase: 'idle', observations: [], errors: [], activity: [], completedAt: null, nextAllowedAt: 0 };
  const emit = () => { if (!disposed) onChange(state); };
  function log(entry) {
    if (disposed) return;
    state = { ...state, activity: [...state.activity, { at: now(), ...entry }].slice(-MAX_ACTIVITY) };
    emit();
  }

  async function refresh() {
    if (disposed || active || now() < state.nextAllowedAt) return false;
    const batch = { controller: new AbortController(), canceled: false, retryAfter: 0 };
    active = batch;
    state = { ...state, phase: 'fetching', observations: [], errors: [] };
    emit();
    const fetchPublic = async (url, options) => {
      const u = new URL(url);
      if (u.origin !== ORIGIN || !/^\/products\/(BTC-USD|ETH-USD)(?:\/(book|ticker|stats|candles))?$/.test(u.pathname) || options.method !== 'GET') throw new Error('Unexpected public request');
      const controller = new AbortController();
      const signals = [batch.controller.signal, options.signal];
      const relay = () => controller.abort();
      for (const signal of signals) signal.addEventListener('abort', relay, { once: true });
      let rejectAbort;
      const abortPromise = new Promise((_, reject) => { rejectAbort = () => reject(aborted()); });
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      try {
        if (signals.some(s => s.aborted)) throw aborted();
        log({ event: 'GET started', path: u.pathname });
        const response = await Promise.race([fetchImpl(url, { ...options, signal: controller.signal, credentials: 'omit', cache: 'no-store' }), abortPromise]);
        if (controller.signal.aborted) throw aborted();
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) batch.retryAfter = Math.max(batch.retryAfter, retryAfterTime(response.headers?.get('retry-after'), now()));
          log({ event: 'HTTP error', path: u.pathname, status: response.status });
          void response.body?.cancel().catch(() => {});
          return { ok: false, status: response.status };
        }
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        try {
          for (;;) {
            const { done, value } = await Promise.race([reader.read(), abortPromise]);
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw new Error('Public response exceeds 5 MB limit');
            chunks.push(value);
          }
        } catch (error) {
          void reader.cancel().catch(() => {});
          controller.abort();
          throw error;
        } finally { reader.releaseLock(); }
        if (controller.signal.aborted) throw aborted();
        const body = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const payload = JSON.parse(new TextDecoder().decode(body));
        log({ event: 'GET received', path: u.pathname, status: response.status, bytes, sourceTime: sourceTimestamp(payload?.time, u.pathname) });
        return { ok: true, status: response.status, json: async () => payload };
      } catch (error) {
        log({ event: controller.signal.aborted || batch.canceled ? 'GET aborted' : 'GET failed', path: u.pathname });
        throw error;
      } finally {
        for (const signal of signals) signal.removeEventListener('abort', relay);
        controller.signal.removeEventListener('abort', rejectAbort);
      }
    };
    try {
      const observer = createCoinbaseObserver({ fetchImpl: fetchPublic, now, timeoutMs });
      const observations = [];
      for (const product of SUPPORTED_PRODUCTS) {
        if (batch.controller.signal.aborted) throw aborted();
        observations.push(await observer.observe(product));
      }
      if (disposed || batch.controller.signal.aborted) throw aborted();
      failures = 0;
      state = { ...state, phase: 'completed', observations, errors: [] };
    } catch (error) {
      failures = batch.canceled ? failures : Math.min(failures + 1, 5);
      state = { ...state, phase: batch.canceled ? 'canceled' : 'failed', observations: [], errors: [batch.canceled ? 'Observation canceled; current marks cleared.' : boundedText(error.message)] };
    } finally {
      batch.controller.abort();
      active = null;
      const cooldown = state.phase === 'failed' ? Math.min(MAX_BACKOFF_MS, MIN_REFRESH_MS * 2 ** (failures - 1)) : MIN_REFRESH_MS;
      state = { ...state, completedAt: now(), nextAllowedAt: Math.max(now() + cooldown, batch.retryAfter) };
      emit();
    }
    return true;
  }
  function cancel() {
    if (!active || active.canceled) return;
    active.canceled = true;
    state = { ...state, observations: [], phase: 'canceling' };
    log({ event: 'Observation cancellation requested' });
    active.controller.abort();
  }
  return { refresh, cancel, getState: () => state, destroy() { disposed = true; if (active) { active.canceled = true; active.controller.abort(); } } };
}
