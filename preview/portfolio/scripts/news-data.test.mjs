import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENTRY_WATCH_ASSETS, NEWS_STALE_AFTER_MS, validateNewsDesk, validateEntryWatch, newsFreshness } from '../portfolio/news-data.mjs';

// Synthetic unit-test evidence, never used to populate the public feed.
const NOW_ISO = '2026-10-07T11:00:00Z';
const now = Date.parse(NOW_ISO);
const checked = '2026-10-07T10:59:00Z';
const sourceUrl = 'https://project.example.org/news/public-update';
const item = () => ({
  id: 'synthetic-public-update', coins: ['RENDER'], headline: 'A project publishes an update',
  what_happened: 'The project published a public technical update.',
  why_it_matters: 'The announcement describes a change in network usage.',
  risk: 'An announcement does not establish future adoption or a price outcome.',
  source: { name: 'Project publication', url: sourceUrl, published_at: null, published_date: '2026-10-01', retrieved_at: checked },
});
const news = () => ({ schema_version: 1, checked_at: checked, items: [item()] });
const record = (options = {}) => ({
  id: 'render-day-one', asset: 'RENDER', status: 'observed', venue: 'Example Spot', pair: 'RENDERUSDT', quote_currency: 'USDT', interval: '1d',
  candle_open_at: '2026-10-05T00:00:00Z', candle_close_at: '2026-10-06T00:00:00Z',
  low: '10', close: '11', volume: '100', observed_at: checked,
  source_url: 'https://exchange.example.org/api/klines?symbol=RENDERUSDT&interval=1d',
  assessment: 'baseline', compared_with: null, supersedes: null, note: 'Synthetic completed UTC daily candle for validator tests.',
  ...options,
});
const second = (options = {}) => record({
  id: 'render-day-two', candle_open_at: '2026-10-06T00:00:00Z', candle_close_at: '2026-10-07T00:00:00Z',
  low: '9.5', close: '10', assessment: 'lower_low', compared_with: 'render-day-one', ...options,
});
const unavailable = (options = {}) => record({
  id: 'akt-unavailable', asset: 'AKT', status: 'unavailable', pair: 'AKTUSDT',
  candle_open_at: null, candle_close_at: null, low: null, close: null, volume: null,
  source_url: null, assessment: 'unknown', note: 'The selected venue instrument is unavailable.', ...options,
});
const ledger = (records = [record(), second()]) => ({ schema_version: 1, assets: [...ENTRY_WATCH_ASSETS], records });
const validNews = value => validateNewsDesk(value, { now });
const validWatch = (value, options = {}) => validateEntryWatch(value, { now, ...options });
const invalidNews = (mutate, pattern) => { const value = news(); mutate(value, value.items[0]); assert.throws(() => validNews(value), pattern); };
const invalidWatch = (mutate, pattern) => { const value = ledger(); mutate(value, value.records[0], value.records[1]); assert.throws(() => validWatch(value), pattern); };

test('public feed and empty initial state validate without mutation', () => {
  const value = news(), before = structuredClone(value);
  assert.equal(validNews(value), value);
  assert.deepEqual(value, before);
  const empty = { schema_version: 1, checked_at: null, items: [] };
  assert.equal(validNews(empty), empty);
  assert.deepEqual(newsFreshness(empty, now), { status: 'never', checkedAt: null, ageMs: null });
  invalidNews(value => { value.checked_at = null; }, /empty initial feed/);
});

test('every news object has exact required keys and plain JSON descriptors', () => {
  for (const select of [value => value, value => value.items[0], value => value.items[0].source]) {
    invalidNews(value => { select(value).wallet = 'private'; }, /unknown property/);
    for (const key of Object.keys(select(news()))) invalidNews(value => { delete select(value)[key]; }, /required/);
  }
  invalidNews(value => { Object.defineProperty(value, Symbol('extra'), { value: 1 }); }, /unknown property/);
  invalidNews(value => { Object.defineProperty(value, 'checked_at', { get: () => checked }); }, /JSON value/);
  assert.throws(() => validNews(null), /plain object/);
  assert.throws(() => validNews(Object.assign(new Date(), news())), /plain object/);
});

