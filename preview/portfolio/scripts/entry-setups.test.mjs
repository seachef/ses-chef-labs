import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENTRY_SETUP_ASSETS, ENTRY_SETUP_MAX_AGE_MS, ENTRY_QUOTE_MAX_AGE_MS,
  ENTRY_SETUP_FUTURE_TOLERANCE_MS, validateEntrySetups, evaluateEntrySetup,
} from '../portfolio/entry-setups.mjs';

const now = Date.parse('2026-10-07T12:00:00Z');
const iso = millis => new Date(millis).toISOString();

// All prices, levels, venue names and source pages here are synthetic test data.
function setup(asset = 'RENDER') {
  return {
    asset, venue: 'Synthetic Spot', pair: `${asset}/USD`, quote_currency: 'USD',
    entry_min: '10', entry_max: '12', stop: '9', targets: ['14', '16', '18'],
    checked_at: '2026-10-07T11:00:00Z', expires_at: '2026-10-08T11:00:00Z',
    review_status: 'reviewed', source_security_checked: true,
    source_urls: ['https://example.com/synthetic-research', 'https://example.com/synthetic-quote'],
    quote: {
      venue: 'Synthetic Spot', pair: `${asset}/USD`, quote_currency: 'USD',
      price: '11', observed_at: '2026-10-07T11:55:00Z',
      source_url: 'https://example.com/synthetic-quote',
    },
  };
}

function feed(row = setup()) {
  return { schema_version: 1, checked_at: '2026-10-07T12:00:00Z', setups: [row] };
}

function invalid(mutate, pattern) {
  const data = feed();
  mutate(data, data.setups[0]);
  assert.throws(() => validateEntrySetups(data, { now }), pattern);
}

test('a valid independently reviewed setup returns the original feed and review result without mutation', () => {
  const data = feed(), before = JSON.stringify(data);
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  freeze(data);
  assert.equal(validateEntrySetups(data, { now }), data);
  assert.deepEqual(evaluateEntrySetup(data.setups[0], now), { status: 'review', reason: 'review_ready' });
  assert.equal(JSON.stringify(data), before);
});

test('empty initial and empty checked feeds are allowed, but null cannot conceal setups', () => {
  const data = { schema_version: 1, checked_at: null, setups: [] };
  assert.equal(validateEntrySetups(data, { now }), data);
  assert.doesNotThrow(() => validateEntrySetups({ ...data, checked_at: iso(now) }, { now }));
  invalid(data => { data.checked_at = null; }, /null only for an empty/);
});

test('asset count is bounded and each supported asset can appear only once', () => {
  const data = { ...feed(), setups: ENTRY_SETUP_ASSETS.map(setup) };
  assert.equal(validateEntrySetups(data, { now }), data);
  invalid(data => { data.setups.push(setup()); }, /asset: must be unique/);
  invalid(data => { data.setups = Array.from({ length: 6 }, () => setup()); }, /0–5/);
  invalid((data, row) => { row.asset = 'RNDR'; }, /asset: must be one of/);
  assert.ok(Object.isFrozen(ENTRY_SETUP_ASSETS));
});

test('unknown or missing keys at every level are rejected, including private and qualification fields', () => {
  for (const select of [data => data, data => data.setups[0], data => data.setups[0].quote]) {
    for (const key of ['qualified', 'buy', 'execute', 'wallet', 'budget', 'owned']) {
      invalid(data => { select(data)[key] = true; }, /unknown property/);
    }
    for (const key of Object.keys(select(feed()))) {
      invalid(data => { delete select(data)[key]; }, /is required as a JSON value/);
    }
  }
  invalid(data => { data.schema_version = '1'; }, /must equal 1/);
});

