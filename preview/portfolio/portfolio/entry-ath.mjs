// CoinGecko's reported all-time aggregate USD high, never a cycle close or
// Binance listing wick. Compare only with the same provider's current USD price.
export const ATH_MAX_AGE = 5 * 60000;
export const ATH_IDS = Object.freeze({ '2Z': 'doublezero', OPEN: 'openledger-2' });
export const ATH_SOURCE = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=doublezero%2Copenledger-2';
export function isFreshATH(value, now = Date.now()) {
  return Boolean(value && Number.isSafeInteger(now) && Number.isSafeInteger(value.observedAt) && now >= value.observedAt && now - value.observedAt < ATH_MAX_AGE);
}
export function parseATHMarkets(payload, now = Date.now()) {
  if (!Number.isSafeInteger(now) || !Array.isArray(payload) || payload.length > 2) throw Error('ATH response invalid');
  const result = new Map();
  for (const [asset, id] of Object.entries(ATH_IDS)) {
    const matches = payload.filter(row => row?.id === id);
    if (matches.length !== 1) continue;
    const row = matches[0], observedAt = Date.parse(row.last_updated), at = Date.parse(row.ath_date);
    if (row.symbol !== asset.toLowerCase() || !isFreshATH({ observedAt }, now) || !Number.isSafeInteger(at) || at <= 0 || at > observedAt || typeof row.ath !== 'number' || !Number.isFinite(row.ath) || row.ath <= 0 || typeof row.current_price !== 'number' || !Number.isFinite(row.current_price) || row.current_price <= 0 || row.current_price > row.ath) continue;
    const below = (1 - row.current_price / row.ath) * 100;
    result.set(asset, { asset, ath: row.ath, current: row.current_price, at, observedAt, currency: 'USD', provider: 'CoinGecko', source: 'https://www.coingecko.com/en/coins/' + id,
      belowLabel: below === 0 ? 'At ATH' : below < 0.1 ? '<0.1%' : below.toFixed(1) + '%' });
  }
  return result;
}
export async function readATHMarkets({ fetchImpl = globalThis.fetch, signal, now = Date.now } = {}) {
  const response = await fetchImpl(ATH_SOURCE, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok || response.redirected || (response.url && response.url !== ATH_SOURCE) || Number(response.headers?.get('content-length') || 0) > 65536) throw Error('ATH source unavailable');
  const text = await response.text();
  if (text.length > 65536 || signal?.aborted) throw Error('ATH response unavailable');
  return parseATHMarkets(JSON.parse(text), now());
}