test('news count, unique IDs and unique ticker bounds are enforced', () => {
  invalidNews(value => { value.schema_version = '1'; }, /equal 1/);
  invalidNews(value => { value.items.push(item()); }, /unique/);
  invalidNews(value => { value.items = Array.from({ length: 6 }, (_, i) => ({ ...item(), id: `item-${i}` })); }, /0–5/);
  for (const coins of [[], ['RENDER', 'RENDER'], ['btc'], ['A'], ['BTC USD'], ['A'.repeat(13)], ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']]) invalidNews((_, entry) => { entry.coins = coins; });
  for (const id of ['', 'Uppercase', 'with_space', 'two--dashes', 'a'.repeat(65), 123]) invalidNews((_, entry) => { entry.id = id; }, /identifier/);
  const full = news(); full.items = Array.from({ length: 5 }, (_, i) => ({ ...item(), id: `item-${i}` })); validNews(full);
});

test('arrays reject holes, unexpected properties and accessors', () => {
  for (const select of [value => value.items, value => value.items[0].coins]) {
    invalidNews(value => { select(value).privateData = 1; }, /dense JSON array/);
    invalidNews(value => { delete select(value)[0]; }, /dense JSON array/);
    invalidNews(value => { Object.defineProperty(select(value), '0', { get: () => item() }); }, /dense JSON array/);
  }
  invalidWatch(value => { value.records.privateData = true; }, /dense JSON array/);
  invalidWatch(value => { delete value.assets[0]; }, /dense JSON array/);
});

test('bounded plain text rejects markup, controls and promises', () => {
  for (const text of ['', ' leading', 'trailing ', '<img src=x>', '**bold**', '`code`', '[click](https://example.org)', '# Heading', 'two\nlines', 'null\u0000byte', 'rtl\u202eoverride', 'zero\u200bwidth']) invalidNews((_, entry) => { entry.what_happened = text; }, /plain text/);
  for (const [field, limit] of [['headline', 140], ['what_happened', 360], ['why_it_matters', 360], ['risk', 360]]) {
    invalidNews((_, entry) => { entry[field] = 'a'.repeat(limit + 1); }, /plain text/);
    const value = news(); value.items[0][field] = 'a'.repeat(limit); validNews(value);
  }
  invalidNews((_, entry) => { entry.source.name = 'a'.repeat(101); }, /plain text/);
  for (const phrase of ['Guaranteed returns', 'risk-free investment', '100% safe', 'You cannot lose money']) invalidNews((_, entry) => { entry.risk = phrase; }, /assured investment/);
  invalidWatch((_, entry) => { entry.note = 'a'.repeat(601); }, /plain text/);
});

test('source links reject credentials, local DNS, all literal IPs and URL-parser bypasses', () => {
  for (const url of [
    'http://example.org', 'javascript:alert(1)', '//example.org', 'https://user:password@example.org', 'https://@example.org',
    'https://localhost', 'https://localhost.', 'https://sub.localhost', 'https://service.internal', 'https://printer.local',
    'https://printer.localdomain', 'https://printer.home.arpa', 'https://printer', 'https://10.0.0.1', 'https://127.1',
    'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1', 'https://8.8.8.8', 'https://[::1]',
    'https://[2606:4700:4700::1111]', 'https://example.org/\npath', 'https://example.org\\path', 'https://exa\u202emple.org',
    'https://example.org/<script>', 'https://example.org/?api_key=secret', 'https://example.org/?%74oken=secret',
    'https://example.org/' + 'a'.repeat(2048),
  ]) {
    invalidNews((_, entry) => { entry.source.url = url; }, /source.url:/);
    invalidWatch((_, entry) => { entry.source_url = url; }, /source_url:/);
  }
  for (const url of ['https://project.example.org/path?symbol=RENDERUSDT#source', 'https://project.example.org.']) {
    const value = news(); value.items[0].source.url = url; validNews(value);
  }
});

test('publication date-only sources remain date-only, with strict retrieval chronology', () => {
  const value = news(); validNews(value); assert.equal(value.items[0].source.published_at, null);
  value.items[0].source.published_at = '2026-10-01T10:00:00Z'; validNews(value);
  invalidNews((_, entry) => { entry.source.published_at = '2026-10-02T10:00:00Z'; }, /must match/);
  invalidNews((_, entry) => { entry.source.published_date = '2026-10-08'; }, /after the retrieval/);
  invalidNews((_, entry) => { entry.source.retrieved_at = '2026-10-07T11:00:00Z'; }, /later than checked_at/);
  invalidNews((_, entry) => { entry.source.published_date = '2026-10-07'; entry.source.published_at = '2026-10-07T11:00:00Z'; }, /later than retrieved_at/);
  for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '07/10/2026', null]) invalidNews((_, entry) => { entry.source.published_date = date; }, /real YYYY-MM-DD/);
});

