import { byteLength } from './portable.mjs';
import { HEADER_BYTES, LEDGER_ROW_BYTES, initialState, validateState, fingerprint } from './core.mjs';

const bytes = value => byteLength(JSON.stringify(value));
const copy = value => structuredClone(value);

// Contract model only: NOT durable disk, database, fsync, or physical quota assurance.
// A real adapter must atomically commit state + append-only ledger + reservations,
// serialize concurrent writers, and durably reserve these bytes before admission.
export class MemoryStore {
  #state;
  #fault = null;
  #inTransaction = false;
  #capacityRows;
  #capacityBytes;
  constructor({ state = initialState(), capacityRows = 9, capacityBytes = HEADER_BYTES + capacityRows * LEDGER_ROW_BYTES } = {}) {
    if (!Number.isSafeInteger(capacityRows) || capacityRows < 0 || capacityRows > 9 || !Number.isSafeInteger(capacityBytes) || capacityBytes < HEADER_BYTES) throw Error('INVALID_STORAGE_CAPACITY');
    this.#capacityRows = capacityRows; this.#capacityBytes = capacityBytes;
    validateState(state); this.#check(state); this.#state = copy(state);
  }
  get capacityRows() { return this.#capacityRows; }
  get capacityBytes() { return this.#capacityBytes; }
  read() { return copy(this.#state); }
  canReserve(state, rows) {
    return state.ledger.length + rows <= this.capacityRows && HEADER_BYTES + (state.ledger.length + rows) * LEDGER_ROW_BYTES <= this.capacityBytes;
  }
  #check(next) {
    validateState(next);
    const { ledger, ...header } = next;
    if (bytes(header) > HEADER_BYTES || ledger.some(row => bytes(row) > LEDGER_ROW_BYTES)) throw Error('RECORD_EXCEEDS_RESERVED_BYTES');
    if (!this.canReserve(next, next.reservedRows)) throw Error('STORAGE_RESERVATION_EXCEEDED');
  }
  transact(fn) {
    if (typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction') throw Error('SYNCHRONOUS_TRANSACTION_REQUIRED');
    if (this.#inTransaction) throw Error('NESTED_TRANSACTION_NOT_ALLOWED');
    this.#inTransaction = true;
    try {
    const next = copy(this.#state);
    const result = fn(next);
    if (result && typeof result.then === 'function') throw Error('SYNCHRONOUS_TRANSACTION_REQUIRED');
    const resultCopy = copy(result);
    if (next.ledger.length < this.#state.ledger.length || this.#state.ledger.some((row, i) => JSON.stringify(row) !== JSON.stringify(next.ledger[i]))) throw Error('IMMUTABLE_LEDGER_VIOLATION');
    this.#check(next);
    const fault = this.#fault; this.#fault = null;
    if (fault === 'beforeCommit') throw Error('SIMULATED_CRASH_BEFORE_COMMIT');
    this.#state = copy(next);
    if (fault === 'afterCommit') throw Error('SIMULATED_CRASH_AFTER_COMMIT_ACK_LOST');
    return resultCopy;
    } finally { this.#inTransaction = false; }
  }
  injectFault(point) {
    if (!['beforeCommit', 'afterCommit'].includes(point)) throw Error('INVALID_FAULT_POINT');
    this.#fault = point;
  }
  snapshot() {
    const payload = { format: 'NEPTUNE2_PUBLIC_PAPER_CONTRACT_V1', capacityRows: this.capacityRows, capacityBytes: this.capacityBytes, state: this.read() };
    return JSON.stringify({ payload, sha256: fingerprint(payload) });
  }
  static restore(text) {
    if (typeof text !== 'string' || byteLength(text) > HEADER_BYTES + 9 * LEDGER_ROW_BYTES + 1024) throw Error('SNAPSHOT_SIZE_LIMIT');
    const { payload, sha256 } = JSON.parse(text);
    if (!payload || payload.format !== 'NEPTUNE2_PUBLIC_PAPER_CONTRACT_V1' || fingerprint(payload) !== sha256) throw Error('SNAPSHOT_CHECKSUM_FAILED');
    return new MemoryStore(payload);
  }
}

// Optional research cannot consume exit reservations or delete trade evidence.
export class ResearchRing {
  #items = [];
  #limit;
  constructor(limit = 8) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw Error('INVALID_RESEARCH_LIMIT');
    this.#limit = limit;
  }
  get limit() { return this.#limit; }
  add({ atMs, text }) {
    if (!Number.isSafeInteger(atMs) || atMs < 0 || typeof text !== 'string' || byteLength(text) > 256) throw Error('INVALID_RESEARCH_ITEM');
    this.#items.push({ atMs, text });
    if (this.#items.length > this.limit) this.#items.shift();
  }
  read() { return copy(this.#items); }
}
