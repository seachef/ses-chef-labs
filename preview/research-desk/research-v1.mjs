// Optional read-only adapter. Call after the authoritative v2 status validator.
// A malformed/missing research extension returns null; never blocks core account UI.
const ASSETS=['ETH/USD','SOL/USD','AVAX/USD','LINK/USD','AAVE/USD','UNI/USD'];
const IDS=['scout','depth','pulse','shield','ledger','watch'];
const SOURCES=['verified_public_catalogue_snapshot','existing_paper_engine_decision','existing_paper_engine_decision','existing_paper_engine_risk','existing_paper_engine_fill','existing_paper_engine_status'];
const SNAPSHOT='2026-10-09T11:38:56Z';
const HASH='6cbc44ed9997bb4866d1c4a81bf89d1b94d20d65424bb7eb535b932c2174b20b';
const URL='https://api.kraken.com/0/public/AssetPairs?assetVersion=1';
const COUNTS={listed_pairs:1460,online_usd_pairs:633,research_markets:610,sizing_supported:180,excluded:7,cashlike_removed:16};
const REASONS=new Set(['missing_or_stale_fx','missing_book','stale_book','invalid_depth','crossed_book','missing_or_stale_metadata','missing_completed_bars','invalid_completed_bars','stale_completed_bars','missing_volume','missing_or_malformed_trade','stale_last_trade','spread_too_wide','volume_below_threshold','insufficient_near_depth','insufficient_exit_depth','stale_account_mark','post_exit_cooldown','warmup_no_historical_replay','entry_expired_or_invalidated','awaiting_later_observation','entry_risk_cost_or_depth_gate','later_observation_entry','no_new_completed_bar','completed_15m_momentum','no_qualified_momentum','trailing_stop_raised','position_within_plan','net_r_target','protective_stop','daily_drawdown','total_drawdown','drawdown_limit','storage_entry_limit','entry_risk_paused','stopped','unclassified_engine_reason','no_recorded_decision','broad_live_screen_not_connected','no_recorded_gate_result','no_valid_report_time','entry_risk_latch_paused','entry_risk_latch_not_paused','risk_state_unavailable','no_recorded_fill','recorded_paper_buy','recorded_paper_sell','reported_engine_health']);
const STATUSES=new Set(['snapshot_only','waiting','blocked','no_trade','pending','filled','monitoring','not_observed','paused','not_paused','configuration_pending','stopped','warming_up','running','data_missing','data_stale','risk_paused','capacity_paused']);
const stamp=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const optional=(v,test)=>v===null||v===undefined||test(v);
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
export function readResearchV1(report){
 try{
  const p=report?.research_v1;if(!object(p)||p.version!==1||p.mode!=='deterministic_checks'||!stamp(p.projection_at))return null;
  const at=Date.parse(p.projection_at),time=v=>stamp(v)&&Date.parse(v)<=at;
  const c=p.catalogue,e=p.execution;if(!object(c)||!object(e)||c.scope!=='Kraken international spot USD'||c.observed_at!==SNAPSHOT||Date.parse(SNAPSHOT)>at||c.source_sha256!==HASH||c.source_url!==URL||c.status!=='snapshot_only'||c.live_screen_status!=='not_connected'||c.last_attempt_status!=='network_access_denied'||Object.entries(COUNTS).some(([k,v])=>c[k]!==v)||e.expanded!==false||!Array.isArray(e.universe)||e.universe.length!==6||!e.universe.every((x,i)=>x===ASSETS[i]))return null;
  if(!Array.isArray(p.checks)||p.checks.length!==6||!p.checks.every((x,i)=>object(x)&&x.asset===ASSETS[i]&&optional(x.at,time)&&optional(x.decision_id,id)&&optional(x.observation_id,id)&&optional(x.action,v=>['buy','sell','hold'].includes(v))&&optional(x.result,v=>['pending','filled','cancelled','no_trade','blocked','trailing_updated'].includes(v))&&REASONS.has(x.reason)&&['data','liquidity','momentum','risk','position','execution','unclassified'].includes(x.reported_gate)&&['blocked','no_trade','pending','filled','monitoring','not_observed'].includes(x.verdict)&&x.source==='existing_paper_engine'&&x.project_quality==='unreviewed'&&x.unlock_risk==='unknown'))return null;
  if(!Array.isArray(p.streams)||p.streams.length!==6||!p.streams.every((x,i)=>object(x)&&x.id===IDS[i]&&x.source===SOURCES[i]&&optional(x.at,time)&&STATUSES.has(x.status)&&REASONS.has(x.reason)&&optional(x.asset,v=>ASSETS.includes(v))&&optional(x.decision_id,id)&&optional(x.fill_id,id)))return null;
  const scout=p.streams[0];if(scout.at!==SNAPSHOT||scout.status!=='snapshot_only'||scout.reason!=='broad_live_screen_not_connected')return null;
  for(const x of p.checks){if(x.verdict!=='not_observed'&&(!time(x.at)||!id(x.decision_id)||!id(x.observation_id)))return null;}
  for(const x of p.streams){if(!['waiting','not_observed'].includes(x.status)&&!time(x.at))return null;}
  // Recompute the exact projection from already-validated authoritative evidence.
  // A linked decision is not enough: its gate/verdict and each stream must agree too.
  const gateReasons={data:['missing_or_stale_fx','missing_book','stale_book','invalid_depth','crossed_book','missing_or_stale_metadata','missing_completed_bars','invalid_completed_bars','stale_completed_bars','missing_volume','missing_or_malformed_trade','stale_last_trade'],liquidity:['spread_too_wide','volume_below_threshold','insufficient_near_depth','insufficient_exit_depth'],momentum:['warmup_no_historical_replay','no_new_completed_bar','completed_15m_momentum','no_qualified_momentum'],risk:['entry_risk_cost_or_depth_gate','stale_account_mark','daily_drawdown','total_drawdown','drawdown_limit','storage_entry_limit','entry_risk_paused'],position:['trailing_stop_raised','position_within_plan','net_r_target','protective_stop','post_exit_cooldown'],execution:['entry_expired_or_invalidated','awaiting_later_observation','later_observation_entry']};
  const engineReasons=new Set([...Object.values(gateReasons).flat(),'stopped']);
  const newest=arr=>[...arr].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||(a.id===b.id?0:a.id<b.id?1:-1))[0];
  const expectedChecks=ASSETS.map(asset=>{
   const d=newest((report.decisions??[]).filter(d=>d.asset===asset&&time(d.at)&&id(d.id)&&id(d.observation_id)&&['buy','sell','hold'].includes(d.action)&&['pending','filled','cancelled','no_trade','blocked','trailing_updated'].includes(d.result)));
   if(!d)return {asset,decision_id:null,observation_id:null,at:null,action:null,result:null,reason:'no_recorded_decision',reported_gate:'unclassified',verdict:'not_observed'};
   const known=engineReasons.has(d.reason),reason=known?d.reason:'unclassified_engine_reason';
   const gate=Object.entries(gateReasons).find(([,rs])=>rs.includes(reason))?.[0]??'unclassified';
   const verdict=!known?'not_observed':d.result==='filled'?'filled':d.result==='pending'?'pending':['cancelled','blocked'].includes(d.result)?'blocked':d.result==='trailing_updated'||['trailing_stop_raised','position_within_plan','awaiting_later_observation'].includes(reason)?'monitoring':'no_trade';
   return {asset,decision_id:d.id,observation_id:d.observation_id,at:d.at,action:d.action,result:d.result,reason,reported_gate:gate,verdict};
  });
  const matches=(actual,expected)=>Object.entries(expected).every(([key,value])=>key==='at'&&value!==null?stamp(actual[key])&&Date.parse(actual[key])===Date.parse(value):actual[key]===value);
  if(!expectedChecks.every((x,i)=>matches(p.checks[i],x)))return null;
  const expectedStreams=[{id:'scout',at:SNAPSHOT,status:'snapshot_only',reason:'broad_live_screen_not_connected'}];
  for(const [name,gate] of [['depth','liquidity'],['pulse','momentum']]){const d=newest(expectedChecks.filter(x=>x.reported_gate===gate&&x.at).map(x=>({...x,id:x.decision_id})));expectedStreams.push({id:name,at:d?.at??null,status:d?.verdict??'waiting',reason:d?.reason??'no_recorded_gate_result',asset:d?.asset??null,decision_id:d?.decision_id??null});}
  const heartbeat=time(report.heartbeat_at)?report.heartbeat_at:null,paused=report.risk?.entry_paused;
  expectedStreams.push({id:'shield',at:heartbeat,status:heartbeat===null?'waiting':paused===true?'paused':paused===false?'not_paused':'waiting',reason:heartbeat===null?'no_valid_report_time':paused===true?'entry_risk_latch_paused':paused===false?'entry_risk_latch_not_paused':'risk_state_unavailable'});
  const fill=newest((report.fills??[]).filter(f=>ASSETS.includes(f.asset)&&['buy','sell'].includes(f.side)&&id(f.id)&&time(f.at)));
  expectedStreams.push({id:'ledger',at:fill?.at??null,status:fill?'filled':'waiting',reason:fill?'recorded_paper_'+fill.side:'no_recorded_fill',asset:fill?.asset??null,fill_id:fill?.id??null});
  const engineStates=['configuration_pending','stopped','warming_up','running','data_missing','data_stale','risk_paused','capacity_paused'];
  expectedStreams.push({id:'watch',at:heartbeat,status:heartbeat!==null&&engineStates.includes(report.status)?report.status:'waiting',reason:'reported_engine_health'});
  if(!expectedStreams.every((x,i)=>matches(p.streams[i],x)))return null;
  return {version:1,mode:p.mode,projection_at:p.projection_at,catalogue:pick(c,['scope','observed_at',...Object.keys(COUNTS),'status','live_screen_status','last_attempt_status','source_url','source_sha256']),execution:{universe:[...ASSETS],expanded:false},checks:p.checks.map(x=>pick(x,['asset','decision_id','observation_id','at','action','result','reason','reported_gate','verdict','source','project_quality','unlock_risk'])),streams:expectedStreams.map((x,i)=>({...x,source:SOURCES[i]}))};
 }catch{return null;}
}
