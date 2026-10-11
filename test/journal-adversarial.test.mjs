import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createState, step, stop, resume, compactState, auditState } from '../src/engine/index.mjs';
import { openStore, recoverInterruptedLock } from '../src/store.mjs';
import { MAX_ACTIVE_ENGINE_BYTES } from '../src/runtime.mjs';

// Independently authored adversarial fixtures. No public inputs or network calls.
const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
const cliUrl = new URL('../src/cli.mjs', import.meta.url).href;
const engineUrl = new URL('../src/engine/index.mjs', import.meta.url).href;
const FIXTURE_TIME = 2_000_000;

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-journal-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function quote({ eventId = 'journal-audit-1', now = FIXTURE_TIME, ...overrides } = {}) {
  return { schemaVersion: 1, eventId, source: 'synthetic-fixture', provenance: 'synthetic',
    productId: 'BTC-USD', base: 'BTC', quote: 'USD', observedAt: now, sourceAt: now,
    bids: [[99.9, 10]], asks: [[100, 10]], change24hPct: null,
    history: { low: 99.5, from: now - 60_000, to: now, samples: 7,
      intervalMs: 10_000, complete: false, description: 'Invented journal audit fixture' }, ...overrides };
}

/** Inject a real filesystem API failure or abrupt exit in an isolated process.
 * Module namespace bindings are synchronized to the patched Node fs methods.
 * The fault is armed only after initialization code finishes; never monkeypatch
 * the parent test process or use permissions/security changes to force a fault.
 */
function faultChild({ directory, initialize = '', action, operation, pathPattern,
  occurrence = 1, phase = 'before', mode = 'throw', code = 'ENOSPC' }) {
  const script = `
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original = Object.fromEntries(['openSync','closeSync','writeFileSync','fsyncSync','renameSync','linkSync'].map(name=>[name,fs[name]]));
const paths=new Map(); let armed=false, matched=0, triggered=false;
const options=${JSON.stringify({ operation, pathPattern, occurrence, phase, mode, code })};
fs.openSync=function(file,...args) {const fd=original.openSync.call(fs,file,...args);paths.set(fd,String(file));return fd;};
fs.closeSync=function(fd) {try{return original.closeSync.call(fs,fd)}finally{paths.delete(fd)}};
const fail=()=>{triggered=true;process.stdout.write('FAULT_TRIGGERED\\n');if(options.mode==='crash')process.exit(93);const error=new Error('Injected '+options.code);error.code=options.code;throw error;};
fs[options.operation]=function(...args) {
 const target=['renameSync','linkSync'].includes(options.operation)?String(args[1]):typeof args[0]==='number'?(paths.get(args[0])??''):String(args[0]);
 const hit=armed && new RegExp(options.pathPattern).test(target) && ++matched===options.occurrence;
 if(hit && options.phase==='before')fail();
 if(hit && options.phase==='during' && options.operation==='writeFileSync') {
   const partial=typeof args[1]==='string'?args[1].slice(0,Math.floor(args[1].length/2)):args[1].subarray(0,Math.floor(args[1].length/2));
   original.writeFileSync.apply(fs,[args[0],partial,...args.slice(2)]);fail();
 }
 const result=original[options.operation].apply(fs,args);
 if(hit && options.phase==='after')fail();
 return result;
};
syncBuiltinESMExports();
const {openStore,recoverInterruptedLock}=await import(${JSON.stringify(storeUrl)});
const {replay}=await import(${JSON.stringify(cliUrl)});
const {createState,step}=await import(${JSON.stringify(engineUrl)});
const directory=${JSON.stringify(directory)};
const store=openStore(directory);
${initialize}
armed=true;
try {${action};process.stdout.write(JSON.stringify({returned:true,triggered})+'\\n')}
catch(error){process.stdout.write(JSON.stringify({returned:false,triggered,code:error.code??null,error:error.message})+'\\n')}
`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 10_000 });
}

function near(actual, expected) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8,
    `${actual} differs from independently calculated ${expected}`);
}

function engine(config = {}) {
  return createState({ initialCash: 1000, now: FIXTURE_TIME,
    config: { maxEvents: 2, maxExposurePct: 50, ...config } });
}

