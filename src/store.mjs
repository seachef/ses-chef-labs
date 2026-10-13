import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import * as engineModule from './engine/index.mjs';
import { applyCommand } from './runtime.mjs';
import { appendRecord, boundedJson, canonical, digest, documentHash, emptyHead, hasEventInHistory,
  hasBookInHistory, hasTradeInHistory, lookupBookInHistory, MAX_DOCUMENT_BYTES, readBounded, syncDirectory, validateHead, walkJournal, withoutHead } from './journal.mjs';

export function initialDocument() {
  return { version: 2, revision: 0, mode: 'idle', control: { stopped: true, stopRequested: false },
    engine: null, observations: [], worker: { status: 'not started', lastCycleAt: null, error: null }, errors: [],
    history: { complete: true, origin: 'empty' }, journal: emptyHead() };
}

export function validateDocument(value) {
  if (!value || ![1, 2].includes(value.version) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !['idle', 'fixture-replay', 'observe'].includes(value.mode) ||
      typeof value.control?.stopped !== 'boolean' || typeof value.control?.stopRequested !== 'boolean' ||
      !Array.isArray(value.observations) || !Array.isArray(value.errors) || !value.worker) {
    throw new Error('STATE_INVALID: document shape');
  }
  if (value.version === 2) {
    validateHead(value.journal);
    if (!value.history || !((value.history.complete === true && value.history.origin === 'empty') ||
        (value.history.complete === false && value.history.origin === 'legacy-snapshot' &&
          Number.isSafeInteger(value.history.unavailableBeforeRevision) && value.history.unavailableBeforeRevision >= 0))) {
      throw new Error('STATE_INVALID: history origin required');
    }
  }
  else if (value.journal !== undefined) throw new Error('STATE_INVALID: legacy document cannot carry a journal head');
  boundedJson(value, 'STATE_INVALID');
  if (value.engine) {
    const audit = engineModule.auditState(value.engine);
    if (!audit.ok) throw new Error(`STATE_AUDIT_FAILED: ${audit.errors.join('; ')}`);
    if (value.control.stopped !== value.engine.control.emergencyStop) throw new Error('STATE_INVALID: stop mismatch');
  }
  return value;
}

function parseEnvelope(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new Error('STATE_CORRUPT: invalid JSON; recovery required'); }
  if (envelope.format !== 1 || typeof envelope.payload !== 'string' || digest(envelope.payload) !== envelope.sha256) {
    throw new Error('STATE_CORRUPT: checksum mismatch; recovery required');
  }
  let document;
  try { document = JSON.parse(envelope.payload); } catch { throw new Error('STATE_CORRUPT: invalid payload JSON'); }
  return validateDocument(document);
}

function migrationAfter(before) {
  const after = structuredClone(before);
  after.version = 2;
  after.revision = before.revision + 1;
  after.history = { complete: false, origin: 'legacy-snapshot', unavailableBeforeRevision: before.revision };
  if (after.engine) {
    if (typeof engineModule.upgradeState !== 'function') throw new Error('MIGRATION_UNAVAILABLE: engine upgrade required');
    after.engine = engineModule.upgradeState(after.engine);
  }
  return after;
}

function validateRecordDocument(document, head) {
  return validateDocument(document.version === 2 ? { ...document, journal: head } : document);
}

function checkRecordSemantics(record, initialHash) {
  if (record.kind === 'document-update') {
    if (record.command?.type !== 'document-update' || documentHash(record.command.after) !== record.afterHash ||
        canonical(record.before.engine) !== canonical(record.after.engine)) throw new Error('JOURNAL_CORRUPT: invalid system document update');
  } else if (record.kind === 'command') {
    if (!record.command || typeof record.command.type !== 'string') throw new Error('JOURNAL_CORRUPT: missing typed command');
  } else {
    if (record.sequence !== 1 || record.before.version !== 1 || record.after.version !== 2 ||
        record.command?.type !== 'legacy-migration' || typeof record.legacy?.envelope !== 'string' ||
        digest(record.legacy.envelope) !== record.legacy.sha256 || record.legacy.historicalInputsReconstructible !== false ||
        documentHash(parseEnvelope(record.legacy.envelope)) !== record.beforeHash ||
        documentHash(migrationAfter(record.before)) !== record.afterHash) throw new Error('JOURNAL_CORRUPT: invalid legacy migration boundary');
  }
  if (record.sequence === 1 && record.kind !== 'legacy-migration' && record.beforeHash !== initialHash) {
    throw new Error('JOURNAL_CORRUPT: chain does not start from empty origin');
  }
  if (record.kind !== 'legacy-migration' && (record.before.version !== 2 || record.after.version !== 2)) {
    throw new Error('JOURNAL_CORRUPT: journal requires version 2 documents');
  }
  if (record.kind !== 'legacy-migration' && canonical(record.before.history) !== canonical(record.after.history)) {
    throw new Error('JOURNAL_CORRUPT: history origin changed');
  }
}

