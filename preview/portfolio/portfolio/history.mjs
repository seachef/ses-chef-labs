/** Recorded observations only. These values are holdings changes, never investment returns. */
import { multiplyDecimals, rawUnits } from './domain.mjs';
import { COINS, decimalSum } from './model.mjs?v=20261002.details1';

export const RANGE_OPTIONS = Object.freeze([
  { key: '1H', label: '1H' }, { key: '1D', label: '1D' },
  { key: '1W', label: '1W' }, { key: '1M', label: '1M' },
  { key: '1Y', label: '1Y' }, { key: 'MAX', label: 'MAX' }
]);
const WINDOWS = { '1H': 3600000, '1D': 86400000, '1W': 7 * 86400000, '1M': 30 * 86400000, '1Y': 365 * 86400000, MAX: Infinity };
const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const SHOGUN = `1:${COINS.find(c => c.symbol === 'SHOGUN').assetId}:18`;
const COLLECTOR_INVENTORY = ['1:native:18', ...COINS.map(c => `1:${c.assetId}:${c.decimals}`)].sort();
const STAKE_STATUSES = new Set(['active', 'matured', 'pending', 'good_accounted', 'unlocked']);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const text = value => typeof value === 'string' && value.trim().length > 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unique = values => [...new Set(values)].sort();
const positive = value => typeof value === 'string' && value.length <= 1000 && DECIMAL.test(value) && /[1-9]/.test(value);
const iso = ms => ms == null ? null : new Date(ms).toISOString();

function parts(value) {
  if (typeof value !== 'string' || value.length > 4096 || !DECIMAL.test(value)) throw new TypeError('Expected a nonnegative exact decimal');
  const [whole, fraction = ''] = value.split('.');
  return { n: BigInt(whole + fraction), scale: fraction.length };
}
function fromParts(n, scale) {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(scale + 1, '0');
  const amount = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') || '0' : digits;
  return negative && amount !== '0' ? '-' + amount : amount;
}
/** end minus start without conversion through a floating-point number. */
export function signedDecimalDifference(end, start) {
  const a = parts(end), b = parts(start), scale = Math.max(a.scale, b.scale);
  return fromParts(a.n * 10n ** BigInt(scale - a.scale) - b.n * 10n ** BigInt(scale - b.scale), scale);
}
function signedCurrency(value, currency) {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value) || value.length > 4096) return '—';
  const negative = value.startsWith('-'), amount = negative ? value.slice(1) : value;
  const { n, scale } = parts(amount), prefix = n === 0n ? '' : negative ? '-' : '+';
  if (n !== 0n && n * 100n < 10n ** BigInt(scale)) return prefix + '<' + currency + '0.01';
  const [whole, fraction = ''] = amount.split('.');
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)) + (Number(fraction[2] || 0) >= 5 ? 1n : 0n);
  return prefix + currency + (cents / 100n).toLocaleString('en-AU') + '.' + (cents % 100n).toString().padStart(2, '0');
}
export const signedAud = value => signedCurrency(value, 'A$');
export const signedUsd = value => signedCurrency(value, 'US$');
export const formatSignedAud = signedAud;