function initialize(store, config = {}) {
  return store.dispatch({ type: 'initialize-fixture', wallTime: FIXTURE_TIME, now: FIXTURE_TIME,
    armed: true, initialCash: 1000, config: { maxEvents: 2, maxExposurePct: 50, ...config },
    pid: process.pid, host: os.hostname() });
}
function snapshotCommand(snapshot, now = snapshot.observedAt) {
  return { type: 'snapshot', wallTime: now, now, snapshot };
}
function submit(store, snapshot, now = snapshot.observedAt) {
  return store.dispatch(snapshotCommand(snapshot, now));
}
function recursiveFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(file) : [file];
  });
}
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Independent file/chain inspection: does not use the implementation's reader.
function committedRecords(directory, head) {
  const files = recursiveFiles(path.join(directory, 'journal'));
  const records = [];
  let cursor = head;
  while (cursor.sequence > 0) {
    const expectedName = `${String(cursor.sequence).padStart(16, '0')}-${cursor.hash}.json`;
    const file = files.find(candidate => path.basename(candidate) === expectedName);
    assert.ok(file, `Missing committed record ${cursor.sequence}`);
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(sha256(raw), cursor.hash);
    const record = JSON.parse(raw);
    assert.equal(record.sequence, cursor.sequence);
    assert.equal(record.previous.sequence, cursor.sequence - 1);
    records.push({ file, raw, record });
    cursor = record.previous;
  }
  return records.reverse();
}

test('journal independent: compaction requires explicit durable archive acknowledgement and preserves accounting/control/highwaters', () => {
  const held = step(engine(), quote(), { now: FIXTURE_TIME });
  const paused = stop(held, { now: FIXTURE_TIME });
  assert.throws(() => compactState(paused), /durable archive|history/i);
  const compacted = compactState(paused, { durableArchive: true });
  assert.equal(compacted.ledger.length, 0);
  assert.equal(compacted.seenEvents.length, 0);
  assert.deepEqual(compacted.account, paused.account);
  assert.deepEqual(compacted.control, paused.control);
  assert.deepEqual(compacted.riskHalt, paused.riskHalt);
  assert.deepEqual(compacted.lastSourceAtByProduct, paused.lastSourceAtByProduct);
  assert.equal(compacted.totalFillCount, 1);
  assert.equal(compacted.totalEventCount, 1);
  near(compacted.account.cash + compacted.account.positions['BTC-USD'].costBasis,
    compacted.account.initialCash + compacted.account.realizedPnl);
  assert.equal(auditState(compacted).ok, true);
});

test('journal independent: compacted pure engine requires archive membership evidence before any execution', () => {
  const held = step(engine(), quote(), { now: FIXTURE_TIME });
  const compacted = compactState(held, { durableArchive: true });
  const exit = quote({ eventId: 'archive-lookup-exit', now: FIXTURE_TIME + 1,
    bids: [[98.9, 10]], asks: [[99, 10]] });
  const blocked = step(compacted, exit, { now: FIXTURE_TIME + 1 });
  assert.match(blocked.decision.reason, /duplicate lookup|archive/i);
  assert.equal(blocked.totalFillCount, 1);
  const exited = step(compacted, exit, { now: FIXTURE_TIME + 1,
    knownDuplicate: false, durableArchive: true });
  assert.equal(exited.totalFillCount, 2);
  assert.equal(Object.keys(exited.account.positions).length, 0);
  near(exited.account.cash, 998.5022);
});

test('journal independent: a protective exit at active capacity rolls over without losing STOP or source highwater', () => {
  let state = step(engine(), quote(), { now: FIXTURE_TIME });
  state = step(state, quote({ eventId: 'hold-capacity', now: FIXTURE_TIME + 1 }),
    { now: FIXTURE_TIME + 1, knownDuplicate: false, durableArchive: true });
  assert.equal(state.seenEvents.length, 2);
  state = stop(state, { now: FIXTURE_TIME + 1 });
  const generation = state.control.version;
  const exit = quote({ eventId: 'capacity-exit', now: FIXTURE_TIME + 2,
    bids: [[98.9, 10]], asks: [[99, 10]] });
  state = step(state, exit, { now: FIXTURE_TIME + 2,
    knownDuplicate: false, durableArchive: true });
  assert.equal(state.control.emergencyStop, true);
  assert.equal(state.control.version, generation);
  assert.equal(state.totalFillCount, 2);
  assert.equal(state.totalEventCount, 3);
  assert.equal(state.seenEvents.length, 1);
  assert.equal(state.ledger.length, 1);
  assert.equal(state.ledger[0].side, 'SELL');
  assert.equal(state.lastSourceAtByProduct['BTC-USD'], FIXTURE_TIME + 2);
  assert.equal(Object.keys(state.account.positions).length, 0);
  near(state.account.cash, 998.5022);
});

