import {CATALOGUE_SHA256} from './catalogue-digest.mjs?v=discovery-20261010';

// A reviewed, fixed public snapshot. The pin is content identity, not a signature.
// A future catalogue requires a newly reviewed pin. Never convert this data to
// check/fill events or use it as an execution-identity trust anchor.
export const DISCOVERY_LIMITS=Object.freeze({maxIdentities:100,maxBytes:131072});
const excluded=new Set(['RENDER','POL','TAO','APT','AKT','2Z','OPEN']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exactKeys=(v,keys)=>object(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const text=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max;
const timestamp=v=>text(v,40)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)$/.test(v)&&Number.isFinite(Date.parse(v));
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const symbol=v=>typeof v==='string'&&/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(v);
const tokenId=v=>typeof v==='string'&&/^0x[0-9a-f]{32}$/.test(v);
const topKeys=['version','catalogue_id','kind','live_monitoring','laser_eligible','execution_eligible','complete_venue_coverage','identity_count','identity_count_unit','cross_venue_economic_deduplication','selection','display','sources','instruments'];
const itemKeys=['id','venue','pair','base','quote','instrument_id','alternate_pair_id','base_id','quote_id','asset_key','chain','address','token_index','quote_token_index','provider_evm_contract_hint','source_id','snapshot_at','metadata_sha256'];
export function canonicalCatalogue(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('Non-finite number');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonicalCatalogue).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalCatalogue(value[k])).join(',')+'}';
 throw new TypeError('Non-JSON value');
}
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

export async function readDiscoveryCatalogue(candidate,{now=Date.now(),crypto=globalThis.crypto}={}){
 try{
  if(!Number.isFinite(now)||!exactKeys(candidate,topKeys)||candidate.version!==1||candidate.catalogue_id!=='neptune-discovery-20261010T0348Z-v1'||candidate.kind!=='historical_discovery_catalogue')return null;
  if(candidate.live_monitoring!==false||candidate.laser_eligible!==false||candidate.execution_eligible!==false||candidate.complete_venue_coverage!==false||candidate.cross_venue_economic_deduplication!=='not_claimed'||candidate.identity_count_unit!=='venue_qualified_asset_identities')return null;
  if(!text(candidate.selection,512)||!text(candidate.display,256)||!Array.isArray(candidate.sources)||candidate.sources.length!==3||!Array.isArray(candidate.instruments)||candidate.instruments.length!==100||candidate.identity_count!==100)return null;
  const sources=new Map();
  for(const s of candidate.sources){
   if(!exactKeys(s,['id','url','request_body','captured_at','capture_file_sha256','parsed_response_sha256'])||sources.has(s.id)||!timestamp(s.captured_at)||Date.parse(s.captured_at)>now||!hex(s.capture_file_sha256)||!hex(s.parsed_response_sha256))return null;
   if(s.id==='kraken-pairs'){if(s.url!=='https://api.kraken.com/0/public/AssetPairs'||s.request_body!==null)return null;}
   else if(s.id==='kraken-tickers'){if(s.url!=='https://api.kraken.com/0/public/Ticker'||s.request_body!==null)return null;}
   else if(s.id==='hyperliquid-spot'){if(s.url!=='https://api.hyperliquid.xyz/info'||!exactKeys(s.request_body,['type'])||s.request_body.type!=='spotMetaAndAssetCtxs')return null;}
   else return null;sources.set(s.id,s);
  }
  const ids=new Set(),assets=new Set();let kraken=0,hyperliquid=0;
  for(const e of candidate.instruments){
   if(!exactKeys(e,itemKeys)||ids.has(e.id)||assets.has(e.asset_key)||!symbol(e.base)||!symbol(e.quote)||excluded.has(e.base)||!text(e.instrument_id)||!hex(e.metadata_sha256)||e.pair!==e.base+'/'+e.quote||e.address!==null||!timestamp(e.snapshot_at))return null;
   if(sources.get(e.source_id)?.captured_at!==e.snapshot_at||Date.parse(e.snapshot_at)>now)return null;
   if(e.venue==='kraken'){
    if(e.id!=='kraken:'+e.instrument_id||e.quote!=='USD'||e.source_id!=='kraken-pairs'||e.chain!==null||e.token_index!==null||e.quote_token_index!==null||e.provider_evm_contract_hint!==null||!text(e.alternate_pair_id)||!text(e.base_id)||!['USD','ZUSD'].includes(e.quote_id)||e.asset_key!=='kraken:asset:'+e.base_id)return null;kraken++;
   }else if(e.venue==='hyperliquid'){
    if(e.id!=='hyperliquid:'+e.instrument_id||e.quote!=='USDC'||e.source_id!=='hyperliquid-spot'||e.chain!=='hyperliquid'||e.alternate_pair_id!==null||!tokenId(e.base_id)||!tokenId(e.quote_id)||!Number.isInteger(e.token_index)||e.token_index<0||e.quote_token_index!==0||e.asset_key!=='hyperliquid:token:'+e.base_id)return null;
    const h=e.provider_evm_contract_hint;if(h!==null&&(!exactKeys(h,['address','evm_extra_wei_decimals'])||!/^0x[0-9a-f]{40}$/.test(h.address)||!Number.isInteger(h.evm_extra_wei_decimals)))return null;hyperliquid++;
   }else return null;
   ids.add(e.id);assets.add(e.asset_key);
  }
  if(kraken!==80||hyperliquid!==20)return null;
  const encoded=new TextEncoder().encode(canonicalCatalogue(candidate));if(encoded.length>DISCOVERY_LIMITS.maxBytes||!crypto?.subtle)return null;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoded))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==CATALOGUE_SHA256)return null;
  return freeze(JSON.parse(new TextDecoder().decode(encoded)));
 }catch{return null;}
}

// Intentionally has no branch that could authorize a laser, pick or order.
export const discoveryCanFire=()=>false;
