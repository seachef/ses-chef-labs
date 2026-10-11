import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { openStore, initialDocument, recoverInterruptedLock } from '../src/store.mjs';
import { canonical, digest, emptyHead, hasEventInHistory, readRecord, recordPath, walkJournal } from '../src/journal.mjs';
import { createState, step } from '../src/engine/index.mjs';

const storeUrl = new URL('../src/store.mjs', import.meta.url).href;
const now = 1_000_000;
function storage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neptune-journal-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return openStore(directory);
}
function init(store, config = {}) {
  return store.dispatch({ type: 'initialize-fixture', now, wallTime: now, armed: true, pid: process.pid, host: 'synthetic-test', config });
}
function snapshot(id, at = now, bid = 100, ask = 100.1) {
  return { schemaVersion: 1, eventId: id, source: 'synthetic-fixture', provenance: 'synthetic', productId: 'BTC-USD', base: 'BTC', quote: 'USD',
    observedAt: at, sourceAt: at, bids: [[bid, 10]], asks: [[ask, 10]], change24hPct: null,
    history: { low: 100, from: at - 60_000, to: at, samples: 60, intervalMs: 1000, complete: false, description: 'Synthetic fixture only' } };
}
function event(store, id, at = now, bid, ask) {
  return store.dispatch({ type: 'snapshot', snapshot: snapshot(id, at, bid, ask), now: at, wallTime: at });
}
function legacyEnvelope(store, document) {
  const payload = JSON.stringify(document), raw = JSON.stringify({ format: 1, sha256: digest(payload), payload }, null, 2) + '\n\n';
  fs.writeFileSync(path.join(store.directory, 'state.json'), raw);
  return raw;
}
function child(directory, body) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const directory=${JSON.stringify(directory)};
    ${body}
  `], { encoding: 'utf8', timeout: 15_000 });
}

test('journal: fresh origin, command inputs and system updates survive reopen and replay exactly', t => {
  const store = storage(t);
  assert.equal(store.read().version, 2);
  assert.deepEqual(store.read().journal, emptyHead());
  const initial = store.auditJournal();
  assert.deepEqual(initial, { ok: true, errors: [], records: 0, completeHistory: true });
  init(store);
  event(store, 'first');
  store.transact(document => { document.worker.status = 'completed'; return document; });
  const document = store.read();
  assert.deepEqual(openStore(store.directory).read(), document);
  assert.equal(document.journal.sequence, 3);
  const records = [...walkJournal(store.directory, document.journal)];
  assert.equal(records[0].record.kind, 'document-update');
  assert.deepEqual(records[0].record.command.after, records[0].record.after);
  assert.equal(records[1].record.command.snapshot.eventId, 'first');
  assert.deepEqual(records[1].record.decision, records[1].record.after.engine.decision);
  assert.deepEqual(records[1].record.execution, records[1].record.after.engine.execution);
  assert.equal(store.auditJournal().ok, true);
});

test('journal: generic updates cannot change engine, head, or silently coerce non-JSON values', t => {
  const store = storage(t); init(store);
  const before = store.read();
  assert.throws(() => store.transact(document => { document.engine.account.cash++; return document; }), /TYPED_COMMAND_REQUIRED/);
  assert.throws(() => store.transact(document => { document.journal.hash = '0'.repeat(64); return document; }), /cannot change journal head/);
  assert.throws(() => store.transact(document => { document.version = 1; return document; }), /cannot change version or history/);
  assert.throws(() => store.transact(document => { document.history = { complete: false, origin: 'legacy-snapshot', unavailableBeforeRevision: 1 }; return document; }), /cannot change version or history/);
  assert.throws(() => store.transact(document => { document.errors = [undefined]; return document; }), /finite JSON/);
  assert.throws(() => store.transact(async document => document), /synchronously/);
  assert.deepEqual(store.read(), before);
});

test('journal: archived IDs remain rejected with a newer timestamp after checkpoint rollover', t => {
  const store = storage(t); init(store, { maxEvents: 2 });
  event(store, 'archived', now);
  for (let index = 1; index <= 6; index++) event(store, `event-${index}`, now + index);
  const before = store.read();
  assert.ok(before.engine.checkpoint.totalEventCount > 0);
  assert.equal(before.engine.seenEvents.includes('archived'), false);
  const after = event(store, 'archived', now + 10);
  assert.equal(after.engine.account.cash, before.engine.account.cash);
  assert.equal(after.engine.totalFillCount, before.engine.totalFillCount);
  assert.match(after.engine.decision.reason, /Duplicate.*durable archive/);
  assert.equal(store.auditJournal().ok, true);
  assert.equal(store.auditJournal().records, 9);
});

test('journal: rejected input IDs are durable, not recycled into corrected later input', t => {
  const store = storage(t); init(store);
  const rejected = snapshot('bad-first'); rejected.quote = 'USDT';
  store.dispatch({ type: 'snapshot', snapshot: rejected, now, wallTime: now });
  const next = event(store, 'bad-first', now + 1);
  assert.equal(next.engine.totalFillCount, 0);
  assert.match(next.engine.decision.reason, /Duplicate.*durable archive/);
  assert.equal(store.auditJournal().ok, true);
});

test('journal: STOP and protective exit continue across retention boundaries', t => {
  const store = storage(t); init(store, { maxEvents: 1 }); event(store, 'entry');
  store.dispatch({ type: 'stop', wallTime: now + 1, reason: 'Synthetic operator pause' });
  event(store, 'exit', now + 2, 97, 97.1);
  const document = store.read();
  assert.equal(document.control.stopped, true);
  assert.equal(document.engine.totalFillCount, 2);
  assert.deepEqual(document.engine.account.positions, {});
  assert.equal(store.auditJournal().ok, true);
});

test('journal: fixed segment rollover is readable without all-history directory enumeration', t => {
  const store = storage(t);
  for (let index = 0; index < 130; index++) store.transact(document => { document.worker.lastCycleAt = index; return document; });
  const head = store.read().journal;
  assert.equal(head.sequence, 130);
  assert.equal(path.basename(path.dirname(recordPath(store.directory, head))), '000000000001');
  assert.equal(store.auditJournal().records, 130);
  const result = child(store.directory, `
    fs.readdirSync=()=>{throw new Error('unbounded directory enumeration forbidden')}; syncBuiltinESMExports();
    const {openStore}=await import(${JSON.stringify(storeUrl)}); const store=openStore(directory);
    if(store.read().journal.sequence!==130||!store.auditJournal().ok)process.exit(2);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test('journal: corrupt or missing committed record and missing authoritative snapshot fail closed', t => {
  const store = storage(t); store.transact(document => document);
  const head = store.read().journal, file = recordPath(store.directory, head), original = fs.readFileSync(file);
  fs.writeFileSync(file, 'corrupt');
  assert.throws(() => store.read(), /JOURNAL_CORRUPT/);
  assert.equal(store.auditJournal().ok, false);
  fs.writeFileSync(file, original); fs.renameSync(file, `${file}.retained-test`);
  assert.throws(() => store.read(), /JOURNAL_CORRUPT/);
  fs.renameSync(`${file}.retained-test`, file);
  fs.renameSync(path.join(store.directory, 'state.json'), path.join(store.directory, 'state.retained-test'));
  assert.throws(() => store.read(), /STATE_MISSING/);
});

