import { leadSchema, reviewSchema } from './schema.mjs';

export const LIMITS=Object.freeze({input_bytes:32768,batch_bytes:131072,batch_leads:4,evidence:9,checks:16,reviews:8,depth:12,nodes:1500,ttl_ms:180000,metadata_age_ms:3600000});
const REQUIRED_CHECKS=Object.freeze(['coarse_screen','exact_identity','depth','completed_candles','latest_trade','momentum','sizing_rules','venue_restrictions']);
const CHECK_EVIDENCE=Object.freeze({coarse_screen:['metadata','metrics'],exact_identity:['metadata'],depth:['depth'],completed_candles:['candles'],latest_trade:['trades'],momentum:['candles'],sizing_rules:['rules'],venue_restrictions:['rules']});
const ECONOMICS=Object.freeze(['fee_bps_per_side','spread_bps','slippage_bps','fx_to_usd','fx_usd_to_aud','network_cost_quote']);
const encoder=new TextEncoder();
class Invalid extends Error { constructor(code) { super(code); this.code=code; } }
const fail=code=>{throw new Invalid(code);};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[null,Object.prototype].includes(Object.getPrototypeOf(x));

// JSON-only validation, without invoking getters/toJSON or traversing unbounded objects.
function boundedObject(value, budget=LIMITS) {
 let nodes=0,bytes=0;const seen=new Set();
 function visit(x,depth=0) {
  if (++nodes>budget.nodes||depth>budget.depth) fail('payload_budget_exceeded');
  if (x===null||typeof x==='boolean')return;
  if(typeof x==='string'){bytes+=encoder.encode(x).length;if(bytes>budget.input_bytes)fail('payload_budget_exceeded');return;}
  if(typeof x==='number'){if(!Number.isSafeInteger(x))fail('unsafe_numeric_value');return;}
  if(typeof x!=='object'||seen.has(x)||(!Array.isArray(x)&&!plain(x)))fail('not_plain_json');
  seen.add(x);
  if(Array.isArray(x)){if(x.length>32)fail('payload_budget_exceeded');if(Object.keys(x).length!==x.length||Object.keys(x).some((k,i)=>k!==String(i)))fail('not_plain_json');}
  const descriptors=Object.getOwnPropertyDescriptors(x);if(Reflect.ownKeys(descriptors).length>48)fail('payload_budget_exceeded');
  for(const [key,d] of Object.entries(descriptors)){
   if(Array.isArray(x)&&key==='length')continue;
   if(!('value' in d)||!d.enumerable)fail('not_plain_json');
   if(['__proto__','prototype','constructor'].includes(key))fail('unsafe_property');
   bytes+=encoder.encode(key).length;visit(d.value,depth+1);
  }
  if(Object.getOwnPropertySymbols(x).length)fail('not_plain_json');
  seen.delete(x);
 }
 visit(value);return value;
}

