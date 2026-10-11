import { advanceTime, compactState, createState, resume, step, stop } from './engine/index.mjs';
import { normalizeBookIdentity, tradeIdentity } from './book-identity.mjs';

const MAX_ACTIVE_ERRORS = 32;
export const MAX_ACTIVE_ENGINE_BYTES = 2 * 1024 * 1024;
function boundedEngine(document) {
  if (!document.engine) return document;
  const bytes = () => Buffer.byteLength(JSON.stringify(document.engine));
  // The store commits this checkpoint with the exact command and both states.
  // No compacted state is acknowledged unless its evidence is durable too.
  if (bytes() > MAX_ACTIVE_ENGINE_BYTES) document.engine = compactState(document.engine, { durableArchive: true });
  if (bytes() > MAX_ACTIVE_ENGINE_BYTES) throw new Error('ACTIVE_STATE_CAPACITY: retained input/control state exceeds 2 MiB; command not committed');
  return document;
}
const wallClock = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('COMMAND_INVALID: explicit wallTime required');
};
const errorList = errors => {
  if (!Array.isArray(errors) || errors.some(error => typeof error !== 'string')) throw new Error('COMMAND_INVALID: errors must be strings');
  return errors.slice(-MAX_ACTIVE_ERRORS).map(error => error.slice(0, 4096));
};

