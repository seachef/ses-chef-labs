import { isDeepStrictEqual } from 'node:util';
import { close, EPSILON, SUPPORTED_PRODUCTS } from './config.mjs';
import { orderIntentHash } from './causal-state.mjs';
import { compareBookProgress, normalizeBookIdentity } from '../book-identity.mjs';

function portion(value, { account, asOf, controlVersion, config, createdAt }, require, label) {
  const scoped = map => map && typeof map === 'object' && !Array.isArray(map) && Object.keys(map).every(key => Object.hasOwn(SUPPORTED_PRODUCTS, key));
  for (const key of ['pendingOrders', 'consumedBooks', 'bookHighWaterByProduct', 'positionGenerationByProduct', 'exitObligations']) require(scoped(value[key]), `${label}: invalid bounded ${key}`);
  require(Number.isSafeInteger(value.totalOrderCount) && value.totalOrderCount >= 0, `${label}: invalid order count`);
  require(Number.isSafeInteger(value.exitPolicyVersion) && value.exitPolicyVersion >= 1, `${label}: invalid exit policy version`);
  let reservedCash = 0, buyCount = 0;
  const reservedSells = {};
  for (const [productId, order] of Object.entries(value.pendingOrders)) {
    require(order.productId === productId && order.base === SUPPORTED_PRODUCTS[productId] && order.quote === 'USD' && order.source === 'synthetic-fixture' && order.provenance === 'synthetic', `${label}: pending identity mismatch`);
    require(typeof order.id === 'string' && order.id.length <= 400 && order.status === 'PENDING' && ['BUY', 'SELL'].includes(order.side), `${label}: pending lifecycle mismatch`);
    require(Number.isSafeInteger(order.sequence) && order.sequence > 0 && order.sequence <= value.totalOrderCount, `${label}: pending sequence mismatch`);
    require(order.intentDigest === orderIntentHash(order), `${label}: immutable order intent digest mismatch`);
    require([order.quantity, order.expectedPrice, order.stopPrice, order.targetPrice].every(number => Number.isFinite(number) && number > 0) && order.stopPrice < order.targetPrice, `${label}: invalid order quantity or protection`);
    require([order.decisionAt, order.eligibleAt, order.expiresAt, order.decisionSourceAt].every(time => Number.isSafeInteger(time) && time >= 0) && order.decisionAt >= createdAt && order.decisionAt <= asOf && order.decisionSourceAt <= order.decisionAt && order.eligibleAt === order.decisionAt + config.latencyMs && order.expiresAt === order.decisionAt + config.maxSignalAgeMs && order.eligibleAt < order.expiresAt && asOf < order.expiresAt, `${label}: pending deadline or timing mismatch`);
    require(order.decisionBook.explicit && order.decisionBook.sourceAt <= order.decisionAt && order.decisionBook.productId === productId && compareBookProgress(order.decisionBook, order.decisionBook).status === 'same', `${label}: invalid decision book`);
    if (order.side === 'BUY') {
      buyCount++;
      const expected = order.quantity * order.expectedPrice * (1 + config.maxSlippageBps / 10000) * (1 + config.feeBps / 10000);
      require(order.entryVersion === controlVersion && order.positionGeneration === 0 && !account.positions[productId] && order.stopPrice < order.expectedPrice && order.targetPrice > order.expectedPrice, `${label}: entry generation or geometry mismatch`);
      require(close(order.reservedCash, expected) && order.reservedQuantity === 0, `${label}: buy reservation mismatch`);
      reservedCash += order.reservedCash;
    } else {
      const held = account.positions[productId];
      require(held && held.positionGeneration === order.positionGeneration && order.quantity <= held.quantity + EPSILON && order.exitPolicyVersion === value.exitPolicyVersion, `${label}: pending exit generation or quantity mismatch`);
      require(order.reservedCash === 0 && close(order.reservedQuantity, order.quantity), `${label}: sell reservation mismatch`);
      require(['protective-stop', 'take-profit'].includes(order.reason), `${label}: unsupported exit reason`);
      if (order.reason === 'protective-stop') require(value.exitObligations[productId]?.positionGeneration === order.positionGeneration, `${label}: pending stop lost its latch`);
      reservedSells[productId] = order.reservedQuantity;
    }
  }
  require(buyCount <= 1 && Object.keys(value.pendingOrders).length <= 2, `${label}: pending-order bound exceeded`);
  require(close(value.reservations.buyCash, reservedCash) && isDeepStrictEqual(value.reservations.sellQuantityByProduct, reservedSells), `${label}: reservation totals do not match pending owners`);
  require(reservedCash <= account.cash + EPSILON, `${label}: reservations exceed ledger cash`);
  for (const [productId, generation] of Object.entries(value.positionGenerationByProduct)) require(Number.isSafeInteger(generation) && generation >= 1, `${label}: invalid position generation for ${productId}`);
  for (const [productId, position] of Object.entries(account.positions)) require(position.positionGeneration === value.positionGenerationByProduct[productId], `${label}: held position generation mismatch`);
  for (const [productId, latch] of Object.entries(value.exitObligations)) require(latch.reason === 'protective-stop' && latch.positionGeneration === account.positions[productId]?.positionGeneration && Number.isSafeInteger(latch.triggeredAt) && latch.triggeredAt <= asOf && typeof latch.triggerEventId === 'string', `${label}: invalid protective exit latch`);
  for (const map of [value.bookHighWaterByProduct, value.consumedBooks]) for (const [productId, book] of Object.entries(map)) require(book.productId === productId && book.explicit && Number.isSafeInteger(book.sourceAt) && book.sourceAt <= asOf && compareBookProgress(book, book).status === 'same', `${label}: invalid retained book identity`);
  for (const [productId, consumed] of Object.entries(value.consumedBooks)) require(value.bookHighWaterByProduct[productId] && ['same', 'new'].includes(compareBookProgress(consumed, value.bookHighWaterByProduct[productId]).status), `${label}: consumed book exceeds observed high-water mark`);
  if (value.lastOrderTransition !== null) {
    const transition = value.lastOrderTransition;
    require(Number.isSafeInteger(transition.sequence) && transition.sequence > 0 && transition.sequence <= value.totalOrderCount && ['PENDING', 'FILLED', 'PARTIAL_AND_CANCELED', 'CANCELED', 'EXPIRED'].includes(transition.status) && typeof transition.lifecycleReason === 'string' && transition.lifecycleReason.length <= 4096 && Number.isSafeInteger(transition.at) && transition.at >= transition.decisionAt && transition.at <= asOf && transition.intentDigest === orderIntentHash(transition), `${label}: invalid latest order transition`);
  } else require(value.totalOrderCount === 0, `${label}: orders exist without lifecycle evidence`);
}