function identity(row) {
  if (!Number.isInteger(row?.chain_id) || row.chain_id <= 0 || !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 255) throw Error('invalid_asset_identity');
  const asset = typeof row.asset_id === 'string' ? row.asset_id.toLowerCase() : '';
  if (asset !== 'native' && !/^0x[0-9a-f]{40}$/.test(asset)) throw Error('invalid_asset_identity');
  return `${row.chain_id}:${asset}:${row.decimals}`;
}
function quoteProblem(row, valuedAt) {
  if (row.price_status !== 'observed') return row.price_status === 'unreliable' ? 'unreliable_price' : 'price_unavailable';
  if (row.provenance?.quote?.held_valuation_eligible === false) return 'ineligible_price';
  if (!positive(row.price_usd) || !text(row.price_source) || time(row.price_observed_at) == null) return 'unverified_price';
  const age = valuedAt - time(row.price_observed_at);
  if (age < -60000 || age > 30 * 60000) return 'stale_price';
  return null;
}
function recordedPoint(model, now) {
  const s = model?.snapshot, p = s?.provenance || {}, v = p.valuation || {};
  const atMs = time(v.balance_as_of_start) ?? time(s?.observed_at);
  const endMs = time(v.balance_as_of_end) ?? atMs;
  const result = {
    snapshotId: s?.id || null, at: iso(atMs), balanceAt: iso(atMs), endAt: iso(endMs), value: null,
    eligible: false, reason: null, scope: null, scopeKey: null,
    completedAt: s?.completed_at || null, priceUsd: null, priceAt: null,
    coverage: { expectedWallets: s?.expected_wallets ?? null, observedWallets: s?.observed_wallets ?? null,
      walletIds: [], inventory: [], included: [], excluded: [], knownAssetInventoryOnly: p.known_asset_inventory_only ?? null,
      excludedCoverage: Array.isArray(p.excluded_coverage) ? unique(p.excluded_coverage.filter(text)) : [],
      rewardsExcluded: true, pricedAssets: 0, unpricedAssets: 0 },
    assets: []
  };
  const fail = reason => ({ ...result, reason });
  if (!s) return fail('snapshot_missing');
  if (atMs == null || endMs == null || endMs < atMs || atMs > now || endMs > now) return fail('invalid_balance_time');
  if (v.basis !== 'fresh_pinned_balances' || v.balances_refreshed !== true) return fail(v.basis === 'carried_forward_balances' || v.balances_refreshed === false ? 'carried_balances' : 'unverified_balance_basis');
  if (!['partial', 'complete'].includes(s.status)) return fail('snapshot_incomplete');
  const method = text(p.inventory_method) ? p.inventory_method : p.import_kind === 'read_only_collector' ? 'read_only_collector' : null;
  // New inventory methods must receive an explicit completeness rule before use.
  if (method !== 'read_only_collector' || typeof p.known_asset_inventory_only !== 'boolean') return fail('inventory_method_unknown');
  const a = model.account, wallets = model.wallets;
  if (!text(a?.id) || !text(a.owner_id) || s.account_id !== a.id || s.owner_id !== a.owner_id) return fail('account_scope_mismatch');
  if (!Array.isArray(wallets) || !wallets.length || !Number.isInteger(s.expected_wallets) || s.expected_wallets !== wallets.length || s.observed_wallets !== s.expected_wallets) return fail('wallet_coverage_incomplete');
  if (wallets.some(w => !w || !text(w.id) || w.account_id !== a.id || w.owner_id !== a.owner_id)) return fail('wallet_scope_mismatch');
  const walletIds = unique(wallets.map(w => w.id));
  result.coverage.walletIds = walletIds;
  if (walletIds.length !== wallets.length) return fail('wallet_scope_mismatch');
  const walletById = new Map(wallets.map(w => [w.id, w]));
  if (!Array.isArray(model.balances) || !Array.isArray(model.stakes)) return fail('holdings_rows_missing');
  const balances = model.balances, stakes = model.stakes, rows = [...balances, ...stakes];
  if (rows.some(r => !r || typeof r !== 'object')) return fail('invalid_holdings_data');
  if (!equal(unique(rows.map(r => r.wallet_id)), walletIds)) return fail('wallet_rows_incomplete');
  if (rows.some(r => r.snapshot_id !== s.id || r.account_id !== a.id || r.owner_id !== a.owner_id || !walletById.has(r.wallet_id) || walletById.get(r.wallet_id).chain_id !== r.chain_id)) return fail('row_scope_mismatch');
  const valuedAt = time(v.valued_at) ?? time(s.completed_at);
  if (valuedAt == null || valuedAt < endMs || valuedAt > now + 60000) return fail('valuation_time_unverified');
  const fxAt = time(s.fx_observed_at);
  if (!positive(s.usd_to_aud) || fxAt == null || !text(s.fx_source)) return fail('fx_unavailable');
  if (valuedAt - fxAt < -60000 || valuedAt - fxAt > 7 * 86400000) return fail('stale_fx');

  const groups = new Map(), seenBalances = new Set(), seenStakes = new Set();
  const perWallet = new Map(walletIds.map(id => [id, []]));
  try {
    const group = row => {
      const id = identity(row);
      if (!groups.has(id)) groups.set(id, { identity: id, key: `${row.chain_id}:${row.asset_id.toLowerCase()}`, symbol: row.symbol,
        decimals: row.decimals, liquidRaw: 0n, stakedRaw: 0n, quotes: [], quoteProblems: [] });
      return groups.get(id);
    };
    for (const row of balances) {
      const g = group(row), key = `${row.wallet_id}:${g.identity}`;
      if (seenBalances.has(key)) return fail('duplicate_balance_rows');
      seenBalances.add(key); perWallet.get(row.wallet_id).push(g.identity);
      // Child observation dates, when present, must describe this recorded balance window.
      if (row.balance_observed_at != null && (time(row.balance_observed_at) == null || time(row.balance_observed_at) < atMs || time(row.balance_observed_at) > endMs)) return fail('balance_time_mismatch');
      g.liquidRaw += BigInt(rawUnits(row.balance_raw));
      const problem = quoteProblem(row, valuedAt);
      if (problem) g.quoteProblems.push(problem); else g.quotes.push(row);
    }
    for (const row of stakes) {
      const g = group(row), key = `${row.wallet_id}:${row.chain_id}:${row.protocol}:${row.stake_id}`;
      if (!text(row.protocol) || !text(row.stake_id) || !STAKE_STATUSES.has(row.status)) return fail('stake_identity_unverified');
      if (seenStakes.has(key)) return fail('duplicate_stake_rows');
      seenStakes.add(key);
      if (time(row.observed_at) == null || time(row.observed_at) < atMs || time(row.observed_at) > endMs) return fail('stake_time_mismatch');
      const principal = BigInt(rawUnits(row.principal_raw));
      if (row.status !== 'unlocked') g.stakedRaw += principal;
    }
    const inventory = [...groups.keys()].sort();
    result.coverage.inventory = inventory;
    // A known collector always emits all six liquid rows for every wallet, including zeros.
    // A dropped zero or liquid row must not turn into a silently smaller subtotal.
    if (method === 'read_only_collector' && wallets.some(w => !equal(unique(perWallet.get(w.id)), COLLECTOR_INVENTORY))) return fail('asset_rows_incomplete');
    const assets = [...groups.values()].sort((x, y) => x.identity.localeCompare(y.identity)).map(g => {
      // Individual rows are uint256, but their cross-wallet sum may exceed uint256.
      const liquid = fromParts(g.liquidRaw, g.decimals), staked = fromParts(g.stakedRaw, g.decimals);
      const quantity = decimalSum([liquid, staked]);
      const quotes = g.quotes.sort((x, y) => time(y.price_observed_at) - time(x.price_observed_at) || x.price_source.localeCompare(y.price_source));
      const quote = quotes[0] || null;
      let reason = unique(g.quoteProblems)[0] || (quote ? null : 'price_unavailable');
      if (quote && quotes.some(q => time(q.price_observed_at) === time(quote.price_observed_at) && signedDecimalDifference(q.price_usd, quote.price_usd) !== '0')) reason = 'conflicting_prices';
      const usd = !reason && quote ? multiplyDecimals(quantity, quote.price_usd) : null;
      return { identity: g.identity, key: g.key, symbol: g.symbol, decimals: g.decimals, liquid, staked, quantity,
        usd, value: usd == null ? null : multiplyDecimals(usd, s.usd_to_aud), priceUsd: reason ? null : quote?.price_usd ?? null,
        priceAt: reason ? null : quote?.price_observed_at ?? null, priceSource: reason ? null : quote?.price_source ?? null, reason };
    });
    result.assets = assets;
    result.coverage.included = assets.filter(a => a.value != null).map(a => a.identity);
    result.coverage.excluded = assets.filter(a => a.value == null).map(a => ({ identity: a.identity, reason: a.reason }));
    result.coverage.pricedAssets = assets.filter(a => a.value != null && a.quantity !== '0').length;
    result.coverage.unpricedAssets = assets.filter(a => a.value == null && a.quantity !== '0').length;
    const scope = { ownerId: a.owner_id, accountId: a.id, walletIds, inventory,
      walletInventory: walletIds.map(id => ({ walletId: id, inventory: unique(perWallet.get(id)) })),
      included: result.coverage.included, excluded: result.coverage.excluded,
      knownAssetInventoryOnly: p.known_asset_inventory_only, inventoryMethod: method, basis: v.basis,
      valuationKind: s.status === 'complete' && v.full_valuation_available === true ? 'complete_valuation' : 'priced_holdings_subtotal',
      excludedCoverage: result.coverage.excludedCoverage };
    result.scope = scope; result.scopeKey = JSON.stringify(scope);
    const unexpected = assets.find(a => a.value == null && a.identity !== SHOGUN);
    if (unexpected) return fail(unexpected.reason || 'price_unavailable');
    if (!result.coverage.included.length) return fail('no_priced_holdings');
    result.value = decimalSum(assets.filter(a => a.value != null).map(a => a.value));
    result.eligible = true;
    return result;
  } catch (error) {
    return fail(error.message === 'invalid_asset_identity' ? error.message : 'invalid_holdings_data');
  }
}

