/** A view over owner-verified stored rows; never writes or invents an observation. */
import { groupHoldings } from './model.mjs';

export function projectWalletModel(model, walletId = null) {
  if (!model || walletId == null) return model;
  const account = model.account;
  const wallet = model.wallets?.find(w => w.id === walletId);
  if (!account?.id || !wallet || wallet.account_id !== account.id || wallet.owner_id !== account.owner_id) throw new TypeError('Wallet is outside the selected account');
  const known = new Set(model.wallets.map(w => w.id));
  for (const rows of [model.balances || [], model.stakes || [], model.rewardEstimates || []]) {
    if (rows.some(row => row.account_id !== account.id || row.owner_id !== account.owner_id || !known.has(row.wallet_id))) throw new TypeError('Stored rows do not match the account');
  }
  const selected = rows => (rows || []).filter(row => row.wallet_id === walletId);
  const balances = selected(model.balances), stakes = selected(model.stakes), rewardEstimates = selected(model.rewardEstimates);
  const source = model.snapshot;
  const snapshot = source ? {...source, status:'partial', expected_wallets:1,
    observed_wallets:wallet.provider_status !== 'provider_pending' && balances.length ? 1 : 0,
    held_value_aud:null, held_value_usd:null,
    provenance:{...source.provenance, view_scope:{wallet_ids:[walletId], source_snapshot_id:source.id,
      source_expected_wallets:source.expected_wallets, source_observed_wallets:source.observed_wallets},
      valuation:{...source.provenance?.valuation,full_valuation_available:false}}} : null;
  const result = {...model,wallets:[wallet],snapshot,balances,stakes,rewardEstimates};
  if (snapshot) snapshot.unpriced_assets = groupHoldings(result).filter(h => h.quantity !== '0' && h.usd == null).length;
  return result;
}

/** Stable identity lets detail views invalidate pending reads when scope changes. */
export function createWalletProjection() {
  let cache = new WeakMap();
  return {
    get(model,walletId=null) {
      if (!model || walletId == null) return model;
      if (!cache.has(model)) cache.set(model,new Map());
      const scopes = cache.get(model);
      if (!scopes.has(walletId)) scopes.set(walletId,projectWalletModel(model,walletId));
      return scopes.get(walletId);
    },
    clear(){cache=new WeakMap();}
  };
}