test('UTC times are real, precise, bounded and reject rollover or offset aliases', () => {
  for (const value of ['2026-02-30T10:59:00Z', '2026-10-07T24:00:00Z', '2026-10-07T10:59:00+00:00', '2026-10-07', '2026-10-07T10:59:00.1234Z', '2026-10-07T11:05:00.001Z', 100]) invalidNews(data => { data.checked_at = value; }, /checked_at:/);
  for (const value of ['2026-10-07T11:05:00Z', '2026-10-07T10:59:00.1Z', '2026-10-07T10:59:00.12Z', '2026-10-07T10:59:00.123Z']) {
    const data = news(); data.checked_at = value; validNews(data);
  }
  for (const invalid of [NaN, Infinity, 'today', null]) assert.throws(() => validateNewsDesk(news(), { now: invalid }), /finite timestamp/);
  assert.throws(() => validateEntryWatch(ledger(), { now: NaN }), /finite timestamp/);
});

test('freshness measures truthful feed checks, preserves old publication dates and shows stale state', () => {
  const value = news(); value.checked_at = '2026-10-05T23:00:00Z'; value.items[0].source.retrieved_at = value.checked_at;
  assert.equal(newsFreshness(value, now).status, 'fresh');
  assert.equal(newsFreshness(value, now + 1).status, 'stale');
  assert.equal(newsFreshness(value, now).ageMs, NEWS_STALE_AFTER_MS);
  const future = news(); future.checked_at = '2026-10-07T11:05:00Z'; future.items[0].source.retrieved_at = future.checked_at;
  assert.equal(newsFreshness(future, now).ageMs, 0);
  const refreshedReport = news(); refreshedReport.items[0].source.retrieved_at = '2026-10-05T22:59:59Z';
  assert.equal(newsFreshness(refreshedReport, now).status, 'stale');
  assert.equal(newsFreshness(refreshedReport, now).checkedAt, checked);
  assert.equal(newsFreshness(refreshedReport, now).ageMs, NEWS_STALE_AFTER_MS + 1000);
  const empty = { schema_version: 1, checked_at: '2020-01-01T00:00:00Z', items: [] };
  validNews(empty); assert.equal(newsFreshness(empty, now).status, 'stale');
});

test('watch validates empty and observed histories without mutation, with exactly five configured assets', () => {
  const value = ledger(), before = structuredClone(value);
  assert.equal(validWatch(value), value); assert.deepEqual(value, before);
  validWatch(ledger([])); assert.equal(Object.isFrozen(ENTRY_WATCH_ASSETS), true);
  invalidWatch(value => { value.schema_version = 2; }, /equal 1/);
  invalidWatch(value => { value.assets.reverse(); }, /in that order/);
  invalidWatch(value => { value.assets.pop(); }, /5–5/);
  invalidWatch(value => { value.records = Array(5001).fill(record()); }, /0–5000/);
});

test('watch records reject extra/private fields, missing keys, duplicate IDs and unknown enums', () => {
  invalidWatch(value => { value.wallet = 'private'; }, /unknown property/);
  invalidWatch((_, entry) => { entry.budget = 'private'; }, /unknown property/);
  for (const key of Object.keys(record())) invalidWatch((_, entry) => { delete entry[key]; }, /required/);
  invalidWatch((_, entry, next) => { next.id = entry.id; }, /unique/);
  for (const [field, value] of [['asset', 'BTC'], ['status', 'estimated'], ['quote_currency', 'AUD'], ['interval', '4h'], ['assessment', 'buy']]) invalidWatch((_, entry) => { entry[field] = value; }, /one of:/);
  invalidWatch((_, entry) => { entry.pair = 'render usdt'; }, /instrument identifier/);
  invalidWatch((_, entry) => { entry.venue = 'a'.repeat(81); }, /plain text/);
});

test('unavailable is explicit, excludes invented values and leaves prior market observations intact', () => {
  const value = ledger([record(), second(), unavailable()]); validWatch(value);
  for (const field of ['candle_open_at', 'candle_close_at', 'low', 'close', 'volume', 'compared_with', 'supersedes']) {
    const bad = ledger([unavailable({ [field]: '0' })]); assert.throws(() => validWatch(bad), /must be null/);
  }
  assert.throws(() => validWatch(ledger([unavailable({ assessment: 'baseline' })])), /one of: unknown/);
  validWatch(ledger([unavailable({ source_url: 'https://exchange.example.org/api/symbols?symbol=AKTUSDT' })]));
  invalidWatch((_, entry) => { entry.source_url = null; }, /required for an observed candle/);
});