// All nondeterministic inputs (including wall clock and process metadata) arrive
// in the command. The store journals that exact command under its writer lock.
export function applyCommand(previous, command, { hasEvent, hasBook, hasTrade, lookupBook } = {}) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('COMMAND_INVALID: object required');
  wallClock(command.wallTime);
  const document = structuredClone(previous);
  switch (command.type) {
    case 'initialize-fixture': {
      if (document.mode === 'observe') throw new Error('Separate data directory required for fixture replay');
      if (!Number.isSafeInteger(command.now) || command.now < 0) throw new Error('COMMAND_INVALID: synthetic clock required');
      if (command.pid != null && (!Number.isSafeInteger(command.pid) || command.pid <= 0)) throw new Error('COMMAND_INVALID: worker pid');
      if (command.host != null && (typeof command.host !== 'string' || command.host.length > 256)) throw new Error('COMMAND_INVALID: worker host');
      if (!document.engine) {
        if (command.armed !== true || document.control.stopRequested) throw new Error('Fixture initialization needs --arm-fixture; prior operator STOP cannot be erased');
        document.engine = createState({ initialCash: command.initialCash ?? 10000, config: command.config ?? {}, now: command.now });
        document.engine = resume(document.engine, { now: command.now });
      } else {
        if (command.initialCash != null && command.initialCash !== document.engine.account.initialCash) throw new Error('COMMAND_INVALID: initial cash cannot change on restart');
        if (command.config != null && Object.entries(command.config).some(([key, value]) => document.engine.config[key] !== value)) throw new Error('COMMAND_INVALID: risk configuration cannot change on restart');
      }
      document.mode = 'fixture-replay';
      document.control.stopped = document.engine.control.emergencyStop;
      document.worker = { status: 'running', lastCycleAt: command.wallTime, error: null, pid: command.pid ?? null, host: command.host ?? null,
        runtime: 'bounded foreground synthetic replay with durable command journal' };
      return boundedEngine(document);
    }
    case 'snapshot': {
      if (!document.engine || document.mode !== 'fixture-replay') throw new Error('COMMAND_INVALID: no initialized fixture engine');
      if (typeof hasEvent !== 'function') throw new Error('COMMAND_INVALID: durable event lookup required');
      const snapshot = command.snapshot;
      if (snapshot?.source !== 'synthetic-fixture' || snapshot?.provenance !== 'synthetic') throw new Error('REPLAY_BLOCKED: only explicit synthetic fixture data accepted');
      const duplicate = typeof snapshot.eventId === 'string' && hasEvent(snapshot.eventId);
      const options = { now: Math.max(document.engine.asOf, command.now), knownDuplicate: duplicate, durableArchive: true };
      if (document.engine.schemaVersion === 3) {
        if (![hasBook, hasTrade, lookupBook].every(value => typeof value === 'function')) throw new Error('COMMAND_INVALID: durable book/trade lookup required');
        let book = null;
        try { book = normalizeBookIdentity(snapshot, { requireExplicit: true }); } catch { /* Engine records the invalid identity as a committed REJECT. */ }
        options.knownBookConsumed = book ? hasBook(book.key) : false;
        let trade = null;
        try { trade = tradeIdentity(snapshot); } catch { /* Invalid trade metadata is rejected by the causal engine. */ }
        options.knownTradeDuplicate = trade ? hasTrade(trade) : false;
        options.archivedBook = book ? lookupBook(book) : null;
      }
      document.engine = step(document.engine, snapshot, options);
      document.control.stopped = document.engine.control.emergencyStop;
      document.worker.lastCycleAt = command.wallTime;
      document.worker.simulatedClock = document.engine.asOf;
      return boundedEngine(document);
    }
    case 'advance-fixture':
    case 'end-fixture': {
      if (!document.engine || document.mode !== 'fixture-replay' || document.engine.schemaVersion !== 3) throw new Error('COMMAND_INVALID: causal synthetic engine required');
      if (!Number.isSafeInteger(command.now) || command.now < 0) throw new Error('COMMAND_INVALID: explicit synthetic clock required');
      document.engine = advanceTime(document.engine, { now: Math.max(document.engine.asOf, command.now),
        endOfInput: command.type === 'end-fixture', reason: command.type === 'end-fixture' ? 'Orderly synthetic end of input' : 'Explicit synthetic clock advance' });
      document.worker.lastCycleAt = command.wallTime;
      document.worker.simulatedClock = document.engine.asOf;
      return boundedEngine(document);
    }
    case 'stop': {
      const reason = command.reason ?? 'Operator emergency entry pause';
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 4096) throw new Error('COMMAND_INVALID: STOP reason required, maximum 4096 characters');
      document.control = { stopped: true, stopRequested: true, requestedAt: command.wallTime };
      if (document.engine) document.engine = stop(document.engine, { now: document.engine.asOf, reason });
      return boundedEngine(document);
    }
    case 'resume-fixture': {
      if (!document.engine || document.mode !== 'fixture-replay') throw new Error('No existing synthetic fixture engine to resume');
      document.engine = resume(document.engine, { now: document.engine.asOf });
      document.control = { stopped: document.engine.control.emergencyStop, stopRequested: false, resumedAt: command.wallTime };
      return boundedEngine(document);
    }
    case 'worker-status': {
      if (!['completed', 'failed', 'interrupted'].includes(command.status)) throw new Error('COMMAND_INVALID: worker status');
      if (command.error != null && typeof command.error !== 'string') throw new Error('COMMAND_INVALID: worker error');
      document.worker.status = command.status;
      document.worker.lastCycleAt = command.wallTime;
      document.worker.error = command.error?.slice(0, 4096) ?? null;
      if (command.error) document.errors = errorList([...document.errors, command.error]);
      return boundedEngine(document);
    }
    case 'observe': {
      if (document.engine) throw new Error('Separate data directory required for read-only observation');
      if (!Array.isArray(command.observations) || command.observations.length > 2 || command.observations.some(value => value?.provenance !== 'public' || value?.source !== 'coinbase-exchange')) throw new Error('COMMAND_INVALID: bounded public observations required');
      document.mode = 'observe'; document.observations = structuredClone(command.observations);
      document.errors = errorList(command.errors);
      document.worker = { status: document.errors.length ? 'observation incomplete' : 'observation completed', lastCycleAt: command.wallTime,
        error: document.errors.join('; ').slice(0, 4096) || null, runtime: 'one read-only foreground observation' };
      return boundedEngine(document);
    }
    default: throw new Error(`COMMAND_INVALID: unsupported type ${String(command.type)}`);
  }
}
