import test from 'node:test';
import assert from 'node:assert/strict';
import * as portfolio from '../portfolio/model.mjs';
import { recordedHistorySummary } from '../portfolio/history.mjs';
import { portfolioHeadline } from '../portfolio/headline.mjs';
import { projectWalletModel } from '../portfolio/wallet-scope.mjs';

// Synthetic observations only. No network, saved user identifiers, or private values.
const AICC = '0x66a3c2fa3e467aa586e90912f977e648589cabaf';
const PVC = '0x514b9e5467b9eb811519e316263c9099eae546ca';
const OTHER = '0x1111111111111111111111111111111111111111';
const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR = 3600000;
const stamp = at => new Date(at).toISOString();
const raw = n => String(BigInt(n) * 10n ** 18n);
const excluded = row => row.chain_id === 1 && [AICC, PVC].includes(row.asset_id?.toLowerCase());
const inventory = [{ assetId: 'native', symbol: 'ETH', decimals: 18 }, ...portfolio.COINS];

function fixture(id = 'synthetic-current', at = NOW, { kind = 'smsf', amount = 30, excludedRows = true } = {}) {
  const account = { id: 'synthetic-' + kind, owner_id: 'synthetic-owner', kind };
  const scope = { account_id: account.id, owner_id: account.owner_id, snapshot_id: id };
  const wallets = ['one', 'two'].map(label => ({ id: kind + '-synthetic-' + label, ...scope, chain_id: 1, network: 'ethereum' }));
  const model = {
    account, wallets,
    snapshot: { ...scope, id, status: 'partial', expected_wallets: 2, observed_wallets: 2, unpriced_assets: 0,
      observed_at: stamp(at), completed_at: stamp(at), usd_to_aud: '1.5', fx_observed_at: stamp(at), fx_source: 'Synthetic FX',
      held_value_aud: '999999', provenance: { import_kind: 'read_only_collector', known_asset_inventory_only: false,
        token_discovery: { status: 'complete' }, excluded_coverage: ['Unminted rewards'],
        valuation: { basis: 'fresh_pinned_balances', balances_refreshed: true,
          balance_as_of_start: stamp(at), balance_as_of_end: stamp(at), valued_at: stamp(at), full_valuation_available: false } } },
    balances: wallets.flatMap(wallet => inventory.map(asset => ({ ...scope, wallet_id: wallet.id, chain_id: 1,
      asset_id: asset.assetId, symbol: asset.symbol, decimals: asset.decimals,
      balance_raw: asset.assetId === 'native' ? raw(amount) : '0', balance_observed_at: stamp(at),
      price_status: 'observed', price_usd: '2', price_source: 'Synthetic retained quote', price_observed_at: stamp(at) }))),
    stakes: [], rewardEstimates: [], history: []
  };
  if (excludedRows) for (const wallet of wallets) for (const [asset_id, symbol] of [[AICC, 'AICC'], [PVC, 'PVC']]) {
    model.balances.push({ ...model.balances[0], wallet_id: wallet.id, asset_id, symbol, balance_raw: raw(1000),
      price_source: 'Synthetic excluded quote', provenance: { token_discovery: true, balance_block_scope: 'read_window' } });
  }
  return model;
}
function stake(model, assetId = AICC, patch = {}) {
  return { ...model.balances.find(excluded), asset_id: assetId, symbol: assetId === AICC ? 'AICC' : 'PVC',
    protocol: 'synthetic-protocol', stake_id: 'synthetic-' + assetId, principal_raw: raw(1000),
    status: 'active', observed_at: model.snapshot.observed_at, ...patch };
}
const series = (models, options = {}) => recordedHistorySummary({ models, currentModel: models.at(-1), now: NOW,
  allowPartial: true, currency: 'USD', ...options });
const point = model => series([model]).points[0];
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('exclusion identity is exact, case-insensitive, and limited to numeric Ethereum chain 1', () => {
  assert.equal(typeof portfolio.isExcludedPortfolioAsset, 'function');
  for (const address of [AICC, PVC]) {
    for (const value of [address, address.toUpperCase(), '0x' + address.slice(2).toUpperCase()])
      assert.equal(portfolio.isExcludedPortfolioAsset(1, value), true);
    for (const chain of [2, 137, 10, '1', null, undefined, NaN, 1n, {}, []])
      assert.equal(portfolio.isExcludedPortfolioAsset(chain, address), false);
    for (const value of [address + '0', address.slice(0, -1), ' ' + address, address + ' ', null, undefined, {}, [], 1])
      assert.equal(portfolio.isExcludedPortfolioAsset(1, value), false);
  }
  for (const value of ['AICC', 'PVC', 'native', OTHER]) assert.equal(portfolio.isExcludedPortfolioAsset(1, value), false);
});

