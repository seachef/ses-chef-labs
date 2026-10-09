import fs from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {perthDay,readDailyPerformance} from './daily-performance.mjs';
const now=Date.parse('2026-10-09T18:00:00Z'),at=new Date(now).toISOString(),baseline='2026-10-09T16:01:00Z';
function report(){return {currency:'AUD',heartbeat_at:at,quote_at:at,account:{equity:10025,valuation_at:at},daily_performance:{status:'available',timezone:'Australia/Perth',day:'2026-10-10',coverage:'since_first_observation',baseline_at:baseline,baseline_equity:10000,net_external_flows:0,current_equity:10025,observed_at:at,net_pnl:25,pct:.25,source_revision:3}};}
test('Perth calendar crosses midnight at16UTC rather than UTC risk day',()=>{assert.equal(perthDay('2026-10-09T15:59:59Z'),'2026-10-09');assert.equal(perthDay('2026-10-09T16:00:00Z'),'2026-10-10');});
test('server-persisted observed-day baseline produces positive and negative results',()=>{const p=report(),r=readDailyPerformance(p,true,now);assert.equal(r.available,true);assert.equal(r.pnl,25);assert.equal(r.pct,.25);assert.equal(r.since,'00:01');p.account.equity=p.daily_performance.current_equity=9975;p.daily_performance.net_pnl=-25;p.daily_performance.pct=-.25;assert.equal(readDailyPerformance(p,true,now).pnl,-25);});
test('external virtual deposits and withdrawals do not masquerade as profit',()=>{for(const flow of [1000,-1000]){const p=report();p.daily_performance.net_external_flows=flow;p.account.equity=p.daily_performance.current_equity=10025+flow;const r=readDailyPerformance(p,true,now);assert.equal(r.available,true);assert.equal(r.pnl,25);assert.equal(r.pct,.25);}});
test('no baseline, explicit unavailable or disconnect remains unavailable instead of0',()=>{for(const p of [null,{}, {daily_performance:{status:'unavailable'}}])assert.equal(readDailyPerformance(p,true,now).available,false);assert.equal(readDailyPerformance(report(),false,now).available,false);});
const cases={
 'UTC baseline':p=>p.daily_performance.timezone='UTC',
 'previous Perth day':p=>p.daily_performance.day='2026-10-09',
 'midnight claim':p=>p.daily_performance.coverage='full_day',
 'previous-day observation':p=>p.daily_performance.baseline_at='2026-10-09T15:59:59Z',
 'future baseline':p=>p.daily_performance.baseline_at='2026-10-09T18:01:00Z',
 'future projection':p=>p.daily_performance.observed_at='2026-10-09T18:01:00Z',
 'old projection':p=>p.daily_performance.observed_at='2026-10-09T17:58:00Z',
 'old quote':p=>p.quote_at='2026-10-09T17:58:00Z',
 'missing valuation':p=>p.account.valuation_at=null,
 'old heartbeat':p=>p.heartbeat_at='2026-10-09T17:58:00Z',
 'unknown cash flows':p=>p.daily_performance.net_external_flows=null,
 'deposit incorrectly counted':p=>{p.account.equity=p.daily_performance.current_equity=11025;p.daily_performance.net_external_flows=1000;p.daily_performance.net_pnl=1025;p.daily_performance.pct=10.25;},
 'root equity mismatch':p=>p.account.equity=9999,
 'wrong percentage':p=>p.daily_performance.pct=25,
 'zero baseline':p=>p.daily_performance.baseline_equity=0,
 'wrong currency':p=>p.currency='USD',
 'nonfinite return':p=>p.daily_performance.net_pnl=Infinity,
 'numeric strings':p=>p.daily_performance.current_equity='10025',
 'bad revision':p=>p.daily_performance.source_revision=-1,
};for(const [name,mutate]of Object.entries(cases))test('rejects '+name,()=>{const p=report();mutate(p);assert.equal(readDailyPerformance(p,true,now).available,false);});
test('opening app again never changes authoritative baseline or return',()=>{const p=report(),a=readDailyPerformance(p,true,now),b=readDailyPerformance(p,true,now+1000);assert.equal(a.baselineAt,b.baselineAt);assert.equal(a.pnl,b.pnl);assert.equal(a.pct,b.pct);});

for(const [name,expected]of [['available',true],['unavailable',false]])test('actual SQL '+name+' daily projection interoperates',()=>{const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/daily-'+name+'-sql.json',import.meta.url))),p=report();p.daily_performance=fixture;p.account.equity=fixture.current_equity;p.account.valuation_at=p.heartbeat_at=p.quote_at=fixture.observed_at;const r=readDailyPerformance(p,true,Date.parse(fixture.observed_at)+1000);assert.equal(r.available,expected);if(expected){assert.equal(r.pnl,250);assert.equal(r.pct,2.5);}});
