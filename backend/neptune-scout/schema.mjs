// Strict, bounded public research evidence. Cross-field/time/trust checks live in lead-review.mjs.
export const str=(max=96, pattern='^[A-Za-z0-9@][A-Za-z0-9_.:/@+\\-]{0,127}$')=>({type:'string',minLength:1,maxLength:max,pattern});
const text={type:'string',minLength:1,maxLength:240,pattern:'^[^<>\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]+$'};
export const timestamp={type:'string',maxLength:32,pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|\\+00:00)$'};
const nullable=s=>({anyOf:[s,{type:'null'}]});
const enumeration=(...values)=>({enum:values});
export const array=(items,max=16)=>({type:'array',maxItems:max,items});
export const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const decimal={type:'string',minLength:1,maxLength:64,pattern:'^(?:0|[1-9][0-9]{0,17})(?:\\.[0-9]{1,36})?$'};
export const actorSchema=object({actor_id:str(),actor_type:enumeration('deterministic','human','model'),display_name:text,model:nullable(text),version:str()});
export const identitySchema=object({venue:enumeration('kraken','hyperliquid'),instrument_id:str(),pair:str(),base_symbol:str(24),quote_symbol:enumeration('USD','USDC'),base_id:str(),quote_id:str(),asset_namespace:enumeration('kraken_asset','hyperliquid_token'),base_representation:enumeration('venue_asset','native','wrapped','proxy','unknown'),quote_representation:enumeration('fiat','stablecoin','unknown')});
const evidence=object({evidence_id:str(),kind:enumeration('metadata','metrics','depth','candles','trades','rules','fx','fees','network'),sha256:sha,request_id:nullable(str()),request_started_at:nullable(timestamp),sample_lower_bound:timestamp,observed_at:timestamp,observation_basis:enumeration('response_received','first_db_observed'),wire_received_at:nullable(timestamp),event_at:nullable(timestamp),transport:enumeration('ok','failed')});
const check=object({check_id:str(),status:enumeration('passed','failed','unknown'),checker_id:str(),checked_at:timestamp,evidence_ids:array(str(),9),reason:text});
const quantity=object({status:enumeration('unknown','assumed','observed','not_applicable'),value:nullable(decimal),unit:enumeration('bps','rate','quote'),evidence_ids:array(str(),9),reason:text});
export const leadSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',
 $id:'urn:neptune:lead-evidence:v1',
 title:'NEPTUNE bounded research evidence v1',
 ...object({protocol:{const:'neptune-lead-evidence-v1'},epoch_id:str(),lead_id:str(128),discovered_at:timestamp,snapshot_observed_at:timestamp,expires_at:timestamp,
 finder:actorSchema,checker:actorSchema,identity:identitySchema,
 screen_config:object({screen_id:str(),origin:{const:'engineering_screen'},parameters:array(object({name:str(),value:decimal,unit:str()}),12)}),
 metrics:object({change_pct:nullable({...decimal,pattern:'^-?(?:0|[1-9][0-9]{0,17})(?:\\.[0-9]{1,36})?$'}),change_basis:enumeration('since_utc_midnight_open','previous_day_reference','unknown'),quote_volume_24h:nullable(decimal),last_reference:nullable(decimal)}),
 scenario:object({notional_quote:nullable(decimal),displayed_book_round_trip_loss_bps:nullable(decimal),modeled_total_cost_reserve_bps:nullable(decimal),expected_return_bps:{const:null}}),
 evidence:array(evidence,9),deterministic_checks:array(check,16),
 economics:object({fee_bps_per_side:quantity,spread_bps:quantity,slippage_bps:quantity,fx_to_usd:quantity,fx_usd_to_aud:quantity,network_cost_quote:quantity}),
 execution_eligible:{const:false},ai_review_status:{const:'not_reviewed'}})
};
export const reviewSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',$id:'urn:neptune:lead-review-receipt:v1',title:'Trusted review receipt; never accepted from lead payload',
 ...object({review_id:str(),lead_id:str(128),epoch_id:str(),evidence_sha256:sha,identity_key:str(512,'^[A-Za-z0-9_.:/@+|\\-]+$'),reviewed_at:timestamp,expires_at:timestamp,reviewer:actorSchema,verdict:enumeration('watch','reject','needs_more_evidence'),summary:text})
};
