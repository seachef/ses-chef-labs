import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleHoldings,groupHoldings,pricedHoldingsSummary,displayValuation,historyPoints} from '../portfolio/model.mjs';
import {projectWalletModel} from '../portfolio/wallet-scope.mjs';
const holding=(usd,aud=usd,quantity='1')=>({quantity,usd,aud});
test('exact list threshold hides rounded and exact values up to 50; includes any exact value above 50',()=>{
 const rows=['0','49.99','49.995','49.999999999999999999999999','50','50.00','50.01','50.000000000000000001','9007199254740993'].map(v=>holding(v));
 for(const currency of ['USD','AUD'])assert.deepEqual(visibleHoldings(rows,currency),rows.slice(6),currency);
});
test('threshold uses selected currency and aggregate value, not unit token price',()=>{
 const rows=[{...holding('40','60'),unitPriceUsd:'0.000001',quantity:'4000000'},{...holding('60','30'),unitPriceUsd:'6000',quantity:'0.001'}];
 assert.deepEqual(visibleHoldings(rows,'USD'),[rows[1]]);assert.deepEqual(visibleHoldings(rows,'AUD'),[rows[0]]);
});
test('unknown, malformed and nondecimal selected values never create holdings rows',()=>{
 const invalid=[null,undefined,'','unknown','NaN','Infinity','-60','+60','6e1','0x40',' 60 ','60.','60.0.1',NaN,Infinity,60,60n,{},[]];
 for(const currency of ['USD','AUD']){
  const key=currency.toLowerCase(),rows=invalid.map(value=>({...holding('60','90'),[key]:value}));
  assert.deepEqual(visibleHoldings(rows,currency),[],currency);
 }
 const noFx=holding('60',null);assert.deepEqual(visibleHoldings([noFx],'AUD'),[]);assert.deepEqual(visibleHoldings([noFx],'USD'),[noFx]);
});
test('missing, invalid and zero quantities cannot pass using an otherwise valid value',()=>{
 const invalid=[undefined,null,'','unknown','-1','+1','1e1',' 1 ','1.','NaN','Infinity',NaN,Infinity,1,1n,{},[],'0','00','0.000'];
 const rows=invalid.map(quantity=>({quantity,usd:'60',aud:'90'}));
 rows.push({usd:'60',aud:'90'});
 assert.deepEqual(visibleHoldings(rows,'USD'),[]);assert.deepEqual(visibleHoldings(rows,'AUD'),[]);
 const positive=holding('60','90','0.000000000000000001');assert.deepEqual(visibleHoldings([positive],'USD'),[positive]);
});
test('strict threshold is exact in both currencies and does not mutate or reorder frozen inputs',()=>{
 const values=['0','0050.0000','49.999999999999999999999999','50.000000000000000001','9007199254740993'];
 const rows=Object.freeze(values.map(value=>Object.freeze(holding(value,value)))),before=structuredClone(rows);
 for(const currency of ['USD','AUD']){
  const shown=visibleHoldings(rows,currency);assert.deepEqual(shown,rows.slice(3));assert.notEqual(shown,rows);assert.equal(shown[0],rows[3]);
 }
 assert.deepEqual(rows,before);
});
const at='2026-10-05T00:00:00Z',account={id:'synthetic-account',owner_id:'synthetic-owner',kind:'smsf'},wallets=['one','two'].map(id=>({id,owner_id:account.owner_id,account_id:account.id,chain_id:1,network:'ethereum'}));
function model(){return {account,wallets,snapshot:{id:'synthetic-snapshot',status:'partial',expected_wallets:2,observed_wallets:2,unpriced_assets:0,observed_at:at,usd_to_aud:'1.5',fx_observed_at:at,fx_source:'Synthetic fixture'},balances:wallets.map(w=>({owner_id:account.owner_id,account_id:account.id,wallet_id:w.id,asset_id:'native',chain_id:1,symbol:'ETH',decimals:2,balance_raw:'2500',price_status:'observed',price_usd:'1',price_observed_at:at,price_source:'Synthetic fixture'})),stakes:[],rewardEstimates:[],history:[]};}
test('same asset combines across selected wallets before filtering and selected-wallet scope recalculates',()=>{
 const m=model(),all=groupHoldings(m);assert.equal(all[0].usd,'50');assert.equal(visibleHoldings(all,'USD').length,0);m.balances[1].balance_raw='2501';assert.equal(visibleHoldings(groupHoldings(m),'USD').length,1);m.balances[1].balance_raw='2500';
 for(const w of wallets){const one=groupHoldings(projectWalletModel(m,w.id));assert.equal(one[0].usd,'25');assert.deepEqual(visibleHoldings(one,'USD'),[]);}
});
test('list filtering never mutates balances, subtotals or stored history',()=>{
 const m=model();m.balances[1].balance_raw='2499';m.history=[structuredClone(m.snapshot)];const before=structuredClone(m),all=groupHoldings(m),value=displayValuation(m,'USD');
 assert.equal(value.value,'49.99');assert.deepEqual(visibleHoldings(all,'USD'),[]);assert.equal(pricedHoldingsSummary(all,'USD').value,'49.99');assert.deepEqual(displayValuation(m,'USD'),value);assert.deepEqual(m,before);
});
test('unpriced and unreliable holdings stay in the underlying model and coverage, never the visible list',()=>{
 const m=model();m.balances[0].balance_raw='6000';m.balances[1].balance_raw='0';
 m.balances.push(...[
  {asset_id:'missing',symbol:'MISSING',price_status:'missing',price_usd:null},
  {asset_id:'unreliable',symbol:'UNRELIABLE',price_status:'unreliable',price_usd:'100'},
  {asset_id:'ineligible',symbol:'INELIGIBLE',price_status:'observed',price_usd:'100',provenance:{quote:{held_valuation_eligible:false}}}
 ].map(patch=>({...m.balances[0],balance_raw:'1000',...patch})));
 m.snapshot.unpriced_assets=3;m.history=[structuredClone(m.snapshot)];
 const before=structuredClone(m),all=groupHoldings(m),valuation=displayValuation(m,'USD'),history=historyPoints(m.history,30,Date.parse(at));
 assert.equal(all.length,4);assert.deepEqual(visibleHoldings(all,'USD').map(h=>h.symbol),['ETH']);
 assert.deepEqual(pricedHoldingsSummary(all,'USD'),{value:'60',pricedAssets:1,unpricedAssets:3});
 assert.deepEqual(displayValuation(m,'USD'),valuation);assert.deepEqual(historyPoints(m.history,30,Date.parse(at)),history);assert.deepEqual(m,before);
 m.snapshot.usd_to_aud=null;const missingFxBefore=structuredClone(m),aud=displayValuation(m,'AUD');
 assert.deepEqual(visibleHoldings(groupHoldings(m),'AUD'),[]);assert.equal(aud.value,null);assert.equal(aud.fxUnavailable,true);assert.deepEqual(displayValuation(m,'AUD'),aud);assert.deepEqual(m,missingFxBefore);
});
test('liquid and staked principal are aggregated once before applying visibility',()=>{
 const m=model();m.balances=m.balances.slice(0,1);m.stakes=[{...m.balances[0],principal_raw:'2500',status:'active'}];
 const [h]=groupHoldings(m);assert.equal(h.quantity,'50');assert.equal(h.usd,'50');assert.equal(visibleHoldings([h],'USD').length,0);m.stakes[0].principal_raw='2501';assert.equal(visibleHoldings(groupHoldings(m),'USD').length,1);
});


import {allocationSummary,renderAllocation} from '../portfolio/visuals.mjs';
test('allocation hides small coin names while preserving all value and percentage denominators',()=>{
 const m=model();Object.assign(m.snapshot,{account_id:account.id,owner_id:account.owner_id});
 assert.equal(allocationSummary(m,'USD').total,'50');assert.doesNotMatch(renderAllocation(m,'USD'),/>ETH</);
 m.balances[1].balance_raw='2501';m.balances.push({...m.balances[0],asset_id:'synthetic-small',symbol:'SMALL',balance_raw:'1000'});
 assert.equal(allocationSummary(m,'USD').total,'60.01');assert.equal(allocationSummary(m,'USD').pricedAssets,2);
 const html=renderAllocation(m,'USD');assert.match(html,/>ETH</);assert.doesNotMatch(html,/>SMALL</);assert.match(html,/83\.3%/);assert.match(html,/Includes smaller holdings/);
});