test('journal independent: persisted input, decision, STOP and protective exit remain replayable across active rollover', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  initialize(store);
  const entry = quote();
  submit(store, entry);
  submit(store, quote({ eventId: 'durable-hold', now: FIXTURE_TIME + 1 }));
  store.dispatch({ type: 'stop', wallTime: FIXTURE_TIME + 2, reason: 'Independent rollover stop' });
  const exit = quote({ eventId: 'durable-exit', now: FIXTURE_TIME + 3,
    bids: [[98.9, 10]], asks: [[99, 10]] });
  submit(store, exit);
  const document = openStore(directory).read();
  assert.equal(document.engine.totalEventCount, 3);
  assert.equal(document.engine.totalFillCount, 2);
  assert.equal(document.control.stopped, true);
  assert.ok(document.engine.seenEvents.length <= 2);
  assert.ok(document.engine.ledger.length <= 2);
  assert.equal(Object.keys(document.engine.account.positions).length, 0);
  near(document.engine.account.cash, 998.5022);
  const records = committedRecords(directory, document.journal);
  assert.equal(records.length, 5);
  const inputs = records.filter(({ record }) => record.command.type === 'snapshot');
  assert.deepEqual(inputs[0].record.command.snapshot, entry);
  assert.deepEqual(inputs.at(-1).record.command.snapshot, exit);
  assert.ok(records.some(({ record }) => record.command.type === 'stop' && record.after.control.stopped));
  for (const { record } of records) {
    assert.deepEqual(record.decision, record.after.engine?.decision ?? null);
    assert.deepEqual(record.execution, record.after.engine?.execution ?? null);
  }
  assert.deepEqual(store.auditJournal(), { ok: true, errors: [], records: 5, completeHistory: true });
});

