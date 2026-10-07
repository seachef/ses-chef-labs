import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleHoldings,groupHoldings,pricedHoldingsSummary,PORTFOLIO_EXCLUDED_ASSETS} from '../portfolio/model.mjs';
import {projectWalletModel} from '../portfolio/wallet-scope.mjs';

const holding=(symbol,value,extra={})=>({key:'1:'+symbol,chainId:1,assetId:symbol,quantity:'1',usd:value,aud:value,symbol,...extra});
const rows=[holding('SMALL','0.00001'),holding('EXACT50','50'),holding('ABOVE','50.000001'),holding('UNPRICED',null),holding('UNRELIABLE',null,{unreliable:true}),holding('NOFX','100',{aud:null}),holding('ZERO','100',{quantity:'0'}),holding('TINY',null,{quantity:'0.000000000000000001'}),...PORTFOLIO_EXCLUDED_ASSETS.map(assetId=>holding('EXCLUDED',null,{assetId})),holding('AICC','1',{assetId:'different-contract'})];
const symbols=holdings=>holdings.map(h=>h.symbol);
test('selected inventory shows every positive saved balance regardless of price, FX or threshold',()=>{
 for(const currency of ['USD','AUD'])assert.deepEqual(symbols(visibleHoldings(rows,currency,{walletView:true})),['SMALL','EXACT50','ABOVE','UNPRICED','UNRELIABLE','NOFX','TINY','AICC']);
});
test('default combined view retains strict priced-only threshold in the selected currency',()=>{
 assert.deepEqual(symbols(visibleHoldings(rows,'USD')),['ABOVE','NOFX']);assert.deepEqual(symbols(visibleHoldings(rows,'AUD')),['ABOVE']);
});
test('invalid and all-zero quantities never become invented wallet holdings',()=>{
 const invalid=['0','0.0','000.000',null,undefined,'-1','1e3','NaN','1x'];
 assert.deepEqual(visibleHoldings(invalid.map(quantity=>holding('BAD',null,{quantity})),'USD',{walletView:true}),[]);
});
test('the selected wallet cannot borrow another wallet balance or quote',()=>{
 const account={id:'account',owner_id:'owner'},scope={owner_id:'owner',account_id:'account'},wallets=['one','two'].map(id=>({...scope,id})),snapshot={id:'snapshot',status:'partial',expected_wallets:2,observed_wallets:2};
 const balance=(wallet_id,asset_id,balance_raw,price_usd)=>({...scope,wallet_id,asset_id,balance_raw,chain_id:1,symbol:asset_id,decimals:18,price_usd,price_status:price_usd?'observed':'missing',price_source:price_usd?'Synthetic':null,price_observed_at:price_usd?'2026-10-07T10:00:00Z':null});
 const model={account,wallets,snapshot,balances:[balance('one','SHARED','1',null),balance('two','SHARED','100000000000000000000','5'),balance('two','OTHER','100000000000000000000','5')],stakes:[],rewardEstimates:[]},before=structuredClone(model);
 const shown=groupHoldings(projectWalletModel(model,'one')),inventory=visibleHoldings(shown,'USD',{walletView:true});
 assert.equal(inventory.length,1);assert.equal(inventory[0].symbol,'SHARED');assert.equal(inventory[0].quantity,'0.000000000000000001');assert.equal(inventory[0].usd,null);assert.equal(pricedHoldingsSummary(shown,'USD').value,null);assert.deepEqual(model,before);
});
