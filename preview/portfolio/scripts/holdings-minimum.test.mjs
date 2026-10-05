import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleHoldings,groupHoldings,pricedHoldingsSummary,displayValuation} from '../portfolio/model.mjs';
import {projectWalletModel} from '../portfolio/wallet-scope.mjs';
const holding=(usd,aud=usd,quantity='1')=>({quantity,usd,aud});
test('exact list threshold hides rounded and exact values up to 5; includes any exact value above 5',()=>{
 const rows=['0','4.99','4.995','4.999999999999999999999999','5','5.00','5.000000000000000001','9007199254740993'].map(v=>holding(v));
 assert.deepEqual(visibleHoldings(rows,'USD'),rows.slice(6));
});
test('threshold uses selected currency and aggregate value, not unit token price',()=>{
 const rows=[{...holding('4','6'),unitPriceUsd:'0.000001',quantity:'4000000'},{...holding('6','3'),unitPriceUsd:'6000',quantity:'0.001'}];
 assert.deepEqual(visibleHoldings(rows,'USD'),[rows[1]]);assert.deepEqual(visibleHoldings(rows,'AUD'),[rows[0]]);
});
test('unknown and unreliable prices remain visible; known zero quantities do not',()=>{
 const unknown=holding(null),noFx=holding('2',null),bad=holding(undefined),zero=holding(null,null,'0');
 assert.deepEqual(visibleHoldings([unknown,noFx,bad,zero],'AUD'),[unknown,noFx,bad]);
 assert.deepEqual(visibleHoldings([unknown,noFx,bad,zero],'USD'),[unknown,bad]);
});
const at='2026-10-05T00:00:00Z',account={id:'synthetic-account',owner_id:'synthetic-owner',kind:'smsf'},wallets=['one','two'].map(id=>({id,owner_id:account.owner_id,account_id:account.id,chain_id:1,network:'ethereum'}));
function model(){return {account,wallets,snapshot:{id:'synthetic-snapshot',status:'partial',expected_wallets:2,observed_wallets:2,unpriced_assets:0,observed_at:at,usd_to_aud:'1.5',fx_observed_at:at,fx_source:'Synthetic fixture'},balances:wallets.map(w=>({owner_id:account.owner_id,account_id:account.id,wallet_id:w.id,asset_id:'native',chain_id:1,symbol:'ETH',decimals:2,balance_raw:'250',price_status:'observed',price_usd:'1',price_observed_at:at,price_source:'Synthetic fixture'})),stakes:[],rewardEstimates:[],history:[]};}
test('same asset combines across selected wallets before filtering and selected-wallet scope recalculates',()=>{
 const m=model(),all=groupHoldings(m);assert.equal(all[0].usd,'5');assert.equal(visibleHoldings(all,'USD').length,0);m.balances[1].balance_raw='251';assert.equal(visibleHoldings(groupHoldings(m),'USD').length,1);m.balances[1].balance_raw='250';
 for(const w of wallets){const one=groupHoldings(projectWalletModel(m,w.id));assert.equal(one[0].usd,'2.5');assert.deepEqual(visibleHoldings(one,'USD'),[]);}
});
test('list filtering never mutates balances, subtotals or stored history',()=>{
 const m=model();m.balances[1].balance_raw='249';m.history=[structuredClone(m.snapshot)];const before=structuredClone(m),all=groupHoldings(m),value=displayValuation(m,'USD');
 assert.equal(value.value,'4.99');assert.deepEqual(visibleHoldings(all,'USD'),[]);assert.equal(pricedHoldingsSummary(all,'USD').value,'4.99');assert.deepEqual(displayValuation(m,'USD'),value);assert.deepEqual(m,before);
});
test('liquid and staked principal are aggregated once before applying visibility',()=>{
 const m=model();m.balances=m.balances.slice(0,1);m.stakes=[{...m.balances[0],principal_raw:'250',status:'active'}];
 const [h]=groupHoldings(m);assert.equal(h.quantity,'5');assert.equal(h.usd,'5');assert.equal(visibleHoldings([h],'USD').length,0);m.stakes[0].principal_raw='251';assert.equal(visibleHoldings(groupHoldings(m),'USD').length,1);
});


import {allocationSummary,renderAllocation} from '../portfolio/visuals.mjs';
test('allocation hides small coin names while preserving all value and percentage denominators',()=>{
 const m=model();Object.assign(m.snapshot,{account_id:account.id,owner_id:account.owner_id});
 assert.equal(allocationSummary(m,'USD').total,'5');assert.doesNotMatch(renderAllocation(m,'USD'),/>ETH</);
 m.balances[1].balance_raw='251';m.balances.push({...m.balances[0],asset_id:'synthetic-small',symbol:'SMALL',balance_raw:'100'});
 assert.equal(allocationSummary(m,'USD').total,'6.01');assert.equal(allocationSummary(m,'USD').pricedAssets,2);
 const html=renderAllocation(m,'USD');assert.match(html,/>ETH</);assert.doesNotMatch(html,/>SMALL</);assert.match(html,/83\.4%/);assert.match(html,/Includes smaller holdings/);
});
