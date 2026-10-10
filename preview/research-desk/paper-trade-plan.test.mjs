import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {paperTradePlanView,renderPaperTradePlan} from './paper-trade-plan.mjs';
import {readPortfolioSnapshot} from './portfolio-snapshot.mjs';
import {readDailyPerformance} from './daily-performance.mjs';

// Existing recorded engine fixture plus an explicit synthetic price-increment
// fixture. All tests are local; fixture prices are never used by the app.
const fixture=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const now=Date.parse('2026-10-09T05:37:01.535Z');
const iso=ms=>new Date(ms).toISOString();
function report(){const p=fixture('engine-running-v2.json');for(const x of p.positions)x.tick_size=.000001;return p;}
const view=p=>paperTradePlanView({report:p,connected:true,now});
const amounts=v=>v.rows.map(x=>x.estimatedNet);

test('actual entry, intended entry and trigger never use each other as fallback',()=>{
 const p=report(),v=view(p);assert.equal(v.rows.length,3);
 for(const r of v.rows){const pos=p.positions.find(x=>x.asset===r.asset);assert.equal(r.entry,pos.entry_price);assert.equal(r.intended,null);assert.equal(r.target,pos.target);assert.equal(r.stop,pos.stop);assert.match(r.status,/OPEN/);assert.match(r.note,/Actual simulated entry receipt/);}
 assert.equal(v.closed.length,0);assert.equal(v.unrealised,p.account.unrealized_pnl);
});
test('target net scenario deducts exit slippage, tick rounding, fee and adverse FX exactly once',()=>{
 const p=report(),v=view(p);
 for(const r of v.rows){const x=p.positions.find(x=>x.asset===r.asset),exit=Math.floor(x.target*.9975/x.tick_size)*x.tick_size;assert.equal(r.estimatedExit,exit);assert.equal(r.estimatedNet,x.qty*exit*.992*(p.account.fx*.9975)-x.cost_base);assert.notEqual(r.estimatedNet,x.qty*(x.target-x.entry_price));assert.match(r.note,/Entry fees\/slippage\/FX are already in recorded cost/);assert.match(r.note,/unchanged/);assert.match(r.note,/Future liquidity, gaps and FX/);}
 assert.match(v.preview.join(' '),/Est\. net P&L/);assert.match(v.reason,/not guaranteed/);
});
test('different quantities produce independent position estimates, not one hard-coded profit',()=>{const p=report(),v=view(p);assert.equal(new Set(amounts(v)).size,3);assert.equal(v.rows.length,3);assert.match(v.preview[2],/\+2 more/);});
test('negative and zero hypothetical outcomes are preserved',()=>{const p=report();p.positions[0].target=80;assert.ok(view(p).rows[0].estimatedNet<0);p.positions[0].target=110;assert.notEqual(view(p).rows[0].estimatedNet,view(report()).rows[0].estimatedNet);});
test('coarse tick floor matters and is not silently omitted',()=>{const p=report();p.positions[0].tick_size=10;const row=view(p).rows[0];assert.equal(row.estimatedExit,130);assert.ok(row.estimatedNet<view(report()).rows[0].estimatedNet);});
const missing={
 'fee model':p=>delete p.cost_model.fee_per_side_pct,
 'wrong fee model':p=>p.cost_model.fee_per_side_pct=.1,
 'slippage model':p=>delete p.cost_model.slippage_per_side_pct,
 'adverse FX model':p=>delete p.cost_model.fx_adverse_per_side_pct,
 'fee tier pretending verified':p=>p.cost_model.actual_fee_tier=true,
 'missing entry cost':p=>delete p.positions[0].cost_base,
 'non-numeric entry cost':p=>p.positions[0].cost_base='182',
 'nonfinite quantity':p=>p.positions[0].qty=Infinity,
 'bad target type':p=>p.positions[0].target='150',
 'negative target':p=>p.positions[0].target=-2,
 'duplicate position':p=>p.positions.push({...p.positions[0]}),
 'unknown coin':p=>p.positions[0].asset='FAKE/USD',
 'future position':p=>p.positions[0].opened_at=iso(now+1),
 'future receipt':p=>p.fills[0].at=iso(now+1),
 'future decision':p=>p.decisions[0].at=iso(now+1),
 'malformed date':p=>p.positions[0].opened_at='2026-02-30T00:00:00Z',
};
for(const [name,mutate] of Object.entries(missing))test('fail closed for '+name,()=>{const p=report();mutate(p);const v=view(p);assert.equal(v.rows.length,0);assert.equal(v.unrealised,null);});
const withheld={
 'missing linked receipt':p=>p.fills=p.fills.filter(f=>f.id!==p.positions[0].entry_fill_id),
 'missing receipt ID':p=>delete p.positions[0].entry_fill_id,
 'cross-asset receipt':p=>p.positions[0].entry_fill_id=p.positions[1].entry_fill_id,
 'inconsistent recorded debit':p=>p.positions[0].cost_base+=1,
 'inconsistent entry quantity':p=>p.positions[0].qty+=1,
 'missing tick':p=>delete p.positions[0].tick_size,
 'invalid tick':p=>p.positions[0].tick_size=0,
 'unrepresentable tick precision':p=>p.positions[0].target=1e100,
 'missing target':p=>p.positions[0].target=null,
 'missing stop':p=>p.positions[0].stop=null,
 'missing FX':p=>p.account.fx=null,
 'missing applied FX':p=>delete p.account.fx_applied_rate,
 'inconsistent applied FX':p=>p.account.fx_applied_rate=1.5,
 'future FX reference':p=>p.account.fx_at=iso(now+1),
 'future FX receipt':p=>p.account.fx_retrieved_at=iso(now+1),
 'stale FX receipt':p=>p.account.fx_retrieved_at=iso(now-3600001),
 'stale FX reference':p=>p.account.fx_at=iso(now-345600001),
 'missing FX date':p=>delete p.account.fx_rate_date,
 'contradictory FX date':p=>p.account.fx_rate_date='2026-10-09',
 'stale mark':p=>p.account.valuation_at=iso(now-90001),
 'future valuation':p=>p.account.valuation_at=iso(now+1),
 'stale coin quote':p=>p.positions[0].quote_at=iso(now-90001),
 'future coin quote':p=>p.positions[0].quote_at=iso(now+1),
};
for(const [name,mutate] of Object.entries(withheld))test('withholds estimated profit for '+name,()=>{const p=report();mutate(p);assert.equal(view(p).rows[0]?.estimatedNet??null,null);});
test('future quote relative to report never becomes current merely because now is later',()=>{const p=report();p.positions[0].quote_at=iso(now+1000);const v=paperTradePlanView({report:p,connected:true,now:now+2000});assert.equal(v.rows[0].estimatedNet,null);assert.equal(v.unrealised,null);});
test('old, future, disconnected or malformed envelope clears all current data',()=>{const p=report();for(const options of [{now:now+90001},{now:now-1},{connected:false},{now:NaN}]){const v=paperTradePlanView({report:p,connected:true,now,...options});assert.equal(v.rows.length,0);assert.equal(v.unrealised,null);assert.ok(v.preview.every(s=>!s.includes('104.')));}assert.equal(view({}).rows.length,0);});
function pending(){const p=report();p.positions=[];p.fills=[];p.decisions=[{...p.decisions.find(x=>x.result==='pending'),at:iso(now-1000)}];return p;}
test('unfilled decision has only intended reference with no actual entry or assumed quantity/profit',()=>{const v=view(pending());assert.equal(v.rows.length,1);assert.equal(v.rows[0].entry,null);assert.equal(v.rows[0].intended,104);assert.equal(v.rows[0].estimatedNet,null);assert.match(v.rows[0].note,/not an order limit or an actual fill/);assert.match(v.rows[0].status,/NOT FILLED/);});
test('pending decision is not revived after cancellation, fill, or a newer decision',()=>{for(const result of ['cancelled','filled','blocked','no_trade']){const p=pending();p.decisions.push({...p.decisions[0],id:'later',at:iso(now),action:'hold',result});assert.equal(view(p).rows.length,0);}});
test('stale or expired pending decisions never imply an active order',()=>{const p=pending();p.decisions[0].at=iso(now-120001);assert.equal(view(p).rows.length,0);});
test('latest pending decision per coin is deterministic regardless of input order',()=>{const p=pending();p.decisions.push({...p.decisions[0],id:'zzzz',price:105});const v=view(p);p.decisions.reverse();assert.deepEqual(view(p),v);assert.equal(v.rows.length,1);assert.equal(v.rows[0].intended,105);});
function closed(name='engine-settled-v2.json'){const p=fixture(name);return {p,at:Date.parse(p.heartbeat_at)};}
test('actual exit and realised result require matching receipts and reconciliation',()=>{const {p,at}=closed(),v=paperTradePlanView({report:p,connected:true,now:at});assert.ok(v.closed.length);assert.ok(v.closed.every(r=>r.net!==null));for(const r of v.closed){const result=p.results.find(x=>x.asset===r.asset);assert.equal(r.net,p.settlements.find(s=>s.exit_fill_id===result.exit_fill_id)?.pnl_base??result.pnl_base);assert.match(r.note,/reconciles/);}});
test('pending conversion shows filled exit with unknown AUD realised result',()=>{const {p,at}=closed('engine-unsettled-v2.json'),v=paperTradePlanView({report:p,connected:true,now:at});assert.ok(v.closed.length);assert.ok(v.closed.every(r=>r.net===null));assert.ok(v.closed.every(r=>r.exit!==null));});
test('missing entry receipt, reused fill and wrong result do not fabricate realised profit',()=>{for(const mutate of [p=>p.fills=p.fills.filter(f=>f.side!=='buy'),p=>p.results.push({...p.results[0],id:'duplicate'}),p=>{for(const s of p.settlements)s.pnl_base+=50;for(const r of p.results)if(r.pnl_base!==null)r.pnl_base+=50;}]){const {p,at}=closed();mutate(p);const v=paperTradePlanView({report:p,connected:true,now:at});assert.ok(v.closed.length);assert.equal(v.closed[0].net,null);}});
function native(){const p=report();p.native_paper={version:1,mode:'PAPER',observed_at:p.heartbeat_at,valuation_at:null,valuation_complete:false,history_complete:false,positions:[{asset:'binance:SOLUSDT',agent_id:'binance',venue:'binance',base:'SOL',quote_currency:'USDT',owned_qty:1,sellable_qty:.999,dust_qty:.001,cost_base:200,initial_risk_base:2,mark_base:null,position_status:'open'}],pending_quote_balances:[],recent_fills:[]};return p;}
test('native holding stays visible with unavailable entry/target; never treats USDT as USD',()=>{const p=native(),r=view(p).rows.find(x=>x.asset==='binance:SOLUSDT');assert.ok(r);for(const k of ['entry','target','stop','estimatedExit','estimatedNet'])assert.equal(r[k],null);assert.equal(r.currency,'USDT');assert.match(r.note,/USDT is not assumed equal to USD/);});
test('malformed or future native report is withheld independently',()=>{for(const mutate of [p=>p.native_paper.positions[0].quote_currency='USD',p=>p.native_paper.observed_at=iso(now+1)]){const p=native();mutate(p);const v=view(p);assert.equal(v.state,'PARTIAL');assert.ok(v.rows.every(x=>x.venue==='Kraken'));assert.equal(v.unrealised,null);}});
test('target scenarios never mutate portfolio totals, daily returns, positions or source object',()=>{const p=report(),before=structuredClone(p),portfolio=readPortfolioSnapshot(p,true,now),daily=readDailyPerformance(p,true,now);view(p);assert.deepEqual(p,before);p.positions[0].target*=2;view(p);assert.deepEqual(readPortfolioSnapshot(p,true,now),portfolio);assert.deepEqual(readDailyPerformance(p,true,now),daily);});
function dom(){const names=['paperTradePreview0','paperTradePreview1','paperTradePreview2','paperPlanStatus','paperPlanUnrealised','paperPlanRows','paperPlanClosed'],nodes=Object.fromEntries(names.map(x=>[x,{textContent:'',dataset:{},replaceChildren(...children){this.children=children;}}]));return {nodes,document:{getElementById:x=>nodes[x],createElement:()=>({textContent:'',set innerHTML(v){throw Error('unsafe HTML');}})}};}
test('rendering is text-only, idempotent, and clears previous prices on disconnect',()=>{const p=report(),d=dom();p.fills[0].id='<script>alert(1)</script>';p.positions.find(x=>x.asset===p.fills[0].asset).entry_fill_id=p.fills[0].id;renderPaperTradePlan(d.document,{report:p,connected:true,now});const rows=d.nodes.paperPlanRows.children;assert.match(rows.map(x=>x.textContent).join(' '),/<script>alert\(1\)<\/script>/);renderPaperTradePlan(d.document,{report:p,connected:true,now});assert.equal(d.nodes.paperPlanRows.children,rows);renderPaperTradePlan(d.document,{report:p,connected:false,now});assert.equal(d.nodes.paperPlanRows.children.length,1);assert.doesNotMatch(d.nodes.paperTradePreview0.textContent,/104/);});
test('candidate stays local/read-only with existing art, controls and inherited type',()=>{const src=fs.readFileSync(new URL('./paper-trade-plan.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('./paper-trade-plan.css',import.meta.url),'utf8'),html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.doesNotMatch(src,/\bfetch\s*\(|localStorage|sessionStorage|setInterval|\.innerHTML\s*=/);assert.doesNotMatch(css,/font-family|\.world|#atmosphere|#art|position:fixed/);assert.match(css,/font:inherit/);for(const id of ['openPortfolio','ownerStop','ownerResume','marketSelect','openProgress','closeProgress','openSeaChat'])assert.ok(html.includes('id="'+id+'"'));assert.doesNotMatch(html,/Apply target|Increase target|Decrease target/);});

test('critical entry/target values wrap instead of truncating on narrow right-side info panels',()=>{const css=fs.readFileSync(new URL('./paper-trade-plan.css',import.meta.url),'utf8');assert.match(css,/\.paper-trade-preview>span\{[^}]*overflow-wrap:anywhere/);assert.match(css,/\.paper-trade-preview>span\{[^}]*white-space:normal/);assert.doesNotMatch(css,/text-overflow:ellipsis/);assert.match(css,/\.progress-window\{max-height:none;overflow:visible/);});
test('append-only pending and settled result versions show one realised result per actual exit',()=>{const {p,at}=closed(),v=paperTradePlanView({report:p,connected:true,now:at});assert.equal(p.results.length,6);assert.equal(v.closed.length,3);assert.ok(v.closed.every(r=>r.net!==null));p.results.reverse();assert.deepEqual(paperTradePlanView({report:p,connected:true,now:at}).closed.map(r=>[r.asset,r.net]).sort(),v.closed.map(r=>[r.asset,r.net]).sort());});
test('an already closed entry cannot be reused as the current open-cycle entry',()=>{const p=report();p.results=[{id:'exit-result',asset:p.positions[0].asset,entry_fill_id:p.positions[0].entry_fill_id,exit_fill_id:'exit-missing',closed_at:p.heartbeat_at,status:'settled',pnl_base:10,net_r:1}];const r=view(p).rows[0];assert.equal(r.entry,null);assert.equal(r.estimatedNet,null);});

test('contradictory unrealised scalar is withheld without changing baseline portfolio readers',()=>{const p=report(),portfolio=readPortfolioSnapshot(p,true,now);for(const pnl of [1000000,0,-1000000]){p.account.unrealized_pnl=pnl;assert.equal(view(p).unrealised,null);assert.deepEqual(readPortfolioSnapshot(p,true,now),portfolio);}});
test('current whole-account unrealised reconciles all supported inventory cost bases',()=>{const p=native(),n=p.native_paper;n.valuation_at=n.observed_at;n.valuation_complete=true;n.positions[0].mark_base=210;n.legacy_mark_base=p.account.equity-p.account.cash;p.account.equity+=210;p.account.unrealized_pnl+=10;p.account.valuation_scope='combined_native_v1';assert.equal(view(p).unrealised,p.account.unrealized_pnl);p.account.unrealized_pnl+=1;assert.equal(view(p).unrealised,null);});
test('native pending quotes with unexposed cost basis cannot assert whole-account unrealised P&L',()=>{const p=native(),n=p.native_paper;n.valuation_at=n.observed_at;n.valuation_complete=true;n.positions[0].mark_base=210;n.legacy_mark_base=p.account.equity-p.account.cash;n.pending_quote_balances=[{agent_id:'binance',currency:'USDT',amount:1,mark_base:1.5}];p.account.equity+=211.5;p.account.unrealized_pnl+=11.5;p.account.valuation_scope='combined_native_v1';assert.equal(readPortfolioSnapshot(p,true,now).valuationCurrent,true);assert.equal(view(p).unrealised,null);});
test('FX reference cannot postdate its own retrieval even when both precede report time',()=>{const p=report();p.account.fx_at='2026-10-09T05:30:00.000Z';p.account.fx_retrieved_at='2026-10-09T05:00:00.000Z';p.account.fx_rate_date='2026-10-09';const v=view(p);assert.ok(v.rows.every(x=>x.estimatedNet===null));assert.equal(v.unrealised,null);});

test('ambiguous numeric/string pending IDs are suppressed instead of sharing one rendered key',()=>{const p=pending();p.decisions[0].id=1;p.decisions.push({...p.decisions[0],id:'1',price:105});assert.equal(view(p).rows.length,0);p.decisions.reverse();assert.equal(view(p).rows.length,0);});
test('historical entry FX with inverted retrieval chronology cannot support an entry net estimate',()=>{const p=report(),f=p.fills.find(f=>f.id===p.positions[0].entry_fill_id);f.fx_at='2026-10-09T05:30:00.000Z';f.fx_retrieved_at='2026-10-09T05:00:00.000Z';f.fx_rate_date='2026-10-09';const row=view(p).rows[0];assert.equal(row.entry,null);assert.equal(row.estimatedNet,null);});
test('historical inverted FX chronology withholds realised profit for entry or settlement',()=>{for(const stage of ['entry','settlement']){const {p,at}=closed(),records=stage==='entry'?p.fills.filter(f=>f.side==='buy'):p.settlements;for(const f of records){f.fx_at='2026-10-09T05:30:00.000Z';f.fx_retrieved_at='2026-10-09T05:00:00.000Z';f.fx_rate_date='2026-10-09';}assert.ok(paperTradePlanView({report:p,connected:true,now:at}).closed.every(r=>r.net===null));}});

test('forged cost basis cannot balance a forged unrealised value against a contradictory entry receipt',()=>{const p=report();p.positions[0].cost_base-=100;p.account.unrealized_pnl+=100;const v=view(p);assert.equal(v.unrealised,null);assert.equal(v.rows[0].estimatedNet,null);});
test('aged-out entry receipt withholds the new unrealised line without changing marked portfolio',()=>{const p=report(),portfolio=readPortfolioSnapshot(p,true,now);p.fills=p.fills.filter(x=>x.id!==p.positions[0].entry_fill_id);assert.equal(view(p).unrealised,null);assert.deepEqual(readPortfolioSnapshot(p,true,now),portfolio);});