test('SMSF and Personal aggregate retained liquid and staked principal without excluded contracts or mutations', () => {
  for (const kind of ['smsf', 'personal']) {
    const m = fixture('synthetic-current', NOW, { kind });
    m.balances.find(excluded).asset_id = AICC.toUpperCase();
    m.stakes = [stake(m), stake(m, PVC), stake(m, 'native', { symbol: 'ETH', principal_raw: raw(5) })];
    const before = structuredClone(m); freeze(m);
    const holdings = portfolio.groupHoldings(m);
    assert.equal(holdings.some(h => [AICC, PVC].includes(h.assetId.toLowerCase())), false);
    const eth = holdings.find(h => h.assetId === 'native');
    assert.equal(eth.quantity, '65'); assert.equal(eth.usd, '130'); assert.equal(eth.aud, '195');
    assert.equal(portfolio.displayValuation(m, 'USD').value, '130');
    assert.equal(portfolio.displayValuation(m, 'AUD').value, '195');
    assert.deepEqual(m, before);
  }
});

test('same-symbol different contracts and matching addresses on other chains remain valued', () => {
  const m = fixture();
  for (const patch of [
    { asset_id: OTHER, symbol: 'AICC', chain_id: 1 },
    { asset_id: OTHER.replace(/1/g, '2'), symbol: 'PVC', chain_id: 1 },
    { asset_id: AICC, symbol: 'AICC', chain_id: 137 },
    { asset_id: PVC, symbol: 'PVC', chain_id: 10 }
  ]) m.balances.push({ ...m.balances[0], ...patch, balance_raw: raw(30) });
  const holdings = portfolio.groupHoldings(m);
  assert.equal(holdings.filter(h => ['AICC', 'PVC'].includes(h.symbol)).length, 4);
  assert.equal(portfolio.displayValuation(m, 'USD').value, '360');
  assert.equal(portfolio.visibleHoldings(holdings, 'USD').length, 5);
});

test('visibility and subtotal defensively reject excluded grouped assets while keeping the exact >50 threshold', () => {
  const value = (assetId, symbol, usd, aud = usd, chainId = 1) => ({ assetId, chainId, symbol, quantity: '1', usd, aud });
  const retained = [value(OTHER, 'AICC', '50', '75'), value(OTHER.replace(/1/g, '2'), 'PVC', '50.000000000000000001', '75.000000000000000001')];
  const rows = freeze([value(AICC.toUpperCase(), 'unrelated-symbol', '9000'), value(PVC, 'PVC', '9000'), ...retained]);
  assert.deepEqual(portfolio.visibleHoldings(rows, 'USD'), [retained[1]]);
  assert.deepEqual(portfolio.visibleHoldings(rows, 'AUD'), retained);
  assert.deepEqual(portfolio.pricedHoldingsSummary(rows, 'USD'), { value: '100.000000000000000001', pricedAssets: 2, unpricedAssets: 0 });
  const missing = [{ ...rows[0], usd: null }, { ...retained[0], usd: null }];
  assert.deepEqual(portfolio.pricedHoldingsSummary(missing, 'USD'), { value: null, pricedAssets: 0, unpricedAssets: 1 });
});

test('cached complete totals containing excluded holdings are recomputed from retained balances', () => {
  const m = fixture(); m.snapshot.status = 'complete'; m.snapshot.provenance.valuation.full_valuation_available = true;
  const before = structuredClone(m);
  assert.equal(portfolio.portfolioTotal(m), '180');
  assert.equal(portfolio.displayValuation(m, 'AUD').value, '180');
  assert.equal(portfolio.displayValuation(m, 'USD').value, '120');
  assert.deepEqual(m, before);
  m.stakes = [stake(m)]; m.balances = m.balances.filter(row => !excluded(row));
  assert.equal(portfolio.portfolioTotal(m), '180', 'Stake-only exclusions also invalidate the cached total');
});