test('only completed daily UTC candles validate and observation time remains chronological', () => {
  invalidWatch((_, entry) => { entry.candle_close_at = '2026-10-05T23:59:59.999Z'; }, /exclusive next-day close/);
  invalidWatch((_, entry) => { entry.candle_open_at = '2026-10-05T01:00:00Z'; entry.candle_close_at = '2026-10-06T01:00:00Z'; }, /complete UTC day/);
  invalidWatch((_, entry) => { entry.observed_at = '2026-10-05T23:59:59Z'; }, /only completed candles/);
  invalidWatch((_, entry, next) => { next.observed_at = '2026-10-07T10:58:59Z'; }, /chronological/);
  invalidWatch((_, entry) => { entry.observed_at = '2026-10-07T11:05:00.001Z'; }, /five minutes/);
  const nearMidnight = Date.parse('2026-10-06T23:59:00Z');
  const futureClose = ledger([second({ assessment: 'baseline', compared_with: null, observed_at: '2026-10-07T00:00:00Z' })]);
  assert.throws(() => validateEntryWatch(futureClose, { now: nearMidnight }), /complete at validation time/);
});

test('prices and volumes are bounded decimal strings with exact low-to-close ordering', () => {
  for (const value of ['0', '0.00', '-1', '+1', '01', '1e2', '.5', '1.', 'NaN', '1,000', 10, null, '1'.repeat(65)]) invalidWatch((_, entry) => { entry.low = value; }, /low:/);
  for (const value of ['-1', '1e2', 0, null]) invalidWatch((_, entry) => { entry.volume = value; }, /volume:/);
  invalidWatch((_, entry) => { entry.close = '9.9999999999999999999999'; }, /must not exceed close/);
  validWatch(ledger([record({ low: '0.0000000000000000000001', close: '0.0000000000000000000001', volume: '0' })]));
  validWatch(ledger([record({ low: '10.0000', close: '11.0', volume: '0.0000' })]));
});

test('lower-low, equal-low and higher-low classification use exact decimal arithmetic', () => {
  validWatch(ledger([record(), second()]));
  for (const low of ['10', '10.0000', '10.5']) validWatch(ledger([record(), second({ low, close: '11', assessment: 'not_lower_low' })]));
  invalidWatch((_, entry, next) => { next.assessment = 'not_lower_low'; }, /must equal lower_low/);
  const a = '0.123456789012345678901234567890', b = '0.123456789012345678901234567889';
  assert.equal(Number(a), Number(b));
  validWatch(ledger([record({ low: a, close: '1' }), second({ low: b, close: '1' })]));
  assert.throws(() => validWatch(ledger([record({ low: a, close: '1' }), second({ low: b, close: '1', assessment: 'not_lower_low' })])), /must equal lower_low/);
});

test('comparison references only the latest effective preceding candle in the same exact market series', () => {
  invalidWatch((_, entry) => { entry.assessment = 'lower_low'; entry.compared_with = 'future-record'; }, /first candle/);
  invalidWatch((_, entry, next) => { next.compared_with = null; }, /latest effective preceding/);
  invalidWatch((_, entry, next) => { next.compared_with = next.id; }, /latest effective preceding/);
  for (const change of [{ asset: 'POL' }, { venue: 'Other Spot' }, { pair: 'RENDERUSD' }, { quote_currency: 'USD' }]) {
    assert.throws(() => validWatch(ledger([record(), second(change)])), /first candle/);
    validWatch(ledger([record(), second({ ...change, assessment: 'baseline', compared_with: null })]));
  }
  // A missing day is permitted and remains visible in the candle dates.
  validWatch(ledger([record({ candle_open_at: '2026-10-04T00:00:00Z', candle_close_at: '2026-10-05T00:00:00Z' }), second()]));
});

test('new candles cannot backfill out of order or overwrite an existing candle without a revision', () => {
  const first = record(), later = second({ assessment: 'baseline', compared_with: null });
  assert.throws(() => validWatch(ledger([later, first])), /appended in candle order/);
  assert.throws(() => validWatch(ledger([first, record({ id: 'duplicate-candle' })])), /latest revision/);
  assert.throws(() => validWatch(ledger([record({ supersedes: 'unknown-record' })])), /requires an earlier record/);
});

