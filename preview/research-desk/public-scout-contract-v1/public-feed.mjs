import {leadSchema,actorSchema,str,timestamp,object,array,sha} from './schema.mjs';
import {parseBoundedJson,canonicalJson,payloadDigest,validateSchema,assessLead,identityKey,LIMITS} from './lead-review.mjs';
export const PUBLIC_LIMITS=Object.freeze({...LIMITS,input_bytes:65536,nodes:6000,depth:16,discovery_ttl_ms:1800000,run_duration_ms:600000});
export const PRODUCER=Object.freeze({finder:Object.freeze({actor_id:'neptune-python-scout',actor_type:'deterministic',display_name:'Public Python scout',model:null,version:'neptune-public-research-runonce-v1'}),checker:Object.freeze({actor_id:'neptune-deterministic-checks',actor_type:'deterministic',display_name:'Deterministic evidence checks',model:null,version:'neptune-public-research-runonce-v1'})});
const nullable=x=>({anyOf:[x,{type:'null'}]});
const uint=max=>({type:'integer',minimum:0,maximum:max});
const source=object({source_id:{enum:['kraken_metadata','kraken_tickers','hyperliquid_bulk']},sha256:sha,sample_lower_bound:timestamp,observed_at:timestamp,status:{enum:['ok','failed']}});
const provider=object({blocked_until:nullable(timestamp),permanent:{type:'boolean'},reason_code:{enum:[null,'http_401','http_402','http_403','http_429','http_418','http_451','invalid_retry_after']},refused_at:nullable(timestamp)});
export const publicFeedSchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:neptune:public-research-feed:v1',title:'Sanitized public research feed; contains no execution or private account data',...object({
 protocol:{const:'neptune-public-research-feed-v1'},run:object({started_at:timestamp,completed_at:timestamp,source_commit:{type:'string',pattern:'^[0-9a-f]{40}$'},workflow_run_id:{type:'string',pattern:'^[0-9]{1,24}$'},acquisition_mode:{enum:['public_read','capture_replay','none']},status:{enum:['completed','failed','initializing','recovery_needed']},recovery_required_run_id:nullable({type:'string',pattern:'^[0-9]{1,24}$'})}),generated_at:timestamp,discovery_expires_at:timestamp,producer:object({finder:actorSchema,checker:actorSchema}),coverage:nullable(object({kraken:uint(2048),hyperliquid:uint(2048),screened_identities:uint(2048),coarse_passes:uint(2048),detailed_leads:uint(4)})),coarse_rejections:nullable(object({volume_below_100k_quote:uint(2048),change_outside_3_to_60_percent:uint(2048),spread_above_35_bps:uint(2048)})),sources:array(source,3),leads:array(object({payload:leadSchema,evidence_sha256:sha}),4),independent_reviews:array({},0),provider_status:object({kraken:provider,hyperliquid:provider})
})};
function stamp(s){if(typeof s!=='string'||!Number.isFinite(Date.parse(s))||new Date(Date.parse(s)).toISOString().slice(0,19)!==s.slice(0,19))throw Error('invalid_timestamp');return Date.parse(s);}
function same(a,b){return canonicalJson(a)===canonicalJson(b);}
const bad=error=>({ok:false,error,feed:null,assessments:[]});
const TEMPORAL=new Set(['lead_expired','stale_metadata_evidence','stale_metrics_evidence','stale_depth_evidence','stale_candles_evidence','stale_trades_evidence','stale_rules_evidence']);
function expectedReject(reason){return TEMPORAL.has(reason)||reason.startsWith('deterministic:')||reason.startsWith('failed_transport:')||reason.startsWith('stale_source_event:');}
/** Browser-safe public feed validator. Only use with bytes read from the fixed approved repo URL.
 * The hash catches mutation, not a malicious publisher. Producer/reviewer identity is fixed here.
 * No independent review can be published through this deterministic collector's feed. */
