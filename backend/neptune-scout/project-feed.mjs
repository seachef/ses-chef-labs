#!/usr/bin/env node
// Build a sanitized public allowlist projection. No network, credentials or order APIs.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PRODUCER,PUBLIC_LIMITS,validatePublicFeed} from './public-feed.mjs';
import {payloadDigest,validateSchema} from './lead-review.mjs';
import {leadSchema} from './schema.mjs';
const NONE=()=>({blocked_until:null,permanent:false,reason_code:null,refused_at:null});
const add=(s,ms)=>new Date(Date.parse(s)+ms).toISOString();
const unknown=unit=>({status:'unknown',value:null,unit,evidence_ids:[],reason:'Not verified by this public research run'});
function decimal(v){if(v==null)return null;if(typeof v!=='string'||! /^-?(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,36})?$/.test(v)||v.length>64)throw Error('invalid_decimal_source');return v;}
function sourceEvidence(s,kind,run){return{evidence_id:kind,kind,sha256:s.raw_sha256,request_id:null,request_started_at:null,sample_lower_bound:run.started_at,observed_at:s.observed_at,observation_basis:'response_received',wire_received_at:s.observed_at,event_at:null,transport:s.status===200&&s.error===null?'ok':'failed'};}
export async function projectFeed(report,snapshot,{source_commit,run_id,rate_state,generated_at=new Date().toISOString()}={}){
 if(report?.protocol!=='neptune-public-research-runonce-v1'||!['read_only_run_once','read_only_capture_replay'].includes(report.mode)||report.execution_enabled!==false||report.qualified_buy_count!==0)throw Error('invalid_collector_report');
 if(!Array.isArray(report.leads)||report.leads.length>4||!Array.isArray(snapshot?.markets)||snapshot.markets.length>2048||!Array.isArray(report.source_captures)||report.source_captures.length>4)throw Error('collector_budget_exceeded');
 const sources=report.source_captures.filter(s=>['kraken_metadata','kraken_tickers','hyperliquid_bulk'].includes(s.kind));
 if(new Set(sources.map(s=>s.kind)).size!==sources.length)throw Error('duplicate_source');
 const runStatus=report.run_outcome??'completed';
 const feed={protocol:'neptune-public-research-feed-v1',run:{started_at:report.started_at,completed_at:report.completed_at,source_commit,workflow_run_id:run_id,acquisition_mode:['initializing','recovery_needed'].includes(runStatus)?'none':report.mode==='read_only_capture_replay'?'capture_replay':'public_read',status:runStatus,recovery_required_run_id:report.recovery_required_run_id??null},generated_at,discovery_expires_at:add(report.completed_at,PUBLIC_LIMITS.discovery_ttl_ms),producer:structuredClone(PRODUCER),coverage:runStatus==='completed'?{kraken:report.coverage.kraken?.screened_identities??0,hyperliquid:report.coverage.hyperliquid?.screened_identities??0,screened_identities:report.screened_identities,coarse_passes:report.prefilter_pass_count,detailed_leads:report.leads.length}:null,coarse_rejections:runStatus==='completed'?Object.fromEntries(['volume_below_100k_quote','change_outside_3_to_60_percent','spread_above_35_bps'].map(k=>[k,report.pre_screen_reasons?.[k]??0])):null,sources:sources.map(s=>({source_id:s.kind,sha256:s.raw_sha256,sample_lower_bound:report.started_at,observed_at:s.observed_at,status:s.status===200&&s.error===null?'ok':'failed'})),leads:[],independent_reviews:[],provider_status:rate_state??{kraken:NONE(),hyperliquid:NONE()}};
 const markets=new Map();for(const m of snapshot.markets){if(markets.has(m.id))throw Error('duplicate_market');markets.set(m.id,m);}
 for(const l of report.leads){
  const m=markets.get(l.id);if(!m||m.execution_eligible!==false||l.execution_eligible!==false||l.qualified_buy!==false||l.ai_review_status!=='not_reviewed'||l.venue!==m.venue||l.base_id!==m.base_id||l.quote_id!==m.quote_id||l.pair!==m.pair)throw Error('lead_market_binding_mismatch');
  if(!Array.isArray(m.prefilter_reasons))throw Error('missing_screen_result');
  const bySource=new Map(sources.map(s=>[s.kind,s]));
  const meta=bySource.get(m.venue==='kraken'?'kraken_metadata':'hyperliquid_bulk'),metrics=bySource.get(m.venue==='kraken'?'kraken_tickers':'hyperliquid_bulk');if(!meta||!metrics)throw Error('missing_bulk_capture');
  const evidence=[sourceEvidence(meta,'metadata',report),sourceEvidence(metrics,'metrics',report)];
  for(const e of l.evidence){const kind={depth:'depth',bars:'candles',trades:'trades'}[e.kind];if(!kind)throw Error('unexpected_detail_kind');let event=null;
   if(kind==='depth'&&typeof l.checks?.cost?.source_event_time==='number'&&Number.isFinite(l.checks.cost.source_event_time))event=new Date(l.checks.cost.source_event_time*1000).toISOString();
   evidence.push({evidence_id:kind,kind,sha256:e.raw_sha256,request_id:e.artifact,request_started_at:e.request_started_at,sample_lower_bound:e.request_started_at,observed_at:e.response_observed_at,observation_basis:'response_received',wire_received_at:e.response_observed_at,event_at:event,transport:l.checks?.[e.kind]?.status==='blocked'?'failed':'ok'});
  }
  const latest=evidence.reduce((a,e)=>Date.parse(a)>Date.parse(e.observed_at)?a:e.observed_at,evidence[0].observed_at);
  if(!Number.isFinite(Date.parse(l.observed_at))||Date.parse(l.observed_at)<Date.parse(latest)||Date.parse(l.observed_at)>Date.parse(report.completed_at))throw Error('invalid_original_check_time');
  const expires=new Date(Math.min(...evidence.filter(e=>e.kind!=='metadata').map(e=>Date.parse(e.sample_lower_bound)))+180000).toISOString();
  const check=(check_id,status,evidence_ids,reason)=>({check_id,status,checker_id:PRODUCER.checker.actor_id,checked_at:l.observed_at,evidence_ids,reason});
  const checks=[check('coarse_screen',m.prefilter_reasons.length?'failed':'passed',['metadata','metrics'],'Deterministic engineering screen; thresholds are not user investment rules'),check('exact_identity','passed',['metadata'],'Exact venue instrument and token identifiers retained')];
  for(const [from,to]of[['depth','depth'],['bars','completed_candles'],['trades','latest_trade']]){
   const e=evidence.find(e=>e.kind==={depth:'depth',bars:'candles',trades:'trades'}[from]);if(!e)continue;
   const prior=l.checks?.[from]?.status;const status=prior==='blocked'?'failed':from==='trades'?'unknown':prior==='passed'?'passed':'unknown';
   checks.push(check(to,status,[e.evidence_id],from==='trades'?'Transport check retained; source trade-event time is absent from compact report':'Deterministic '+from+' evidence check retained from collector'));
  }
  if(evidence.some(e=>e.kind==='candles')){
   const breakout=l.checks?.momentum?.completed_close_above_previous_20_highs;
   const status=breakout===false?'failed':'unknown';
   const reason=breakout===false?'Completed candle did not close above the previous 20 candle highs; breakout criterion not met':breakout===true?'Completed-bar breakout observed; remaining momentum criteria are not fully qualified':'Completed-bar breakout evidence is missing or inconclusive';
   checks.push(check('momentum',status,['candles'],reason));
   checks.push(check('strategy_qualification','unknown',['candles'],'Full strategy qualification has not been completed'));
  }
  checks.push(check('sizing_rules','unknown',['metadata'],'Complete current instrument rules still require verification'),check('venue_restrictions','unknown',['metadata'],'Current venue and route restrictions require independent verification'));
  const cost=l.checks?.cost??{},economics={fee_bps_per_side:unknown('bps'),spread_bps:unknown('bps'),slippage_bps:unknown('bps'),fx_to_usd:m.quote==='USD'?{status:'not_applicable',value:null,unit:'rate',evidence_ids:[],reason:'Native USD quote; no USD conversion'}:unknown('rate'),fx_usd_to_aud:unknown('rate'),network_cost_quote:unknown('quote')};
  // Fee multiplication by 10,000 shifts a decimal string exactly, without floating arithmetic.
  if(cost.fee_rate_per_side!=null){const fee=decimal(cost.fee_rate_per_side);const [a,b='']=fee.split('.');const digits=a+b.padEnd(4,'0').slice(0,4);const tail=b.slice(4);economics.fee_bps_per_side={status:'assumed',value:(digits.replace(/^0+(?=\d)/,'')||'0')+(tail?'.'+tail:''),unit:'bps',evidence_ids:[],reason:'Existing paper-model scenario assumption; actual account tier is unknown'};}
  if(cost.spread_bps!=null&&evidence.some(e=>e.kind==='depth'&&e.transport==='ok'))economics.spread_bps={status:'observed',value:decimal(cost.spread_bps),unit:'bps',evidence_ids:['depth'],reason:'Captured displayed-book spread; not a promised executable quote'};
  else if(m.spread_bps!=null)economics.spread_bps={status:'observed',value:decimal(m.spread_bps),unit:'bps',evidence_ids:['metrics'],reason:'Captured bulk ticker spread; individual event time unknown'};
  const payload={protocol:'neptune-lead-evidence-v1',epoch_id:run_id,lead_id:l.id,discovered_at:l.observed_at,snapshot_observed_at:latest,expires_at:expires,...structuredClone(PRODUCER),identity:{venue:m.venue,instrument_id:m.instrument_id,pair:m.pair,base_symbol:m.base,quote_symbol:m.quote,base_id:m.base_id,quote_id:m.quote_id,asset_namespace:m.venue==='kraken'?'kraken_asset':'hyperliquid_token',base_representation:m.venue==='kraken'?'venue_asset':'unknown',quote_representation:m.quote==='USD'?'fiat':'stablecoin'},screen_config:{screen_id:'runonce-coarse-screen-v1',origin:'engineering_screen',parameters:[{name:'minimum_quote_volume',value:'100000',unit:'quote_24h'},{name:'minimum_change',value:'3',unit:'percent'},{name:'maximum_change',value:'60',unit:'percent'},{name:'maximum_spread',value:'35',unit:'bps'}]},metrics:{change_pct:decimal(m.change_pct),change_basis:m.change_basis,quote_volume_24h:decimal(m.quote_volume_24h),last_reference:decimal(m.last_reference)},scenario:{notional_quote:decimal(l.model_quote_notional),displayed_book_round_trip_loss_bps:decimal(cost.displayed_book_round_trip_loss_bps),modeled_total_cost_reserve_bps:decimal(cost.screening_cost_reserve_bps),expected_return_bps:null},evidence,deterministic_checks:checks,economics,execution_eligible:false,ai_review_status:'not_reviewed'};
  validateSchema(payload,leadSchema);feed.leads.push({payload,evidence_sha256:await payloadDigest(payload)});
 }
 const raw=JSON.stringify(feed);if(Buffer.byteLength(raw)>65536)throw Error('public_output_budget_exceeded');
 const result=await validatePublicFeed(raw,{now_ms:Date.parse(generated_at),allow_expired_discovery:true,source_commit,run_id});if(!result.ok)throw Error(result.error);return feed;
}
function read(path,max){if(fs.statSync(path).size>max)throw Error('input_byte_budget_exceeded');const s=fs.readFileSync(path,'utf8');if(Buffer.byteLength(s)>max)throw Error('input_byte_budget_exceeded');return JSON.parse(s);}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try{const [report,snapshot,out,...args]=process.argv.slice(2);if(!report||!snapshot||!out)throw Error('Usage: project-feed.mjs REPORT SNAPSHOT OUTPUT --source-commit SHA --run-id ID --rate-state FILE');const flags={};for(let i=0;i<args.length;i+=2){if(!['--source-commit','--run-id','--rate-state'].includes(args[i])||!args[i+1])throw Error('invalid_argument');flags[args[i]]=args[i+1];}
  const feed=await projectFeed(read(report,65536),read(snapshot,524288),{source_commit:flags['--source-commit'],run_id:flags['--run-id'],rate_state:flags['--rate-state']?read(flags['--rate-state'],8192):undefined});const raw=JSON.stringify(feed)+'\n';fs.writeFileSync(out,raw,{flag:'wx'});process.stdout.write(JSON.stringify({ok:true,bytes:Buffer.byteLength(raw),leads:feed.leads.length,completed_at:feed.run.completed_at})+'\n');
 }catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=1;}
}
