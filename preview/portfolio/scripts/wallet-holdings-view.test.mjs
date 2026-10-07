import test from 'node:test';
import assert from 'node:assert/strict';
import {COINS,groupHoldings,visibleHoldings,pricedHoldingsSummary,PORTFOLIO_EXCLUDED_ASSETS} from '../portfolio/model.mjs';
import {projectWalletModel,walletHoldingsView} from '../portfolio/wallet-scope.mjs';

const account={id:'synthetic-account',owner_id:'synthetic-owner',kind:'smsf'},scope={account_id:account.id,owner_id:account.owner_id};
const wallets=['one','two'].map(id=>({...scope,id,chain_id:1,network:'ethereum'}));
const at='2026-10-07T00:00:00Z',snapshot={...scope,id:'synthetic-snapshot',status:'partial',expected_wallets:2,observed_wallets:2,unpriced_assets:1,usd_to_aud:'1.5',fx_source:'Synthetic FX',fx_observed_at:at};
const row=(wallet_id,assetId,symbol,decimals,quantity,price='2')=>({...scope,snapshot_id:snapshot.id,wallet_id,chain_id:1,asset_id:assetId,symbol,decimals,balance_raw:(BigInt(quantity)*10n**BigInt(decimals)).toString(),price_status:price?'observed':'missing',price_usd:price,price_source:price?'Synthetic quote':null,price_observed_at:price?at:null});
const model={account,wallets,snapshot,balances:[...COINS.map(c=>row('one',c.assetId,c.symbol,c.decimals,100)),row('one','native','ETH',18,100),row('two','native','ETH',18,200),row('one','small','SMALL',18,10),row('one','unpriced','UNPRICED',18,100,null),...PORTFOLIO_EXCLUDED_ASSETS.map((id,i)=>row('one',id,i?'PVC':'AICC',18,100))],stakes:[],rewardEstimates:[]};
const symbols=rows=>visibleHoldings(rows,'USD').map(h=>h.symbol);

test('all-wallet view retains the separate staking-assets panel',()=>{
 const views=walletHoldingsView(groupHoldings(model));
 assert.deepEqual(symbols(views.main),['DRAGONX','SHOGUN','ETH']);assert.deepEqual(symbols(views.staking),['HEX','HDRN','ICSA']);
});
test('single wallet shows every qualifying asset and preserves thresholds and exact exclusions',()=>{
 const before=structuredClone(model),shown=projectWalletModel(model,'one'),holdings=groupHoldings(shown),views=walletHoldingsView(holdings,'one');
 assert.deepEqual(symbols(views.main),['DRAGONX','SHOGUN','HEX','HDRN','ICSA','ETH']);assert.deepEqual(symbols(views.staking),['HEX','HDRN','ICSA']);
 assert.equal(pricedHoldingsSummary(holdings,'USD').value,'1220');assert.deepEqual(model,before);
 assert.deepEqual(symbols(walletHoldingsView(groupHoldings(projectWalletModel(model,'two')),'two').main),['ETH']);
});
test('locked principal is counted once while the staking panel remains a breakdown',()=>{
 const hex=COINS.find(c=>c.symbol==='HEX'),withStake={...model,stakes:[{...scope,wallet_id:'one',chain_id:1,asset_id:hex.assetId,symbol:'HEX',decimals:8,principal_raw:'5000000000',status:'active'}]},shown=projectWalletModel(withStake,'one'),holdings=groupHoldings(shown),views=walletHoldingsView(holdings,'one');
 const holding=views.main.find(h=>h.symbol==='HEX');assert.equal(holding.liquid,'100');assert.equal(holding.staked,'50');assert.equal(holding.quantity,'150');assert.equal(views.staking.find(h=>h.symbol==='HEX'),holding);assert.equal(pricedHoldingsSummary(holdings,'USD').value,'1320');
});