function coinIdentity(currentModel, coinKey) {
  const matches = unique([...(currentModel?.balances || []), ...(currentModel?.stakes || [])].flatMap(row => {
    try { const id = identity(row); return id === coinKey || `${row.chain_id}:${row.asset_id.toLowerCase()}` === coinKey ? [id] : []; }
    catch { return []; }
  }));
  return matches.length === 1 ? matches[0] : null;
}
function projectCoin(point, tokenIdentity, metric) {
  if (!tokenIdentity) return { ...point, value: null, eligible: false, reason: 'coin_identity_unverified' };
  if (!point.eligible) return { ...point, value: null };
  const asset = point.assets.find(a => a.identity === tokenIdentity);
  const reason = !asset ? 'coin_rows_missing' : asset.reason;
  return { ...point, value: reason ? null : metric === 'price' ? asset.priceUsd : asset.value,
    eligible: !reason, reason, priceUsd: asset?.priceUsd ?? null, priceAt: asset?.priceAt ?? null,
    priceSource: asset?.priceSource ?? null, quantity: asset?.quantity ?? null,
    scopeKey: JSON.stringify({ portfolioScope: point.scopeKey, tokenIdentity, metric }) };
}

/**
 * UI entry point. Missing data stays null; ranges include their exact boundary and
 * never borrow an out-of-range baseline. A change is the endpoint minus baseline.
 * Price graphs retain balance-observation x coordinates and expose priceAt separately.
 */
