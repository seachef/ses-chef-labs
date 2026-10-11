import * as fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const SEGMENT_RECORDS = 128;
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const MAX_RECORD_BYTES = 96 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function emptyHead() { return { version: 1, sequence: 0, hash: null }; }
export function withoutHead(document) {
  const result = structuredClone(document);
  delete result.journal;
  return result;
}
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Error('JOURNAL_INVALID: only finite JSON values are supported');
}
export function documentHash(document) { return digest(canonical(withoutHead(document))); }
export function validateHead(head) {
  if (!head || head.version !== 1 || !Number.isSafeInteger(head.sequence) || head.sequence < 0 ||
      (head.sequence === 0 ? head.hash !== null : typeof head.hash !== 'string' || !HASH.test(head.hash))) {
    throw new Error('JOURNAL_CORRUPT: invalid head');
  }
  return head;
}
export function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function boundedJson(value, label, maximum = MAX_DOCUMENT_BYTES) {
  canonical(value); // Reject values JSON.stringify would silently discard/coerce.
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result) > maximum) throw new Error(`${label}: exceeds ${maximum} byte local limit`);
  return result;
}
export function readBounded(file, maximum, label) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) throw new Error(`${label}: invalid file or local size limit exceeded`);
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

export function recordPath(directory, head) {
  validateHead(head);
  if (head.sequence === 0) throw new Error('JOURNAL_INVALID: empty head has no record');
  const segment = String(Math.floor((head.sequence - 1) / SEGMENT_RECORDS)).padStart(12, '0');
  return path.join(directory, 'journal', segment, `${String(head.sequence).padStart(16, '0')}-${head.hash}.json`);
}

function validateRecord(record, head) {
  if (!record || record.version !== 1 || record.sequence !== head.sequence ||
      !['command', 'document-update', 'legacy-migration'].includes(record.kind) ||
      record.before?.journal !== undefined || record.after?.journal !== undefined ||
      record.after?.revision !== record.before?.revision + 1 ||
      documentHash(record.before) !== record.beforeHash || documentHash(record.after) !== record.afterHash ||
      canonical(record.decision) !== canonical(record.after?.engine?.decision ?? null) ||
      canonical(record.execution) !== canonical(record.after?.engine?.execution ?? null)) {
    throw new Error('JOURNAL_CORRUPT: invalid record or state hash');
  }
  validateHead(record.previous);
  if (record.previous.sequence !== head.sequence - 1) throw new Error('JOURNAL_CORRUPT: nonconsecutive chain');
  boundedJson(record.before, 'JOURNAL_CORRUPT before');
  boundedJson(record.after, 'JOURNAL_CORRUPT after');
  boundedJson(record.command, 'JOURNAL_CORRUPT command');
  return record;
}

export function readRecord(directory, head) {
  let raw;
  try { raw = readBounded(recordPath(directory, head), MAX_RECORD_BYTES, 'JOURNAL_CORRUPT'); }
  catch (error) { throw new Error(`JOURNAL_CORRUPT: cannot read committed record ${head.sequence}: ${error.message}`); }
  if (digest(raw) !== head.hash) throw new Error(`JOURNAL_CORRUPT: record ${head.sequence} checksum mismatch`);
  let record;
  try { record = JSON.parse(raw); } catch { throw new Error('JOURNAL_CORRUPT: invalid record JSON'); }
  return validateRecord(record, head);
}

// Content-addressed append; existing and orphan records are never overwritten or deleted.
export function appendRecord(directory, { previous, kind, command, before, after, legacyEnvelope }) {
  validateHead(previous);
  const record = {
    version: 1, sequence: previous.sequence + 1, previous: structuredClone(previous), kind,
    command: structuredClone(command), before: withoutHead(before), after: withoutHead(after),
    beforeHash: documentHash(before), afterHash: documentHash(after),
    decision: structuredClone(after.engine?.decision ?? null), execution: structuredClone(after.engine?.execution ?? null),
  };
  if (legacyEnvelope !== undefined) record.legacy = {
    envelope: legacyEnvelope, sha256: digest(legacyEnvelope), historicalInputsReconstructible: false,
  };
  boundedJson(command, 'COMMAND_INVALID');
  const raw = boundedJson(record, 'JOURNAL_INVALID', MAX_RECORD_BYTES - 1) + '\n';
  const head = { version: 1, sequence: record.sequence, hash: digest(raw) };
  validateRecord(record, head);
  const file = recordPath(directory, head), segment = path.dirname(file), journal = path.dirname(segment);
  fs.mkdirSync(segment, { recursive: true, mode: 0o700 });
  // Incomplete writes retain their unique prepared path, never occupy a final hash path.
  const prepared = path.join(segment, `.prepared-${randomUUID()}`);
  const fd = fs.openSync(prepared, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, raw);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try { fs.linkSync(prepared, file); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (readBounded(file, MAX_RECORD_BYTES, 'JOURNAL_COLLISION') !== raw) throw new Error('JOURNAL_COLLISION: immutable record exists with different bytes');
  }
  const published = fs.openSync(file, 'r');
  try { fs.fsyncSync(published); } finally { fs.closeSync(published); }
  syncDirectory(segment);
  syncDirectory(journal);
  syncDirectory(directory);
  // Identical complete bytes now have a durable final name; no unique evidence is lost.
  fs.unlinkSync(prepared);
  syncDirectory(segment);
  return head;
}

export function* walkJournal(directory, head) {
  let current = validateHead(head);
  while (current.sequence > 0) {
    const record = readRecord(directory, current);
    yield { head: current, record };
    current = record.previous;
  }
}

export function hasEventInHistory(directory, head, eventId) {
  if (typeof eventId !== 'string' || !eventId) return false;
  for (const { record } of walkJournal(directory, head)) {
    if (record.kind === 'command' && record.command.type === 'snapshot' && record.command.snapshot?.eventId === eventId) return true;
    if (record.kind === 'legacy-migration') {
      const engine = record.before.engine;
      if (engine?.seenEvents?.includes(eventId) || engine?.ledger?.some(fill => fill.eventId === eventId)) return true;
    }
  }
  return false;
}