test('excluded unpriced holdings do not add an unpriced count or erase retained subtotals', () => {
  const m = fixture(); m.snapshot.unpriced_assets = 2;
  for (const row of m.balances.filter(excluded)) Object.assign(row, { price_status: 'missing', price_usd: null, price_observed_at: null });
  for (const [currency, value] of [['USD', '120'], ['AUD', '180']]) {
    const result = portfolio.displayValuation(m, currency);
    assert.equal(result.value, value); assert.equal(result.pricedAssets, 1); assert.equal(result.unpricedAssets, 0);
  }
  m.snapshot.status = 'complete';
  assert.equal(portfolio.portfolioTotal(m), null, 'The original snapshot completeness guard remains conservative');
  assert.equal(portfolio.displayValuation(m, 'AUD').value, '180');
  assert.equal(portfolio.displayValuation(m, 'AUD').incomplete, true);
});

test('a proven complete view containing only excluded assets is zero; missing coverage or FX stays unknown', () => {
  const m = fixture(); m.balances = m.balances.filter(excluded); m.snapshot.status = 'complete';
  m.snapshot.provenance.valuation.full_valuation_available = true;
  assert.deepEqual(portfolio.groupHoldings(m), []);
  assert.equal(portfolio.portfolioTotal(m), '0');
  assert.equal(portfolio.displayValuation(m, 'AUD').value, '0');
  assert.equal(portfolio.displayValuation(m, 'USD').value, '0');
  for (const mutate of [
    model => { model.snapshot.status = 'partial'; },
    model => { model.snapshot.observed_wallets = 1; },
    model => { model.balances = []; },
    model => { model.snapshot.usd_to_aud = null; model.snapshot.fx_source = null; model.snapshot.fx_observed_at = null; }
  ]) {
    const incomplete = structuredClone(m); mutate(incomplete);
    assert.equal(portfolio.portfolioTotal(incomplete), null);
    assert.equal(portfolio.displayValuation(incomplete, 'AUD').value, null);
  }
});

test('verified recorded zeros remain zero after exclusions and never borrow excluded positive values', () => {
  const early = fixture('synthetic-early', NOW - HOUR, { amount: 0 }), current = fixture('synthetic-current', NOW, { amount: 0 });
  const summary = series([early, current]);
  assert.deepEqual(summary.points.map(p => p.value), ['0', '0']); assert.equal(summary.change, '0');
  assert.equal(portfolioHeadline({ summary, currentModel: current, now: NOW }).percentAvailable, false);
});

test('snapshot-only history preserves observation metadata but cannot expose cached unfiltered totals', () => {
  const m = fixture(); m.snapshot.status = 'complete';
  const snapshot = freeze(structuredClone(m.snapshot));
  assert.deepEqual(portfolio.historyPoints([snapshot], 1, NOW), [{ at: snapshot.observed_at, value: null, status: 'complete' }]);
});

test('exclusions never turn unknown retained quotes, missing FX, carried balances or missing wallets into complete totals', () => {
  const mutations = [
    m => { for (const row of m.balances.filter(row => row.asset_id === 'native')) Object.assign(row, { price_status: 'missing', price_usd: null }); },
    m => { m.snapshot.usd_to_aud = null; m.snapshot.fx_source = null; m.snapshot.fx_observed_at = null; },
    m => { m.snapshot.observed_wallets = 1; },
    m => { m.wallets.push({ id: 'synthetic-pending', owner_id: m.account.owner_id, account_id: m.account.id, chain_id: null, network: 'solana', provider_status: 'provider_pending' }); m.snapshot.expected_wallets = 3; },
    m => { m.snapshot.provenance.valuation.basis = 'carried_forward_balances'; m.snapshot.provenance.valuation.balances_refreshed = false; }
  ];
  for (const mutate of mutations) {
    const m = fixture(); m.snapshot.status = 'complete'; m.snapshot.provenance.valuation.full_valuation_available = true; mutate(m);
    assert.equal(portfolio.portfolioTotal(m), null);
    assert.notEqual(portfolio.displayValuation(m, 'AUD').value, '999999');
    assert.equal(portfolio.displayValuation(m, 'AUD').incomplete, true);
  }
});

