import { coinMetadata, verifiedFx } from './model.mjs?v=20261008.shogun1';
import { multiplyDecimals } from './domain.mjs';
import { decimal, decimalText } from './exact-decimal.mjs';

export const SHOGUN_CONTRACT = '0xfd4cb1294df23920e683e046963117cae6c807d9';
export const SHOGUN_SOURCE = 'https://www.titanxhub.com/tokens/eth/shogun';
// TitanX Hub's token page also uses this exact-contract public price endpoint.
export const SHOGUN_PRICE_URL = `https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${SHOGUN_CONTRACT}`;
const MAX_AGE_MS = 5 * 60 * 1000;

export function parseShogunReference(value, retrievedAt) {
  if (value?.data?.type !== 'simple_token_price') throw Error('Invalid token price response');
  const raw = value.data.attributes?.token_prices?.[SHOGUN_CONTRACT];
  if (typeof raw !== 'string' || raw.length > 100) throw Error('SHOGUN price unavailable');
  const priceUsd = decimalText(decimal(raw, { positive: true, exponent: true }));
  if (!Number.isFinite(Date.parse(retrievedAt))) throw Error('Invalid retrieval time');
  return Object.freeze({ priceUsd, retrievedAt, provider: 'GeckoTerminal', source: SHOGUN_SOURCE });
}

/** Public reference only. Never changes saved quotes, totals, history or balances. */
export function shogunReferenceValue(holding, model, currency, quote, now = Date.now()) {
  if (model?.account?.kind !== 'smsf' || coinMetadata(holding)?.symbol !== 'SHOGUN' || !quote) return null;
  const age = now - Date.parse(quote.retrievedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
  try {
    decimal(holding.quantity, { positive: true });
    const price = decimalText(decimal(quote.priceUsd, { positive: true }));
    const fx = verifiedFx(model.snapshot);
    const unit = currency === 'USD' ? price : currency === 'AUD' && fx ? multiplyDecimals(price, fx) : null;
    return { ...quote, unit, value: unit == null ? null : multiplyDecimals(holding.quantity, unit) };
  } catch { return null; }
}

export function createShogunReference({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  let quote = null, pending = null, lastAttempt = -Infinity;
  return {
    value(holding, model, currency) { return shogunReferenceValue(holding, model, currency, quote, now()); },
    // A null result means no request is due. Failures also cool down to avoid retry loops.
    refresh() {
      if (pending) return null;
      if (now() - lastAttempt < MAX_AGE_MS) return null;
      lastAttempt = now();
      pending = Promise.resolve().then(async () => {
        try {
          const response = await fetchImpl(SHOGUN_PRICE_URL, { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
          if (!response.ok || response.redirected || (response.url && response.url !== SHOGUN_PRICE_URL)) throw Error('Price unavailable');
          const body = await response.text();
          if (body.length > 16384) throw Error('Oversized price response');
          quote = parseShogunReference(JSON.parse(body), new Date(now()).toISOString());
        } catch { quote = null; }
        finally { pending = null; }
        return quote;
      });
      return pending;
    },
  };
}
