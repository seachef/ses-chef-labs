import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolioAdapter} from '../portfolio/adapter.mjs';
import {groupHoldings,visibleHoldings,displayValuation} from '../portfolio/model.mjs';

// Synthetic mixed-account fixtures. No credentials, real wallets or external calls.
const owner='fixture-owner';
const smsf={id:'fixture-smsf',owner_id:owner,kind:'smsf'};
const personal={id:'fixture-personal',owner_id:owner,kind:'personal'};
function fixture({accounts=[personal,smsf],ignoreAccountKind=false}={}){
 const tables={portfolio_accounts:accounts,portfolio_wallets:accounts.map(account=>({id:`${account.id}-wallet`,owner_id:owner,account_id:account.id})),portfolio_snapshots:accounts.map(account=>({id:`${account.id}-snapshot`,owner_id:owner,account_id:account.id,status:'partial'}))};
 const calls=[];let authCalls=0;
 const client={auth:{getUser:async()=>{authCalls++;return {data:{user:{id:owner}}};}},from(table){const filters={};const call={table,filters};calls.push(call);const q={select(){return q;},eq(key,value){filters[key]=value;return q;},order(){return q;},range:async()=>({data:(tables[table]||[]).filter(row=>Object.entries(filters).every(([key,value])=>ignoreAccountKind&&table==='portfolio_accounts'&&key==='kind'||row[key]===value)),error:null})};return q;}};
 return {adapter:createPortfolioAdapter(client),calls,tables,get authCalls(){return authCalls;}};
}

test('SMSF option filters account discovery and every subsequent wallet, snapshot and value read',async()=>{
 const f=fixture(),before=JSON.stringify(f.tables);
 const result=await f.adapter.readPortfolio(null,{accountKind:'smsf'});
 assert.equal(result.status,'ready');assert.equal(result.model.account.id,smsf.id);
 assert.deepEqual(result.models.map(model=>model.account.id),[smsf.id]);
 assert.deepEqual(f.calls[0],{table:'portfolio_accounts',filters:{owner_id:owner,kind:'smsf'}});
 const reads=f.calls.slice(1);assert.ok(reads.length>=5);assert.ok(reads.every(read=>read.filters.owner_id===owner&&read.filters.account_id===smsf.id));
 for(const read of reads.filter(read=>['portfolio_balance_snapshots','portfolio_stake_snapshots','portfolio_reward_estimates'].includes(read.table)))assert.equal(read.filters.snapshot_id,`${smsf.id}-snapshot`);
 assert.equal(JSON.stringify(f.tables),before);
});

test('SMSF client-side filtering precedes dependent reads even if account results include Personal',async()=>{
 const f=fixture({ignoreAccountKind:true});
 const result=await f.adapter.readPortfolio(personal.id,{accountKind:'smsf'});
 assert.equal(result.model.account.id,smsf.id);assert.deepEqual(result.models.map(model=>model.account.kind),['smsf']);
 assert.equal(f.calls.some(read=>read.filters.account_id===personal.id),false);
});

test('a Personal-only account returns no SMSF model without loading its wallet or snapshot',async()=>{
 const f=fixture({accounts:[personal],ignoreAccountKind:true});
 assert.deepEqual(await f.adapter.readPortfolio(personal.id,{accountKind:'smsf'}),{status:'no-account',model:null});
 assert.equal(f.calls.length,1);
});

test('unfiltered adapter callers retain both account kinds and can select Personal explicitly',async()=>{
 const f=fixture();const result=await f.adapter.readPortfolio(personal.id);
 assert.equal(result.model.account.id,personal.id);assert.deepEqual(result.models.map(model=>model.account.id),[smsf.id,personal.id]);
 assert.equal('kind' in f.calls[0].filters,false);assert.ok(f.calls.some(read=>read.filters.account_id===personal.id));
});

test('explicit Personal scope still works for other callers and unsupported kinds cannot broaden a read',async()=>{
 const f=fixture();const result=await f.adapter.readPortfolio(null,{accountKind:'personal'});
 assert.equal(result.model.account.id,personal.id);assert.deepEqual(result.models.map(model=>model.account.id),[personal.id]);
 const invalid=fixture();await assert.rejects(()=>invalid.adapter.readPortfolio(null,{accountKind:'all'}),TypeError);assert.equal(invalid.calls.length,0);assert.equal(invalid.authCalls,0);
});

test('default two-account loading selects SMSF and retains isolated Personal values and missing AUD',async()=>{
 const f=fixture(),at='2026-10-06T10:00:00Z';
 for(const snapshot of f.tables.portfolio_snapshots)Object.assign(snapshot,{observed_at:at,expected_wallets:1,observed_wallets:1,unpriced_assets:0,usd_to_aud:snapshot.account_id===smsf.id?'1.5':null,fx_observed_at:snapshot.account_id===smsf.id?at:null,fx_source:snapshot.account_id===smsf.id?'Synthetic FX':null});
 f.tables.portfolio_balance_snapshots=[smsf,personal].map(account=>({owner_id:owner,account_id:account.id,snapshot_id:`${account.id}-snapshot`,wallet_id:`${account.id}-wallet`,chain_id:1,asset_id:'native',symbol:'ETH',decimals:2,balance_raw:account===smsf?'6000':'4000',price_usd:'1',price_status:'observed',price_observed_at:at,price_source:'Synthetic price'}));
 const before=structuredClone(f.tables),opened=await f.adapter.readPortfolio();
 assert.equal(opened.model.account.id,smsf.id);assert.deepEqual(opened.models.map(model=>model.account.id),[smsf.id,personal.id]);assert.equal('kind' in f.calls[0].filters,false);
 const switched=await f.adapter.readPortfolio(personal.id);assert.equal(switched.model.account.id,personal.id);
 for(const result of [opened,switched])for(const model of result.models){
  const id=model.account.id;
  for(const rows of [model.wallets,model.history,model.balances,model.stakes,model.rewardEstimates])assert.ok(rows.every(row=>row.account_id===id&&row.owner_id===owner));
  assert.equal(model.snapshot.account_id,id);assert.equal(groupHoldings(model).length,1);assert.equal(groupHoldings(model)[0].usd,id===smsf.id?'60':'40');
 }
 assert.equal(displayValuation(opened.model,'USD').value,'60');assert.equal(visibleHoldings(groupHoldings(opened.model),'USD').length,1);
 assert.equal(displayValuation(switched.model,'USD').value,'40');assert.deepEqual(visibleHoldings(groupHoldings(switched.model),'USD'),[],'An account cannot cross the cutoff by borrowing another account’s holding');
 assert.equal(displayValuation(switched.model,'AUD').value,null);assert.equal(displayValuation(switched.model,'AUD').fxUnavailable,true);assert.deepEqual(visibleHoldings(groupHoldings(switched.model),'AUD'),[]);
 for(const read of f.calls.filter(read=>read.table!=='portfolio_accounts')){assert.equal(read.filters.owner_id,owner);assert.ok([smsf.id,personal.id].includes(read.filters.account_id));if(read.filters.snapshot_id)assert.equal(read.filters.snapshot_id,`${read.filters.account_id}-snapshot`);}
 assert.deepEqual(f.tables,before);
});