// The snapshot head is authoritative. No record, snapshot or STOP fallback is allowed.
export function openStore(directory) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const statePath = path.join(root, 'state.json');
  const lockPath = path.join(root, 'transaction.lock');
  const recoveryPath = path.join(root, 'recovery.lock');
  const initialHash = documentHash(initialDocument());

  function rawState() {
    try { return readBounded(statePath, MAX_DOCUMENT_BYTES * 2 + 1024, 'STATE_CORRUPT'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (fs.existsSync(path.join(root, 'journal'))) throw new Error('STATE_MISSING: journal evidence exists; authoritative head recovery required');
      return null;
    }
  }

  function inspectChain(document, visitor) {
    let expectedHash = documentHash(document), records = 0, legacyBoundary = null;
    if (document.version === 1) return { records: 0, completeHistory: false, legacyBoundary: { unmigrated: true, historicalInputsReconstructible: false } };
    if (document.journal.sequence === 0 && expectedHash !== initialHash) throw new Error('JOURNAL_CORRUPT: nonempty state without committed history');
    for (const { head, record } of walkJournal(root, document.journal)) {
      if (record.afterHash !== expectedHash) throw new Error('JOURNAL_CORRUPT: chain/state continuity mismatch');
      validateRecordDocument(record.before, record.previous);
      validateRecordDocument(record.after, head);
      checkRecordSemantics(record, initialHash);
      if (record.kind === 'legacy-migration') legacyBoundary = {
        sequence: record.sequence, legacyRevision: record.before.revision,
        envelopeSha256: record.legacy.sha256, historicalInputsReconstructible: false,
      };
      if (visitor) visitor(record);
      expectedHash = record.beforeHash;
      records++;
    }
    return { records, completeHistory: legacyBoundary === null, ...(legacyBoundary ? { legacyBoundary } : {}) };
  }

  function read() {
    const raw = rawState();
    const document = raw === null ? initialDocument() : parseEnvelope(raw);
    inspectChain(document);
    return document;
  }

  function writeSnapshot(document, temporary) {
    const payload = boundedJson(document, 'STATE_INVALID');
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ format: 1, sha256: digest(payload), payload }) + '\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, statePath);
    syncDirectory(root);
  }

  function locked(operation) {
    if (fs.existsSync(recoveryPath)) throw new Error('STORE_LOCKED: recovery in progress or interrupted; operator inspection required');
    let lockFd;
    try { lockFd = fs.openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('STORE_LOCKED: another transaction or interrupted writer; inspect before explicit recovery');
      throw error;
    }
    const token = randomUUID();
    const temporary = path.join(root, `state-${token}.tmp`);
    try {
      if (fs.existsSync(recoveryPath)) throw new Error('STORE_LOCKED: recovery in progress');
      fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, host: hostname(), token, createdAt: Date.now() }));
      fs.fsyncSync(lockFd);
      syncDirectory(root);
      return operation(temporary);
    } finally {
      fs.closeSync(lockFd);
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fs.unlinkSync(lockPath);
    }
  }

  function commit(current, next, { kind, command, legacyEnvelope }, temporary) {
    if (!next || typeof next.then === 'function') throw new Error('STATE_INVALID: transaction must return synchronously');
    if (current.version === 2 && canonical(next.journal) !== canonical(current.journal)) throw new Error('STATE_INVALID: command cannot change journal head');
    if (current.version === 2 && (next.version !== current.version || canonical(next.history) !== canonical(current.history))) {
      throw new Error('STATE_INVALID: command cannot change version or history origin');
    }
    next.version = 2;
    next.revision = current.revision + 1;
    next.journal = current.version === 2 ? current.journal : emptyHead();
    validateDocument(next);
    if (kind === 'document-update') command = { type: 'document-update', after: withoutHead(next) };
    // Establish an authoritative empty head before any first-record orphan can exist.
    if (rawState() === null) writeSnapshot(current, temporary);
    const head = appendRecord(root, { previous: next.journal, kind, command, before: current, after: next, legacyEnvelope });
    next.journal = head;
    validateDocument(next);
    writeSnapshot(next, temporary); // Ack only after file fsync, rename and directory fsync.
    return next;
  }

  function transact(change) {
    return locked(temporary => {
      const current = read();
      if (current.version === 1) throw new Error('MIGRATION_REQUIRED: legacy snapshot is readable but writes require explicit migrateLegacy()');
      const next = change(structuredClone(current));
      if (!next || typeof next.then === 'function') throw new Error('STATE_INVALID: transaction must return synchronously');
      if (canonical(next.engine) !== canonical(current.engine)) throw new Error('TYPED_COMMAND_REQUIRED: engine changes must use dispatch(command)');
      return commit(current, next, { kind: 'document-update' }, temporary);
    });
  }

  function dispatch(command) {
    boundedJson(command, 'COMMAND_INVALID');
    return locked(temporary => {
      const current = read();
      if (current.version === 1) throw new Error('MIGRATION_REQUIRED: legacy snapshot is readable but writes require explicit migrateLegacy()');
      const next = applyCommand(structuredClone(current), structuredClone(command), {
        hasEvent: eventId => hasEventInHistory(root, current.journal, eventId),
        hasBook: key => hasBookInHistory(root, current.journal, key),
        hasTrade: key => hasTradeInHistory(root, current.journal, key),
        lookupBook: identity => lookupBookInHistory(root, current.journal, identity),
      });
      return commit(current, next, { kind: 'command', command }, temporary);
    });
  }

  function migrateLegacy() {
    return locked(temporary => {
      const legacyEnvelope = rawState();
      const current = read();
      if (current.version !== 1) throw new Error('MIGRATION_NOT_REQUIRED: snapshot already uses the journal');
      return commit(current, migrationAfter(current), { kind: 'legacy-migration', command: { type: 'legacy-migration' }, legacyEnvelope }, temporary);
    });
  }

  function auditJournal() {
    try {
      const raw = rawState(), document = raw === null ? initialDocument() : parseEnvelope(raw);
      const result = inspectChain(document, record => {
        if (record.kind !== 'command') return;
        const before = { ...structuredClone(record.before), journal: structuredClone(record.previous) };
        const replayed = applyCommand(before, structuredClone(record.command), {
          hasEvent: eventId => hasEventInHistory(root, record.previous, eventId),
          hasBook: key => hasBookInHistory(root, record.previous, key),
          hasTrade: key => hasTradeInHistory(root, record.previous, key),
          lookupBook: identity => lookupBookInHistory(root, record.previous, identity),
        });
        if (!replayed || typeof replayed.then === 'function') throw new Error('JOURNAL_REPLAY_FAILED: command must replay synchronously');
        replayed.revision = record.before.revision + 1;
        if (documentHash(replayed) !== record.afterHash) throw new Error(`JOURNAL_REPLAY_FAILED: state differs at record ${record.sequence}`);
      });
      return { ok: true, errors: [], ...result };
    } catch (error) { return { ok: false, errors: [error.message], records: null, completeHistory: false }; }
  }

  return { read, transact, dispatch, migrateLegacy, auditJournal, close() {}, directory: root };
}