test('journal: legacy write barrier, explicit exact-byte genesis, and incomplete-history disclosure', t => {
  const store = storage(t), legacy = initialDocument();
  legacy.version = 1; legacy.revision = 12; delete legacy.journal;
  const raw = legacyEnvelope(store, legacy);
  assert.deepEqual(store.read(), legacy);
  assert.equal(store.auditJournal().completeHistory, false);
  assert.throws(() => store.transact(document => document), /MIGRATION_REQUIRED/);
  assert.throws(() => store.dispatch({ type: 'stop', wallTime: now }), /MIGRATION_REQUIRED/);
  assert.equal(fs.readFileSync(path.join(store.directory, 'state.json'), 'utf8'), raw);
  const migrated = store.migrateLegacy();
  assert.equal(migrated.version, 2); assert.equal(migrated.revision, 13);
  assert.deepEqual(migrated.history, { complete: false, origin: 'legacy-snapshot', unavailableBeforeRevision: 12 });
  const genesis = readRecord(store.directory, migrated.journal);
  assert.equal(genesis.legacy.envelope, raw);
  assert.equal(genesis.legacy.sha256, digest(raw));
  assert.equal(genesis.legacy.historicalInputsReconstructible, false);
  assert.equal(store.auditJournal().ok, true);
  assert.equal(store.auditJournal().completeHistory, false);
  assert.throws(() => store.migrateLegacy(), /MIGRATION_NOT_REQUIRED/);
  store.dispatch({ type: 'stop', wallTime: now });
  assert.equal(store.auditJournal().ok, true);
});

