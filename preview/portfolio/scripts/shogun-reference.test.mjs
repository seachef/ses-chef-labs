import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleHoldings, pricedHoldingsSummary } from '../portfolio/model.mjs';
import { SHOGUN_CONTRACT, SHOGUN_PRICE_URL, parseShogunReference, shogunReferenceValue, createShogunReference } from '../portfolio/shogun-reference.mjs';

const NOW = Date.parse('2026-10-08T00:00:00Z');
const response = price => ({ data: { type: 'simple_token_price', attributes: { token_prices: { [SHOGUN_CONTRACT]: price } } } });
const holding = { chainId: 1, assetId: SHOGUN_CONTRACT, decimals: 18, symbol: 'SHOGUN', quantity: '1000000', usd: null, aud: null, unreliable: true };
const model = { account: { kind: 'smsf' }, snapshot: { usd_to_aud: '1.5', fx_source: 'Synthetic FX', fx_observed_at: new Date(NOW).toISOString() } };

test('SMSF opening pins only the exact held SHOGUN contract, without changing Personal or exclusions', () => {
  const rows = [holding, { ...holding, chainId: 369 }, { ...holding, assetId: '0x66a3c2fa3e467aa586e90912f977e648589cabaf' }, { ...holding, decimals: 9 }, { ...holding, quantity: '0' }];
  assert.deepEqual(visibleHoldings(rows, 'AUD', { accountKind: 'smsf' }), [holding]);
  assert.deepEqual(visibleHoldings(rows, 'USD', { accountKind: 'personal' }), []);
  assert.deepEqual(visibleHoldings([], 'USD', { accountKind: 'smsf' }), []);
});

test('reference estimate uses exact decimals and saved FX without affecting totals or observations', () => {
  const before = structuredClone({ holding, model });
  const quote = parseShogunReference(response('0.000070123456789123'), new Date(NOW).toISOString());
  assert.equal(shogunReferenceValue(holding, model, 'USD', quote, NOW).value, '70.123456789123');
  assert.equal(shogunReferenceValue(holding, model, 'AUD', quote, NOW).value, '105.1851851836845');
  assert.equal(pricedHoldingsSummary([holding], 'USD').value, null);
  assert.deepEqual({ holding, model }, before);
  assert.equal(shogunReferenceValue(holding, { ...model, snapshot: {} }, 'AUD', quote, NOW).value, null);
  assert.equal(shogunReferenceValue(holding, { ...model, account: { kind: 'personal' } }, 'USD', quote, NOW), null);
  assert.equal(shogunReferenceValue(holding, model, 'USD', quote, NOW + 300001), null);
  assert.equal(shogunReferenceValue(holding, model, 'USD', quote, NOW - 1), null);
});

test('missing, zero, negative, malformed and wrong-contract prices stay unavailable', () => {
  for (const raw of [null, undefined, 0.00007, '0', '-1', 'NaN', '<script>', '1e10000']) {
    assert.throws(() => parseShogunReference(response(raw), new Date(NOW).toISOString()));
  }
  assert.throws(() => parseShogunReference({ data: { type: 'simple_token_price', attributes: { token_prices: { other: '10' } } } }, new Date(NOW).toISOString()));
});

test('public request contains only the token contract, omits credentials, and reuses the quote for five minutes', async () => {
  let clock = NOW, calls = 0;
  const client = createShogunReference({ now: () => clock, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, SHOGUN_PRICE_URL);
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.body, undefined); assert.deepEqual(options.headers, { Accept: 'application/json' });
    return { ok: true, url, text: async () => JSON.stringify(response('0.00007')) };
  } });
  const pending = client.refresh(); assert.equal(client.refresh(), null); await pending;
  assert.equal(calls, 1); assert.equal(client.value(holding, model, 'USD').value, '70');
  assert.equal(client.refresh(), null);
  clock += 300001; assert.equal(client.value(holding, model, 'USD'), null);
  await client.refresh(); assert.equal(calls, 2);
});

test('provider errors preserve the held coin but never invent a quote or retry in a loop', async () => {
  for (const fetchImpl of [() => { throw Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, text: async () => 'not JSON' }), async () => ({ ok: true, text: async () => ' '.repeat(16385) })]) {
    const client = createShogunReference({ now: () => NOW, fetchImpl });
    await client.refresh();
    assert.equal(client.value(holding, model, 'USD'), null); assert.equal(client.refresh(), null);
    assert.deepEqual(visibleHoldings([holding], 'USD', { accountKind: 'smsf' }), [holding]);
  }
});
