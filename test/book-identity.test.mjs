import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookIdentity, compareBookProgress, tradeIdentity, compareTradeProgress } from '../src/book-identity.mjs';

// Explicitly synthetic identity/depth examples. No prices are fetched or traded.
function snapshot(overrides = {}) {
  return {
    schemaVersion: 1, source: 'synthetic-fixture', provenance: 'synthetic',
    productId: 'BTC-USD', base: 'BTC', quote: 'USD', eventId: 'delivery-a', tradeId: 'trade-a',
    observedAt: 10_100, sourceAt: 10_000,
    bookId: 'source-book-a', bookSequence: 42, bookSourceAt: 9990,
    bids: [[99.9, 2], [99.8, 3]], asks: [[100, 4], [100.1, 5]],
    ...overrides,
  };
}
const identity = value => normalizeBookIdentity(value, { requireExplicit: true });

test('identity: cached depth retains its key across delivery, trade and receipt changes', () => {
  const first = identity(snapshot());
  const retagged = identity(snapshot({ eventId: 'delivery-b', tradeId: 'trade-b', observedAt: 20_000, sourceAt: 19_900, price: 101 }));
  assert.deepEqual(retagged, first);
  assert.equal(compareBookProgress(first, retagged).status, 'same');
  assert.equal(first.explicit, true);
  assert.equal(first.sequence, 42);
  assert.equal(first.sourceAt, 9990);
  assert.equal(first.bookId, 'source-book-a');
  assert.match(first.key, /^book:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes('delivery-a'), false);
  assert.equal(JSON.stringify(first).includes('trade-a'), false);
});

test('identity: same source sequence cannot be relabelled or have depth/time replaced', async t => {
  const first = identity(snapshot());
  for (const [label, overrides] of [
    ['bookId', { bookId: 'renamed-book' }],
    ['quantity', { asks: [[100, 400], [100.1, 5]] }],
    ['price', { bids: [[99.85, 2], [99.8, 3]] }],
    ['source time', { bookSourceAt: 9991 }],
    ['removed bookId', { bookId: undefined }],
  ]) await t.test(label, () => {
    const changed = snapshot(overrides);
    if (label === 'removed bookId') delete changed.bookId;
    const next = identity(changed);
    assert.equal(next.key, first.key);
    assert.equal(compareBookProgress(first, next).status, 'conflict');
  });
});

test('identity: a genuine higher source sequence may share timestamp and unchanged depth', () => {
  const first = identity(snapshot());
  const next = identity(snapshot({ bookId: 'source-book-b', bookSequence: 43 }));
  assert.notEqual(next.key, first.key);
  assert.equal(next.contentHash, first.contentHash);
  assert.equal(next.sourceAt, first.sourceAt);
  assert.equal(compareBookProgress(first, next).status, 'new');
  assert.equal(compareBookProgress(null, first).status, 'new');
});

test('identity: source sequence/time regression rejects even with fresh delivery and trade IDs', () => {
  const first = identity(snapshot());
  const sequenceRegression = identity(snapshot({ bookId: 'older-book', bookSequence: 41, observedAt: 30_000, tradeId: 'new-trade' }));
  const timeRegression = identity(snapshot({ bookId: 'older-time', bookSequence: 43, bookSourceAt: 9989 }));
  assert.equal(compareBookProgress(first, sequenceRegression).status, 'regression');
  assert.equal(compareBookProgress(first, timeRegression).status, 'regression');
});

test('identity: historical same bookId with a larger sequence is a conflict when archive supplies the earlier identity', () => {
  const archived = identity(snapshot());
  const next = identity(snapshot({ bookSequence: 500, bookSourceAt: 50_000, asks: [[100, 400], [100.1, 5]] }));
  assert.equal(compareBookProgress(archived, next).status, 'conflict');
  assert.match(compareBookProgress(archived, next).reason, /Same bookId/);
});

test('identity: source/product/currency scopes never alias', () => {
  const first = identity(snapshot());
  for (const overrides of [
    { productId: 'ETH-USD', base: 'ETH' },
    { productId: 'BTC-USDT', quote: 'USDT' },
    { source: 'another-synthetic-source' },
    { provenance: 'another-provenance' },
  ]) {
    const next = identity(snapshot(overrides));
    assert.notEqual(next.key, first.key);
    assert.notEqual(next.contentHash, first.contentHash);
    assert.equal(compareBookProgress(first, next).status, 'conflict');
    assert.notEqual(tradeIdentity(snapshot(overrides)), tradeIdentity(snapshot()));
  }
  assert.throws(() => identity(snapshot({ quote: 'USDT' })), /product\/base\/quote disagree/);
});

test('identity: positive latency cannot use missing or partial book evidence', async t => {
  const legacy = snapshot(); delete legacy.bookId; delete legacy.bookSequence; delete legacy.bookSourceAt;
  assert.throws(() => identity(legacy), /explicit bookSequence and bookSourceAt/);
  for (const [label, overrides] of [
    ['missing sequence', { bookSequence: undefined }], ['missing source time', { bookSourceAt: undefined }],
    ['fractional sequence', { bookSequence: 1.5 }], ['unsafe sequence', { bookSequence: Number.MAX_SAFE_INTEGER + 1 }],
    ['string sequence', { bookSequence: '42' }], ['negative source time', { bookSourceAt: -1 }],
    ['nonfinite source time', { bookSourceAt: Infinity }], ['empty id', { bookId: '' }],
    ['spaced id', { bookId: ' source-book-a ' }], ['unbounded id', { bookId: 'x'.repeat(201) }],
  ]) await t.test(label, () => { assert.throws(() => identity(snapshot(overrides)), /BOOK_IDENTITY_INVALID/); });
  const noBookId = snapshot(); delete noBookId.bookId;
  assert.equal(identity(noBookId).bookId, null);
});