test('journal: legacy engine accounting and retained event identity survive explicit upgrade', t => {
  const store = storage(t), legacy = initialDocument();
  legacy.version = 1; legacy.revision = 7; delete legacy.journal;
  let engine = step(createState({ now }), snapshot('old-input'), { now });
  engine.schemaVersion = 1; delete engine.checkpoint; delete engine.totalFillCount; delete engine.totalEventCount;
  legacy.engine = engine; legacy.mode = 'fixture-replay'; legacy.control.stopped = engine.control.emergencyStop;
  legacyEnvelope(store, legacy);
  const migrated = store.migrateLegacy();
  assert.deepEqual(migrated.engine.account, engine.account);
  assert.equal(migrated.engine.schemaVersion, 2);
  assert.equal(hasEventInHistory(store.directory, migrated.journal, 'old-input'), true);
  const after = event(store, 'old-input', now + 1);
  assert.equal(after.engine.account.cash, engine.account.cash);
  assert.match(after.engine.decision.reason, /Duplicate.*durable archive/);
  assert.equal(store.auditJournal().ok, true);
});

test('journal: partial prepared-record failure retains evidence and same command can retry', t => {
  const store = storage(t); store.transact(document => document); const before = store.read();
  const result = child(store.directory, `
    const open=fs.openSync,write=fs.writeFileSync; const files=new Map();
    fs.openSync=(file,...args)=>{const fd=open(file,...args);files.set(fd,String(file));return fd};
    fs.writeFileSync=(fd,data,...args)=>{if(files.get(fd)?.includes('.prepared-')){write(fd,String(data).slice(0,30));throw Object.assign(new Error('fixture ENOSPC'),{code:'ENOSPC'})}return write(fd,data,...args)};
    syncBuiltinESMExports(); const {openStore}=await import(${JSON.stringify(storeUrl)});
    try{openStore(directory).transact(d=>{d.worker.status='completed';return d});process.exit(2)}catch(e){if(!e.message.includes('ENOSPC'))throw e}
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(store.read(), before);
  const segment = path.join(store.directory, 'journal', '000000000000');
  const prepared = fs.readdirSync(segment).filter(name => name.startsWith('.prepared-'));
  assert.equal(prepared.length, 1);
  store.transact(document => { document.worker.status = 'completed'; return document; });
  assert.equal(fs.existsSync(path.join(segment, prepared[0])), true);
  assert.equal(store.auditJournal().ok, true);
});

test('journal: failure after record publication leaves orphan; same command reuses immutable bytes', t => {
  const store = storage(t); store.transact(document => document); const before = store.read();
  const result = child(store.directory, `
    const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(to).endsWith('/state.json'))throw new Error('fixture pointer failure');return rename(from,to)};
    syncBuiltinESMExports();const {openStore}=await import(${JSON.stringify(storeUrl)});
    try{openStore(directory).transact(d=>{d.worker.status='completed';return d});process.exit(2)}catch(e){if(!e.message.includes('pointer failure'))throw e}
  `);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(store.read(), before);
  const segment = path.join(store.directory, 'journal', '000000000000');
  const orphan = fs.readdirSync(segment).find(name => name.startsWith('0000000000000002-'));
  assert.ok(orphan);
  const bytes = fs.readFileSync(path.join(segment, orphan));
  store.transact(document => { document.worker.status = 'completed'; return document; });
  assert.deepEqual(fs.readFileSync(path.join(segment, orphan)), bytes);
  assert.equal(path.basename(recordPath(store.directory, store.read().journal)), orphan);
});

test('journal: record and record-directory fsync failures cannot advance the authoritative head', async t => {
  for (const boundary of ['record', 'record-directory']) await t.test(boundary, childTest => {
    const store = storage(childTest); store.transact(document => document); const before = store.read();
    const result = child(store.directory, `
      const open=fs.openSync,sync=fs.fsyncSync;const files=new Map();
      fs.openSync=(file,...args)=>{const fd=open(file,...args);files.set(fd,String(file));return fd};
      fs.fsyncSync=fd=>{const file=files.get(fd)||'';
        if(${JSON.stringify(boundary)}==='record'?file.includes('.prepared-'):file.endsWith('/000000000000'))throw new Error('fixture journal fsync failure');
        return sync(fd)};
      syncBuiltinESMExports();const {openStore}=await import(${JSON.stringify(storeUrl)});
      try{openStore(directory).dispatch({type:'stop',wallTime:1000000});process.exit(2)}catch(e){if(!e.message.includes('journal fsync'))throw e}
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(store.read(), before);
    assert.equal(store.dispatch({ type: 'stop', wallTime: now }).control.stopRequested, true);
    assert.equal(store.auditJournal().ok, true);
  });
});

