// Versioned public audit classification. This module never writes or estimates a fill.
export const EXPERIMENT_METHOD='market_paper_experiment_v1';
export const EXPERIMENT_FIELDS=Object.freeze(['context_scope','schema_version','id','at','experiment_id','entry_method','asset','venue','event','record_kind','record_id','entry_order_id','entry_fill_id','exit_order_id','exit_fill_id','decision_id','observation_id','experiment_source_hash','experiment_config_hash','strategy_edge_evidence','started_at','expires_at','max_intents','action','reason','result','stop','target','invalidation','observed_at','completed_bar_close_at','signal_close','prior20_high','structural_low','atr','signal_volume','mean_volume','bid','ask','spread','trend_assessment','independent_strategy_review','normalized_bars_sha256']);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),id=x=>typeof x==='string'&&x.length>0&&x.length<=128,time=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===x.slice(0,10);
const experimentId=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(x);
const eventKinds={requested:'market_experiments',stopped:'market_experiment_stops',intent:'orders',entry_fill:'fills',closed_result:'results',settlement:'settlements',exit_intent:'orders',exit_fill:'fills',observation:'decisions'};
export function validateExperimentEvent(row){
 const fail=()=>{throw Error('Invalid experiment audit event');};
 const p=row?.payload;if(!row||row.kind!=='experiment_events'||!Number.isSafeInteger(row.seq)||row.seq<=0||!p||typeof p!=='object'||Array.isArray(p)||!hash(row.source_hash)||!hash(row.config_hash)||!time(row.at)||!time(p.at)||Date.parse(row.at)!==Date.parse(p.at))return fail();
 if(Object.entries(p).some(([k,v])=>!EXPERIMENT_FIELDS.includes(k)||v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='string'&&v.length>1000||typeof v==='number'&&!Number.isFinite(v)))return fail();
 if(p.schema_version!==1||!experimentId(p.experiment_id)||p.entry_method!==EXPERIMENT_METHOD||p.asset!=='ETH/USD'||p.venue!=='Kraken'||p.strategy_edge_evidence!==false||!Object.hasOwn(eventKinds,p.event)||eventKinds[p.event]!==p.record_kind||!id(p.record_id)||p.id!=='experiment:'+p.event+':'+p.record_id||row.id!==p.id||!hash(p.experiment_source_hash)||!hash(p.experiment_config_hash))return fail();
 for(const k of ['entry_order_id','entry_fill_id','exit_order_id','exit_fill_id','decision_id','observation_id'])if(p[k]!==null&&!id(p[k]))return fail();
 if(['requested','stopped'].includes(p.event)&&p.record_id!==p.experiment_id)return fail();
 if(p.event==='requested'&&(!time(p.started_at)||Date.parse(p.started_at)!==Date.parse(p.at)||!time(p.expires_at)||Date.parse(p.expires_at)<=Date.parse(p.started_at)||Date.parse(p.expires_at)-Date.parse(p.started_at)>7200000||!Number.isInteger(p.max_intents)||p.max_intents<1||p.max_intents>8))return fail();
 if(['intent','entry_fill','exit_intent','exit_fill','closed_result','settlement'].includes(p.event)&&(!id(p.entry_order_id)||!id(p.decision_id)||!id(p.observation_id)))return fail();
 if(p.event==='intent'&&p.entry_order_id!==p.record_id||p.event==='entry_fill'&&p.entry_fill_id!==p.record_id)return fail();
 if(['exit_intent','exit_fill','closed_result','settlement'].includes(p.event)&&(!id(p.entry_fill_id)||!id(p.exit_order_id)||p.event!=='exit_intent'&&!id(p.exit_fill_id)))return fail();
 if(p.event==='exit_intent'&&p.exit_order_id!==p.record_id||p.event==='exit_fill'&&p.exit_fill_id!==p.record_id)return fail();
 if(![null,'entry_order','position','observation_window'].includes(p.context_scope))return fail();
 if(p.event==='observation'&&p.context_scope===null||['requested','stopped'].includes(p.event)&&p.context_scope!==null||['intent','entry_fill'].includes(p.event)&&p.context_scope!=='entry_order'||['exit_intent','exit_fill','closed_result','settlement'].includes(p.event)&&p.context_scope!=='position')return fail();
 if(p.context_scope==='entry_order'&&!id(p.entry_order_id)||p.context_scope==='position'&&(!id(p.entry_order_id)||!id(p.entry_fill_id))||p.context_scope==='observation_window'&&['entry_order_id','entry_fill_id','exit_order_id','exit_fill_id'].some(k=>p[k]!==null))return fail();
 if(p.event==='observation'&&(p.decision_id!==p.record_id||!id(p.observation_id)||!['buy','sell','hold'].includes(p.action)||!id(p.reason)||!['pending','filled','cancelled','no_trade','blocked','trailing_updated'].includes(p.result)))return fail();
 if(['requested','intent','entry_fill'].includes(p.event)&&(row.source_hash!==p.experiment_source_hash||row.config_hash!==p.experiment_config_hash))return fail();
 if(p.event==='intent'){
  if(!time(p.observed_at)||Date.parse(p.observed_at)!==Date.parse(p.at)||!time(p.completed_bar_close_at)||Date.parse(p.completed_bar_close_at)>Date.parse(p.observed_at)||!hash(p.normalized_bars_sha256)||p.trend_assessment!=='unknown'||p.independent_strategy_review!=='not_performed')return fail();
  if(['stop','target','invalidation','signal_close','prior20_high','structural_low','atr','signal_volume','mean_volume','bid','ask'].some(k=>typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<=0)||typeof p.spread!=='number'||!Number.isFinite(p.spread)||p.spread<0||p.ask<p.bid||p.stop>=p.bid||p.target<=p.ask||p.invalidation!==p.stop)return fail();
 }
 return {seq:row.seq,kind:row.kind,id:row.id,at:row.at,payload:{...p},source_hash:row.source_hash,config_hash:row.config_hash};
}
const CLASS_FIELDS=['experiment_id','entry_method','experiment_source_hash','experiment_config_hash','experiment_entry_order_id','experiment_entry_fill_id'];
function agree(a,b){if(a.paper_classification!==b.paper_classification)throw Error('Conflicting linked paper classification');if(a.paper_classification==='experiment'&&CLASS_FIELDS.some(k=>a[k]!==b[k]))throw Error('Conflicting linked experiment provenance');}
export function validateExperimentProjection(report){
 if(!report||typeof report!=='object'||Array.isArray(report))throw Error('Experiment report unavailable');
 const groups=['fills','results','settlements','positions'],version=report.experiment_provenance_version;
 if(version!==undefined&&version!==1)throw Error('Unsupported experiment provenance version');
 for(const k of groups){if(report[k]!==undefined&&!Array.isArray(report[k]))throw Error('Invalid experiment records');for(const r of report[k]??[]){
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Invalid experiment record');
  const tagged=['paper_classification',...CLASS_FIELDS].some(x=>Object.hasOwn(r,x));
  if(version!==1){if(tagged)throw Error('Missing experiment provenance contract');continue;}
  if(!['strategy','experiment','unresolved'].includes(r.paper_classification))throw Error('Missing paper classification');
  if(r.paper_classification==='experiment'){
   if(!experimentId(r.experiment_id)||r.entry_method!==EXPERIMENT_METHOD||!hash(r.experiment_source_hash)||!hash(r.experiment_config_hash)||!id(r.experiment_entry_order_id)||!id(r.experiment_entry_fill_id)||r.asset!==undefined&&r.asset!=='ETH/USD'||r.venue!==undefined&&r.venue!=='Kraken')throw Error('Invalid experiment classification');
   if(k==='fills'&&r.side==='buy'&&(r.id!==r.experiment_entry_fill_id||r.order_id!==r.experiment_entry_order_id)||['positions','results'].includes(k)&&r.entry_fill_id!==r.experiment_entry_fill_id)throw Error('Conflicting experiment entry identity');
   if(k==='fills'&&r.side==='buy'&&(r.source_hash!==r.experiment_source_hash||r.config_hash!==r.experiment_config_hash))throw Error('Conflicting experiment entry source');
  }else if(CLASS_FIELDS.some(x=>Object.hasOwn(r,x)))throw Error('Conflicting experiment classification');
 }}
 const x=report.market_experiment,scope=report.experiment_projection_scope,experimental=!!x||groups.some(k=>(report[k]??[]).some(r=>r.paper_classification==='experiment'));
 if(experimental&&(!scope||!time(report.experiment_evaluated_at)))throw Error('Missing bounded experiment projection scope');
 if(scope!==undefined){
  if(version!==1||!scope||typeof scope!=='object'||Array.isArray(scope)||!time(report.experiment_evaluated_at))throw Error('Invalid experiment projection scope');
  for(const k of groups){const rows=report[k]??[],total=scope[k+'_total'],complete=scope[k+'_complete'];if(!Number.isSafeInteger(total)||total<rows.length||typeof complete!=='boolean'||complete!==(total===rows.length)||k==='positions'&&!complete)throw Error('Contradictory bounded projection scope');}
 }
 if(x!==undefined){
  if(version!==1||!x||x.version!==1||!experimentId(x.id)||x.asset!=='ETH/USD'||x.venue!=='Kraken'||x.entry_method!==EXPERIMENT_METHOD||x.account_scope!=='shared_existing_account'||x.strategy_edge_evidence!==false||!hash(x.source_hash)||!hash(x.config_hash)||!time(x.started_at)||!time(x.expires_at)||Date.parse(x.expires_at)<=Date.parse(x.started_at)||Date.parse(x.expires_at)-Date.parse(x.started_at)>7200000||!(x.stopped_at===null||time(x.stopped_at))||!Number.isSafeInteger(x.max_intents)||x.max_intents<1||x.max_intents>8||!Number.isSafeInteger(x.intents)||x.intents<0||x.intents>x.max_intents||!time(x.evaluated_at)||Date.parse(x.evaluated_at)!==Date.parse(report.experiment_evaluated_at))throw Error('Invalid experiment summary');
  const at=Date.parse(x.evaluated_at);if(Date.parse(x.started_at)>at||x.stopped_at!==null&&(Date.parse(x.stopped_at)<Date.parse(x.started_at)||Date.parse(x.stopped_at)>at))throw Error('Invalid experiment summary times');
  const expected=x.stopped_at!==null?'stop_requested':at>=Date.parse(x.expires_at)?'expired':x.intents>=x.max_intents?'intent_limit_reached':'active';if(x.state!==expected)throw Error('Contradictory experiment summary state');
 }
 if(version!==1)return report;
 const fills=new Map((report.fills??[]).map(f=>[f.id,f])),results=report.results??[];
 function link(r,key,kind,side){const target=fills.get(r[key]);if(target){agree(r,target);if(target.side!==side||r.asset!==undefined&&r.asset!==target.asset)throw Error('Invalid classified fill link');return target;}if(scope?.fills_complete||Number.isSafeInteger(report.account?.fills)&&report.account.fills===(report.fills??[]).length)throw Error('Classified fill link missing from complete projection');return null;}
 for(const k of groups)for(const r of report[k]??[]){
  if(r.paper_classification==='experiment'){
   if(x?.id===r.experiment_id&&(x.source_hash!==r.experiment_source_hash||x.config_hash!==r.experiment_config_hash))throw Error('Conflicting campaign source');
   const entry=fills.get(r.experiment_entry_fill_id);if(entry){agree(r,entry);if(entry.side!=='buy'||entry.order_id!==r.experiment_entry_order_id)throw Error('Invalid experiment entry link');}else if(scope?.fills_complete)throw Error('Experiment entry absent from complete fills');
  }
  if(k==='positions')link(r,'entry_fill_id',k,'buy');
  if(k==='results'){const a=link(r,'entry_fill_id',k,'buy'),b=link(r,'exit_fill_id',k,'sell');if(a&&b&&(Date.parse(a.at)>Date.parse(b.at)||Date.parse(b.at)!==Date.parse(r.closed_at)))throw Error('Invalid classified result times');}
  if(k==='settlements'){link(r,'exit_fill_id',k,'sell');for(const result of results.filter(x=>x.exit_fill_id===r.exit_fill_id))agree(r,result);}
 }
 return report;
}
// Cross-row audit validation is deliberately separate from shape validation. A
// page may have unresolved links; a complete frozen snapshot/CSV may not.
export function validateExperimentHistory(rows,{complete=false}={}){
 const records=new Map(rows.map(r=>[r.kind+':'+r.id,r])),events=rows.filter(r=>r.kind==='experiment_events').map(validateExperimentEvent),requests=new Map(),members=new Map();
 for(const e of events){const p=e.payload;if(p.event==='requested'){if(requests.has(p.experiment_id))throw Error('Duplicate experiment request');requests.set(p.experiment_id,p);}if(!['requested','stopped','observation'].includes(p.event)){const key=p.record_kind+':'+p.record_id,old=members.get(key);if(old&&old.experiment_id!==p.experiment_id)throw Error('Conflicting history membership');members.set(key,p);}}
 function requireRecord(kind,key){const row=records.get(kind+':'+key);if(!row&&complete)throw Error('Missing linked experiment history record');return row?.payload;}
 function member(kind,key,p){const linked=members.get(kind+':'+key);if(!linked&&complete)throw Error('Missing linked experiment event');if(linked&&(linked.experiment_id!==p.experiment_id||linked.experiment_source_hash!==p.experiment_source_hash||linked.experiment_config_hash!==p.experiment_config_hash||linked.entry_order_id!==p.entry_order_id||linked.entry_fill_id&&p.entry_fill_id&&linked.entry_fill_id!==p.entry_fill_id))throw Error('Conflicting linked history experiment');return linked;}
 for(const e of events){const p=e.payload,request=requests.get(p.experiment_id);if(!request){if(complete)throw Error('Missing experiment request event');}else{
   for(const k of ['experiment_source_hash','experiment_config_hash','asset','venue','entry_method'])if(p[k]!==request[k])throw Error('Changed experiment campaign identity');
   if(Date.parse(p.at)<Date.parse(request.started_at))throw Error('Experiment event precedes request');
  }
  if(['requested','stopped'].includes(p.event))continue;
  const source=requireRecord(p.record_kind,p.record_id),sourceRow=records.get(p.record_kind+':'+p.record_id);
  if(source){
   if(source.asset!==undefined&&source.asset!==p.asset)throw Error('Experiment source asset conflict');
   // Insert time is authoritative: a delayed-FX result retains its earlier close.
   if(Date.parse(sourceRow.at)!==Date.parse(p.at)||source.at!==undefined&&Date.parse(source.at)!==Date.parse(sourceRow.at))throw Error('Experiment source timestamp conflict');
   if(['source_hash','config_hash'].some(k=>sourceRow[k]!==e[k]))throw Error('Experiment source audit hash conflict');
   if(p.event==='closed_result'&&(!time(source.closed_at)||Date.parse(source.closed_at)>Date.parse(sourceRow.at)||source.settled_at!==undefined&&(source.status!=='settled'||!time(source.settled_at)||Date.parse(source.settled_at)<Date.parse(source.closed_at))||Date.parse(source.settled_at??source.closed_at)!==Date.parse(sourceRow.at)))throw Error('Experiment result lifecycle timestamp conflict');
   if(['intent','exit_intent','entry_fill','exit_fill'].includes(p.event)&&(source.decision_id!==p.decision_id||source.observation_id!==p.observation_id))throw Error('Experiment source observation conflict');
   if(['intent','entry_fill'].includes(p.event)&&source.side!=='buy'||['exit_intent','exit_fill'].includes(p.event)&&source.side!=='sell')throw Error('Experiment source side conflict');
   if(p.event==='entry_fill'&&source.order_id!==p.entry_order_id||p.event==='exit_fill'&&source.order_id!==p.exit_order_id)throw Error('Experiment source order conflict');
   if(p.event==='closed_result'&&(source.entry_fill_id!==p.entry_fill_id||source.exit_fill_id!==p.exit_fill_id)||p.event==='settlement'&&source.exit_fill_id!==p.exit_fill_id)throw Error('Experiment source result conflict');
   if(p.event==='observation'&&(source.id!==p.decision_id||source.observation_id!==p.observation_id||source.action!==p.action||source.reason!==p.reason||source.result!==p.result))throw Error('Experiment observation conflict');
  }
  if(p.entry_order_id){const o=requireRecord('orders',p.entry_order_id);member('orders',p.entry_order_id,p);if(o&&(o.side!=='buy'||o.asset!==p.asset))throw Error('Invalid experiment entry order');}
  if(p.entry_fill_id){const f=requireRecord('fills',p.entry_fill_id);member('fills',p.entry_fill_id,p);if(f&&(f.side!=='buy'||f.order_id!==p.entry_order_id||f.asset!==p.asset))throw Error('Invalid experiment entry fill');}
  if(p.exit_order_id){const o=requireRecord('orders',p.exit_order_id);member('orders',p.exit_order_id,p);if(o&&(o.side!=='sell'||o.asset!==p.asset||o.decision_id!==p.decision_id))throw Error('Invalid experiment exit order');}
  if(p.exit_fill_id){const f=requireRecord('fills',p.exit_fill_id);member('fills',p.exit_fill_id,p);if(f&&(f.side!=='sell'||f.order_id!==p.exit_order_id||f.asset!==p.asset||f.decision_id!==p.decision_id||f.observation_id!==p.observation_id))throw Error('Invalid experiment exit fill');
   if(f&&source&&(p.event==='closed_result'&&Date.parse(source.closed_at)!==Date.parse(f.at)||p.event==='settlement'&&(f.settlement_status!=='pending_conversion'||Date.parse(source.at)<Date.parse(f.at))))throw Error('Experiment exit lifecycle conflict');}
  if(p.decision_id){const d=requireRecord('decisions',p.decision_id);if(d&&(d.asset!==p.asset||['intent','exit_intent','observation'].includes(p.event)&&d.observation_id!==p.observation_id))throw Error('Invalid experiment decision link');}
 }
 return rows;
}
export function experimentRecordLabel(record){return record?.paper_classification==='experiment'&&experimentId(record.experiment_id)?'PAPER EXPERIMENT · '+record.experiment_id+' · ':record?.paper_classification==='unresolved'?'PAPER CLASSIFICATION UNRESOLVED · ':'';}
export function historyExperimentLabels(rows,{complete=false}={}){
 const labels=new Map();for(const row of rows)if(row.kind==='experiment_events'){const p=row.payload;if(!['requested','stopped','observation'].includes(p.event))labels.set(p.record_kind+':'+p.record_id,'PAPER EXPERIMENT · '+p.experiment_id+' · ');}
 return row=>labels.get(row.kind+':'+row.id)??(!complete&&['orders','fills','results','settlements'].includes(row.kind)?'PAPER CLASSIFICATION UNRESOLVED · ':'');
}
export function formatExperimentEvent(row){const p=validateExperimentEvent(row).payload;return `${p.at} · PAPER EXPERIMENT ${p.experiment_id} · ${p.asset} · ${p.event==='observation'&&p.context_scope==='observation_window'?'contextual window observation (not trade membership)':p.event.replaceAll('_',' ')} · ${p.reason??p.record_id} · shared paper account; unvalidated hypothesis`;}
export function ordinaryProfitEligible(report,...records){try{validateExperimentProjection(report);}catch{return false;}return report.experiment_provenance_version===1&&records.every(r=>r?.paper_classification==='strategy');}