test('identity: malformed or noncanonical depth cannot become usable evidence', async t => {
  for (const [label, overrides] of [
    ['empty', { bids: [] }], ['unsorted', { bids: [[99, 1], [99.5, 1]] }],
    ['duplicate', { asks: [[100, 1], [100, 2]] }], ['crossed', { bids: [[101, 1]] }],
    ['locked', { bids: [[100, 1]] }], ['zero', { asks: [[100, 0]] }],
    ['NaN', { asks: [[NaN, 1]] }], ['Infinity', { asks: [[100, Infinity]] }],
    ['negative', { bids: [[99, -1]] }], ['numeric string', { asks: [['100', 1]] }],
    ['extra field', { asks: [[100, 1, 2]] }], ['sparse', { bids: [, [99, 1]] }],
    ['over limit', { asks: Array.from({ length: 1001 }, (_, index) => [100 + index, 1]) }],
  ]) await t.test(label, () => { assert.throws(() => identity(snapshot(overrides)), /BOOK_IDENTITY_INVALID/); });
});

test('identity: normalized state cannot silently change key or identity mode', () => {
  const first = identity(snapshot());
  assert.throws(() => compareBookProgress(first, { ...first, key: 'book:forged' }), /key mismatch/);
  assert.throws(() => compareBookProgress(first, { ...first, contentHash: 'invalid' }), /malformed/);
  assert.throws(() => compareBookProgress(first, { ...first, sequence: first.sequence + 1 }), /key mismatch/);
  const legacy = snapshot(); delete legacy.bookId; delete legacy.bookSequence; delete legacy.bookSourceAt;
  assert.equal(compareBookProgress(first, normalizeBookIdentity(legacy)).status, 'conflict');
});

test('identity: legacy advisory fallback never promotes delivery/trade/ticker timestamps to book identity', () => {
  const legacy = snapshot(); delete legacy.bookId; delete legacy.bookSequence; delete legacy.bookSourceAt;
  const first = normalizeBookIdentity(legacy);
  const again = normalizeBookIdentity({ ...legacy, eventId: 'new-delivery', tradeId: 'new-trade', sourceAt: 100_000, observedAt: 100_100 });
  assert.deepEqual(again, first);
  assert.equal(first.sourceAt, null);
  assert.equal(first.sequence, null);
  assert.equal(first.explicit, false);
  assert.equal(first.basis, 'legacy-depth-only');
  assert.equal(compareBookProgress(first, again).status, 'same');
  const changed = normalizeBookIdentity({ ...legacy, asks: [[100, 8], [100.1, 5]] });
  assert.equal(compareBookProgress(first, changed).status, 'new');
  assert.match(compareBookProgress(first, changed).reason, /replenishment remain unverified/);
  // Returning to A produces A's original key; archive consumption must prevent reuse.
  assert.equal(normalizeBookIdentity(legacy).key, first.key);
});

test('identity: distinct genuine trades at one timestamp remain distinct; delivery IDs do not become trades', () => {
  const first = snapshot();
  const second = snapshot({ eventId: 'another-delivery', tradeId: 'trade-b' });
  assert.notEqual(tradeIdentity(first), tradeIdentity(second));
  assert.equal(compareTradeProgress(first, second).status, 'new');
  assert.equal(compareTradeProgress(first, snapshot({ eventId: 'redelivery', observedAt: 50_000 })).status, 'same');
  assert.equal(tradeIdentity(first), tradeIdentity(snapshot({ eventId: 'redelivery', sourceAt: 50_000, observedAt: 50_100 })));
  assert.equal(compareTradeProgress(first, snapshot({ sourceAt: 50_000, observedAt: 50_100 })).status, 'conflict');
  const noTrade = snapshot(); delete noTrade.tradeId;
  assert.equal(tradeIdentity(noTrade), null);
  assert.equal(compareTradeProgress(noTrade, { ...noTrade, eventId: 'different-delivery', sourceAt: 50_000 }).status, 'unknown');
  assert.equal(compareTradeProgress(first, snapshot({ tradeId: 'older-trade', sourceAt: 9999 })).status, 'regression');
});

test('identity: genuine trade identifier representations are bounded and numeric strings do not create a second ID', () => {
  assert.equal(tradeIdentity(snapshot({ tradeId: 7 })), tradeIdentity(snapshot({ tradeId: '7' })));
  for (const tradeId of [null, undefined, '', ' id ', -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, 'x'.repeat(201), {}]) {
    assert.throws(() => tradeIdentity(snapshot({ tradeId })), /BOOK_IDENTITY_INVALID/);
  }
  assert.equal(compareTradeProgress(null, snapshot()).status, 'new');
});

test('identity: normalizing and comparing never mutate the caller snapshot', () => {
  const input = snapshot(), copy = structuredClone(input);
  const first = identity(input);
  compareBookProgress(first, identity(input));
  tradeIdentity(input);
  compareTradeProgress(input, input);
  assert.deepEqual(input, copy);
});