test('wallet projections preserve raw rows and recompute selected retained holdings for each account', () => {
  for (const kind of ['smsf', 'personal']) {
    const m = fixture('synthetic-current', NOW, { kind }); const before = structuredClone(m);
    for (const wallet of m.wallets) {
      const projected = projectWalletModel(m, wallet.id);
      assert.equal(portfolio.displayValuation(projected, 'USD').value, '60');
      assert.equal(portfolio.displayValuation(projected, 'AUD').value, '90');
      assert.equal(projected.balances.filter(excluded).length, 2);
      assert.equal(portfolio.groupHoldings(projected).some(h => [AICC, PVC].includes(h.assetId.toLowerCase())), false);
    }
    assert.deepEqual(m, before);
  }
});

test('history compares retained USD/AUD values while arbitrary excluded quotes and quantities remain irrelevant', () => {
  for (const kind of ['smsf', 'personal']) for (const currency of ['USD', 'AUD']) {
    const early = fixture('synthetic-early', NOW - HOUR, { kind });
    const current = fixture('synthetic-current', NOW, { kind, amount: 35 });
    for (const [i, row] of current.balances.filter(excluded).entries()) Object.assign(row, {
      balance_raw: raw(9999), price_usd: i % 2 ? null : '999999', price_status: i % 2 ? 'missing' : 'observed',
      price_source: '', price_observed_at: stamp(NOW - 48 * HOUR), provenance: { ...row.provenance, quote: { held_valuation_eligible: false } }
    });
    current.stakes = [stake(current), stake(current, PVC)];
    const before = structuredClone([early, current]), summary = series([early, current], { currency });
    assert.equal(summary.reason, null); assert.equal(summary.change, currency === 'USD' ? '20' : '30');
    assert.deepEqual(summary.points.map(p => p.value), currency === 'USD' ? ['120', '140'] : ['180', '210']);
    assert.equal(summary.points[0].scopeKey, summary.points[1].scopeKey);
    for (const p of summary.points) {
      assert.equal(p.coverage.unpricedAssets, 0);
      assert.equal(p.assets.some(a => a.key === '1:' + AICC || a.key === '1:' + PVC), false);
      const { inventory, walletInventory, included, excluded } = p.scope;
      assert.doesNotMatch(JSON.stringify({ inventory, walletInventory, included, excluded }), new RegExp(AICC + '|' + PVC, 'i'));
    }
    assert.deepEqual([early, current], before);
  }
});

test('adding and removing only excluded rows does not manufacture a historical scope change', () => {
  const without = fixture('synthetic-early', NOW - HOUR, { excludedRows: false });
  const withRows = fixture();
  const summary = series([without, withRows]);
  assert.equal(summary.change, '0'); assert.equal(summary.reason, null);
  assert.equal(summary.points[0].scopeKey, summary.points[1].scopeKey);
});

test('retained quote eligibility, discovery coverage and wallet scopes still invalidate comparisons', () => {
  for (const mutate of [
    m => { for (const row of m.balances.filter(row => row.asset_id === 'native')) Object.assign(row, { price_status: 'missing', price_usd: null }); },
    m => { m.snapshot.provenance.token_discovery.status = 'partial'; },
    m => { m.snapshot.provenance.excluded_coverage.push('Additional unavailable network'); }
  ]) {
    const early = fixture('synthetic-early', NOW - HOUR), current = fixture(); mutate(current);
    assert.equal(series([early, current]).change, null);
  }
  const early = fixture('synthetic-early', NOW - HOUR), current = fixture();
  assert.equal(series([projectWalletModel(early, early.wallets[0].id), projectWalletModel(current, current.wallets[1].id)]).reason, 'scope_changed');
});

