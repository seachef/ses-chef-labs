// Local-only adapter proof. Public market feeds are deliberately not imported here.
// IndexedDB is origin-local, may be evicted, and is not a physical exit-space reservation.
import { initialState, validateState, fingerprint, HEADER_BYTES, LEDGER_ROW_BYTES, PaperEngine } from './core/core.mjs';
import { MemoryStore } from './core/storage.mjs';

const FORMAT = 'NEPTUNE2_PUBLIC_PAPER_ACCOUNT_V1';
export const ACCOUNT_MODES = Object.freeze({ paper: 'PUBLIC_PRICE_PAPER_PRACTICE' });
const DATABASE_PREFIX = 'neptune2-public-paper:v1:';
const DB_VERSION = 1;
export const MAX_META_ENVELOPE_BYTES = 131_072;
export const MAX_LEDGER_ENVELOPE_BYTES = 65_536;
// Strict command serials reject stale retries without an unbounded receipt history.
const STORES = ['meta', 'ledger'];
const METHODS = new Set(['start', 'stop', 'tick', 'observePublicResponse', 'proposeBuy', 'interrupt', 'resumeProtective']);
const clone = value => structuredClone(value);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const error = (code, cause) => Object.assign(new Error(code), { code, ...(cause ? { cause } : {}) });
const insist = (condition, code) => { if (!condition) throw error(code); };
const commandHash = (method, args) => fingerprint({ method, args });
const seal = payload => ({ payload, sha256: fingerprint(payload) });
const verified = record => record?.payload && record.sha256 === fingerprint(record.payload);

export function databaseName(accountId) {
  insist(typeof accountId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(accountId), 'INVALID_LOCAL_ACCOUNT_ID');
  return DATABASE_PREFIX + accountId;
}
export const newLocalAccountId = () => crypto.randomUUID();

function headFor(accountId, accountMode, state, version, lastCommandReceipt) {
  const { ledger, ...header } = state;
  const head = seal({ format: FORMAT, accountId, accountMode, version, capacityRows: 9,
    capacityBytes: HEADER_BYTES + 9 * LEDGER_ROW_BYTES,
    state: header, ledgerCount: ledger.length, stateHash: fingerprint(state), lastCommandReceipt });
  insist(bytes(head) <= MAX_META_ENVELOPE_BYTES, 'LOCAL_META_ENVELOPE_SIZE_LIMIT');
  return head;
}

// Aborting an accidental version-0 upgrade leaves a missing database missing.
// Recovery never initializes an empty account, even when storage was evicted.
function openDatabase(accountId, { create = false, accountMode, indexedDBFactory = globalThis.indexedDB } = {}) {
  insist(indexedDBFactory && typeof indexedDBFactory.open === 'function', 'INDEXEDDB_UNAVAILABLE');
  const name = databaseName(accountId);
  const genesis = create ? headFor(accountId, accountMode, initialState(), 0, null) : null;
  return new Promise((resolve, reject) => {
    let created = false, missing = false, settled = false;
    const request = indexedDBFactory.open(name, DB_VERSION);
    const fail = e => { if (!settled) { settled = true; reject(e); } };
    request.onupgradeneeded = event => {
      if (!create || event.oldVersion !== 0) {
        missing = event.oldVersion === 0;
        request.transaction.abort();
        return;
      }
      created = true;
      const db = request.result;
      db.createObjectStore('meta').add(genesis, 'head');
      db.createObjectStore('ledger', { keyPath: 'payload.ordinal' });
    };
    request.onblocked = () => fail(error('LOCAL_DATABASE_OPEN_BLOCKED'));
    request.onerror = () => fail(error(missing ? 'MISSING_LOCAL_ACCOUNT' : 'LOCAL_DATABASE_OPEN_FAILED', request.error));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      if (create && !created) { db.close(); fail(error('LOCAL_ACCOUNT_ALREADY_EXISTS')); return; }
      if (!STORES.every(s => db.objectStoreNames.contains(s)) || db.objectStoreNames.length !== STORES.length) {
        db.close(); fail(error('INVALID_LOCAL_DATABASE_SCHEMA')); return;
      }
      settled = true;
      resolve(db); // Open success follows completion of the creation transaction.
    };
  });
}

function readRecords(db) {
  return new Promise((resolve, reject) => {
    let values = {};
    let tx;
    try {
      tx = db.transaction(STORES, 'readonly');
      for (const [key, store, all] of [['head', 'meta', false], ['ledger', 'ledger', true]]) {
        const req = all ? tx.objectStore(store).getAll(null, 10) : tx.objectStore(store).get('head');
        req.onsuccess = () => { values[key] = req.result; };
      }
      tx.oncomplete = () => resolve(values);
      tx.onabort = () => reject(error('LOCAL_READ_ABORTED', tx.error));
      tx.onerror = () => {}; // The transaction abort, not a request event, is final.
    } catch (e) { reject(error('LOCAL_READ_FAILED', e)); }
  });
}

