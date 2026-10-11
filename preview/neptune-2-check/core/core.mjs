// Isolated PUBLIC PRICE PAPER PRACTICE contract. All fills are modeled, never orders.
// Receipt clocks and local ordinals are not exchange timestamps or sequences.
import { sha256, byteLength } from './portable.mjs';
import { certifyPublicResponse, verifyPublicBook } from '../public-boundary.mjs';

export const INSTRUMENT = Object.freeze({ venue: 'KRAKEN_SPOT_INTERNATIONAL', asset: 'ETH', quote: 'USD', restPair: 'XETHZUSD', altname: 'ETHUSD', wsname: 'ETH/USD', baseCode: 'XETH', quoteCode: 'ZUSD' });
export const LIMITS = Object.freeze({
  initialCashMicros: 100_000_000, maxPositionCostMicros: 25_000_000,
  maxRealizedLossMicros: 5_000_000, maxEntries: 1, pilotDurationMs: 180_000,
  maxHoldingMs: 60_000, quoteAgeMs: 1_500, maxSnapshotSilenceMs: 5_000, intentLifeMs: 5_000,
  feeBps: 40, slippageBps: 10, maxSpreadBps: 50, maxEntryDriftBps: 50,
  maxDepthParticipationBps: 1_000, stopBps: 200, takeProfitBps: 300,
  
});
export const HEADER_BYTES = 98_304;
export const LEDGER_ROW_BYTES = 49_152;
const SCALE = 1_000_000;
const BPS = 10_000;
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const fingerprint = value => sha256(JSON.stringify(canonical(value)));
const fail = code => { throw new Error(code); };
const require = (condition, code) => { if (!condition) fail(code); };
const integer = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const mul = (a, b, d, up = false) => {
  const product = BigInt(a) * BigInt(b);
  const value = Number((product + (up ? BigInt(d) - 1n : 0n)) / BigInt(d));
  require(Number.isSafeInteger(value), 'ARITHMETIC_OVERFLOW');
  return value;
};
const time = n => integer(n, 8_000_000_000_000);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(id);
const identity = value => value && Object.keys(INSTRUMENT).every(key => value[key] === INSTRUMENT[key]);
const fresh = (at, now, limit) => time(at) && time(now) && at <= now && now - at <= limit;
const notional = (price, quantity, up) => mul(price, quantity, SCALE, up);
const fee = (gross, c) => mul(gross, c.feeBps, BPS, true);
const executionCosts = (b, quantity, price, side) => {
  const buying = side === 'buy', touch = buying ? b.askMicros : b.bidMicros;
  const midpoint = Math.floor((b.askMicros + b.bidMicros) / 2);
  return { quotedBidMicros: b.bidMicros, quotedAskMicros: b.askMicros,
    modeledSpreadCostMicros: Math.abs(notional(touch, quantity, buying) - notional(midpoint, quantity, buying)),
    modeledSlippageCostMicros: Math.abs(notional(price, quantity, buying) - notional(touch, quantity, buying)) };
};
const sell = (book, quantity, c) => {
  const price = mul(book.bidMicros, BPS - c.slippageBps, BPS);
  const gross = notional(price, quantity, false);
  return { priceMicros: price, grossMicros: gross, feeMicros: fee(gross, c), netMicros: gross - fee(gross, c) };
};
const hasDepth = (depth, quantity, c) => quantity <= mul(depth, c.maxDepthParticipationBps, BPS);
const spreadBps = book => mul(book.askMicros - book.bidMicros, BPS, book.bidMicros, true);
const EXIT_REASONS = ['OWNER_STOP', 'PILOT_EXPIRED', 'MAX_HOLDING_TIME', 'STOP_TRIGGER', 'TAKE_PROFIT_TRIGGER', 'DATA_INTERRUPTED'];
const SNAPSHOT_FIELDS = 'askDepthMicroEth,askMicros,askUpdatedAtMs,bidDepthMicroEth,bidMicros,bidUpdatedAtMs,bookType,exchangeSequence,instrument,localOrdinal,publicEvidence,receivedAtMs,requestStartedAtMs,sessionId,sourceDigest,sourceEventAtMs,synthetic';
function validateBook(b, now, checkFresh = true) {
  require(b && Object.keys(b).sort().join() === SNAPSHOT_FIELDS, 'INVALID_SNAPSHOT_FIELDS');
  verifyPublicBook(b);
  require(b.synthetic === false && b.bookType === 'independent-rest-depth' && identity(b.instrument) && Object.keys(b.instrument).length === Object.keys(INSTRUMENT).length, 'INVALID_SNAPSHOT_IDENTITY');
  require(b.exchangeSequence === null && b.sourceEventAtMs === null && validId(b.sessionId) && /^[a-f0-9]{64}$/.test(b.sourceDigest), 'FALSE_SOURCE_CHRONOLOGY');
  require(['bidMicros', 'askMicros', 'bidDepthMicroEth', 'askDepthMicroEth', 'localOrdinal'].every(k => integer(b[k], 1_000_000_000_000) && b[k] > 0) && b.askMicros > b.bidMicros, 'INVALID_BOOK');
  require(time(b.requestStartedAtMs) && time(b.receivedAtMs) && b.requestStartedAtMs <= b.receivedAtMs && b.receivedAtMs <= now && b.receivedAtMs - b.requestStartedAtMs <= LIMITS.quoteAgeMs, 'INVALID_SNAPSHOT_CLOCK');
  require([b.askUpdatedAtMs, b.bidUpdatedAtMs].every(at => time(at) && at <= b.receivedAtMs && (checkFresh ? now : b.receivedAtMs) - at <= 30_000), 'STALE_OR_FUTURE_TOP_LEVEL');
  // This is a LOCAL request-age budget, never proof of exchange snapshot freshness.
  require(fresh(b.requestStartedAtMs, now, checkFresh ? LIMITS.quoteAgeMs : Number.MAX_SAFE_INTEGER), 'STALE_OR_FUTURE_SNAPSHOT');
}
function validateEvidence(e, receipt) {
  require(e && validId(e.setupId) && typeof e.entryReason === 'string' && e.entryReason.length > 0 && byteLength(e.entryReason) <= 160 && e.expectedMoveBps === null && e.setupId === 'OWNER_PRACTICE' && e.entryReason === 'One bounded paper mechanics exercise; no expected edge claimed.' && integer(e.decisionSnapshotOrdinal) && e.decisionSnapshotOrdinal > 0 && time(e.decisionReceivedAtMs) && integer(e.decisionAskMicros) && e.decisionAskMicros > 0, 'INVALID_ENTRY_EVIDENCE');
  const c = { synthetic: false, id: receipt.candidateId, setupId: e.setupId, entryReason: e.entryReason, instrument: { ...INSTRUMENT }, snapshotOrdinal: e.decisionSnapshotOrdinal, snapshotReceivedAtMs: e.decisionReceivedAtMs, snapshotAskMicros: e.decisionAskMicros, expectedMoveBps: e.expectedMoveBps };
  require(fingerprint(c) === receipt.fingerprint, 'ENTRY_EVIDENCE_RECEIPT_MISMATCH');
}


