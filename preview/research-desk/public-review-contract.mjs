import {str,timestamp,object,array,sha,identitySchema} from './public-scout-contract-v1/schema.mjs';
import {parseBoundedJson,canonicalJson,payloadDigest,validateSchema,identityKey} from './public-scout-contract-v1/lead-review.mjs';

export const PUBLIC_REVIEWS_URL='https://raw.githubusercontent.com/seachef/ses-chef-labs/main/public/research-reviews.json';
export const REVIEW_LIMITS=Object.freeze({input_bytes:65536,nodes:6000,depth:14,records:16,history_ms:7*24*60*60*1000});
// Repository publication attests that this review was performed. It does NOT provide
// a model-provider signature, verify a model binary, or promise an always-on reviewer.
export const REVIEWER_REGISTRY=Object.freeze({'astra-scout-review-v1':Object.freeze({actor_id:'astra-scout-review-v1',actor_type:'model',display_name:'Astra',model:'gpt-6-astra',model_identity:'owner_verified_configuration_not_cryptographic_attestation'})});
const text=(max=480)=>({type:'string',minLength:1,maxLength:max,pattern:'^[^<>\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]+$'});
const nullable=s=>({anyOf:[s,{type:'null'}]});
const commit={type:'string',pattern:'^[a-f0-9]{40}$'},runId={type:'string',pattern:'^[0-9]{1,24}$'};
const source=object({source_id:str(),label:text(120),url:{type:'string',minLength:1,maxLength:512}});
export const completedReviewSchema=object({
 review_id:str(),reviewer_id:{enum:Object.keys(REVIEWER_REGISTRY)},status:{const:'completed'},review_started_at:timestamp,review_completed_at:timestamp,
 subject:object({run_id:runId,run_started_at:timestamp,run_completed_at:timestamp,source_commit:commit,data_commit:commit,feed_sha256:sha,lead_id:str(128),identity:identitySchema,identity_key:str(512,'^[A-Za-z0-9_.:/@+|\\-]+$'),evidence_sha256:sha,source_observed_at:timestamp,quote_expires_at:timestamp}),
 verdict:{enum:['research_watch','reject','needs_more_evidence']},summary:text(),
 findings:array(object({code:str(),conclusion:{enum:['confirmed','failed','unknown','caution']},text:text(),source_ids:array(str(),8)}),8),
 observations:array(object({kind:{enum:['candles','depth','trades']},source_id:str(),instrument_id:str(),request_started_at:timestamp,response_observed_at:timestamp,source_event_at:nullable(timestamp),sha256:sha}),3),
 sources:array(source,8),original_raw_reproduced:{type:'boolean'},new_observation_at:nullable(timestamp),
 execution_eligible:{const:false},paper_entry_allowed:{const:false},qualified_buy:{const:false}
});
export const publicReviewSchema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:neptune:owner-published-reviews:v1',...object({
 protocol:{const:'neptune-owner-published-reviews-v1'},revision:{type:'integer',minimum:1,maximum:1000000000},record_created_at:timestamp,
 authority:object({kind:{const:'repository-owner-publication'},repository:{const:'seachef/ses-chef-labs'},branch:{const:'main'},path:{const:'public/research-reviews.json'},cryptographic_model_attestation:{const:false}}),
 reviews:array(completedReviewSchema,REVIEW_LIMITS.records)
})};
const stamp=s=>{const n=Date.parse(s);if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,19)!==s.slice(0,19))throw Error('invalid_review_timestamp');return n;};
const fail=error=>({ok:false,error,document:null,records:[]});
export function safeReviewSource(url){
 try{
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||(u.hash&&!(u.hostname==='hyperevmscan.io'&&u.hash==='#code'))||u.href!==url)return false;
  if(u.hostname==='raw.githubusercontent.com')return /^\/seachef\/ses-chef-labs\/[a-f0-9]{40}\/public\/research-feed\.json$/.test(u.pathname)&&!u.search;
  if(u.hostname==='github.com')return /^\/seachef\/ses-chef-labs\/(?:commit\/[a-f0-9]{40}|actions\/runs\/[0-9]{1,24})$/.test(u.pathname)&&!u.search;
  const paths={
   'api.kraken.com':/^\/0\/public\/(?:AssetPairs|Ticker|Depth|OHLC|Trades)$/,
   'docs.kraken.com':/^\/api-reference\/market-data\/[A-Za-z0-9_/-]+$/,
   'support.kraken.com':/^\/articles\/[A-Za-z0-9_/-]+$/,
   'api.hyperliquid.xyz':/^\/info$/,
   'www.kraken.com':/^\/au\/features\/fee-schedule$/,
   'app.hyperliquid.xyz':/^\/terms$/,
   'www.sui.io':/^\/(?:token-schedule|blog\/sui-mainnet-network-stall-resolution)$/,
   'sui-circulation.suiexplorer.com':/^\/api\/(?:current_month_sui_circulation|sui_circulation)$/,
   'blog.nearone.org':/^\/announcement\/2025\/10\/21\/enhancing-near-tokenomics\.html$/,
   'hyperevmscan.io':/^\/address\/0x[0-9a-f]{40}$/,
   'insights.derive.xyz':/^\/drv\/$/,

   'hyperliquid.gitbook.io':/^\/hyperliquid-docs\/[A-Za-z0-9_/-]+$/
  };
  if(!paths[u.hostname]?.test(u.pathname))return false;
  const allowed=u.hostname==='api.kraken.com'?new Set(['pair','interval','count','since','assetVersion']):u.hostname==='support.kraken.com'?new Set(['country']):new Set();
  if([...u.searchParams].length>5)return false;
  const seen=new Set();for(const [k,v]of u.searchParams){if(seen.has(k)||!allowed.has(k)||! /^[A-Za-z0-9_./-]{1,64}$/.test(v))return false;seen.add(k);}
  return true;
 }catch{return false;}
}
export async function validatePublicReviews(raw,{now_ms,last_seen}={}){
 try{
  if(!Number.isSafeInteger(now_ms))throw Error('review_clock_required');
  const document=parseBoundedJson(raw,REVIEW_LIMITS);validateSchema(document,publicReviewSchema);
  const published=stamp(document.record_created_at);if(published>now_ms)throw Error('future_review_publication');
  const digest=await payloadDigest(document,REVIEW_LIMITS);
  if(last_seen){if(document.revision<last_seen.revision||(document.revision===last_seen.revision&&digest!==last_seen.digest)||published<stamp(last_seen.record_created_at))throw Error('review_document_replayed_or_replaced');}
  const ids=new Set(),records=[];
  for(const r of document.reviews){
   if(ids.has(r.review_id))throw Error('duplicate_review_id');ids.add(r.review_id);
   const start=stamp(r.review_started_at),complete=stamp(r.review_completed_at),runStart=stamp(r.subject.run_started_at),runEnd=stamp(r.subject.run_completed_at),observed=stamp(r.subject.source_observed_at),expiry=stamp(r.subject.quote_expires_at);
   if(start>complete||complete>published||runStart>runEnd||runEnd>start||observed<runStart||observed>runEnd||expiry<=runStart||expiry>runEnd+180000)throw Error('invalid_completed_review_window');
   if(r.new_observation_at!==null&&(stamp(r.new_observation_at)<start||stamp(r.new_observation_at)>complete))throw Error('new_review_observation_time_invalid');
   const i=r.subject.identity;if(i.pair!==i.base_symbol+'/'+i.quote_symbol)throw Error('review_exact_identity_mismatch');
   if(i.venue==='kraken'&&(i.asset_namespace!=='kraken_asset'||i.quote_symbol!=='USD'||i.quote_id!=='USD'||i.base_id!==i.base_symbol||i.instrument_id!==i.pair||i.base_representation!=='venue_asset'||i.quote_representation!=='fiat'))throw Error('review_exact_identity_mismatch');
   if(i.venue==='hyperliquid'&&(i.asset_namespace!=='hyperliquid_token'||i.quote_symbol!=='USDC'||i.quote_representation!=='stablecoin'||!/^0x[0-9a-f]{32}$/.test(i.base_id)||i.quote_id!=='0x6d1e7cde53ba9467b783cb7c530ce054'||!(/^@\d{1,6}$/.test(i.instrument_id)||i.instrument_id==='PURR/USDC')))throw Error('review_exact_identity_mismatch');
   if(r.subject.identity_key!==identityKey(r.subject.identity)||r.subject.lead_id!==r.subject.identity.venue+':'+r.subject.identity.instrument_id)throw Error('review_exact_identity_mismatch');
   const sourceIds=new Set();for(const s of r.sources){if(sourceIds.has(s.source_id)||!safeReviewSource(s.url))throw Error('unsafe_or_duplicate_review_source');sourceIds.add(s.source_id);}
   if(new Set(r.findings.map(f=>f.code)).size!==r.findings.length)throw Error('duplicate_review_finding');
   const observationKinds=new Set();let latestObservation=null;for(const o of r.observations){if(observationKinds.has(o.kind)||!sourceIds.has(o.source_id)||o.instrument_id!==r.subject.identity.instrument_id)throw Error('review_observation_binding_mismatch');observationKinds.add(o.kind);const requested=stamp(o.request_started_at),received=stamp(o.response_observed_at);if(requested<start||requested>received||received>complete||o.source_event_at!==null&&stamp(o.source_event_at)>received)throw Error('review_observation_window_invalid');if(latestObservation===null||stamp(latestObservation)<received)latestObservation=o.response_observed_at;}
   if(r.new_observation_at!==latestObservation)throw Error('new_observation_summary_mismatch');
   for(const f of r.findings){if(new Set(f.source_ids).size!==f.source_ids.length||f.source_ids.some(id=>!sourceIds.has(id)))throw Error('review_finding_source_mismatch');}
   const bindingUrl=`https://raw.githubusercontent.com/seachef/ses-chef-labs/${r.subject.data_commit}/public/research-feed.json`;
   if(!r.sources.some(s=>s.url===bindingUrl))throw Error('immutable_original_feed_link_required');
   const recordDigest=await payloadDigest(r,REVIEW_LIMITS);
   if(last_seen?.record_digests?.[r.review_id]&&last_seen.record_digests[r.review_id]!==recordDigest)throw Error('completed_review_record_mutated');
   records.push({...structuredClone(r),reviewer:{...REVIEWER_REGISTRY[r.reviewer_id]},record_digest:recordDigest,quote_state:now_ms>=expiry?'expired':'time_bounded',review_timing:complete>=expiry?'completed_after_quote_expiry':'completed_before_quote_expiry',display_expired:now_ms-complete>=REVIEW_LIMITS.history_ms,execution_eligible:false,paper_entry_allowed:false,qualified_buy:false});
  }
  return{ok:true,document,records,digest,record_digests:Object.fromEntries(records.map(r=>[r.review_id,r.record_digest]))};
 }catch(e){return fail(typeof e?.message==='string'?e.message.slice(0,160):'invalid_review_document');}
}
// Does not amend a price, expiry, lead payload, live review state or trading decision.
export function associateReviews(records,feed,feedDigest,now_ms){
 const current=[],history=[];
 for(const r of records??[]){
  if(now_ms-Date.parse(r.review_completed_at)>=REVIEW_LIMITS.history_ms)continue;
  const match=feed?.leads.find(item=>r.subject.run_id===feed.run.workflow_run_id&&r.subject.source_commit===feed.run.source_commit&&r.subject.feed_sha256===feedDigest&&r.subject.lead_id===item.payload.lead_id&&r.subject.identity_key===identityKey(item.payload.identity)&&r.subject.evidence_sha256===item.evidence_sha256&&r.subject.source_observed_at===item.payload.snapshot_observed_at&&r.subject.quote_expires_at===item.payload.expires_at);
  const record={...r,binding:match?'exact_current_snapshot':'historical_other_snapshot',quote_state:now_ms>=Date.parse(r.subject.quote_expires_at)?'expired':'time_bounded',execution_eligible:false,paper_entry_allowed:false,qualified_buy:false};
  (match?current:history).push(record);
 }
 return{current,history};
}