test('journal independent: archive-wide event IDs and source highwater survive segment rollover and retry', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  initialize(store);
  const entry = quote();
  submit(store, entry);
  submit(store, quote({ eventId: 'segment-hold', now: FIXTURE_TIME + 1 }));
  submit(store, quote({ eventId: 'segment-exit', now: FIXTURE_TIME + 2,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  while (store.read().journal.sequence < 130) {
    store.dispatch({ type: 'worker-status', wallTime: FIXTURE_TIME + 3, status: 'completed' });
  }
  const before = store.read();
  assert.equal(before.engine.seenEvents.includes(entry.eventId), false);
  assert.ok(fs.readdirSync(path.join(directory, 'journal')).length >= 2);
  const disguisedRetry = quote({ eventId: entry.eventId, now: FIXTURE_TIME + 4 });
  const duplicate = submit(store, disguisedRetry);
  assert.match(duplicate.engine.decision.reason, /Duplicate.*archive/i);
  assert.equal(duplicate.engine.totalFillCount, before.engine.totalFillCount);
  assert.equal(duplicate.engine.totalEventCount, before.engine.totalEventCount);
  assert.deepEqual(duplicate.engine.account, before.engine.account);
  const stale = submit(store, quote({ eventId: 'new-id-old-source', now: FIXTURE_TIME + 5,
    sourceAt: FIXTURE_TIME + 1, history: null }));
  assert.match(stale.engine.decision.reason, /Out-of-order|repeated source/);
  assert.equal(stale.engine.lastSourceAtByProduct['BTC-USD'], FIXTURE_TIME + 2);
  assert.equal(stale.engine.totalFillCount, 2);
  const audit = store.auditJournal();
  assert.equal(audit.ok, true, audit.errors.join('; '));
  assert.equal(audit.records, 132);
  assert.equal(committedRecords(directory, stale.journal).length, 132);
});

test('journal independent: missing, truncated or altered committed archives fail closed without empty-state fallback', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  initialize(store);
  submit(store, quote());
  const before = store.read();
  const { file, raw } = committedRecords(directory, before.journal)[0];
  for (const mutation of ['truncate', 'alter', 'remove']) {
    fs.writeFileSync(file, raw);
    if (mutation === 'truncate') fs.writeFileSync(file, raw.slice(0, Math.floor(raw.length / 2)));
    if (mutation === 'alter') fs.writeFileSync(file, raw.replace('initialize-fixture', 'initialize-forged'));
    if (mutation === 'remove') fs.unlinkSync(file);
    assert.throws(() => store.read(), /JOURNAL_CORRUPT/);
    assert.equal(store.auditJournal().ok, false);
    assert.throws(() => store.dispatch({ type: 'stop', wallTime: FIXTURE_TIME + 1 }), /JOURNAL_CORRUPT/);
  }
  fs.writeFileSync(file, raw);
  assert.deepEqual(store.read(), before);
  fs.unlinkSync(path.join(directory, 'state.json'));
  assert.throws(() => store.read(), /STATE_MISSING/);
});

test('journal independent: replay audit detects a changed input even if its record and state-pointer checksums are recomputed', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  initialize(store);
  submit(store, quote());
  const before = store.read();
  const headRecord = committedRecords(directory, before.journal).at(-1);
  const changed = structuredClone(headRecord.record);
  changed.command.snapshot.quote = 'USDT';
  const raw = JSON.stringify(changed) + '\n';
  const hash = sha256(raw);
  const newPath = path.join(path.dirname(headRecord.file), `${String(changed.sequence).padStart(16, '0')}-${hash}.json`);
  fs.writeFileSync(newPath, raw);
  before.journal.hash = hash;
  const payload = JSON.stringify(before);
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ format: 1, payload, sha256: sha256(payload) }));
  const audit = store.auditJournal();
  assert.equal(audit.ok, false);
  assert.match(audit.errors.join('; '), /REPLAY_FAILED|state differs|identity|currency/i);
});

test('journal independent: explicit migration preserves exact baseline bytes and labels unreconstructible earlier inputs', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  const original = JSON.stringify(BASELINE_ENVELOPE) + '\n';
  fs.writeFileSync(path.join(directory, 'state.json'), original);
  const legacy = store.read();
  assert.equal(legacy.version, 1);
  assert.throws(() => store.dispatch({ type: 'stop', wallTime: FIXTURE_TIME }), /MIGRATION_REQUIRED/);
  assert.equal(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'), original);
  const migrated = store.migrateLegacy();
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.engine.account, legacy.engine.account);
  assert.deepEqual(migrated.engine.control, legacy.engine.control);
  assert.deepEqual(migrated.engine.lastSourceAtByProduct, legacy.engine.lastSourceAtByProduct);
  const records = committedRecords(directory, migrated.journal);
  assert.equal(records.length, 1);
  assert.equal(records[0].record.kind, 'legacy-migration');
  assert.equal(records[0].record.legacy.envelope, original);
  assert.equal(records[0].record.legacy.historicalInputsReconstructible, false);
  const audit = store.auditJournal();
  assert.equal(audit.ok, true, audit.errors.join('; '));
  assert.equal(audit.completeHistory, false);
  assert.equal(audit.legacyBoundary.historicalInputsReconstructible, false);
  submit(store, quote({ eventId: 'migration-hold', now: FIXTURE_TIME + 1 }));
  submit(store, quote({ eventId: 'migration-exit', now: FIXTURE_TIME + 2,
    bids: [[98.9, 10]], asks: [[99, 10]] }));
  const duplicate = submit(store, quote({ eventId: 'baseline-migration-buy', now: FIXTURE_TIME + 3 }));
  assert.match(duplicate.engine.decision.reason, /Duplicate.*archive/i);
  assert.equal(duplicate.engine.totalFillCount, 2);
  assert.equal(store.auditJournal().ok, true);
  assert.equal(store.auditJournal().completeHistory, false);
});