test('excluded raw balances retain ownership, wallet-chain, quantity, timestamp and provenance validation', () => {
  const cases = [
    ['foreign owner', row => { row.owner_id = 'other-owner'; }, 'row_scope_mismatch'],
    ['foreign account', row => { row.account_id = 'other-account'; }, 'row_scope_mismatch'],
    ['foreign snapshot', row => { row.snapshot_id = 'other-snapshot'; }, 'row_scope_mismatch'],
    ['foreign wallet', row => { row.wallet_id = 'other-wallet'; }, null],
    ['wrong chain', row => { row.chain_id = 137; }, 'row_scope_mismatch'],
    ['invalid decimals', row => { row.decimals = -1; }, 'invalid_asset_identity'],
    ['malformed amount', row => { row.balance_raw = '-1'; }, 'invalid_holdings_data'],
    ['numeric amount', row => { row.balance_raw = 1; }, 'invalid_holdings_data'],
    ['overflow amount', row => { row.balance_raw = (2n ** 256n).toString(); }, 'invalid_holdings_data'],
    ['invalid time', row => { row.balance_observed_at = 'yesterday'; }, 'balance_time_mismatch'],
    ['outside window', row => { row.balance_observed_at = stamp(NOW - HOUR); }, 'balance_time_mismatch'],
    ['missing provenance', row => { row.provenance = {}; }, 'inventory_method_unknown'],
    ['wrong block scope', row => { row.provenance.balance_block_scope = 'unknown'; }, 'inventory_method_unknown']
  ];
  for (const [label, mutate, reason] of cases) {
    const m = fixture(); mutate(m.balances.find(excluded)); const p = point(m);
    assert.equal(p.eligible, false, label); assert.equal(p.value, null, label);
    if (reason) assert.equal(p.reason, reason, label);
  }
});

test('excluded duplicate balance and stake rows remain rejected, including different contract case', () => {
  const m = fixture(), duplicate = { ...m.balances.find(excluded), asset_id: AICC.toUpperCase() };
  m.balances.push(duplicate); assert.equal(point(m).reason, 'duplicate_balance_rows');
  const n = fixture(); n.stakes = [stake(n), stake(n)]; assert.equal(point(n).reason, 'duplicate_stake_rows');
});

test('excluded raw stakes retain quantity, time, status and identity validation', () => {
  for (const [patch, reason] of [
    [{ principal_raw: '-1' }, 'invalid_holdings_data'], [{ principal_raw: (2n ** 256n).toString() }, 'invalid_holdings_data'],
    [{ observed_at: stamp(NOW - HOUR) }, 'stake_time_mismatch'], [{ observed_at: null }, 'stake_time_mismatch'],
    [{ status: 'invented' }, 'stake_identity_unverified'], [{ protocol: '' }, 'stake_identity_unverified'],
    [{ stake_id: null }, 'stake_identity_unverified'], [{ owner_id: 'foreign-owner' }, 'row_scope_mismatch']
  ]) {
    const m = fixture(); m.stakes = [stake(m, AICC, patch)];
    assert.equal(point(m).reason, reason, JSON.stringify(patch)); assert.equal(point(m).value, null);
  }
});

test('excluding contracts does not bypass collector completeness, null rows or raw coverage checks', () => {
  for (const [mutate, reason] of [
    [m => { m.balances = m.balances.filter(row => !(row.wallet_id === m.wallets[0].id && row.asset_id === 'native')); }, 'asset_rows_incomplete'],
    [m => { m.balances.push(null); }, 'invalid_holdings_data'],
    [m => { m.snapshot.observed_wallets = 1; }, 'wallet_coverage_incomplete'],
    [m => { m.snapshot.provenance.token_discovery.status = 'unknown'; }, 'inventory_method_unknown']
  ]) { const m = fixture(); mutate(m); assert.equal(point(m).reason, reason); }
});

test('headline quote freshness ignores excluded quotes while retained stale quotes still matter', () => {
  const m = fixture();
  for (const row of m.balances.filter(excluded)) row.price_observed_at = stamp(NOW - 48 * HOUR);
  const headline = portfolioHeadline({ currentModel: m, summary: series([m]), now: NOW });
  assert.equal(headline.quote.at, stamp(NOW)); assert.equal(headline.quote.stale, false);
  for (const row of m.balances.filter(row => row.asset_id === 'native')) row.price_observed_at = stamp(NOW - HOUR);
  assert.equal(portfolioHeadline({ currentModel: m, now: NOW }).quote.stale, true);
});

test('direct coin history cannot expose excluded holdings by an old contract deep link', () => {
  for (const contract of [AICC, PVC]) for (const metric of ['value', 'price']) {
    const early = fixture('synthetic-early', NOW - HOUR), current = fixture();
    const summary = series([early, current], { coinKey: '1:' + contract, metric });
    assert.equal(summary.change, null); assert.ok(summary.points.every(p => p.value === null));
  }
});