test('journal: crash at publication preserves old head and lock until explicit recovery', t => {
  const store = storage(t); store.transact(document => document); const before = store.read();
  const result = child(store.directory, `
    const link=fs.linkSync;fs.linkSync=(...args)=>{link(...args);process.exit(73)};
    syncBuiltinESMExports(); const {openStore}=await import(${JSON.stringify(storeUrl)});
    openStore(directory).dispatch({type:'stop',wallTime:1000000});
  `);
  assert.equal(result.status, 73, result.stderr); assert.deepEqual(store.read(), before);
  assert.throws(() => store.dispatch({ type: 'stop', wallTime: now }), /STORE_LOCKED/);
  assert.equal(recoverInterruptedLock(store.directory).recovered, true);
  assert.equal(store.dispatch({ type: 'stop', wallTime: now }).control.stopRequested, true);
  assert.equal(store.auditJournal().ok, true);
});

test('journal: final directory sync failure never acknowledges a commit', t => {
  const store = storage(t); store.transact(document => document);
  const result = child(store.directory, `
    const open=fs.openSync,sync=fs.fsyncSync,rename=fs.renameSync;const files=new Map();let renamed=false;
    fs.openSync=(file,...args)=>{const fd=open(file,...args);files.set(fd,String(file));return fd};
    fs.renameSync=(from,to)=>{const result=rename(from,to);if(String(to).endsWith('/state.json'))renamed=true;return result};
    fs.fsyncSync=fd=>{if(renamed&&files.get(fd)===directory)throw new Error('fixture final fsync failure');return sync(fd)};
    syncBuiltinESMExports();const {openStore}=await import(${JSON.stringify(storeUrl)});
    try{openStore(directory).dispatch({type:'stop',wallTime:1000000});process.exit(2)}catch(e){if(!e.message.includes('final fsync'))throw e}
  `);
  assert.equal(result.status, 0, result.stderr);
  // Rename can be visible despite no acknowledgement. Any visible head still validates.
  assert.equal(store.auditJournal().ok, true);
  assert.equal(store.read().control.stopRequested, true);
});

test('journal: canonical comparison is deterministic without accepting sparse or nonfinite data', () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.throws(() => canonical([, 1]), /finite JSON/);
  assert.throws(() => canonical({ value: Infinity }), /finite JSON/);
});
