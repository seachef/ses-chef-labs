import {validHistoryRecord,ACCOUNT_CURRENCY} from './status-v2.mjs?v=neptune-v2-20261009-r9';
import {csvRows} from './csv-safe.mjs?v=neptune-v2-20261009-r9';
export const HISTORY_PAGE_SIZE=100;
export const HISTORY_FIELDS=Object.freeze(['id','at','asset','action','side','price','qty','quote_currency','reason','source','observation_id','risk_base','stop','target','invalidation','confidence','result','config_version','config_hash','source_hash','origin_order_id','origin_decision_id','decision_id','order_id','initial_risk_base','fx','fx_source','fx_at','gross_base','fee_base','cash_delta_base','slippage_pct','gross_usd','fee_usd','net_usd','settlement_status','fx_rate_date','fx_retrieved_at','fx_applied_rate','fx_cost_base','closed_at','settled_at','entry_fill_id','exit_fill_id','pnl_base','net_r','status','usd_amount','fill_id','delta','balance']);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const seq=v=>Number.isSafeInteger(v)&&v>=0;
const kinds=['decisions','orders','fills','results','settlements','order_events','cash_ledger','usd_ledger'];
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validateHistoryRow(row){
 if(!row||!seq(row.seq)||row.seq===0||!kinds.includes(row.kind)||typeof row.id!=='string'||!row.id||row.id.length>1000||!stamp(row.at)||!hash(row.source_hash)||!hash(row.config_hash)||!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload))throw Error('Invalid history row');
 const p=row.payload;
 for(const [key,value] of Object.entries(p))if(!HISTORY_FIELDS.includes(key)||(value!==null&&!['string','number','boolean'].includes(typeof value))||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>1000)throw Error('Non-public history field');
 if(row.kind!=='order_events'&&p.id!==row.id||!validHistoryRecord(row.kind,row.kind==='order_events'?{...p,id:row.id,at:row.at}:p))throw Error('Invalid history payload');
 for(const k of ['source_hash','config_hash'])if(k in p&&(!hash(p[k])||p[k]!==row[k]))throw Error('History hash mismatch');
 // Return only an explicit projection; never retain unknown top-level identity fields.
 return {seq:row.seq,kind:row.kind,id:row.id,at:row.at,payload:Object.fromEntries(HISTORY_FIELDS.filter(k=>k in p).map(k=>[k,p[k]])),source_hash:row.source_hash,config_hash:row.config_hash};
}
export function createHistory({fetchPage,onChange=()=>{}}){
 let state={watermark:null,cursor:0,rows:[],busy:false,complete:false,error:null},epoch=0;
 const bySeq=new Map(),byId=new Map();
 const snapshot=()=>({...state,rows:state.rows.slice()});
 const emit=patch=>{state={...state,...patch};onChange(snapshot());};
 function reset(watermark){if(!seq(watermark))throw Error('History snapshot unavailable');epoch++;bySeq.clear();byId.clear();emit({watermark,cursor:0,rows:[],busy:false,complete:watermark===0,error:null});}
 async function more(){
  if(state.busy||state.complete)return snapshot();
  if(!seq(state.watermark))throw Error('History snapshot unavailable');
  const requestEpoch=epoch,start=state.cursor,watermark=state.watermark;emit({busy:true,error:null});
  try{
   const data=await fetchPage({cursor:start,watermark,limit:HISTORY_PAGE_SIZE});if(requestEpoch!==epoch)return snapshot();
   if(!Array.isArray(data)||data.length>HISTORY_PAGE_SIZE)throw Error('Invalid history page');
   const normalized=data.map(validateHistoryRow),additions=[];let cursor=start,prior=0;
   for(const row of normalized){
    if(row.seq>watermark||row.seq<prior)throw Error('History page order changed');prior=row.seq;
    const encoded=JSON.stringify(row),known=bySeq.get(row.seq),knownId=byId.get(row.kind+':'+row.id);
    if(known){if(known!==encoded)throw Error('History record changed');continue;}
    if(row.seq<=start||knownId&&knownId!==encoded)throw Error('History cursor conflict');
    if(additions.some(x=>x.seq===row.seq||x.kind===row.kind&&x.id===row.id)){const earlier=additions.find(x=>x.seq===row.seq);if(!earlier||JSON.stringify(earlier)!==encoded)throw Error('History duplicate conflict');continue;}
    additions.push(row);cursor=row.seq;
   }
   // Identity sequences can have rollback gaps. Never require consecutive integers.
   // A committed fixed watermark must nevertheless be reached before claiming completeness.
   if(cursor===start&&cursor<watermark)throw Error('History page made no progress');
   for(const row of additions){const encoded=JSON.stringify(row);bySeq.set(row.seq,encoded);byId.set(row.kind+':'+row.id,encoded);}
   emit({cursor,rows:[...state.rows,...additions],complete:cursor>=watermark,error:null});
  }catch{if(requestEpoch===epoch)emit({error:'History unavailable or incomplete. Loaded records are retained; retry to continue.'});}
  finally{if(requestEpoch===epoch)emit({busy:false});}
  return snapshot();
 }
 async function exportAll(){if(state.busy)throw Error('History request in progress');const exportEpoch=epoch;while(!state.complete){const before=state.cursor;await more();if(epoch!==exportEpoch||state.error||state.cursor===before)throw Error('Complete history export unavailable');}return historyCsv(state.rows);}
 return {reset,more,exportAll,getState:snapshot};
}
export function historyCsv(rows){const columns=['mode','account_currency','seq','kind','history_id','history_at','history_source_hash','history_config_hash',...HISTORY_FIELDS];return csvRows(columns,rows.map(validateHistoryRow).map(r=>['PAPER_SIMULATED',ACCOUNT_CURRENCY,r.seq,r.kind,r.id,r.at,r.source_hash,r.config_hash,...HISTORY_FIELDS.map(k=>r.payload[k])]));}