test('only JSON-like plain objects and dense data arrays are accepted without invoking getters', () => {
  for (const value of [null, [], new Date(), 'setup']) assert.throws(() => evaluateEntrySetup(value, now), /plain object/);
  invalid(data => { data.setups[0] = Object.assign(Object.create({ inherited: true }), setup()); }, /plain object/);
  invalid((data, row) => { Object.defineProperty(row, 'checked_at', { enumerable: true, get() { throw Error('getter ran'); } }); }, /required as a JSON value/);
  invalid(data => { data.setups = Array(1); }, /dense JSON array/);
  invalid((data, row) => { row.targets.extra = '20'; }, /dense JSON array/);
  invalid((data, row) => { Object.defineProperty(row.targets, 0, { enumerable: true, get() { throw Error('getter ran'); } }); }, /dense JSON array/);
  invalid((data, row) => { row.source_urls[Symbol('private')] = 'secret'; }, /dense JSON array/);
  invalid((data, row) => { row[Symbol('private')] = 'secret'; }, /unknown property/);
});

test('all permitted asset/currency pair shapes validate and quote identity must match exactly', () => {
  for (const asset of ENTRY_SETUP_ASSETS) for (const currency of ['USD', 'USDT', 'USDC']) for (const separator of ['', '/', '-', '_']) {
    const row = setup(asset);
    row.pair = row.quote.pair = `${asset}${separator}${currency}`;
    row.quote_currency = row.quote.quote_currency = currency;
    assert.doesNotThrow(() => validateEntrySetups(feed(row), { now }));
  }
  for (const pair of ['RNDR/USD', 'BTCRENDERUSD', 'RENDERBTCUSD', 'RENDER/USDT', 'RENDER/USD-PERP', 'RENDER//USD', 'RENDER.USD', 'RENDER:USD', 'render/USD', ' RENDER/USD', 'RENDER/USD\n']) {
    invalid((data, row) => { row.pair = row.quote.pair = pair; }, /pair: must be the exact/);
  }
  for (const [field, value] of [['venue', 'Other Spot'], ['pair', 'RENDERUSD'], ['quote_currency', 'USDT']]) {
    invalid((data, row) => { row.quote[field] = value; }, /must exactly match the setup market identity/);
  }
});

test('venue, status, boolean and currency cannot use coerced or unsafe values', () => {
  for (const venue of ['', ' Synthetic Spot', 'Synthetic Spot ', 'x'.repeat(81), '<b>Venue</b>', 'Venue\u202e', '**Venue**', 'Venue\n']) {
    invalid((data, row) => { row.venue = row.quote.venue = venue; }, /trimmed plain text/);
  }
  for (const status of ['buy', 'review', true, null]) invalid((data, row) => { row.review_status = status; }, /review_status: must be one of/);
  for (const flag of ['true', 1, null]) invalid((data, row) => { row.source_security_checked = flag; }, /must be a boolean/);
  for (const currency of ['AUD', 'usd', null]) invalid((data, row) => { row.quote_currency = currency; }, /quote_currency: must be one of/);
});

test('all prices are positive exact decimal strings and reject floating-point or coercible inputs', () => {
  const bad = [0, 10, NaN, Infinity, null, '', '0', '0.000', '-1', '+1', '01', '1.', '.1', '1e1', 'NaN', 'Infinity', ' 10', '10 ', '10\n', '1,000', '1'.repeat(65)];
  for (const value of bad) {
    for (const field of ['entry_min', 'entry_max', 'stop']) invalid((data, row) => { row[field] = value; }, /decimal string|positive price/);
    invalid((data, row) => { row.targets[0] = value; }, /decimal string|positive price/);
    invalid((data, row) => { row.quote.price = value; }, /decimal string|positive price/);
  }
});

test('price ordering enforces stop, inclusive entry range, and one to three increasing targets', () => {
  invalid((data, row) => { row.stop = '10'; }, /strictly below entry_min/);
  invalid((data, row) => { row.stop = '10.00000000000000001'; }, /strictly below entry_min/);
  invalid((data, row) => { row.entry_max = '9.9'; }, /at least entry_min/);
  for (const targets of [[], ['14', '16', '18', '20']]) invalid((data, row) => { row.targets = targets; }, /1–3/);
  for (const targets of [['12'], ['11'], ['14', '14.00'], ['14', '13']]) invalid((data, row) => { row.targets = targets; }, /strictly above/);
  const row = setup();
  row.entry_min = row.entry_max = row.quote.price = '10';
  row.targets = ['11'];
  assert.equal(evaluateEntrySetup(row, now).status, 'review');
});