export function recordedHistorySummary({ currentModel, models = [], rangeKey = '1D', now = Date.now(), coinKey = null, metric = 'value', historyLimited = false } = {}) {
  metric = coinKey != null && metric === 'price' ? 'price' : 'value';
  const range = Object.hasOwn(WINDOWS, rangeKey) ? rangeKey : '1D';
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(nowMs)) throw new TypeError('A valid current time is required');
  const cutoff = WINDOWS[range] === Infinity ? -Infinity : nowMs - WINDOWS[range];
  const currentId = currentModel?.snapshot?.id || null;
  const byId = new Map();
  for (const model of Array.isArray(models) ? models : []) if (model?.snapshot?.id) byId.set(model.snapshot.id, model);
  if (currentId) byId.set(currentId, currentModel);
  const tokenIdentity = coinKey == null ? null : coinIdentity(currentModel, coinKey);
  let observations = [...byId.values()].map(model => recordedPoint(model, nowMs));
  if (coinKey != null) observations = observations.map(point => projectCoin(point, tokenIdentity, metric));
  const undated = observations.filter(p => p.at == null);
  const byTime = new Map();
  // Stable tie-breaking agrees with the adapter: latest completion, then id.
  for (const point of observations.filter(p => p.at != null).sort((a, b) =>
    (time(a.completedAt) ?? -Infinity) - (time(b.completedAt) ?? -Infinity) || a.snapshotId.localeCompare(b.snapshotId))) byTime.set(point.at, point);
  const points = [...byTime.values()].filter(p => time(p.at) >= cutoff && time(p.at) <= nowMs)
    .sort((a, b) => time(a.at) - time(b.at));
  points.push(...undated.sort((a, b) => a.snapshotId.localeCompare(b.snapshotId)));
  const eligible = points.filter(p => p.eligible), baseline = eligible[0] || null;
  const endpoint = points.find(p => p.snapshotId === currentId) || null;
  const lastDated = points.filter(p => p.at != null).at(-1);
  let reason = null;
  if (!currentId) reason = 'current_snapshot_missing';
  else if (!endpoint) reason = 'current_snapshot_outside_range_or_superseded';
  else if (!endpoint.eligible) reason = endpoint.reason;
  else if (nowMs - time(endpoint.at) > 36 * 3600000) reason = 'current_snapshot_stale';
  else if (endpoint !== lastDated) reason = 'current_snapshot_not_endpoint';
  else if (!baseline || baseline.at === endpoint.at) reason = 'insufficient_distinct_observations';
  else if (undated.length) reason = 'undated_observation_gap';
  else {
    const span = points.filter(p => time(p.at) >= time(baseline.at) && time(p.at) <= time(endpoint.at));
    if (span.some(p => !p.eligible)) reason = 'observation_gap';
    else if (span.some(p => p.scopeKey !== endpoint.scopeKey)) reason = 'scope_changed';
  }
  const change = reason ? null : signedDecimalDifference(endpoint.value, baseline.value);
  return {
    range, cutoffAt: Number.isFinite(cutoff) ? iso(cutoff) : null, points, change,
    changeAvailable: change !== null, changeFormatted: change == null ? '—' : metric === 'price' ? signedUsd(change) : signedAud(change),
    baselineAt: baseline?.at || null, baselineEndAt: baseline?.endAt || null,
    endpointAt: endpoint?.at || null, endpointEndAt: endpoint?.endAt || null,
    spanMs: baseline && endpoint ? time(endpoint.at) - time(baseline.at) : null,
    reason, historyLimited: !!historyLimited || range === 'MAX' && (Array.isArray(models) && models.length >= 730 || (currentModel?.history?.length || 0) >= 730),
    coinKey, metric: coinKey == null ? 'value' : metric, tokenIdentity, activityAvailable: false
  };
}
export function buildRecordedHistory(models, currentModel, range = '1D', now = Date.now()) {
  return recordedHistorySummary({ models, currentModel, rangeKey: range, now });
}
export function buildCoinRecordedHistory(models, currentModel, token, range = '1D', now = Date.now(), metric = 'value') {
  const coinKey = typeof token === 'string' ? token : token?.key || (token?.chainId != null && token?.assetId ? `${token.chainId}:${token.assetId.toLowerCase()}` : null);
  return recordedHistorySummary({ models, currentModel, coinKey: coinKey ?? '', rangeKey: range, now, metric });
}