test('journal independent: byte rollover on a many-leg protective exit preserves uncompacted economics and archived identity', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  const denseBids = best => Array.from({ length: 1000 }, (_, i) => [best - i * 0.00003333333333, 0.001]);
  let reference = engine({ maxEvents: 10000 });
  let event = 0, held, exit, expected;
  for (let cycle = 0; cycle < 100; cycle++) {
    const entry = quote({ eventId: `byte-entry-${event}`, now: FIXTURE_TIME + ++event });
    reference = step(reference, entry, { now: entry.observedAt });
    const paused = stop(reference, { now: reference.asOf, reason: 'Byte rollover entry pause' });
    const candidate = quote({ eventId: `byte-final-exit-${event}`, now: FIXTURE_TIME + event + 1,
      bids: denseBids(98.9), asks: [[99, 10]] });
    const wouldExit = step(paused, candidate, { now: candidate.observedAt });
    if (Buffer.byteLength(JSON.stringify(paused)) <= MAX_ACTIVE_ENGINE_BYTES &&
        Buffer.byteLength(JSON.stringify(wouldExit)) > MAX_ACTIVE_ENGINE_BYTES) {
      held = reference; exit = candidate; expected = wouldExit; break;
    }
    const profit = quote({ eventId: `byte-profit-${event}`, now: FIXTURE_TIME + ++event,
      bids: denseBids(102), asks: [[102.1, 10]] });
    reference = step(reference, profit, { now: profit.observedAt });
  }
  assert.ok(held && expected, 'Fixture must actually cross the byte budget on a protective SELL');
  assert.ok(held.seenEvents.length < held.config.maxEvents, 'This must challenge bytes, not event-count capacity');

  // A synthetic schema-1 representation efficiently supplies a large existing
  // ledger; migration preserves its stated missing-input-history boundary.
  const legacyEngine = structuredClone(held);
  legacyEngine.schemaVersion = 1;
  for (const key of ['checkpoint', 'totalFillCount', 'totalEventCount', 'lastFill']) delete legacyEngine[key];
  assert.equal(auditState(legacyEngine).ok, true);
  const legacy = { version: 1, revision: 7, mode: 'fixture-replay',
    control: { stopped: false, stopRequested: false }, engine: legacyEngine, observations: [],
    worker: { status: 'completed', lastCycleAt: null, error: null }, errors: [] };
  const payload = JSON.stringify(legacy);
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ format: 1, payload, sha256: sha256(payload) }));
  store.migrateLegacy();
  store.dispatch({ type: 'stop', wallTime: exit.observedAt, reason: 'Byte rollover entry pause' });
  const before = store.read();
  assert.equal(before.engine.checkpoint.totalEventCount, 0, 'Stop itself must not consume this byte-boundary fixture');
  const result = submit(store, exit);
  assert.ok(Buffer.byteLength(JSON.stringify(result.engine)) <= MAX_ACTIVE_ENGINE_BYTES);
  assert.equal(result.engine.checkpoint.totalEventCount, expected.totalEventCount);
  assert.equal(result.engine.totalFillCount, expected.totalFillCount);
  assert.deepEqual(result.engine.account, expected.account);
  assert.equal(result.control.stopped, true);
  assert.equal(result.engine.lastFill.side, 'SELL');
  assert.equal(result.engine.ledger.length, 0);
  assert.equal(result.engine.seenEvents.length, 0);
  assert.deepEqual(openStore(directory).read(), result);
  const priorAccount = structuredClone(result.engine.account);
  store.dispatch({ type: 'resume-fixture', wallTime: exit.observedAt + 1 });
  const reused = submit(store, quote({ eventId: held.seenEvents[0], now: exit.observedAt + 2 }));
  assert.match(reused.engine.decision.reason, /Duplicate.*archive/i);
  assert.deepEqual(reused.engine.account, priorAccount);
  assert.equal(reused.engine.lastSourceAtByProduct['BTC-USD'], exit.sourceAt);
  const audit = store.auditJournal();
  assert.equal(audit.ok, true, audit.errors.join('; '));
  assert.equal(audit.completeHistory, false);
});