function validateRecords(accountId, records) {
  const { head, ledger } = records;
  insist(head, 'MISSING_LOCAL_ACCOUNT_STATE');
  insist(bytes(head) <= MAX_META_ENVELOPE_BYTES, 'LOCAL_META_ENVELOPE_SIZE_LIMIT');
  insist(verified(head), 'LOCAL_STATE_CHECKSUM_FAILED');
  const h = head.payload;
  insist(h.format === FORMAT && h.accountId === accountId && Number.isSafeInteger(h.version) && h.version >= 0,
    'INVALID_LOCAL_ACCOUNT_HEADER');
  insist(h.capacityRows === 9 && h.capacityBytes === HEADER_BYTES + 9 * LEDGER_ROW_BYTES, 'INVALID_LOCAL_ACCOUNT_CAPACITY');
  insist(Array.isArray(ledger) && ledger.length === h.ledgerCount && ledger.length <= 9, 'LOCAL_LEDGER_COUNT_MISMATCH');
  ledger.forEach((entry, ordinal) => {
    insist(bytes(entry) <= MAX_LEDGER_ENVELOPE_BYTES, 'LOCAL_LEDGER_ENVELOPE_SIZE_LIMIT');
    insist(verified(entry) && entry.payload.ordinal === ordinal, 'LOCAL_LEDGER_CHECKSUM_FAILED');
  });
  const state = { ...h.state, ledger: ledger.map(entry => entry.payload.row) };
  insist(Object.values(ACCOUNT_MODES).includes(h.accountMode), 'INVALID_ACCOUNT_MODE');
  insist(state.dataMode === 'UNSET' || state.dataMode === h.accountMode, 'ACCOUNT_MODE_MISMATCH');
  validateState(state);
  new MemoryStore({ state, capacityRows: h.capacityRows, capacityBytes: h.capacityBytes });
  insist(fingerprint(state) === h.stateHash, 'LOCAL_STATE_CHECKSUM_FAILED');
  const receipt = h.lastCommandReceipt;
  if (h.version === 0) {
    insist(receipt === null && h.stateHash === fingerprint(initialState()), 'INVALID_LOCAL_GENESIS');
  } else {
    insist(verified(receipt), 'LOCAL_COMMAND_CHECKSUM_FAILED');
    const r = receipt.payload;
    insist(r.serial === h.version && /^[a-f0-9]{64}$/.test(r.requestHash)
      && /^[a-f0-9]{64}$/.test(r.previousStateHash) && r.stateHash === h.stateHash
      && bytes(receipt) <= 4096, 'INVALID_LOCAL_COMMAND_RECEIPT');
  }
  return { head: clone(head), state: clone(state) };
}

/**
 * Async bridge to the isolated public-price paper-practice risk/accounting core.
 * Each command runs on an isolated MemoryStore draft; only a completed IDB
 * transaction publishes that draft. Version + checksum CAS is authoritative;
 * Web Locks are neither required nor relied on. No live order capability exists.
 * Only the latest serial can replay its original receipt; older serials fail closed.
 * After an uncertain acknowledgement, explicitly recover and retry the SAME serial.
 * Never blindly allocate a new serial to resend an uncertain command. A snapshot
 * is the last verified version and can be stale relative to another tab until CAS.
 * Envelope bounds are logical limits, not physical disk-space reservations; the
 * core byte budget excludes adapter envelopes and IndexedDB implementation overhead.
 */
export class IndexedDBPaperStore {
  #db;
  #accountId;
  #factory;
  #verified;
  #blocked = 'RECOVERY_REQUIRED';
  #busy = false;
  #fault = null;

