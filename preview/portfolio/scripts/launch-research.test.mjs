import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLaunchResearch, validateLaunchLedger, researchFreshness, candidateFingerprintInput } from '../portfolio/launch-research-data.mjs';

const now = Date.parse('2026-10-07T05:00:00Z');
const checked = '2026-10-07T04:59:00Z';
const sourceUrl = 'https://project.example.org/news/launch';
const exchangeSource = 'https://exchange.example.org/announcements/project';
const candidate = () => ({
  id: 'project-one', name: 'Project One', symbol: 'ONE', status: 'prelaunch',
  summary: 'A public launch announcement is under review.',
  risks: ['Launch timing and venue access may change.'],
  official_url: 'https://project.example.org/',
  launch: { date: '2026-10-08', time_utc: null, source_url: sourceUrl },
  venues: [{ name: 'Example Exchange', status: 'announced', url: 'https://exchange.example.org/spot/ONE-USD', source_url: exchangeSource, checked_at: checked }],
  sources: [{ label: 'Official project announcement', url: sourceUrl, checked_at: checked }, { label: 'Official exchange announcement', url: exchangeSource, checked_at: checked }],
  australia_eligibility: 'unverified',
});
const report = () => ({ schema_version: 1, checked_at: checked, candidates: [candidate()] });
const entry = () => ({ candidate_id: 'project-one', checked_at: checked, event: 'added', fingerprint: 'a'.repeat(64), note: 'Added an official public launch announcement.' });
const ledger = () => ({ schema_version: 1, entries: [entry()] });
const valid = data => validateLaunchResearch(data, { now });
const invalid = (mutate, pattern) => { const data = report(); mutate(data, data.candidates[0]); assert.throws(() => valid(data), pattern); };

test('valid public records and empty shortlists pass without mutation', () => {
  const data = report(), before = structuredClone(data);
  assert.equal(valid(data), data);
  assert.deepEqual(data, before);
  data.candidates = [];
  assert.equal(valid(data), data);
  assert.equal(validateLaunchLedger({ schema_version: 1, entries: [] }, { now }).entries.length, 0);
});

test('every object level rejects unknown and missing keys', () => {
  const paths = [data => data, data => data.candidates[0], data => data.candidates[0].launch,
    data => data.candidates[0].venues[0], data => data.candidates[0].sources[0]];
  for (const select of paths) {
    invalid(data => { select(data).wallet_address = 'private'; }, /unknown property/);
    const keys = Object.keys(select(report()));
    for (const key of keys) invalid(data => { delete select(data)[key]; }, /required/);
  }
  invalid(data => { Object.defineProperty(data, Symbol('private'), { value: 1 }); }, /unknown property/);
  invalid(data => { Object.defineProperty(data, 'checked_at', { get: () => checked }); }, /JSON value/);
  assert.throws(() => valid(Object.assign(new Date(), report())), /plain object/);
  assert.throws(() => valid(null), /plain object/);
});

test('candidate count, identity and schema version are strict', () => {
  invalid(data => { data.schema_version = '1'; }, /equal 1/);
  invalid(data => { data.candidates.push(candidate()); }, /unique/);
  invalid(data => { data.candidates = Array.from({ length: 4 }, (_, i) => ({ ...candidate(), id: `project-${i}` })); }, /0–3/);
  const data = report(); data.candidates = Array.from({ length: 3 }, (_, i) => ({ ...candidate(), id: `project-${i}` })); valid(data);
  for (const id of ['ONE', 'project_one', '-project', 'project-', 'project--one', 'a'.repeat(65), 123]) invalid((_, item) => { item.id = id; }, /id:/);
  for (const symbol of ['one', 'ONE USD', '<ONE>', '', 'A'.repeat(21), null]) invalid((_, item) => { item.symbol = symbol; }, /symbol:/);
});

test('all arrays are bounded and reject sparse or decorated input', () => {
  for (const field of ['sources', 'risks']) invalid((_, item) => { item[field] = []; }, new RegExp(field));
  invalid((_, item) => { item.sources = Array.from({ length: 7 }, () => item.sources[0]); }, /1–6/);
  invalid((_, item) => { item.risks = Array(4).fill('Timing may change.'); }, /1–3/);
  invalid((_, item) => { item.venues = Array(4).fill(item.venues[0]); }, /0–3/);
  invalid(data => { data.candidates = Array(1); }, /dense JSON array/);
  invalid(data => { data.candidates.privateData = true; }, /dense JSON array/);
});

test('prose rejects markup, controls, direction overrides and unbounded input', () => {
  for (const summary of ['', ' leading', 'trailing ', '<img src=x>', '**bold**', '`code`', '[click](https://example.org)', '# Heading', 'two\nlines', 'hidden\u0000text', 'direction\u202etext', 'zero\u200bwidth', 'a'.repeat(601)]) invalid((_, item) => { item.summary = summary; }, /plain text/);
  for (const [field, length] of [['name', 101], ['summary', 601]]) invalid((_, item) => { item[field] = 'a'.repeat(length); }, /plain text/);
  invalid((_, item) => { item.risks[0] = 'a'.repeat(241); }, /plain text/);
  invalid((_, item) => { item.venues[0].name = 'a'.repeat(81); }, /plain text/);
  invalid((_, item) => { item.sources[0].label = 'a'.repeat(121); }, /plain text/);
  const data = report(); data.candidates[0].summary = 'a'.repeat(600); valid(data);
});