test('journal independent: irreducibly oversized migrated state refuses a typed update without acknowledging or replacing state', (t) => {
  const directory = temporaryDirectory(t), store = openStore(directory);
  const legacy = JSON.parse(BASELINE_ENVELOPE.payload);
  legacy.engine.accountingBasis = 'x'.repeat(MAX_ACTIVE_ENGINE_BYTES + 4096);
  const payload = JSON.stringify(legacy);
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ format: 1, payload, sha256: sha256(payload) }));
  const migrated = store.migrateLegacy();
  const bytes = fs.readFileSync(path.join(directory, 'state.json'));
  assert.throws(() => store.dispatch({ type: 'stop', wallTime: FIXTURE_TIME + 1 }), /ACTIVE_STATE_CAPACITY/);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'state.json')), bytes);
  assert.deepEqual(store.read(), migrated);
  assert.equal(store.auditJournal().ok, true);
});

const journalFilePattern = '/journal/[^/]+/[^/]+\\.json$';
const journalPreparedPattern = '/journal/[^/]+/\\.prepared-[^/]+$';
const snapshotTemporaryPattern = '/state-[^/]+\\.tmp$';
const snapshotDestinationPattern = '/state\\.json$';
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('journal independent: ENOSPC and fsync/rename errors never acknowledge a partial input/accounting commit', async (t) => {
  const cases = [
    { name: 'before journal write', operation: 'writeFileSync', pathPattern: journalPreparedPattern },
    { name: 'during journal write', operation: 'writeFileSync', pathPattern: journalPreparedPattern, phase: 'during' },
    { name: 'before prepared journal fsync', operation: 'fsyncSync', pathPattern: journalPreparedPattern, code: 'EIO' },
    { name: 'before journal fsync', operation: 'fsyncSync', pathPattern: journalFilePattern, code: 'EIO' },
    { name: 'before snapshot write', operation: 'writeFileSync', pathPattern: snapshotTemporaryPattern },
    { name: 'before snapshot fsync', operation: 'fsyncSync', pathPattern: snapshotTemporaryPattern, code: 'EIO' },
    { name: 'before authoritative rename', operation: 'renameSync', pathPattern: snapshotDestinationPattern, code: 'EIO' },
    { name: 'after authoritative rename', operation: 'renameSync', pathPattern: snapshotDestinationPattern, phase: 'after', code: 'EIO', published: true },
    { name: 'before final directory fsync', operation: 'fsyncSync', directoryPattern: true, occurrence: 3, code: 'EIO', published: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, (t) => {
    const directory = temporaryDirectory(t), store = openStore(directory);
    initialize(store);
    const before = store.read();
    const command = snapshotCommand(quote({ eventId: `fault-${scenario.name}` }), FIXTURE_TIME + 1);
    const child = faultChild({ directory, ...scenario,
      pathPattern: scenario.directoryPattern ? `${escapeRegex(directory)}$` : scenario.pathPattern,
      action: `store.dispatch(${JSON.stringify(command)})` });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /FAULT_TRIGGERED/);
    assert.match(child.stdout, /"returned":false/);
    assert.doesNotMatch(child.stdout, /"returned":true/);
    const reopened = openStore(directory).read();
    assert.equal(reopened.revision, before.revision + (scenario.published ? 1 : 0));
    assert.equal(reopened.engine.totalFillCount, scenario.published ? 1 : 0);
    const audit = store.auditJournal();
    assert.equal(audit.ok, true, audit.errors.join('; '));
    const evidence = recursiveFiles(path.join(directory, 'journal')).map(file => [file, fs.readFileSync(file)]);
    // Even a byte-identical retry succeeds. Incomplete unique prepared files
    // stay evidence and never occupy or masquerade as a committed hash path.
    const retried = store.dispatch(command);
    assert.equal(retried.engine.totalFillCount, 1);
    near(retried.engine.account.cash, 899.8);
    assert.equal(store.dispatch({ ...command, wallTime: command.wallTime + 1 }).engine.totalFillCount, 1);
    assert.equal(store.auditJournal().ok, true);
    for (const [file, bytes] of evidence) assert.deepEqual(fs.readFileSync(file), bytes);
  });
});