// Deliberately manual. Never break a live, remote-host, malformed, or uncertain lock.
export function recoverInterruptedLock(directory) {
  const store = openStore(directory);
  const lockPath = path.join(store.directory, 'transaction.lock');
  const recoveryPath = path.join(store.directory, 'recovery.lock');
  let guard;
  try { guard = fs.openSync(recoveryPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('RECOVERY_BLOCKED: another or interrupted recovery; operator inspection required'); throw error; }
  try {
    fs.writeFileSync(guard, JSON.stringify({ pid: process.pid, host: hostname(), createdAt: Date.now() }));
    fs.fsyncSync(guard);
    const raw = fs.readFileSync(lockPath, 'utf8');
    const lock = JSON.parse(raw);
    if (lock.host !== hostname() || !Number.isSafeInteger(lock.pid) || lock.pid <= 0 || typeof lock.token !== 'string') {
      throw new Error('RECOVERY_BLOCKED: uncertain lock owner');
    }
    try { process.kill(lock.pid, 0); throw new Error('RECOVERY_BLOCKED: lock owner still exists'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    store.read(); // A corrupt ledger must not be bypassed to restart.
    if (fs.readFileSync(lockPath, 'utf8') !== raw) throw new Error('RECOVERY_BLOCKED: lock changed');
    const retained = `${lockPath}.recovered-${randomUUID()}`;
    fs.renameSync(lockPath, retained);
    syncDirectory(store.directory);
    return { recovered: true, retained };
  } finally { fs.closeSync(guard); fs.unlinkSync(recoveryPath); syncDirectory(store.directory); }
}