test('obvious assurances of returns or safety are rejected in public text', () => {
  for (const phrase of ['Guaranteed returns', 'guaranteed high profits', 'Risk-free investment', 'zero risk', '100% safe', 'You cannot lose money', 'Returns are guaranteed']) invalid((_, item) => { item.summary = phrase; }, /assured investment/);
});

test('HTTPS links reject credentials, private hosts and literal-address bypasses', () => {
  for (const url of ['http://example.org', 'javascript:alert(1)', '//example.org', 'https://user:password@example.org', 'https://@example.org', 'https://localhost', 'https://localhost.', 'https://sub.localhost', 'https://service.internal', 'https://printer.local', 'https://printer', 'https://10.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1', 'https://172.31.0.1', 'https://192.168.1.1', 'https://169.254.169.254', 'https://100.64.0.1', 'https://0.0.0.0', 'https://224.0.0.1', 'https://[::1]', 'https://[fc00::1]', 'https://[fe80::1]', 'https://[::ffff:127.0.0.1]', 'https://[64:ff9b::7f00:1]', 'https://[2002:7f00:1::]', 'https://[2001:db8::1]', 'https://example.org/\npath', 'https://example.org\\path', 'https://exa\u202emple.org', 'https://example.org/<script>', 'https://example.org/' + 'a'.repeat(2048)]) invalid((_, item) => { item.official_url = url; }, /official_url:/);
  for (const url of ['https://example.org/path?x=1#details', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/', 'https://project.example.org.']) { const data = report(); data.candidates[0].official_url = url; valid(data); }
});

test('all URL fields share public-host checks', () => {
  for (const setter of [item => { item.launch.source_url = 'https://127.0.0.1'; }, item => { item.venues[0].url = 'https://127.0.0.1'; }, item => { item.venues[0].source_url = 'https://127.0.0.1'; }, item => { item.sources[0].url = 'https://127.0.0.1'; }]) invalid((_, item) => setter(item), /public host/);
});

test('launch dates require cited evidence, times require dates, and unknowns stay null', () => {
  invalid((_, item) => { item.launch.source_url = null; }, /required for a known launch date/);
  invalid((_, item) => { item.launch.date = null; item.launch.time_utc = '09:00:00'; }, /requires a launch date/);
  invalid((_, item) => { item.launch.source_url = 'https://project.example.org/other'; }, /match a source citation/);
  for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '08/10/2026', '', undefined]) invalid((_, item) => { item.launch.date = date; }, /launch.date:/);
  for (const time of ['24:00:00', '12:60:00', '12:00:60', '09:00', '9:00:00', '', 100]) invalid((_, item) => { item.launch.time_utc = time; }, /time_utc:/);
  for (const launch of [{ date: null, time_utc: null, source_url: null }, { date: null, time_utc: null, source_url: sourceUrl }, { date: '2028-02-29', time_utc: '00:00:00', source_url: sourceUrl }]) { const data = report(); data.candidates[0].launch = launch; valid(data); }
});

test('venue availability cannot be guessed or promoted without a cited official link', () => {
  for (const status of ['announced', 'available', 'closed']) {
    invalid((_, item) => { item.venues[0].status = status; item.venues[0].url = null; }, /official URL and source URL/);
    invalid((_, item) => { item.venues[0].status = status; item.venues[0].source_url = null; }, /official URL and source URL/);
  }
  invalid((_, item) => { item.venues[0].source_url = 'https://exchange.example.org/other'; }, /match a source citation/);
  invalid((_, item) => { item.venues[0].status = 'unconfirmed'; }, /must be null/);
  invalid((_, item) => { item.status = 'available'; }, /requires an available venue/);
  const data = report(); data.candidates[0].status = 'available'; data.candidates[0].venues[0].status = 'available'; valid(data);
  data.candidates[0].status = 'watch'; data.candidates[0].venues = [{ name: 'Possible venue', status: 'unconfirmed', url: null, source_url: null, checked_at: checked }]; valid(data);
});

test('enums and regional eligibility are exact and source citations are unique', () => {
  invalid((_, item) => { item.status = 'safe'; }, /one of:/);
  invalid((_, item) => { item.venues[0].status = 'listed'; }, /one of:/);
  for (const eligibility of ['yes', 'eligible', true, null]) invalid((_, item) => { item.australia_eligibility = eligibility; }, /unverified/);
  invalid((_, item) => { item.sources.push({ ...item.sources[0], label: 'Duplicate' }); }, /duplicate a source citation/);
});