export function initialState() {
  return {
    schema: 3, mode: 'PUBLIC_PRICE_PAPER_PRACTICE', dataMode: 'PUBLIC_PRICE_PAPER_PRACTICE', dataInterrupted: false, protectiveResumedAtMs: null, reconnectPending: false, limits: { ...LIMITS },
    lastNowMs: null, startedAtMs: null, startId: null, entriesEnabled: false, entryHaltReason: 'NOT_STARTED',
    entryCount: 0, cashMicros: LIMITS.initialCashMicros, realizedNetMicros: 0,
    lastBook: null, intent: null, position: null,
    reservedRows: 0, reservedCashMicros: 0, receipts: [], ledger: [],
  };
}

// Cross-check a recovered snapshot against its immutable, ordered cash ledger.
export function validateState(s) {
  require(s && s.schema === 3 && s.mode === 'PUBLIC_PRICE_PAPER_PRACTICE' && same(s.limits, LIMITS), 'INVALID_SNAPSHOT_SCHEMA');
  require(s.lastNowMs === null || time(s.lastNowMs), 'INVALID_CLOCK_STATE');
  require(typeof s.entriesEnabled === 'boolean' && [null, 'NOT_STARTED', 'OWNER_STOP', 'PILOT_EXPIRED', 'REALIZED_LOSS_LIMIT', 'DATA_INTERRUPTED', 'PRACTICE_COMPLETE'].includes(s.entryHaltReason) && (s.entriesEnabled ? s.entryHaltReason === null : s.entryHaltReason !== null), 'INVALID_HALT_STATE');
  if (s.lastBook) validateBook(s.lastBook, s.lastNowMs, false);
  require(s.dataMode === 'PUBLIC_PRICE_PAPER_PRACTICE' && typeof s.dataInterrupted === 'boolean', 'INVALID_DATA_MODE');
  require(!s.dataInterrupted || !s.entriesEnabled && s.entryHaltReason === 'DATA_INTERRUPTED', 'INVALID_INTERRUPTION_STATE');
  require(typeof s.reconnectPending === 'boolean' && (s.protectiveResumedAtMs === null || time(s.protectiveResumedAtMs) && s.dataInterrupted && s.protectiveResumedAtMs <= s.lastNowMs), 'INVALID_PROTECTIVE_RESUME');
  require(!s.reconnectPending || s.dataInterrupted && s.position && s.intent?.side === 'sell' && s.protectiveResumedAtMs === s.intent.createdAtMs, 'INVALID_RECONNECT_STATE');
  require(integer(s.cashMicros) && Number.isSafeInteger(s.realizedNetMicros), 'INVALID_BALANCE');
  require(integer(s.entryCount, LIMITS.maxEntries) && Array.isArray(s.receipts) && s.receipts.length === s.entryCount, 'INVALID_ENTRY_COUNT');
  require(new Set(s.receipts.map(r => r.candidateId)).size === s.entryCount, 'DUPLICATE_CANDIDATE');
  require(s.receipts.every((r, i) => validId(r.candidateId) && r.tradeId === `paper-${i + 1}` && /^[a-f0-9]{64}$/.test(r.fingerprint)), 'INVALID_RECEIPT');
  require(Array.isArray(s.ledger) && s.ledger.length <= LIMITS.maxEntries * 3, 'INVALID_LEDGER');
  let cash = LIMITS.initialCashMicros, realized = 0, open = null, sold = null, lastFillOrdinal = 0, lastFillAt = 0;
  const completed = new Set();
  for (const row of s.ledger) {
    require(row && s.receipts.some(r => r.tradeId === row.tradeId) && !completed.has(row.tradeId), 'INVALID_TRADE_REFERENCE');
    if (row.kind === 'fill') {
      require(identity(row.instrument) && Object.keys(row.instrument).length === Object.keys(INSTRUMENT).length && integer(row.snapshotOrdinal) && time(row.snapshotReceivedAtMs) && time(row.filledAtMs), 'INVALID_FILL_IDENTITY');
      require(integer(row.priceMicros) && (row.side === 'sell' || row.priceMicros > 0) && integer(row.quantityMicroEth) && row.quantityMicroEth > 0, 'INVALID_FILL_SIZE');
      require(integer(row.grossMicros) && integer(row.feeMicros) && row.feeMicros === fee(row.grossMicros, LIMITS), 'INVALID_FILL_COST');
      require(row.grossMicros === notional(row.priceMicros, row.quantityMicroEth, row.side === 'buy'), 'INVALID_FILL_NOTIONAL');
      require(row.snapshotOrdinal > lastFillOrdinal && row.snapshotReceivedAtMs > lastFillAt && row.snapshotOrdinal <= s.lastBook?.localOrdinal && row.snapshotReceivedAtMs <= s.lastBook?.receivedAtMs, 'INVALID_FILL_CHRONOLOGY');
      lastFillOrdinal = row.snapshotOrdinal; lastFillAt = row.snapshotReceivedAtMs;
      require(row.snapshotSessionId === s.lastBook?.sessionId && /^[a-f0-9]{64}$/.test(row.sourceDigest) && row.synthetic === false && row.simulated === true && row.exchangeSequence === null && row.sourceEventAtMs === null && time(row.snapshotRequestedAtMs) && row.snapshotRequestedAtMs > row.intentCreatedAtMs && row.snapshotRequestedAtMs <= row.snapshotReceivedAtMs && row.filledAtMs - row.snapshotRequestedAtMs <= LIMITS.quoteAgeMs && time(row.intentCreatedAtMs) && row.intentCreatedAtMs >= s.startedAtMs && row.snapshotReceivedAtMs > row.intentCreatedAtMs && row.filledAtMs > row.intentCreatedAtMs, 'FILL_PRECEDES_INTENT');
      require(integer(row.quotedBidMicros) && row.quotedBidMicros > 0 && integer(row.quotedAskMicros) && row.quotedAskMicros >= row.quotedBidMicros, 'INVALID_FILL_QUOTES');
      const expectedPrice = mul(row.side === 'buy' ? row.quotedAskMicros : row.quotedBidMicros, BPS + (row.side === 'buy' ? LIMITS.slippageBps : -LIMITS.slippageBps), BPS, row.side === 'buy');
      const expectedCosts = executionCosts({ bidMicros: row.quotedBidMicros, askMicros: row.quotedAskMicros }, row.quantityMicroEth, row.priceMicros, row.side);
      require(row.priceMicros === expectedPrice && row.modeledSpreadCostMicros === expectedCosts.modeledSpreadCostMicros && row.modeledSlippageCostMicros === expectedCosts.modeledSlippageCostMicros, 'INVALID_EXECUTION_COST_MODEL');
      require([row.snapshotBidUpdatedAtMs, row.snapshotAskUpdatedAtMs].every(at => time(at) && at <= row.snapshotReceivedAtMs && row.filledAtMs - at <= 30_000), 'INVALID_FILL_LEVEL_AGE');
      const certified = certifyPublicResponse(row.publicEvidence, row.snapshotReceivedAtMs);
      require(certified.sourceDigest === row.sourceDigest && certified.localOrdinal === row.snapshotOrdinal && certified.sessionId === row.snapshotSessionId && certified.bidMicros === row.quotedBidMicros && certified.askMicros === row.quotedAskMicros && certified.requestStartedAtMs === row.snapshotRequestedAtMs && certified.receivedAtMs === row.snapshotReceivedAtMs && certified.bidUpdatedAtMs === row.snapshotBidUpdatedAtMs && certified.askUpdatedAtMs === row.snapshotAskUpdatedAtMs, 'FILL_PUBLIC_EVIDENCE_MISMATCH');
      require(spreadBps(certified) <= LIMITS.maxSpreadBps && hasDepth(row.side === 'buy' ? certified.askDepthMicroEth : certified.bidDepthMicroEth, row.quantityMicroEth, LIMITS), 'RECOVERED_FILL_LIQUIDITY_LIMIT');
      require(row.fillId === `${row.tradeId}-${row.side}` && row.filledAtMs >= row.snapshotReceivedAtMs && row.filledAtMs <= s.lastNowMs, 'INVALID_FILL_ID');
      if (row.side === 'buy') {
        require(!open && !sold, 'DOUBLE_BUY');
        validateEvidence(row.entryEvidence, s.receipts.find(r => r.tradeId === row.tradeId));
        require(row.snapshotOrdinal > row.entryEvidence.decisionSnapshotOrdinal && row.intentCreatedAtMs >= row.entryEvidence.decisionReceivedAtMs, 'INVALID_ENTRY_DECISION_ORDER');
        require(row.priceMicros <= mul(row.entryEvidence.decisionAskMicros, BPS + LIMITS.maxEntryDriftBps, BPS, true), 'RECOVERED_ENTRY_PRICE_DRIFT');
        require(row.grossMicros + row.feeMicros <= LIMITS.maxPositionCostMicros, 'ENTRY_RISK_LIMIT');
        open = row; cash -= row.grossMicros + row.feeMicros;
      } else {
        require(row.side === 'sell' && open && !sold && row.tradeId === open.tradeId && row.quantityMicroEth === open.quantityMicroEth, 'DOUBLE_OR_UNMATCHED_SELL');
        require(row.snapshotOrdinal > open.snapshotOrdinal && row.snapshotReceivedAtMs > open.snapshotReceivedAtMs, 'INVALID_EXIT_ORDER');
        require(EXIT_REASONS.includes(row.exitReason), 'INVALID_EXIT_REASON');
        sold = row; cash += row.grossMicros - row.feeMicros;
      }
    } else {
      require(row.kind === 'settlement' && row.simulated === true && row.currency === 'USD' && open && sold && row.tradeId === open.tradeId, 'UNMATCHED_SETTLEMENT');
      require(row.settledAtMs === sold.filledAtMs && row.exitReason === sold.exitReason, 'INVALID_SETTLEMENT_TIME_OR_REASON');
      const net = sold.grossMicros - sold.feeMicros - open.grossMicros - open.feeMicros;
      require(row.totalFeesMicros === open.feeMicros + sold.feeMicros && row.modeledSpreadCostMicros === open.modeledSpreadCostMicros + sold.modeledSpreadCostMicros && row.modeledSlippageCostMicros === open.modeledSlippageCostMicros + sold.modeledSlippageCostMicros, 'INVALID_COST_SUMMARY');
      require(row.netProfitMicros === net && row.entryCostMicros === open.grossMicros + open.feeMicros && row.exitProceedsMicros === sold.grossMicros - sold.feeMicros, 'INVALID_SETTLEMENT');
      realized += net; completed.add(row.tradeId); open = null; sold = null;
    }
    require(cash >= 0, 'NEGATIVE_CASH');
  }
  require(!sold && cash === s.cashMicros && realized === s.realizedNetMicros, 'CAPITAL_CONSERVATION');
  require(Boolean(open) === Boolean(s.position), 'POSITION_LEDGER_MISMATCH');
  if (open) {
    const expected = { tradeId: open.tradeId, quantityMicroEth: open.quantityMicroEth, entryCostMicros: open.grossMicros + open.feeMicros, enteredAtMs: open.filledAtMs, stopPriceMicros: mul(open.priceMicros, BPS - LIMITS.stopBps, BPS), targetPriceMicros: mul(open.priceMicros, BPS + LIMITS.takeProfitBps, BPS, true) };
    require(same(s.position, expected), 'POSITION_PROTECTION_MISMATCH');
  }
  const expectedRows = s.position ? 2 : s.intent?.side === 'buy' ? 3 : 0;
  require(s.reservedRows === expectedRows, 'EXIT_RESERVATION_MISMATCH');
  require(integer(s.reservedCashMicros) && s.reservedCashMicros <= s.cashMicros, 'INVALID_CASH_RESERVATION');
  require(s.intent?.side === 'buy' ? !s.position && s.reservedCashMicros > 0 : s.reservedCashMicros === 0, 'INVALID_INTENT_STATE');
  if (s.intent) {
    const i = s.intent, receipt = s.receipts.find(r => r.tradeId === i.tradeId);
    require(receipt && (i.side === 'buy' || (i.side === 'sell' && s.position?.tradeId === i.tradeId)), 'INVALID_INTENT_REFERENCE');
    require(time(i.createdAtMs) && i.createdAtMs <= s.lastNowMs && i.createdAtMs >= s.startedAtMs && time(i.afterReceivedAtMs) && i.afterReceivedAtMs <= i.createdAtMs && i.afterReceivedAtMs <= s.lastBook?.receivedAtMs && integer(i.afterSnapshotOrdinal) && i.afterSnapshotOrdinal > 0 && i.afterSnapshotOrdinal <= s.lastBook?.localOrdinal, 'INVALID_INTENT_TIME');
    if (i.side === 'buy') {
      validateEvidence(i.entryEvidence, receipt);
      require(i.expiresAtMs === i.createdAtMs + LIMITS.intentLifeMs && i.afterSnapshotOrdinal === i.entryEvidence.decisionSnapshotOrdinal && i.afterReceivedAtMs === i.entryEvidence.decisionReceivedAtMs, 'INVALID_BUY_INTENT_TIME');
      const maximum = mul(i.entryEvidence.decisionAskMicros, BPS + LIMITS.maxEntryDriftBps, BPS, true);
      require(integer(i.quantityMicroEth) && i.quantityMicroEth > 0 && i.maxPriceMicros === maximum, 'INVALID_BUY_INTENT_RISK');
      const gross = notional(maximum, i.quantityMicroEth, true);
      require(s.reservedCashMicros === gross + fee(gross, LIMITS) && s.reservedCashMicros <= LIMITS.maxPositionCostMicros && s.entriesEnabled, 'INVALID_BUY_INTENT_RESERVE');
    } else require(EXIT_REASONS.includes(i.reason) && i.createdAtMs >= s.position.enteredAtMs, 'INVALID_EXIT_INTENT');
  }
  require(s.startedAtMs === null ? s.startId === null && !s.entriesEnabled && s.entryCount === 0 : time(s.startedAtMs) && s.startedAtMs <= s.lastNowMs && validId(s.startId), 'INVALID_START_STATE');
  require(s.realizedNetMicros > -LIMITS.maxRealizedLossMicros || !s.entriesEnabled, 'LOSS_LIMIT_NOT_HALTED');
  return true;
}