test('corrections append, preserve historical assessments and require explicit latest revision links', () => {
  const revisedFirst = record({ id: 'render-day-one-revised', low: '9', supersedes: 'render-day-one' });
  const historical = ledger([record(), second(), revisedFirst]);
  validWatch(historical); // The day-two historical comparison stays true as logged.
  const revisedSecond = second({ id: 'render-day-two-revised', supersedes: 'render-day-two', compared_with: revisedFirst.id, assessment: 'not_lower_low' });
  const corrected = ledger([...historical.records, revisedSecond]); validWatch(corrected);
  const staleReference = structuredClone(corrected); staleReference.records[3].compared_with = 'render-day-one';
  assert.throws(() => validWatch(staleReference), /latest effective preceding/);
  const staleRevision = structuredClone(corrected); staleRevision.records.push({ ...revisedSecond, id: 'render-day-two-revised-again' });
  assert.throws(() => validWatch(staleRevision), /latest revision/);
  corrected.records.push({ ...revisedSecond, id: 'render-day-two-revised-again', supersedes: revisedSecond.id }); validWatch(corrected);
});

test('trusted previous ledgers enforce an immutable prefix while permitting additions and object key reordering', () => {
  const previous = ledger([record()]), updated = ledger();
  validWatch(updated, { previous });
  assert.throws(() => validWatch(ledger([]), { previous }), /immutable previous ledger prefix/);
  const changed = structuredClone(updated); changed.records[0].note = 'A changed historical note.';
  assert.throws(() => validWatch(changed, { previous }), /immutable previous ledger prefix/);
  const reformatted = structuredClone(updated); reformatted.records[0].observed_at = '2026-10-07T10:59:00.000Z';
  assert.throws(() => validWatch(reformatted, { previous }), /immutable previous ledger prefix/);
  const reordered = structuredClone(updated); reordered.records[0] = Object.fromEntries(Object.entries(reordered.records[0]).reverse());
  validWatch(reordered, { previous });
  const invalidPrevious = structuredClone(previous); invalidPrevious.records[0].wallet = 'private';
  assert.throws(() => validWatch(updated, { previous: invalidPrevious }), /unknown property/);
});

test('schema documents parse, match the runtime field shapes and keep exact keys', async () => {
  const read = async name => JSON.parse(await readFile(new URL(`../data/${name}.schema.json`, import.meta.url), 'utf8'));
  const newsSchema = await read('news-desk'), watchSchema = await read('entry-watch');
  assert.deepEqual([...newsSchema.required].sort(), Object.keys(news()).sort());
  assert.deepEqual([...newsSchema.$defs.source.required].sort(), Object.keys(item().source).sort());
  assert.deepEqual([...watchSchema.required].sort(), Object.keys(ledger()).sort());
  assert.deepEqual([...watchSchema.$defs.record.required].sort(), Object.keys(record()).sort());
  assert.equal(newsSchema.$defs.item.additionalProperties, false);
  assert.equal(watchSchema.$defs.record.additionalProperties, false);
});

test('CLI validates both files, checks trusted history, reports stale state and rejects bad invocations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'news-desk-validator-'));
  try {
    const newsPath = join(dir, 'news.json'), watchPath = join(dir, 'watch.json'), previousPath = join(dir, 'previous.json');
    const value = news(); value.checked_at = '2020-01-01T00:00:00Z'; value.items = [];
    await Promise.all([writeFile(newsPath, JSON.stringify(value)), writeFile(watchPath, JSON.stringify(ledger())), writeFile(previousPath, JSON.stringify(ledger([record()])))]);
    const command = fileURLToPath(new URL('./validate-news-data.mjs', import.meta.url));
    const args = ['--news', newsPath, '--watch', watchPath, '--previous', previousPath, '--now', NOW_ISO];
    const run = (input = args) => spawnSync(process.execPath, [command, ...input], { cwd: dir, encoding: 'utf8' });
    const success = run(); assert.equal(success.status, 0, success.stderr); assert.match(success.stdout, /stale/); assert.match(success.stdout, /Immutable previous prefix verified/);
    for (const input of [['--bad'], ['--news'], ['--news', newsPath, '--news', newsPath], [...args.slice(0, -2), '--now', '2026-02-30T10:00:00Z'], [...args, '--now', NOW_ISO]]) assert.notEqual(run(input).status, 0);
    const modified = ledger(); modified.records[0].note = 'Changed history.'; await writeFile(watchPath, JSON.stringify(modified));
    assert.match(run().stderr, /immutable previous ledger prefix/);
    await writeFile(watchPath, JSON.stringify({ ...ledger(), budget: 'private' })); assert.match(run().stderr, /unknown property/);
    await writeFile(newsPath, '{'); assert.notEqual(run().status, 0);
    assert.equal(run(['--help']).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