test('decimal comparisons preserve distinctions smaller than Number precision and large integers', () => {
  const row = setup();
  row.stop = '1';
  row.entry_min = '1.00000000000000000000000000000000000000000000000000000000000001';
  row.entry_max = '1.00000000000000000000000000000000000000000000000000000000000002';
  row.targets = ['1.00000000000000000000000000000000000000000000000000000000000003'];
  row.quote.price = row.entry_min;
  assert.equal(evaluateEntrySetup(row, now).status, 'review');
  row.quote.price = row.targets[0];
  assert.deepEqual(evaluateEntrySetup(row, now), { status: 'watch', reason: 'outside_entry_range' });
  row.stop = '9007199254740992'; row.entry_min = '9007199254740993';
  row.entry_max = row.quote.price = '9007199254740994'; row.targets = ['9007199254740995'];
  assert.equal(evaluateEntrySetup(row, now).status, 'review');
});

test('entry endpoints are inclusive and decimal trailing zeroes compare by value', () => {
  for (const price of ['10', '10.000', '12', '12.000']) {
    const row = setup(); row.quote.price = price;
    assert.equal(evaluateEntrySetup(row, now).status, 'review');
  }
  for (const price of ['9.999999999999999999', '12.000000000000000001']) {
    const row = setup(); row.quote.price = price;
    assert.deepEqual(evaluateEntrySetup(row, now), { status: 'watch', reason: 'outside_entry_range' });
  }
  for (const price of ['9.00', '8.999']) {
    const row = setup(); row.quote.price = price;
    assert.deepEqual(evaluateEntrySetup(row, now), { status: 'watch', reason: 'quote_at_or_below_stop' });
  }
});

test('a refreshed quote may follow research, but root checked_at covers both', () => {
  assert.doesNotThrow(() => validateEntrySetups(feed(), { now }));
  invalid(data => { data.checked_at = '2026-10-07T11:54:59Z'; }, /must cover every/);
  invalid((data, row) => { row.checked_at = '2026-10-07T12:00:01Z'; }, /must cover every/);
});

test('timestamps require real UTC calendar times with at most millisecond precision', () => {
  const bad = ['2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z', '2026-10-07T24:00:00Z', '2026-10-07T11:59:60Z', '2026-10-07', '2026-10-07T12:00:00', '2026-10-07T12:00:00+00:00', '2026-10-07T12:00:00.0001Z', '2026-10-07T12:00:00z', '2026-10-07T12:00:00Z\n', null, now];
  for (const value of bad) {
    for (const field of ['checked_at', 'expires_at']) invalid((data, row) => { row[field] = value; }, /UTC|real/);
    invalid((data, row) => { row.quote.observed_at = value; }, /UTC|real/);
    if (value !== null) invalid(data => { data.checked_at = value; }, /UTC|real/);
  }
  const row = setup(); row.quote.observed_at = '2026-10-07T11:59:00.1Z';
  assert.doesNotThrow(() => validateEntrySetups(feed(row), { now }));
});

test('observation clock skew allows exactly five minutes and rejects one millisecond more', () => {
  for (const field of ['root', 'setup', 'quote']) {
    const data = feed(); data.checked_at = iso(now + ENTRY_SETUP_FUTURE_TOLERANCE_MS);
    if (field === 'setup') data.setups[0].checked_at = data.checked_at;
    if (field === 'quote') data.setups[0].quote.observed_at = data.checked_at;
    assert.doesNotThrow(() => validateEntrySetups(data, { now }));
    if (field === 'root') data.checked_at = iso(now + ENTRY_SETUP_FUTURE_TOLERANCE_MS + 1);
    if (field === 'setup') data.setups[0].checked_at = iso(now + ENTRY_SETUP_FUTURE_TOLERANCE_MS + 1);
    if (field === 'quote') data.setups[0].quote.observed_at = iso(now + ENTRY_SETUP_FUTURE_TOLERANCE_MS + 1);
    assert.throws(() => validateEntrySetups(data, { now }), /more than five minutes/);
  }
});