  constructor(token, accountId, factory) {
    insist(token === PRIVATE, 'USE_CREATE_OR_RECOVER');
    this.#accountId = accountId;
    this.#factory = factory;
  }
  static async create({ accountId, accountMode, acknowledgement, indexedDBFactory = globalThis.indexedDB }) {
    insist(acknowledgement === 'CREATE_ISOLATED_PUBLIC_PAPER_ACCOUNT', 'EXPLICIT_NEW_LOCAL_ACCOUNT_REQUIRED');
    insist(Object.values(ACCOUNT_MODES).includes(accountMode), 'INVALID_ACCOUNT_MODE');
    const account = new IndexedDBPaperStore(PRIVATE, accountId, indexedDBFactory);
    account.#attach(await openDatabase(accountId, { create: true, accountMode, indexedDBFactory }));
    await account.#verify();
    return account;
  }
  static async recover({ accountId, indexedDBFactory = globalThis.indexedDB }) {
    const account = new IndexedDBPaperStore(PRIVATE, accountId, indexedDBFactory);
    await account.recover();
    return account;
  }
  get accountId() { return this.#accountId; }
  get accountMode() { return this.#verified?.head.payload.accountMode; }
  get blocked() { return this.#blocked !== null; }
  get blockedReason() { return this.#blocked; }
  get limits() { return Object.freeze({ maxLedgerRows: 9, retainedCommandReceipts: 1, maxMetaEnvelopeBytes: MAX_META_ENVELOPE_BYTES, maxLedgerEnvelopeBytes: MAX_LEDGER_ENVELOPE_BYTES }); }
  snapshot() {
    insist(this.#verified, 'NO_VERIFIED_LOCAL_STATE');
    return clone({ accountId: this.#accountId, accountMode: this.accountMode, version: this.#verified.head.payload.version,
      stateHash: this.#verified.head.payload.stateHash, state: this.#verified.state,
      blocked: this.blocked, blockedReason: this.#blocked });
  }
  #attach(db) {
    this.#db = db;
    db.onversionchange = () => { if (this.#db !== db) return; this.#blocked = 'DATABASE_VERSION_CHANGED_RECOVERY_REQUIRED'; db.close(); };
    db.onclose = () => { if (this.#db === db) this.#blocked = 'DATABASE_CLOSED_RECOVERY_REQUIRED'; };
  }
  async #verify() {
    try {
      const next = validateRecords(this.#accountId, await readRecords(this.#db));
      this.#verified = next;
      this.#blocked = null;
    } catch (e) { this.#blocked = e.code || e.message || 'RECOVERY_FAILED'; this.#db?.close(); throw e; }
  }
  async recover() {
    insist(!this.#busy, 'LOCAL_OPERATION_IN_PROGRESS');
    this.#busy = true;
    this.#blocked = 'RECOVERY_REQUIRED';
    try {
      this.#db?.close();
      this.#attach(await openDatabase(this.#accountId, { indexedDBFactory: this.#factory }));
      await this.#verify();
      return this.snapshot();
    } finally { this.#busy = false; }
  }
  close() {
    insist(!this.#busy, 'LOCAL_OPERATION_IN_PROGRESS');
    this.#db?.close();
    this.#blocked = 'CLOSED_RECOVERY_REQUIRED';
  }
  // Test-only deterministic faults. 'quotaAbort' models failure, not real quota pressure.
  injectFault(point) {
    insist(['beforeCommit', 'afterRequestSuccess', 'quotaAbort', 'afterCommitAckLost'].includes(point), 'INVALID_LOCAL_FAULT_POINT');
    this.#fault = point;
  }
  async execute(serial, method, args = []) {
    insist(!this.blocked, 'LOCAL_ACCOUNT_BLOCKED_RECOVER_FIRST');
    insist(!this.#busy, 'LOCAL_OPERATION_IN_PROGRESS');
    insist(Number.isSafeInteger(serial) && serial >= 1, 'INVALID_LOCAL_COMMAND_SERIAL');
    insist(METHODS.has(method) && Array.isArray(args), 'INVALID_LOCAL_COMMAND');
    const copiedArgs = clone(args);
    insist(bytes(copiedArgs) <= 40_960, 'LOCAL_COMMAND_SIZE_LIMIT');
    const requestHash = commandHash(method, copiedArgs);
    const before = this.#verified;
    const version = before.head.payload.version;
    insist(serial >= version, 'STALE_LOCAL_COMMAND_SERIAL');
    insist(serial <= version + 1, 'LOCAL_COMMAND_SERIAL_GAP');
    const prior = serial === version ? before.head.payload.lastCommandReceipt : null;
    insist(!prior || prior.payload.requestHash === requestHash, 'LOCAL_COMMAND_ID_CONFLICT');
    this.#busy = true;
    try {
      let next = before, receipt = prior, result = prior?.payload.result;
      if (!prior) {
        const memory = new MemoryStore({ state: before.state, capacityRows: 9, capacityBytes: before.head.payload.capacityBytes });
        const engine = new PaperEngine(memory);
        result = engine[method](...copiedArgs);
        const state = memory.read();
        insist(state.ledger.length >= before.state.ledger.length && before.state.ledger.every((row, i) => fingerprint(row) === fingerprint(state.ledger[i])), 'IMMUTABLE_LOCAL_LEDGER_VIOLATION');
        const version = before.head.payload.version + 1;
        receipt = seal({ serial, requestHash, result: clone(result), previousStateHash: before.head.payload.stateHash, stateHash: fingerprint(state) });
        insist(bytes(receipt) <= 4096, 'LOCAL_RECEIPT_SIZE_LIMIT');
        next = { state, head: headFor(this.#accountId, this.accountMode, state, version, receipt) };
      }
      // Every digest and clone needed for writes is computed BEFORE the RW transaction.
      const expectedLedger = before.state.ledger.map((row, ordinal) => seal({ ordinal, row: clone(row) }));
      const additions = next.state.ledger.slice(before.state.ledger.length).map((row, i) => seal({ ordinal: before.state.ledger.length + i, row: clone(row) }));
      insist(additions.every(row => bytes(row) <= MAX_LEDGER_ENVELOPE_BYTES), 'LOCAL_LEDGER_ENVELOPE_SIZE_LIMIT');
      const fault = this.#fault; this.#fault = null;
      await this.#commit({ before, next, receipt, prior, additions, expectedLedger, fault });
      this.#verified = next;
      return clone(result);
    } finally { this.#busy = false; }
  }
  #commit({ before, next, receipt, prior, additions, expectedLedger, fault }) {
    return new Promise((resolve, reject) => {
      let tx, failure = null, settled = false;
      const fail = e => {
        if (settled) return;
        settled = true;
        this.#blocked = e.code || 'LOCAL_COMMIT_UNCERTAIN_RECOVERY_REQUIRED';
        reject(e);
      };
      const abort = e => { failure = e; try { tx.abort(); } catch { fail(e); } };
      try {
        // A strict-durability request is a browser hint, not an fsync or eviction guarantee.
        tx = this.#db.transaction(STORES, 'readwrite', { durability: 'strict' });
        let actualHead, actualLedger, reads = 0;
        const ready = () => {
          if (++reads !== 2) return;
          // The snapshot version/hash compare prevents stale writers and duplicate fills.
          if (!actualHead || actualHead.payload?.version !== before.head.payload.version
            || actualHead.payload?.stateHash !== before.head.payload.stateHash
            || actualHead.sha256 !== before.head.sha256 || !same(actualHead, before.head)) {
            abort(error('LOCAL_CAS_CONFLICT_RECOVERY_REQUIRED')); return;
          }
          if (!same(actualLedger, expectedLedger)) { abort(error('LOCAL_LEDGER_CONFLICT_RECOVERY_REQUIRED')); return; }
          if (prior) return; // Exact retry is acknowledged only at transaction completion.
          const ledger = tx.objectStore('ledger');
          for (const row of additions) ledger.add(row); // Existing rows are never put/deleted.
          const write = tx.objectStore('meta').put(next.head, 'head');
          if (fault === 'beforeCommit') abort(error('SIMULATED_ABORT_BEFORE_COMMIT'));
          write.onsuccess = () => {
            if (fault === 'afterRequestSuccess') abort(error('SIMULATED_ABORT_AFTER_REQUEST_SUCCESS'));
            if (fault === 'quotaAbort') abort(error('SIMULATED_QUOTA_EXCEEDED', new DOMException('Synthetic quota fault', 'QuotaExceededError')));
          };
        };
        const headRead = tx.objectStore('meta').get('head');
        headRead.onsuccess = () => { actualHead = headRead.result; ready(); };
        const ledgerRead = tx.objectStore('ledger').getAll(null, 10);
        ledgerRead.onsuccess = () => { actualLedger = ledgerRead.result; ready(); };
        tx.onerror = () => {};
        tx.onabort = () => fail(failure || error(tx.error?.name === 'QuotaExceededError' ? 'LOCAL_QUOTA_EXCEEDED_RECOVERY_REQUIRED' : 'LOCAL_COMMIT_ABORTED_RECOVERY_REQUIRED', tx.error));
        tx.oncomplete = () => {
          if (fault === 'afterCommitAckLost') { fail(error('SIMULATED_COMMIT_ACK_LOST')); return; }
          if (!settled) { settled = true; resolve(); }
        };
      } catch (e) {
        // A synchronous exception after a write was queued is uncertain until abort/recovery.
        if (tx) abort(error('LOCAL_COMMIT_UNCERTAIN_RECOVERY_REQUIRED', e));
        else fail(error('LOCAL_TRANSACTION_OPEN_FAILED_RECOVERY_REQUIRED', e));
      }
    });
  }
}
const PRIVATE = Symbol('IndexedDBPaperStore');