test('journal independent: abrupt crashes before, during and after publication preserve one coherent recoverable commit', async (t) => {
  const cases = [
    { name: 'before journal bytes', operation: 'writeFileSync', pathPattern: journalPreparedPattern },
    { name: 'during journal bytes', operation: 'writeFileSync', pathPattern: journalPreparedPattern, phase: 'during' },
    { name: 'after prepared journal fsync', operation: 'fsyncSync', pathPattern: journalPreparedPattern, phase: 'after' },
    { name: 'after immutable record link', operation: 'linkSync', pathPattern: journalFilePattern, phase: 'after' },
    { name: 'after journal fsync', operation: 'fsyncSync', pathPattern: journalFilePattern, phase: 'after' },
    { name: 'during snapshot bytes', operation: 'writeFileSync', pathPattern: snapshotTemporaryPattern, phase: 'during' },
    { name: 'after authoritative rename', operation: 'renameSync', pathPattern: snapshotDestinationPattern, phase: 'after', published: true },
    { name: 'after final directory fsync before acknowledgment', operation: 'fsyncSync', directoryPattern: true, occurrence: 3, phase: 'after', published: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, (t) => {
    const directory = temporaryDirectory(t), store = openStore(directory);
    initialize(store);
    const before = store.read();
    const command = snapshotCommand(quote({ eventId: `crash-${scenario.name}` }), FIXTURE_TIME + 1);
    const child = faultChild({ directory, ...scenario, mode: 'crash',
      pathPattern: scenario.directoryPattern ? `${escapeRegex(directory)}$` : scenario.pathPattern,
      action: `store.dispatch(${JSON.stringify(command)})` });
    assert.equal(child.status, 93, child.stderr);
    assert.match(child.stdout, /FAULT_TRIGGERED/);
    assert.doesNotMatch(child.stdout, /"returned":true/);
    const reopened = openStore(directory).read();
    assert.equal(reopened.revision, before.revision + (scenario.published ? 1 : 0));
    assert.equal(reopened.engine.totalFillCount, scenario.published ? 1 : 0);
    assert.throws(() => store.dispatch(command), /STORE_LOCKED/);
    const recovered = recoverInterruptedLock(directory);
    assert.ok(fs.existsSync(recovered.retained));
    const result = store.dispatch({ ...command, wallTime: command.wallTime + 1 });
    assert.equal(result.engine.totalFillCount, 1);
    near(result.engine.account.cash, 899.8);
    const audit = store.auditJournal();
    assert.equal(audit.ok, true, audit.errors.join('; '));
    assert.equal(committedRecords(directory, result.journal).length, result.journal.sequence);
  });
});

// Captured from reviewed baseline tree cc02395ed39579b4530c8e5622ae3000f13cf1ea before engine changes.
const BASELINE_ENVELOPE = {"format":1,"sha256":"9f8d36323460da10a922168564566b64e56a379b7e43bb0a6d3f065d2ab59bd3","payload":"{\"version\":1,\"revision\":1,\"mode\":\"fixture-replay\",\"control\":{\"stopped\":false,\"stopRequested\":false},\"engine\":{\"schemaVersion\":1,\"mode\":\"synthetic-paper\",\"strategyVersion\":\"observed-window-low-v1\",\"accountingBasis\":\"Configured synthetic USD cash; synthetic fixture performance only. Bid marks include paid fees, exclude prospective exit fees.\",\"config\":{\"maxOrderNotional\":100,\"maxPositionNotional\":250,\"maxExposurePct\":50,\"maxDrawdownPct\":5,\"maxLossUsd\":100,\"feeBps\":20,\"slippageBps\":0,\"maxSlippageBps\":30,\"maxSpreadBps\":25,\"minDepthNotional\":100,\"maxSnapshotAgeMs\":15000,\"maxSignalAgeMs\":2000,\"latencyMs\":0,\"minHistorySamples\":5,\"minHistoryWindowMs\":60000,\"buyDistanceFromLowPct\":1,\"stopLossPct\":1,\"takeProfitPct\":2,\"maxEvents\":2},\"createdAt\":2000000,\"asOf\":2000000,\"account\":{\"initialCash\":1000,\"cash\":899.8,\"positions\":{\"BTC-USD\":{\"quantity\":1,\"costBasis\":100.2,\"stopPrice\":99,\"targetPrice\":102,\"openedAt\":2000000,\"markPrice\":99.9,\"markAsOf\":2000000,\"markStatus\":\"observed-bid\"}},\"realizedPnl\":0,\"unrealizedPnl\":-0.29999999999999716,\"equity\":999.6999999999999,\"marketValue\":99.9,\"feesPaid\":0.2,\"peakEquity\":1000,\"drawdownPct\":0.030000000000006823,\"netReturnPct\":-0.030000000000007798,\"valuationComplete\":true},\"control\":{\"emergencyStop\":false,\"entryPaused\":false,\"version\":0,\"stoppedAt\":null,\"stopReason\":null,\"resumedAt\":null,\"exitPolicy\":\"fresh-synthetic-protective-exits\"},\"riskHalt\":{\"active\":false,\"reasons\":[]},\"marketByProduct\":{\"BTC-USD\":{\"schemaVersion\":1,\"eventId\":\"baseline-migration-buy\",\"source\":\"synthetic-fixture\",\"provenance\":\"synthetic\",\"productId\":\"BTC-USD\",\"base\":\"BTC\",\"quote\":\"USD\",\"observedAt\":2000000,\"sourceAt\":2000000,\"bids\":[[99.9,10]],\"asks\":[[100,10]],\"change24hPct\":null,\"history\":{\"low\":99.5,\"from\":1940000,\"to\":2000000,\"samples\":7,\"intervalMs\":10000,\"complete\":false,\"description\":\"Invented baseline migration fixture\"}}},\"seenEvents\":[\"baseline-migration-buy\"],\"lastSourceAtByProduct\":{\"BTC-USD\":2000000},\"ledger\":[{\"id\":\"fill:baseline-migration-buy\",\"eventId\":\"baseline-migration-buy\",\"productId\":\"BTC-USD\",\"side\":\"BUY\",\"quantity\":1,\"requestedQuantity\":1,\"averagePrice\":100,\"expectedPrice\":100,\"notional\":100,\"fee\":0.2,\"slippageCost\":0,\"status\":\"filled\",\"canceledQuantity\":0,\"legs\":[{\"price\":100,\"observedPrice\":100,\"quantity\":1}],\"sourceAt\":2000000,\"decidedAt\":2000000,\"simulatedFillAt\":2000000,\"stopPrice\":99,\"targetPrice\":102,\"provenance\":\"synthetic\",\"assumption\":\"Zero-latency immediate-or-cancel depth walk plus 0 bps adverse price assumption, within 30 bps total cap; no future liquidity, queue or network latency prediction\",\"sequence\":1,\"cashAfter\":899.8}],\"decision\":{\"action\":\"BUY\",\"reason\":\"Ask lies within 1% of the explicitly reported 7-sample window low; this is not an all-time low\",\"at\":2000000,\"productId\":\"BTC-USD\",\"proposal\":{\"eventId\":\"baseline-migration-buy\",\"productId\":\"BTC-USD\",\"createdAt\":2000000,\"sourceAt\":2000000,\"controlVersion\":0,\"strategyVersion\":\"observed-window-low-v1\",\"side\":\"BUY\",\"quantity\":1,\"expectedPrice\":100,\"stopPrice\":99,\"targetPrice\":102,\"reason\":\"observed-window-low\"}},\"execution\":{\"id\":\"fill:baseline-migration-buy\",\"eventId\":\"baseline-migration-buy\",\"productId\":\"BTC-USD\",\"side\":\"BUY\",\"quantity\":1,\"requestedQuantity\":1,\"averagePrice\":100,\"expectedPrice\":100,\"notional\":100,\"fee\":0.2,\"slippageCost\":0,\"status\":\"filled\",\"canceledQuantity\":0,\"legs\":[{\"price\":100,\"observedPrice\":100,\"quantity\":1}],\"sourceAt\":2000000,\"decidedAt\":2000000,\"simulatedFillAt\":2000000,\"stopPrice\":99,\"targetPrice\":102,\"provenance\":\"synthetic\",\"assumption\":\"Zero-latency immediate-or-cancel depth walk plus 0 bps adverse price assumption, within 30 bps total cap; no future liquidity, queue or network latency prediction\",\"at\":2000000,\"entry\":100,\"size\":1,\"stop\":99,\"target\":102},\"engine\":{\"status\":\"processed\",\"lastEventAt\":2000000,\"lastEventId\":\"baseline-migration-buy\",\"lastError\":null,\"workerStatus\":\"not-running\"}},\"observations\":[],\"worker\":{\"status\":\"not started\",\"lastCycleAt\":null,\"error\":null},\"errors\":[]}"};