test('future observations within clock tolerance stay Watch until their observation time', () => {
  for (const field of ['checked_at', 'observed_at']) {
    const row = setup(), observed = now + 1;
    if (field === 'checked_at') row.checked_at = iso(observed);
    else row.quote.observed_at = iso(observed);
    assert.deepEqual(evaluateEntrySetup(row, now), { status: 'watch', reason: 'awaiting_observation' });
    assert.equal(evaluateEntrySetup(row, observed).status, 'review');
  }
});

test('expiry is a real future deadline with a strictly positive validity of at most 24 hours', () => {
  const row = setup(), checked = Date.parse(row.checked_at);
  row.expires_at = iso(checked + ENTRY_SETUP_MAX_AGE_MS);
  assert.doesNotThrow(() => validateEntrySetups(feed(row), { now }));
  for (const expiry of [checked, checked - 1, checked + ENTRY_SETUP_MAX_AGE_MS + 1]) {
    invalid((data, candidate) => { candidate.expires_at = iso(expiry); }, /after checked_at and at most 24 hours/);
  }
});

test('expiry becomes Watch exactly at the exclusive deadline regardless of a fresh quote', () => {
  const row = setup(), expiry = Date.parse(row.expires_at);
  row.quote.observed_at = iso(expiry - 1);
  assert.equal(evaluateEntrySetup(row, expiry - 1).status, 'review');
  assert.deepEqual(evaluateEntrySetup(row, expiry), { status: 'watch', reason: 'expired' });
  assert.deepEqual(evaluateEntrySetup(row, expiry + 1), { status: 'watch', reason: 'expired' });
});

test('quote freshness accepts exactly 15 minutes and fails closed one millisecond later', () => {
  const row = setup(); row.quote.observed_at = iso(now - ENTRY_QUOTE_MAX_AGE_MS);
  assert.equal(evaluateEntrySetup(row, now).status, 'review');
  assert.deepEqual(evaluateEntrySetup(row, now + 1), { status: 'watch', reason: 'quote_stale' });
  const data = feed(row); data.checked_at = iso(now + 1);
  validateEntrySetups(data, { now: now + 1 });
  assert.equal(evaluateEntrySetup(data.setups[0], now + 1).reason, 'quote_stale');
});

test('pending or source-unchecked research stays Watch even with an in-range fresh quote', () => {
  const row = setup(); row.review_status = 'pending';
  assert.deepEqual(evaluateEntrySetup(row, now), { status: 'watch', reason: 'review_pending' });
  row.source_security_checked = false;
  assert.equal(evaluateEntrySetup(row, now).reason, 'review_pending');
  row.review_status = 'reviewed';
  assert.deepEqual(evaluateEntrySetup(row, now), { status: 'watch', reason: 'sources_unchecked' });
});

test('unsafe, credential-bearing, local and IP source URLs are rejected in citations and quotes', () => {
  const urls = [
    'http://example.com/quote', 'javascript:alert(1)', 'data:text/plain,test',
    'https://user:pass@example.com/quote', 'https://@example.com/quote',
    'https://localhost/quote', 'https://example.local/quote', 'https://corp.internal/quote',
    'https://printer.home.arpa/quote', 'https://127.0.0.1/quote', 'https://8.8.8.8/quote',
    'https://0177.0.0.1/quote', 'https://2130706433/quote', 'https://[::1]/quote',
    'https://[2001:4860:4860::8888]/quote', 'https://example.com/quote?api_key=secret',
    'https://example.com/quote?access-token=secret', 'https://example.com/quote?%74oken=secret',
    'https://example.com/quote?Authorization=secret', 'https://example.com/quote?password=secret',
    'https://example.com/white space', 'https://example.com/\\quote', 'https://example.com/<quote>',
    'https://example.com/\u202equote', 'https://example.com/' + 'x'.repeat(2048),
  ];
  for (const url of urls) {
    invalid((data, row) => { row.source_urls[0] = url; }, /URL|HTTPS|host|credential/);
    invalid((data, row) => { row.quote.source_url = url; }, /URL|HTTPS|host|credential/);
  }
});