// Parse once, with duplicate-key detection before object construction can erase a conflict.
export function parseLeadJson(raw) {return parseBoundedJson(raw,LIMITS);}
export function parseBoundedJson(raw,budget=LIMITS) {
 if(typeof raw!=='string'||encoder.encode(raw).length>budget.input_bytes)fail('payload_budget_exceeded');
 let p=0,nodes=0;const ws=()=>{while(/[ \n\r\t]/.test(raw[p]??'x'))p++;};
 function string(){const start=p++;while(p<raw.length){if(raw[p]==='\\'){p+=2;continue;}if(raw[p++]==='"'){try{return JSON.parse(raw.slice(start,p));}catch{fail('invalid_json');}}}fail('invalid_json');}
 function value(depth=0){
  if(++nodes>budget.nodes||depth>budget.depth)fail('payload_budget_exceeded');ws();const c=raw[p];
  if(c==='"')return string();
  if(c==='{'||c==='['){const isObject=c==='{' ;p++;ws();const out=isObject?Object.create(null):[];const keys=new Set();if(raw[p]===(isObject?'}':']')){p++;return out;}
   while(p<raw.length){ws();let key;if(isObject){if(raw[p]!=='"')fail('invalid_json');key=string();if(keys.has(key))fail('duplicate_json_key');keys.add(key);ws();if(raw[p++]!==':')fail('invalid_json');}const v=value(depth+1);if(isObject)out[key]=v;else out.push(v);ws();const end=raw[p++];if(end===(isObject?'}':']'))return out;if(end!==',')fail('invalid_json');}fail('invalid_json');}
  const m=raw.slice(p).match(/^(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!m)fail('invalid_json');p+=m[0].length;return JSON.parse(m[0]);
 }
 const result=value();ws();if(p!==raw.length)fail('invalid_json');return boundedObject(result,budget);
}
export function validateSchema(x,s,path='payload'){
 if(s.anyOf){for(const option of s.anyOf){try{validateSchema(x,option,path);return;}catch{}}fail('schema_invalid:'+path);}
 if('const' in s&&x!==s.const)fail('schema_invalid:'+path);
 if(s.enum&&!s.enum.includes(x))fail('schema_invalid:'+path);
 if(s.type==='boolean'&&typeof x!=='boolean')fail('schema_invalid:'+path);
 if(s.type==='integer'&&(!Number.isSafeInteger(x)||x<(s.minimum??-Infinity)||x>(s.maximum??Infinity)))fail('schema_invalid:'+path);
 if(s.type==='null'&&x!==null)fail('schema_invalid:'+path);
 if(s.type==='string'&&(typeof x!=='string'||x.length<(s.minLength??0)||x.length>(s.maxLength??Infinity)||(s.pattern&&!new RegExp(s.pattern).test(x))))fail('schema_invalid:'+path);
 if(s.type==='object'){
  if(!plain(x))fail('schema_invalid:'+path);
  for(const k of Object.keys(x))if(!Object.hasOwn(s.properties,k))fail('schema_invalid:'+path+'.'+k);
  for(const k of s.required)if(!Object.hasOwn(x,k))fail('schema_invalid:'+path+'.'+k);
  for(const [k,v]of Object.entries(x))validateSchema(v,s.properties[k],path+'.'+k);
 }
 if(s.type==='array'){if(!Array.isArray(x)||x.length>s.maxItems)fail('schema_invalid:'+path);x.forEach((v,i)=>validateSchema(v,s.items,path+'['+i+']'));}
}
function timestamp(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(s))fail('invalid_timestamp');
 const value=Date.parse(s);if(!Number.isFinite(value)||new Date(value).toISOString().slice(0,19)!==s.slice(0,19))fail('invalid_timestamp');return value;
}
export function canonicalJson(x,budget=LIMITS){boundedObject(x,budget);return canonical(x);}
function canonical(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return'['+x.map(canonical).join(',')+']';return'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
export async function payloadDigest(x,budget=LIMITS){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(canonicalJson(x,budget))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function identityKey(identity){validateSchema(identity,leadSchema.properties.identity,'identity');return [identity.venue,identity.asset_namespace,identity.instrument_id,identity.base_id,identity.quote_id,identity.base_symbol,identity.quote_symbol,identity.base_representation,identity.quote_representation].join('|');}
function same(a,b){return canonical(a)===canonical(b);}
function distinct(items,key,code){const seen=new Set();for(const item of items){const k=key(item);if(seen.has(k))fail(code);seen.add(k);}return seen;}
function actor(a){if((a.actor_type==='model')!==(a.model!==null))fail('actor_model_mismatch');}
function identity(i){
 if(i.pair!==i.base_symbol+'/'+i.quote_symbol)fail('pair_identity_mismatch');
 if(i.venue==='kraken'){
  if(i.asset_namespace!=='kraken_asset'||i.quote_symbol!=='USD'||i.quote_id!=='USD'||i.base_id!==i.base_symbol||i.instrument_id!==i.pair||i.base_representation!=='venue_asset'||i.quote_representation!=='fiat')fail('kraken_identity_mismatch');
 }else{
  if(i.asset_namespace!=='hyperliquid_token'||i.quote_symbol!=='USDC'||i.quote_representation!=='stablecoin'||!/^0x[0-9a-f]{32}$/.test(i.base_id)||i.quote_id!=='0x6d1e7cde53ba9467b783cb7c530ce054'||!(/^@\d{1,6}$/.test(i.instrument_id)||i.instrument_id==='PURR/USDC'))fail('hyperliquid_identity_mismatch');
 }
}
function defaultResult(code){return{protocol:'neptune-lead-assessment-v1',status:'rejected',lead_id:null,identity:null,identity_key:null,finder:{actor_type:'unknown',display_name:'Unknown finder'},checker:{actor_type:'unknown',display_name:'Unknown checker'},discovered_at:null,snapshot_observed_at:null,expires_at:null,evidence_sha256:null,evidence:[],deterministic_checks:[],independent_review:{status:'not_reviewed',reviews:[]},economics:null,metrics:null,scenario:null,unknowns:[],checks_remaining:['trusted_evidence_required'],reject_reasons:[code],execution_eligible:false,paper_entry_allowed:false,qualified_buy:false};}

/**
 * Pure assessment of one public lead. trustedContext MUST come from the authenticated
 * producer/transport and review store, never JSON supplied alongside the lead by a client.
 * A digest proves binding to that trusted record, not provider truth or investment merit.
 * This function neither fetches sources nor starts, approves or writes paper/live trades.
 */
export async function assessLead(input,trustedContext){
 let lead,digest,key,now,trust;
 try{
  lead=typeof input==='string'?parseLeadJson(input):boundedObject(input);validateSchema(lead,leadSchema);identity(lead.identity);actor(lead.finder);actor(lead.checker);
  if(lead.checker.actor_type!=='deterministic')fail('checker_must_be_deterministic');
  if(lead.lead_id!==lead.identity.venue+':'+lead.identity.instrument_id)fail('lead_identity_mismatch');
  if(!plain(trustedContext)||!Number.isSafeInteger(trustedContext.now_ms))fail('trusted_context_required');
  now=trustedContext.now_ms;trust=trustedContext.record;
  if(!plain(trust))fail('trusted_record_required');
  // Validate bounded independently supplied provenance too; never execute getters.
  boundedObject(trust);validateSchema(trust.finder,leadSchema.properties.finder,'trusted_finder');validateSchema(trust.checker,leadSchema.properties.checker,'trusted_checker');
  if(lead.epoch_id!==trustedContext.expected_epoch_id||lead.epoch_id!==trust.epoch_id)fail('epoch_mismatch');
  if(lead.lead_id!==trust.lead_id)fail('trusted_identity_mismatch');
  if(!same(lead.finder,trust.finder)||!same(lead.checker,trust.checker))fail('actor_provenance_mismatch');
  digest=await payloadDigest(lead);if(digest!==trust.evidence_sha256)fail('untrusted_evidence_digest');
  key=identityKey(lead.identity);if(trust.identity_key!==key)fail('trusted_identity_mismatch');
  if(trustedContext.seen_digests!==undefined){if(!Array.isArray(trustedContext.seen_digests)||trustedContext.seen_digests.length>64)fail('replay_registry_budget_exceeded');if(trustedContext.seen_digests.includes(digest))fail('replayed_evidence');}
 }catch(e){return defaultResult(e instanceof Invalid?e.code:'invalid_payload');}
 const out={protocol:'neptune-lead-assessment-v1',status:'detail_pending',lead_id:lead.lead_id,identity:structuredClone(lead.identity),identity_key:key,finder:structuredClone(lead.finder),checker:structuredClone(lead.checker),discovered_at:lead.discovered_at,snapshot_observed_at:lead.snapshot_observed_at,expires_at:lead.expires_at,evidence_sha256:digest,evidence:structuredClone(lead.evidence),deterministic_checks:structuredClone(lead.deterministic_checks),independent_review:{status:'not_reviewed',reviews:[]},economics:structuredClone(lead.economics),metrics:structuredClone(lead.metrics),scenario:structuredClone(lead.scenario),unknowns:[],checks_remaining:[],reject_reasons:[],execution_eligible:false,paper_entry_allowed:false,qualified_buy:false};
 const reject=code=>{if(!out.reject_reasons.includes(code))out.reject_reasons.push(code);};const missing=code=>{if(!out.checks_remaining.includes(code))out.checks_remaining.push(code);};
 try{
  const discovered=timestamp(lead.discovered_at),found=timestamp(lead.snapshot_observed_at),expiry=timestamp(lead.expires_at);
  if(discovered>now||found>now||expiry-found>LIMITS.ttl_ms)fail('invalid_lead_window');
  if(now>=expiry){out.status='expired';reject('lead_expired');}
  const priceBounds=lead.evidence.filter(e=>e.kind!=='metadata').map(e=>timestamp(e.sample_lower_bound));if(priceBounds.length&&expiry<=Math.min(...priceBounds))fail('invalid_lead_window');
  const evidenceIds=distinct(lead.evidence,x=>x.evidence_id,'duplicate_evidence');distinct(lead.evidence,x=>x.kind,'duplicate_evidence_kind');
  distinct(lead.deterministic_checks,x=>x.check_id,'duplicate_check');distinct(lead.screen_config.parameters,x=>x.name,'duplicate_screen_parameter');
  const byEvidence=new Map(lead.evidence.map(e=>[e.evidence_id,e]));let newest=-Infinity;
  for(const e of lead.evidence){
   const observed=timestamp(e.observed_at),lower=timestamp(e.sample_lower_bound);newest=Math.max(newest,observed);
   if(lower>observed)fail('sample_bound_after_observation');
   if(e.observation_basis==='response_received'){if(e.wire_received_at!==e.observed_at)fail('wire_timestamp_mismatch');}
   else if(e.wire_received_at!==null)fail('invented_wire_timestamp');
   if(observed>found||observed>now)fail('evidence_timestamp_mismatch');
   const maxAge=e.kind==='metadata'?LIMITS.metadata_age_ms:LIMITS.ttl_ms;
   if(found-lower>maxAge||now-lower>maxAge)reject('stale_'+e.kind+'_evidence');
   if(e.kind!=='metadata'&&expiry>lower+LIMITS.ttl_ms)fail('expiry_exceeds_source_window');
   if((e.request_id===null)!==(e.request_started_at===null))fail('request_provenance_mismatch');
   if(e.request_started_at===null)missing('request_provenance:'+e.kind);
   else if(timestamp(e.request_started_at)>observed||timestamp(e.request_started_at)<lower)fail('request_time_outside_source_window');
   if(e.event_at!==null){const event=timestamp(e.event_at);if(event>observed)fail('future_source_event');if(['depth','trades'].includes(e.kind)&&now-event>LIMITS.ttl_ms)reject('stale_source_event:'+e.kind);}
   else if(['metrics','depth','trades'].includes(e.kind))out.unknowns.push('source_event_time:'+e.kind);
   if(e.transport==='failed')reject('failed_transport:'+e.kind);
  }
  if(newest!==found)fail('snapshot_time_must_preserve_latest_observation');
  for(const required of ['metadata','metrics'])if(!lead.evidence.some(e=>e.kind===required))missing('evidence:'+required);
  for(const c of lead.deterministic_checks){
   if(c.checker_id!==lead.checker.actor_id)fail('check_actor_mismatch');
   const checked=timestamp(c.checked_at);if(checked<found||checked>now)fail('invalid_check_time');
   distinct(c.evidence_ids,x=>x,'duplicate_check_evidence');
   for(const id of c.evidence_ids){if(!evidenceIds.has(id))fail('check_evidence_missing');if(c.status==='passed'&&byEvidence.get(id).transport!=='ok')fail('failed_evidence_cannot_pass');}
   if(c.status==='passed'&&c.evidence_ids.length===0)fail('unsupported_pass_claim');
   if(c.status==='passed'&&CHECK_EVIDENCE[c.check_id])for(const kind of CHECK_EVIDENCE[c.check_id])if(!c.evidence_ids.some(id=>byEvidence.get(id)?.kind===kind))fail('check_kind_mismatch');
   if(c.check_id==='latest_trade'&&c.status==='passed'&&!c.evidence_ids.some(id=>byEvidence.get(id)?.kind==='trades'&&byEvidence.get(id)?.event_at!==null))fail('trade_event_time_required');
   if(c.status==='failed')reject('deterministic:'+c.check_id);else if(c.status==='unknown')missing('deterministic:'+c.check_id);
  }
  for(const id of REQUIRED_CHECKS)if(!lead.deterministic_checks.some(c=>c.check_id===id))missing('deterministic:'+id);
  for(const name of ECONOMICS){
   const q=lead.economics[name],expectedUnit=name.includes('fx_')?'rate':name==='network_cost_quote'?'quote':'bps';
   if(q.unit!==expectedUnit)fail('economics_unit_mismatch');
   if(['unknown','not_applicable'].includes(q.status)&&q.value!==null)fail('unknown_economics_value');
   if(['assumed','observed'].includes(q.status)&&q.value===null)fail('economics_value_missing');
   if(name.startsWith('fx_')&&q.value!==null&&Number(q.value)<=0)fail('invalid_fx_rate');
   distinct(q.evidence_ids,x=>x,'duplicate_economics_evidence');
   for(const id of q.evidence_ids){if(!evidenceIds.has(id))fail('economics_evidence_missing');if(q.status==='observed'&&byEvidence.get(id).transport!=='ok')fail('failed_economics_source');}
   if(q.status==='observed'&&q.evidence_ids.length===0)fail('unsupported_economics_claim');
   if(q.status==='unknown'||q.status==='assumed'){out.unknowns.push(name+':'+q.status);missing('economics:'+name);}
   if(q.status==='not_applicable'&&name!=='network_cost_quote'&&!(name==='fx_to_usd'&&lead.identity.quote_symbol==='USD'))fail('invalid_not_applicable_economics');
  }
  if(lead.identity.base_representation==='unknown')out.unknowns.push('base_asset_representation');
  if(lead.identity.quote_symbol==='USDC'&&lead.economics.fx_to_usd.status!=='observed')missing('observed_USDC_USD_conversion');
  // Only the separate authenticated review store can attest that review actually happened.
  const reviews=trustedContext.reviews??[];if(!Array.isArray(reviews)||reviews.length>LIMITS.reviews)fail('review_budget_exceeded');
  const reviewIds=new Set();
  for(const r of reviews){
   try{
    boundedObject(r);validateSchema(r,reviewSchema);actor(r.reviewer);
    if(reviewIds.has(r.review_id))fail('duplicate_review');reviewIds.add(r.review_id);
    if(!Array.isArray(trustedContext.reviewers)||trustedContext.reviewers.length>16||!trustedContext.reviewers.some(a=>same(a,r.reviewer)))fail('unknown_reviewer');
    if(!['human','model'].includes(r.reviewer.actor_type)||r.reviewer.actor_id===lead.finder.actor_id||r.reviewer.actor_id===lead.checker.actor_id)fail('review_not_independent');
    if(r.lead_id!==lead.lead_id||r.epoch_id!==lead.epoch_id||r.evidence_sha256!==digest||r.identity_key!==key)fail('review_evidence_mismatch');
    const reviewed=timestamp(r.reviewed_at),reviewExpiry=timestamp(r.expires_at);
    if(reviewed<found||reviewed>now||reviewExpiry<=reviewed||reviewExpiry>expiry||now>=reviewExpiry)fail('review_stale_or_invalid');
    out.independent_review.reviews.push(structuredClone(r));
   }catch(e){reject('untrusted_review:'+(e instanceof Invalid?e.code:'invalid_review'));}
  }
  if(out.independent_review.reviews.length){out.independent_review.status='reviewed';if(out.independent_review.reviews.some(r=>r.verdict==='reject'))reject('independent_review_rejected');if(out.independent_review.reviews.some(r=>r.verdict==='needs_more_evidence'))missing('review_followup');}
  else missing('independent_review');
  missing('separate_paper_entry_validation_and_authorization');
  if(out.status!=='expired'){
   if(out.reject_reasons.length)out.status='rejected';
   else if(out.independent_review.reviews.some(r=>r.verdict==='watch'))out.status='reviewed_watch';
   else if(out.checks_remaining.some(x=>x.startsWith('deterministic:')||x.startsWith('evidence:')))out.status=lead.deterministic_checks.some(c=>c.check_id==='coarse_screen'&&c.status==='passed')?'coarse_pass':'detail_pending';
   else out.status='awaiting_independent_review';
  }
 }catch(e){reject(e instanceof Invalid?e.code:'invalid_evidence');if(out.status!=='expired')out.status='rejected';out.independent_review={status:'not_reviewed',reviews:[]};}
 return out;
}

export async function assessBatch(leads,contextFor){
 if(!Array.isArray(leads)||leads.length>LIMITS.batch_leads||typeof contextFor!=='function')throw new Invalid('batch_budget_exceeded');
 let bytes=0;const ids=new Set(),results=[];
 for(const lead of leads){bytes+=typeof lead==='string'?encoder.encode(lead).length:encoder.encode(canonicalJson(lead)).length;if(bytes>LIMITS.batch_bytes)throw new Invalid('batch_budget_exceeded');const result=await assessLead(lead,contextFor(lead));if(result.lead_id&&ids.has(result.lead_id))throw new Invalid('duplicate_batch_identity');ids.add(result.lead_id);results.push(result);}
 return results;
}

/** Text-only view rows for existing evidence windows; consumers must use textContent. */
export function evidenceRows(assessment){
 const a=assessment;if(!plain(a)||a.protocol!=='neptune-lead-assessment-v1')throw new Invalid('invalid_assessment');
 return [
  ['State',a.status],['Finder',a.finder.actor_type+' · '+a.finder.display_name],['Checker',a.checker.actor_type+' · '+a.checker.display_name],
  ['Identity',a.identity_key??'Unverified'],['First retained discovery',a.discovered_at??'Unknown'],['Snapshot observed',a.snapshot_observed_at??'Unknown'],['Expires',a.expires_at??'Unknown'],
  ['Independent review',a.independent_review.status==='reviewed'?a.independent_review.reviews.map(r=>r.reviewer.actor_type+' · '+r.reviewer.display_name+' · '+r.verdict).join('; '):'Not reviewed'],
  ['Unknowns',a.unknowns.join('; ')||'None recorded'],['Checks remaining',a.checks_remaining.join('; ')],['Reject reasons',a.reject_reasons.join('; ')||'None'],...ECONOMICS.map(name=>[name,a.economics?`${a.economics[name].status}: ${a.economics[name].value??'unknown'} ${a.economics[name].unit}`:'Unknown']),['Paper entry','Not allowed by research evidence']
 ];
}