export function auditCausalState(state, require) {
  require(state.config.latencyMs > 0 && state.config.latencyMs < state.config.maxSignalAgeMs, 'Causal latency must be positive and below order lifetime');
  const anchored = state.checkpoint.causal;
  portion(anchored, { account: { ...state.checkpoint, positions: state.checkpoint.positions }, asOf: state.checkpoint.asOf, controlVersion: state.checkpoint.controlVersion, config: state.config, createdAt: state.createdAt }, require, 'Checkpoint');
  portion(state, { account: state.account, asOf: state.asOf, controlVersion: state.control.version, config: state.config, createdAt: state.createdAt }, require, 'Current');
  require(state.totalOrderCount >= anchored.totalOrderCount && state.totalFillCount <= state.totalOrderCount, 'Causal lifetime order/fill counts mismatch');
  require(close(state.account.availableCash, state.account.cash - state.reservations.buyCash) && state.account.availableCash >= -EPSILON, 'Available cash does not equal cash minus owned reservations');
  require(!state.control.entryPaused || !Object.values(state.pendingOrders).some(order => order.side === 'BUY'), 'Entry pause retained a pending buy');
  for (const [productId, book] of Object.entries(anchored.bookHighWaterByProduct)) require(state.bookHighWaterByProduct[productId] && ['same', 'new'].includes(compareBookProgress(book, state.bookHighWaterByProduct[productId]).status), 'Archived book high-water mark was lost');
  for (const [productId, book] of Object.entries(anchored.consumedBooks)) require(state.consumedBooks[productId] && ['same', 'new'].includes(compareBookProgress(book, state.consumedBooks[productId]).status), 'Archived consumed-book high-water mark was lost');
  const generations = structuredClone(anchored.positionGenerationByProduct);
  const fillBooks = structuredClone(anchored.consumedBooks);
  for (const fill of state.ledger) {
    require(compareBookProgress(fillBooks[fill.productId], fill.arrivalBook).status === 'new', 'Multiple fills reused the same or older book capacity');
    fillBooks[fill.productId] = fill.arrivalBook;
    if (fill.side === 'BUY') generations[fill.productId] = (generations[fill.productId] ?? 0) + 1;
    require(fill.positionGeneration === generations[fill.productId], 'Fill position generation does not reconcile');
  }
  require(isDeepStrictEqual(generations, state.positionGenerationByProduct), 'Lifetime position generations do not reconcile');
  for (const [productId, book] of Object.entries(fillBooks)) require(state.consumedBooks[productId] && ['same', 'new'].includes(compareBookProgress(book, state.consumedBooks[productId]).status), 'Fill lacks its conserved consumed-book marker');
  for (const [productId, snapshot] of Object.entries(state.marketByProduct)) require(isDeepStrictEqual(normalizeBookIdentity(snapshot, { requireExplicit: true }), state.bookHighWaterByProduct[productId]), 'Retained market differs from independent book identity');
}