test('UTC timestamps reject invalid dates, offsets and future observations', () => {
  for (const value of ['2026-02-30T04:59:00Z', '2026-10-07T24:00:00Z', '2026-10-07T04:59:00+00:00', '2026-10-07', '2026-10-07T04:59:00.1234Z', '2026-10-07T05:05:00.001Z', null, 100]) invalid(data => { data.checked_at = value; }, /checked_at:/);
  invalid((_, item) => { item.sources[0].checked_at = '2026-10-07T04:59:00.001Z'; }, /later than the report/);
  invalid((_, item) => { item.venues[0].checked_at = '2026-10-07T04:59:00.001Z'; }, /later than the report/);
  for (const value of ['2026-10-07T05:05:00Z', '2026-10-07T04:59:00.1Z', '2026-10-07T04:59:00.12Z', '2026-10-07T04:59:00.123Z']) { const data = report(); data.checked_at = value; valid(data); }
  assert.throws(() => validateLaunchResearch(report(), { now: NaN }), /finite timestamp/);
});

test('36-hour freshness uses the oldest evidence and accepts valid old records', () => {
  const data = report();
  const oldest = now - 36 * 60 * 60 * 1000;
  data.candidates[0].sources[0].checked_at = new Date(oldest).toISOString();
  valid(data); assert.equal(researchFreshness(data, now), 'current');
  assert.equal(researchFreshness(data, now + 1), 'stale');
  data.candidates[0].sources[0].checked_at = checked;
  data.candidates[0].venues[0].checked_at = new Date(oldest - 1).toISOString();
  assert.equal(researchFreshness(data, now), 'stale');
  const empty = { schema_version: 1, checked_at: new Date(oldest - 1).toISOString(), candidates: [] };
  valid(empty); assert.equal(researchFreshness(empty, now), 'stale');
});

test('canonical candidate fingerprints ignore only checked_at and sort object keys', () => {
  const first = candidate(), second = Object.fromEntries(Object.entries(candidate()).reverse());
  second.sources = second.sources.map(source => Object.fromEntries(Object.entries(source).reverse()));
  second.sources[0].checked_at = '2026-10-06T00:00:00Z';
  second.venues[0].checked_at = '2026-10-06T00:00:00Z';
  assert.equal(candidateFingerprintInput(first), candidateFingerprintInput(second));
  assert.equal(candidateFingerprintInput(first).includes('checked_at'), false);
  const hash = value => createHash('sha256').update(candidateFingerprintInput(value)).digest('hex');
  assert.equal(hash(first), hash(second));
  second.summary = 'The official launch timing changed.';
  assert.notEqual(hash(first), hash(second));
  assert.equal(first.sources[0].checked_at, checked);
});

test('ledger validates public revision identity, chronology and exact keys', () => {
  const data = ledger(); assert.equal(validateLaunchLedger(data, { now }), data);
  for (const mutate of [item => { item.notifications = []; }, item => { item.entries[0].account = 'private'; }, item => { delete item.entries[0].event; }, item => { item.entries[0].candidate_id = 'BAD ID'; }, item => { item.entries[0].event = 'notified'; }, item => { item.entries[0].fingerprint = 'A'.repeat(64); }, item => { item.entries[0].note = '<script>'; }, item => { item.entries[0].checked_at = '2026-10-07T06:00:00Z'; }, item => { item.entries.push({ ...entry(), checked_at: '2026-10-07T04:58:00Z' }); }, item => { item.entries.push({ ...entry(), checked_at: '2026-10-07T04:59:00.000Z', fingerprint: 'b'.repeat(64) }); }]) {
    const bad = ledger(); mutate(bad); assert.throws(() => validateLaunchLedger(bad, { now }));
  }
  data.entries.push({ ...entry(), checked_at: '2026-10-07T05:00:00Z', event: 'updated' });
  validateLaunchLedger(data, { now }); // Returning to an earlier content state is legitimate.
  data.entries = Array(1001).fill(entry()); assert.throws(() => validateLaunchLedger(data, { now }), /0–1000/);
});

test('CLI validates both files, reports stale data honestly and fails invalid input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'launch-research-'));
  try {
    const dataPath = join(dir, 'research.json'), ledgerPath = join(dir, 'ledger.json');
    const data = report(); data.checked_at = '2020-01-01T00:00:00Z'; data.candidates = [];
    await writeFile(dataPath, JSON.stringify(data));
    await writeFile(ledgerPath, JSON.stringify({ schema_version: 1, entries: [] }));
    const command = fileURLToPath(new URL('./validate-launch-research.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [command, dataPath, ledgerPath], { cwd: dir, encoding: 'utf8' });
    const success = run(); assert.equal(success.status, 0, success.stderr); assert.match(success.stdout, /stale/);
    await writeFile(ledgerPath, JSON.stringify({ schema_version: 1, entries: [], notifications: [] }));
    const failed = run(); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /unknown property/);
    await writeFile(dataPath, '{'); assert.notEqual(run().status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