export async function validatePublicFeed(raw,options={}){
 try{
  if(typeof raw!=='string')throw Error('raw_json_string_required');
  if(!Number.isSafeInteger(options.now_ms))throw Error('now_ms_required');
  const feed=parseBoundedJson(raw,PUBLIC_LIMITS);validateSchema(feed,publicFeedSchema);
  const now=options.now_ms,start=stamp(feed.run.started_at),end=stamp(feed.run.completed_at),generated=stamp(feed.generated_at),expiry=stamp(feed.discovery_expires_at);
  if(start>end||end-start>PUBLIC_LIMITS.run_duration_ms||end>now||generated<end||generated>now||expiry!==end+PUBLIC_LIMITS.discovery_ttl_ms)throw Error('invalid_run_window');
  if(options.source_commit&&feed.run.source_commit!==options.source_commit)throw Error('source_commit_mismatch');
  if(options.run_id&&feed.run.workflow_run_id!==options.run_id)throw Error('workflow_run_id_mismatch');
  if(!same(feed.producer,PRODUCER))throw Error('unexpected_producer');
  const digest=await payloadDigest(feed,PUBLIC_LIMITS);
  if(options.last_seen){const last=stamp(options.last_seen.completed_at);if(end<last||(end===last&&digest!==options.last_seen.digest))throw Error('replayed_or_replaced_run');}
  if(now>=expiry&&!options.allow_expired_discovery)throw Error('discovery_expired');
  if(feed.run.status==='completed'){if(!feed.coverage||!feed.coarse_rejections||feed.run.acquisition_mode==='none'||feed.coverage.kraken+feed.coverage.hyperliquid!==feed.coverage.screened_identities||feed.coverage.coarse_passes>feed.coverage.screened_identities||feed.coverage.detailed_leads!==feed.leads.length||Object.values(feed.coarse_rejections).some(n=>n>feed.coverage.screened_identities))throw Error('coverage_mismatch');}
  else if(feed.coverage!==null||feed.coarse_rejections!==null||feed.leads.length||feed.sources.length)throw Error('failed_run_cannot_claim_coverage');
  if((feed.run.status==='recovery_needed')!==(feed.run.recovery_required_run_id!==null))throw Error('recovery_latch_mismatch');
  if(['initializing','recovery_needed'].includes(feed.run.status)&&feed.run.acquisition_mode!=='none')throw Error('initialization_cannot_claim_acquisition');
  const sources=new Map();for(const s of feed.sources){if(sources.has(s.source_id))throw Error('duplicate_source');sources.set(s.source_id,s);const lower=stamp(s.sample_lower_bound),observed=stamp(s.observed_at);if(lower<start||lower>observed||observed>end)throw Error('source_time_mismatch');}
  // Nonzero coverage requires the exact successful bulk captures that support it.
  // A current run timestamp alone is never evidence that a venue was screened.
  if(feed.coverage?.kraken>0&&(!['kraken_metadata','kraken_tickers'].every(k=>sources.get(k)?.status==='ok')))throw Error('kraken_coverage_without_successful_sources');
  if(feed.coverage?.hyperliquid>0&&sources.get('hyperliquid_bulk')?.status!=='ok')throw Error('hyperliquid_coverage_without_successful_source');
  const assessments=[],ids=new Set();
  for(const item of feed.leads){
   const p=item.payload;if(ids.has(p.lead_id))throw Error('duplicate_lead');ids.add(p.lead_id);
   if(p.epoch_id!==feed.run.workflow_run_id||!same(p.finder,PRODUCER.finder)||!same(p.checker,PRODUCER.checker))throw Error('lead_provenance_mismatch');
   if(stamp(p.discovered_at)<start||stamp(p.snapshot_observed_at)>end)throw Error('lead_run_time_mismatch');
   for(const e of p.evidence){if(stamp(e.sample_lower_bound)<start||stamp(e.observed_at)>end)throw Error('lead_source_time_mismatch');}
   const sourceNames=p.identity.venue==='kraken'?{metadata:'kraken_metadata',metrics:'kraken_tickers'}:{metadata:'hyperliquid_bulk',metrics:'hyperliquid_bulk'};
   for(const [kind,name]of Object.entries(sourceNames)){const e=p.evidence.find(x=>x.kind===kind),s=sources.get(name);if(!e||!s||e.sha256!==s.sha256||e.observed_at!==s.observed_at||e.sample_lower_bound!==s.sample_lower_bound||e.transport!==s.status)throw Error('bulk_source_binding_mismatch');}
   const context={now_ms:end,expected_epoch_id:p.epoch_id,record:{epoch_id:p.epoch_id,lead_id:p.lead_id,identity_key:identityKey(p.identity),evidence_sha256:item.evidence_sha256,...PRODUCER},reviews:[],reviewers:[]};
   const historical=await assessLead(p,context);
   if(historical.reject_reasons.some(r=>!expectedReject(r)))throw Error('lead_invalid:'+historical.reject_reasons.join(','));
   assessments.push(await assessLead(p,{...context,now_ms:now}));
  }
  for(const p of Object.values(feed.provider_status)){
   if(p.blocked_until!==null)stamp(p.blocked_until);
   if(p.reason_code===null){if(p.permanent||p.refused_at!==null||p.blocked_until!==null)throw Error('provider_state_mismatch');}
   else{if(p.refused_at===null||stamp(p.refused_at)>end)throw Error('provider_refusal_time_invalid');if(['http_401','http_402','http_403','http_418','http_451'].includes(p.reason_code)&&!p.permanent)throw Error('permanent_refusal_required');if(!p.permanent&&(p.blocked_until===null||stamp(p.blocked_until)<stamp(p.refused_at)+900000))throw Error('cooldown_too_short');}
  }
  const fresh=assessments.filter(a=>now<stamp(a.expires_at)).length;
  return{ok:true,feed,assessments,digest,discovery_state:now>=expiry?'expired':'current',quote_state:fresh===0?'expired':fresh===assessments.length?'fresh':'mixed'};
 }catch(e){return bad(typeof e?.message==='string'?e.message.slice(0,512):'invalid_public_feed');}
}