export class PaperEngine {
  constructor(store) {
    require(store && typeof store.read === 'function' && typeof store.transact === 'function' && typeof store.canReserve === 'function', 'STORAGE_CONTRACT_REQUIRED');
    this.store = store;
    validateState(store.read());
  }
  change(fn, now) {
    require(time(now), 'INVALID_CLOCK');
    return this.store.transact(s => { validateState(s); require(s.lastNowMs === null || now >= s.lastNowMs, 'CLOCK_MOVED_BACKWARDS'); s.lastNowMs = now; const result = fn(s); validateState(s); return result; });
  }
  start({ id, acknowledgement, now }) {
    require(validId(id) && time(now) && acknowledgement === 'START_ONE_FINITE_PUBLIC_PRICE_PAPER_PRACTICE', 'EXPLICIT_PAPER_START_REQUIRED');
    return this.change(s => {
      require(!s.dataInterrupted, 'INTERRUPTED_ENTRIES_PERMANENTLY_HALTED');
      if (s.startId === id) return { status: 'DUPLICATE_START' };
      require(s.startedAtMs === null, 'PILOT_ALREADY_STARTED');
      s.startId = id; s.startedAtMs = now; s.entriesEnabled = true; s.entryHaltReason = null;
      return { status: 'PAPER_STARTED', expiresAtMs: now + s.limits.pilotDurationMs };
    }, now);
  }
  // Entry halts never disable existing position/exit processing.
  halt(s, reason, now) {
    s.entriesEnabled = false; s.entryHaltReason = s.dataInterrupted ? 'DATA_INTERRUPTED' : reason;
    if (s.intent?.side === 'buy') { s.intent = null; s.reservedRows = 0; s.reservedCashMicros = 0; }
    if (s.position && !s.intent) this.exitIntent(s, reason, now);
  }
  exitIntent(s, reason, now) {
    s.intent = { side: 'sell', tradeId: s.position.tradeId, reason, createdAtMs: now,
      afterSnapshotOrdinal: s.lastBook.localOrdinal, afterReceivedAtMs: s.lastBook.receivedAtMs };
  }
  tickState(s, now) {
    if (s.startedAtMs !== null && now >= s.startedAtMs + s.limits.pilotDurationMs) this.halt(s, 'PILOT_EXPIRED', now);
    if (s.intent?.side === 'buy' && now >= s.intent.expiresAtMs) { s.intent = null; s.reservedRows = 0; s.reservedCashMicros = 0; }
    if (s.position && !s.intent && now >= s.position.enteredAtMs + s.limits.maxHoldingMs) this.exitIntent(s, 'MAX_HOLDING_TIME', now);
  }
  tick(now) { require(time(now), 'INVALID_CLOCK'); return this.change(s => { this.tickState(s, now); return { status: 'CHECKED' }; }, now); }
  stop(now) { require(time(now), 'INVALID_CLOCK'); return this.change(s => { this.halt(s, 'OWNER_STOP', now); return { status: 'ENTRIES_HALTED_EXITS_REMAIN_ACTIVE' }; }, now); }
  interrupt(now) {
    return this.change(s => { s.dataInterrupted = true; s.protectiveResumedAtMs = null; s.reconnectPending = false; this.halt(s, 'DATA_INTERRUPTED', now); return { status: 'SNAPSHOT_STREAM_INTERRUPTED' }; }, now);
  }
  resumeProtective({ acknowledgement, now }) {
    require(acknowledgement === 'RESUME_FRESH_PROTECTIVE_EXIT_ONLY', 'EXPLICIT_PROTECTIVE_RESUME_REQUIRED');
    return this.change(s => {
      require(s.dataInterrupted && s.position, 'NO_INTERRUPTED_POSITION');
      s.protectiveResumedAtMs = now; s.reconnectPending = true;
      this.exitIntent(s, 'DATA_INTERRUPTED', now);
      return { status: 'FRESH_PROTECTIVE_EXIT_ONLY' };
    }, now);
  }
  observePublicResponse(evidence, now) {
    const b = certifyPublicResponse(evidence, now);
    validateBook(b, now, false);
    return this.change(s => {
      require(!s.dataInterrupted || s.position && s.protectiveResumedAtMs !== null, 'SNAPSHOT_SESSION_INTERRUPTED');
      const dataMode = 'PUBLIC_PRICE_PAPER_PRACTICE';
      if (s.lastBook && b.localOrdinal === s.lastBook.localOrdinal) { require(same(b, s.lastBook), 'SNAPSHOT_ORDINAL_CONFLICT'); return { status: 'DUPLICATE_SNAPSHOT' }; }
      validateBook(b, now);
      require(s.lastBook ? b.sessionId === s.lastBook.sessionId && b.localOrdinal === s.lastBook.localOrdinal + 1 && b.requestStartedAtMs > s.lastBook.receivedAtMs : b.localOrdinal === 1, 'SNAPSHOT_SESSION_ORDER_ERROR');
      if (s.lastBook && !s.reconnectPending && b.requestStartedAtMs - s.lastBook.receivedAtMs > LIMITS.maxSnapshotSilenceMs) {
        s.dataInterrupted = true; s.protectiveResumedAtMs = null; s.reconnectPending = false; this.halt(s, 'DATA_INTERRUPTED', now); return { status: 'SNAPSHOT_STREAM_INTERRUPTED' };
      }
      if (s.lastBook) for (const side of ['bid', 'ask']) require(b[`${side}Micros`] !== s.lastBook[`${side}Micros`] || b[`${side}UpdatedAtMs`] >= s.lastBook[`${side}UpdatedAtMs`], 'TOP_LEVEL_TIME_REGRESSION');
      s.dataMode = dataMode;
      this.tickState(s, now);
      const priorIntent = s.intent;
      s.lastBook = b; s.reconnectPending = false;
      if (priorIntent && !b.synthetic && b.requestStartedAtMs > priorIntent.createdAtMs && b.localOrdinal > priorIntent.afterSnapshotOrdinal && b.receivedAtMs > priorIntent.afterReceivedAtMs && b.receivedAtMs > priorIntent.createdAtMs && now > priorIntent.createdAtMs) {
        if (priorIntent.side === 'buy') {
          const price = mul(b.askMicros, BPS + s.limits.slippageBps, BPS, true);
          if (price > priorIntent.maxPriceMicros || spreadBps(b) > s.limits.maxSpreadBps || !hasDepth(b.askDepthMicroEth, priorIntent.quantityMicroEth, s.limits)) return { status: 'BUY_WAITING_FOR_PRICE_OR_DEPTH' };
          const gross = notional(price, priorIntent.quantityMicroEth, true), fees = fee(gross, s.limits);
          require(gross + fees <= s.reservedCashMicros, 'ENTRY_EXCEEDS_RESERVED_CASH');
          s.ledger.push({ kind: 'fill', fillId: `${priorIntent.tradeId}-buy`, tradeId: priorIntent.tradeId, side: 'buy', instrument: { ...INSTRUMENT }, quantityMicroEth: priorIntent.quantityMicroEth, priceMicros: price, grossMicros: gross, feeMicros: fees, ...executionCosts(b, priorIntent.quantityMicroEth, price, 'buy'), entryEvidence: priorIntent.entryEvidence, intentCreatedAtMs: priorIntent.createdAtMs, synthetic: false, simulated: true, publicEvidence: structuredClone(b.publicEvidence), snapshotSessionId: b.sessionId, sourceDigest: b.sourceDigest, exchangeSequence: null, sourceEventAtMs: null, snapshotRequestedAtMs: b.requestStartedAtMs, snapshotBidUpdatedAtMs: b.bidUpdatedAtMs, snapshotAskUpdatedAtMs: b.askUpdatedAtMs, snapshotOrdinal: b.localOrdinal, snapshotReceivedAtMs: b.receivedAtMs, filledAtMs: now });
          s.cashMicros -= gross + fees;
          s.position = { tradeId: priorIntent.tradeId, quantityMicroEth: priorIntent.quantityMicroEth, entryCostMicros: gross + fees, enteredAtMs: now, stopPriceMicros: mul(price, BPS - s.limits.stopBps, BPS), targetPriceMicros: mul(price, BPS + s.limits.takeProfitBps, BPS, true) };
          s.intent = null; s.reservedRows = 2; s.reservedCashMicros = 0;
          return { status: 'BUY_FILLED', tradeId: priorIntent.tradeId };
        }
        if (spreadBps(b) > s.limits.maxSpreadBps || !hasDepth(b.bidDepthMicroEth, s.position.quantityMicroEth, s.limits)) return { status: 'EXIT_WAITING_FOR_DEPTH' };
        const execution = sell(b, s.position.quantityMicroEth, s.limits);
        const entryCost = s.position.entryCostMicros, entryFill = s.ledger.at(-1);
        s.ledger.push({ kind: 'fill', fillId: `${priorIntent.tradeId}-sell`, tradeId: priorIntent.tradeId, side: 'sell', instrument: { ...INSTRUMENT }, quantityMicroEth: s.position.quantityMicroEth, priceMicros: execution.priceMicros, grossMicros: execution.grossMicros, feeMicros: execution.feeMicros, ...executionCosts(b, s.position.quantityMicroEth, execution.priceMicros, 'sell'), intentCreatedAtMs: priorIntent.createdAtMs, synthetic: false, simulated: true, publicEvidence: structuredClone(b.publicEvidence), snapshotSessionId: b.sessionId, sourceDigest: b.sourceDigest, exchangeSequence: null, sourceEventAtMs: null, snapshotRequestedAtMs: b.requestStartedAtMs, snapshotBidUpdatedAtMs: b.bidUpdatedAtMs, snapshotAskUpdatedAtMs: b.askUpdatedAtMs, snapshotOrdinal: b.localOrdinal, snapshotReceivedAtMs: b.receivedAtMs, filledAtMs: now, exitReason: priorIntent.reason });
        const net = execution.netMicros - entryCost;
        s.ledger.push({ kind: 'settlement', simulated: true, currency: 'USD', tradeId: priorIntent.tradeId, entryCostMicros: entryCost, exitProceedsMicros: execution.netMicros, netProfitMicros: net, totalFeesMicros: entryFill.feeMicros + execution.feeMicros, modeledSpreadCostMicros: entryFill.modeledSpreadCostMicros + s.ledger.at(-1).modeledSpreadCostMicros, modeledSlippageCostMicros: entryFill.modeledSlippageCostMicros + s.ledger.at(-1).modeledSlippageCostMicros, exitReason: priorIntent.reason, settledAtMs: now });
        s.cashMicros += execution.netMicros; s.realizedNetMicros += net;
        s.position = null; s.intent = null; s.reservedRows = 0; s.reconnectPending = false;
        this.halt(s, 'PRACTICE_COMPLETE', now);
        if (s.realizedNetMicros <= -s.limits.maxRealizedLossMicros) this.halt(s, 'REALIZED_LOSS_LIMIT', now);
        return { status: 'SELL_FILLED_AND_SETTLED', netProfitMicros: net };
      }
      if (s.position && !s.intent) {
        const reason = b.bidMicros <= s.position.stopPriceMicros ? 'STOP_TRIGGER' : b.bidMicros >= s.position.targetPriceMicros ? 'TAKE_PROFIT_TRIGGER' : null;
        if (reason) { this.exitIntent(s, reason, now); return { status: 'EXIT_INTENT_CREATED', reason }; }
      }
      return { status: 'SNAPSHOT_ACCEPTED' };
    }, now);
  }
  proposeBuy(candidate, now) {
    const c = structuredClone(candidate);
    require(c && Object.keys(c).sort().join() === 'entryReason,expectedMoveBps,id,instrument,setupId,snapshotAskMicros,snapshotOrdinal,snapshotReceivedAtMs,synthetic', 'INVALID_CANDIDATE_FIELDS');
    require(validId(c.setupId) && typeof c.entryReason === 'string' && c.entryReason.length > 0 && byteLength(c.entryReason) <= 160, 'BOUNDED_ENTRY_EVIDENCE_REQUIRED');
    require(c.synthetic === false && validId(c.id) && identity(c.instrument) && Object.keys(c.instrument).length === Object.keys(INSTRUMENT).length && c.expectedMoveBps === null && c.setupId === 'OWNER_PRACTICE' && c.entryReason === 'One bounded paper mechanics exercise; no expected edge claimed.', 'INVALID_CANDIDATE');
    require(time(now), 'INVALID_CLOCK');
    return this.change(s => {
      require(s.dataMode === 'PUBLIC_PRICE_PAPER_PRACTICE' && !s.dataInterrupted, 'INTERRUPTED_ENTRIES_PERMANENTLY_HALTED');
      const prior = s.receipts.find(r => r.candidateId === c.id);
      if (prior) { require(prior.fingerprint === fingerprint(c), 'CANDIDATE_ID_CONFLICT'); return { status: 'DUPLICATE_CANDIDATE', tradeId: prior.tradeId }; }
      this.tickState(s, now);
      require(s.entriesEnabled && s.startedAtMs !== null, 'ENTRIES_HALTED');
      require(!s.intent && !s.position, 'EXPOSURE_ALREADY_RESERVED');
      require(s.entryCount < s.limits.maxEntries, 'PILOT_ENTRY_LIMIT');
      const b = s.lastBook;
      require(b && fresh(b.requestStartedAtMs, now, s.limits.quoteAgeMs) && c.snapshotOrdinal === b.localOrdinal && c.snapshotReceivedAtMs === b.receivedAtMs && c.snapshotAskMicros === b.askMicros && [b.askUpdatedAtMs, b.bidUpdatedAtMs].every(at => now - at <= 30_000), 'CANDIDATE_MARKET_MISMATCH_OR_STALE');
      const spread = spreadBps(b);
      require(spread <= s.limits.maxSpreadBps, 'ENTRY_SPREAD_LIMIT');
      require(this.store.canReserve(s, 3), 'NO_PERSISTABLE_EXIT_CAPACITY');
      const maxPrice = mul(b.askMicros, BPS + s.limits.maxEntryDriftBps, BPS, true);
      const budget = Math.min(s.limits.maxPositionCostMicros, s.cashMicros);
      // Leave a two-microdollar allowance for independent notional and fee rounding.
      const budgetQuantity = mul(mul(Math.max(0, budget - 2), BPS, BPS + s.limits.feeBps), SCALE, maxPrice);
      const quantity = Math.min(budgetQuantity, mul(b.askDepthMicroEth, s.limits.maxDepthParticipationBps, BPS));
      require(quantity > 0 && hasDepth(b.askDepthMicroEth, quantity, s.limits), 'ENTRY_DEPTH_OR_CAPITAL_LIMIT');
      const gross = notional(maxPrice, quantity, true), reserved = gross + fee(gross, s.limits);
      require(reserved <= budget, 'RISK_BUDGET_EXCEEDED');
      const tradeId = `paper-${++s.entryCount}`;
      s.receipts.push({ candidateId: c.id, fingerprint: fingerprint(c), tradeId });
      s.intent = { side: 'buy', tradeId, entryEvidence: { setupId: c.setupId, entryReason: c.entryReason, expectedMoveBps: c.expectedMoveBps, decisionSnapshotOrdinal: b.localOrdinal, decisionReceivedAtMs: b.receivedAtMs, decisionAskMicros: b.askMicros }, quantityMicroEth: quantity, maxPriceMicros: maxPrice, createdAtMs: now, expiresAtMs: now + s.limits.intentLifeMs, afterSnapshotOrdinal: b.localOrdinal, afterReceivedAtMs: b.receivedAtMs };
      s.reservedRows = 3; s.reservedCashMicros = reserved;
      return { status: 'BUY_INTENT_CREATED', tradeId, quantityMicroEth: quantity };
    }, now);
  }
  status(now) {
    require(time(now), 'INVALID_CLOCK');
    const s = this.store.read();
    require(s.lastNowMs === null || now >= s.lastNowMs, 'CLOCK_MOVED_BACKWARDS');
    const marketFresh = (!s.dataInterrupted || s.protectiveResumedAtMs !== null) && s.lastBook && fresh(s.lastBook.requestStartedAtMs, now, s.limits.quoteAgeMs) && [s.lastBook.askUpdatedAtMs, s.lastBook.bidUpdatedAtMs].every(at => now - at <= 30_000);
    const spreadPermitted = s.lastBook && spreadBps(s.lastBook) <= s.limits.maxSpreadBps;
    const marketExecutable = marketFresh && spreadPermitted && (!s.position || hasDepth(s.lastBook.bidDepthMicroEth, s.position.quantityMicroEth, s.limits));
    const usdUnavailableReason = !s.position ? null : !marketFresh ? 'FRESH_MARKET_REQUIRED' : !spreadPermitted ? 'SPREAD_EXCEEDS_POLICY' : !marketExecutable ? 'INSUFFICIENT_EXECUTABLE_DEPTH' : null;
    const liquidation = !s.position ? 0 : marketExecutable ? sell(s.lastBook, s.position.quantityMicroEth, s.limits).netMicros : null;
    const equity = liquidation === null ? null : s.cashMicros + liquidation;
    return { mode: s.mode, dataMode: s.dataMode, dataInterrupted: s.dataInterrupted, snapshotWithinLocalPolicy: Boolean(marketFresh), sourceFreshness: 'UNKNOWN_NO_VENUE_SNAPSHOT_TIME', exchangeContinuityProven: false, executionAllowed: s.startedAtMs !== null && (!s.dataInterrupted || s.position !== null && s.protectiveResumedAtMs !== null), phase: s.intent ? `${s.intent.side.toUpperCase()}_PENDING` : s.position ? 'HOLDING' : 'FLAT',
      entriesEnabled: s.entriesEnabled && now < s.startedAtMs + s.limits.pilotDurationMs && s.entryCount < s.limits.maxEntries,
      cashUsdMicros: s.cashMicros, realizedNetUsdMicros: s.realizedNetMicros,
      unrealizedNetUsdMicros: liquidation === null ? null : s.position ? liquidation - s.position.entryCostMicros : 0,
      estimatedLiquidationEquityUsdMicros: equity, usdUnavailableReason,
      estimatedEquityAudMicros: null,
      audUnavailableReason: 'NATIVE_USD_ONLY_NO_AUD_EXECUTION_OR_CONVERSION',
      entryHaltReason: s.entryHaltReason, completedTrades: s.ledger.filter(r => r.kind === 'settlement').length,
      ledgerRows: s.ledger.length, reservedExitRows: s.reservedRows,
    };
  }
}
