import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortfolioAdapter} from '../portfolio/adapter.mjs';

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
