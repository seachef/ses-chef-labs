import { createHash } from 'node:crypto';

const MAX_ID_LENGTH = 200;
const MAX_LEVELS = 1000;
const HASH = /^[a-f0-9]{64}$/;
const SCOPE_FIELDS = ['source', 'provenance', 'productId', 'base', 'quote'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = reason => { throw new Error(`BOOK_IDENTITY_INVALID: ${reason}`); };

function textId(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > MAX_ID_LENGTH) fail(`${label} must be a nonempty bounded identifier`);
  return value;
}

function scope(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('snapshot must be an object');
  const result = {};
  for (const key of SCOPE_FIELDS) result[key] = textId(snapshot[key], key);
  if (result.productId !== `${result.base}-${result.quote}`) fail('product/base/quote disagree');
  return result;
}

function scopeKey(identity) { return SCOPE_FIELDS.map(key => identity[key]); }
function sameScope(left, right) { return SCOPE_FIELDS.every(key => left[key] === right[key]); }
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a nonnegative safe integer`);
  return value;
}

function depth(snapshot) {
  const result = {};
  for (const side of ['bids', 'asks']) {
    const levels = snapshot[side];
    if (!Array.isArray(levels) || !levels.length || levels.length > MAX_LEVELS) fail(`${side} must contain 1..${MAX_LEVELS} levels`);
    result[side] = Array.from(levels, (row, index) => {
      if (!Array.isArray(row) || row.length !== 2 || !row.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) fail(`${side} has invalid price/quantity`);
      const [price, quantity] = row;
      if (!Number.isFinite(price * quantity)) fail(`${side} notional overflow`);
      if (index && (side === 'bids' ? levels[index - 1][0] <= price : levels[index - 1][0] >= price)) fail(`${side} is unsorted or contains duplicate prices`);
      return [price, quantity];
    });
  }
  if (result.bids[0][0] >= result.asks[0][0]) fail('book is crossed or locked');
  return result;
}

/**
 * Delivery eventId and tradeId are deliberately absent from every book key/hash.
 * Positive-latency callers must requireExplicit:true. Source identity does not
 * authenticate a feed, assert freshness, or authorize any execution.
 *
 * Legacy zero-latency advisory fallback hashes depth only. It proves no separate
 * source-book time or sequence; a ticker/receipt time change is never replenishment.
 * A caller using fallback keys must retain archived consumption to detect A-B-A
 * depth cycles. This helper does not change legacy execution or replay behavior.
 */
export function normalizeBookIdentity(snapshot, { requireExplicit = false } = {}) {
  if (typeof requireExplicit !== 'boolean') fail('requireExplicit must be boolean');
  const namespace = scope(snapshot);
  const observedDepth = depth(snapshot);
  const contentHash = hash([scopeKey(namespace), observedDepth.bids, observedDepth.asks]);
  const provided = ['bookId', 'bookSequence', 'bookSourceAt'].some(key => Object.hasOwn(snapshot, key));
  if (!provided) {
    if (requireExplicit) fail('explicit bookSequence and bookSourceAt are required');
    return {
      version: 1, ...namespace, explicit: false, basis: 'legacy-depth-only',
      key: `legacy-book:${hash([scopeKey(namespace), contentHash])}`,
      sequence: null, sourceAt: null, bookId: null, contentHash,
    };
  }
  const sequence = nonnegativeInteger(snapshot.bookSequence, 'bookSequence');
  const sourceAt = nonnegativeInteger(snapshot.bookSourceAt, 'bookSourceAt');
  const bookId = Object.hasOwn(snapshot, 'bookId') ? textId(snapshot.bookId, 'bookId') : null;
  return {
    version: 1, ...namespace, explicit: true, basis: 'source-book-sequence',
    key: `book:${hash([scopeKey(namespace), sequence])}`,
    sequence, sourceAt, bookId, contentHash,
  };
}

function validateIdentity(identity) {
  scope(identity);
  if (identity.version !== 1 || typeof identity.explicit !== 'boolean' || typeof identity.contentHash !== 'string' || !HASH.test(identity.contentHash)) fail('malformed normalized identity');
  if (identity.explicit) {
    nonnegativeInteger(identity.sequence, 'normalized sequence');
    nonnegativeInteger(identity.sourceAt, 'normalized sourceAt');
    if (identity.bookId !== null) textId(identity.bookId, 'normalized bookId');
    if (identity.basis !== 'source-book-sequence' || identity.key !== `book:${hash([scopeKey(identity), identity.sequence])}`) fail('normalized explicit key mismatch');
  } else if (identity.sequence !== null || identity.sourceAt !== null || identity.bookId !== null || identity.basis !== 'legacy-depth-only' ||
      identity.key !== `legacy-book:${hash([scopeKey(identity), identity.contentHash])}`) fail('normalized legacy key mismatch');
  return identity;
}

/** Compare source evidence, never local receipt or delivery-event progress. */
export function compareBookProgress(previous, next) {
  validateIdentity(next);
  if (previous === null || previous === undefined) return { status: 'new', reason: 'First observed book identity' };
  validateIdentity(previous);
  if (!sameScope(previous, next)) return { status: 'conflict', reason: 'Book source, product or currency scope changed' };
  if (previous.explicit !== next.explicit) return { status: 'conflict', reason: 'Book identity evidence mode changed' };
  if (!next.explicit) return next.key === previous.key
    ? { status: 'same', reason: 'Identical legacy depth; no separate source-book progression evidence' }
    : { status: 'new', reason: 'Changed legacy depth only; source ordering and replenishment remain unverified' };
  if (previous.bookId !== null && next.bookId === previous.bookId &&
      (previous.sequence !== next.sequence || previous.sourceAt !== next.sourceAt || previous.contentHash !== next.contentHash)) {
    return { status: 'conflict', reason: 'Same bookId has changed sequence, source time or depth' };
  }
  if (next.sequence < previous.sequence || next.sourceAt < previous.sourceAt) return { status: 'regression', reason: 'Book sequence or source time regressed' };
  if (next.sequence === previous.sequence) {
    if (next.contentHash !== previous.contentHash || next.sourceAt !== previous.sourceAt || next.bookId !== previous.bookId) {
      return { status: 'conflict', reason: 'Same book sequence has changed identity, source time or depth' };
    }
    return { status: 'same', reason: 'Same source book; delivery, trade and receipt changes grant no new liquidity' };
  }
  return { status: 'new', reason: 'Source book sequence advanced without source-time regression' };
}

/** A genuine supplied trade identifier, scoped to source/product/currency. */
export function tradeIdentity(snapshot) {
  const namespace = scope(snapshot);
  if (!Object.hasOwn(snapshot, 'tradeId')) return null;
  const id = typeof snapshot.tradeId === 'number'
    ? String(nonnegativeInteger(snapshot.tradeId, 'tradeId'))
    : textId(snapshot.tradeId, 'tradeId');
  // Numeric 7 and string "7" are the same identifier, not two delivery opportunities.
  return `trade:${hash([scopeKey(namespace), id])}`;
}

/** Equal timestamps do not merge distinct genuine trades. Book progress is separate. */
export function compareTradeProgress(previous, next) {
  const nextScope = scope(next), nextKey = tradeIdentity(next);
  nonnegativeInteger(next.sourceAt, 'trade sourceAt');
  if (previous === null || previous === undefined) return { status: nextKey === null ? 'unknown' : 'new', reason: nextKey === null ? 'No genuine trade identity supplied' : 'First genuine trade identity' };
  const previousScope = scope(previous), previousKey = tradeIdentity(previous);
  nonnegativeInteger(previous.sourceAt, 'previous trade sourceAt');
  if (!sameScope(previousScope, nextScope)) return { status: 'conflict', reason: 'Trade source, product or currency scope changed' };
  if (next.sourceAt < previous.sourceAt) return { status: 'regression', reason: 'Trade source time regressed' };
  if (nextKey === null || previousKey === null) return { status: 'unknown', reason: 'No comparable genuine trade identity; delivery or receipt changes are insufficient' };
  if (nextKey === previousKey) return next.sourceAt === previous.sourceAt
    ? { status: 'same', reason: 'Same genuine trade identity; redelivery is not another trade' }
    : { status: 'conflict', reason: 'Same tradeId has a changed source timestamp' };
  return { status: 'new', reason: 'Distinct genuine trade identity, including when source timestamps are equal' };
}