test('citations are bounded and unique, and the quote source is cited exactly', () => {
  invalid((data, row) => { row.source_urls = []; }, /1–5/);
  invalid((data, row) => { row.source_urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`); }, /1–5/);
  invalid((data, row) => { row.source_urls.push(row.source_urls[0]); }, /duplicate a source/);
  invalid((data, row) => { row.quote.source_url += '?new=true'; }, /must exactly match a source citation/);
});

test('invalid data throws from evaluation before even a pending review can return a status', () => {
  const row = setup(); row.review_status = 'pending'; row.stop = row.entry_min;
  assert.throws(() => evaluateEntrySetup(row, now), /strictly below/);
  row.stop = '9'; row.qualified = true;
  assert.throws(() => evaluateEntrySetup(row, now), /unknown property/);
});

test('technical freshness constants and clock inputs are explicit', () => {
  assert.equal(ENTRY_SETUP_MAX_AGE_MS, 86_400_000);
  assert.equal(ENTRY_QUOTE_MAX_AGE_MS, 900_000);
  assert.equal(ENTRY_SETUP_FUTURE_TOLERANCE_MS, 300_000);
  for (const value of [NaN, Infinity, -Infinity, '2026-10-07', new Date(now), null, 1e20]) {
    assert.throws(() => validateEntrySetups(feed(), { now: value }), /finite timestamp/);
    assert.throws(() => evaluateEntrySetup(setup(), value), /finite timestamp/);
  }
});

test('the schema is parseable and agrees on exact key lists, enums and list bounds', async () => {
  const schema = JSON.parse(await readFile(new URL('../data/entry-setups.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(feed()).sort());
  assert.deepEqual([...schema.$defs.setup.required].sort(), Object.keys(setup()).sort());
  assert.deepEqual([...schema.$defs.quote.required].sort(), Object.keys(setup().quote).sort());
  assert.deepEqual(schema.$defs.asset.enum, [...ENTRY_SETUP_ASSETS]);
  assert.equal(schema.properties.setups.maxItems, 5);
  assert.equal(schema.$defs.setup.properties.targets.maxItems, 3);
  assert.equal(schema.$defs.setup.properties.source_urls.maxItems, 5);
  for (const [definition, valid] of [['pair', 'RENDER/USD'], ['positiveDecimal', '10'], ['utcTimestamp', '2026-10-07T12:00:00Z']]) {
    const pattern = new RegExp(schema.$defs[definition].pattern);
    assert.equal(pattern.test(valid), true);
    assert.equal(pattern.test(valid + '\n'), false);
  }
});

test('CLI validates explicit paths, rejects bad input and rejects extra arguments without changing files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'entry-setups-test-'));
  const cli = fileURLToPath(new URL('./validate-entry-setups.mjs', import.meta.url));
  try {
    const path = join(folder, 'setups.json');
    const empty = '{"schema_version":1,"checked_at":null,"setups":[]}\n';
    await writeFile(path, empty);
    const valid = spawnSync(process.execPath, [cli, 'setups.json'], { cwd: folder, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /0 setups, 0 available for review/);
    assert.equal(await readFile(path, 'utf8'), empty);
    await writeFile(path, '{"schema_version":1,"checked_at":null,"setups":[],"buy":true}');
    const bad = spawnSync(process.execPath, [cli, path], { cwd: folder, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /unknown property/);
    const args = spawnSync(process.execPath, [cli, path, path], { cwd: folder, encoding: 'utf8' });
    assert.equal(args.status, 1);
    assert.match(args.stderr, /Usage:/);
    const missing = spawnSync(process.execPath, [cli, join(folder, 'missing.json')], { cwd: folder, encoding: 'utf8' });
    assert.equal(missing.status, 1);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
