import {NATIVE_FIELDS,DECIMAL_FIELDS,NATIVE_KINDS} from './native-fields.mjs?v=neptune-native-20261009';
const decimal=v=>typeof v==='string'&&v.length<=128&&/^-?\d+(\.\d+)?$/.test(v);
const zero=v=>decimal(v)&&/^-?0+(\.0+)?$/.test(v);
const positive=v=>decimal(v)&&!v.startsWith('-')&&!zero(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validateNativeHistoryRow(r){
 if(!r||!Number.isSafeInteger(r.seq)||r.seq<=0||!NATIVE_KINDS.includes(r.kind)||typeof r.id!=='string'||!r.id||r.id.length>1000||!stamp(r.at)||!hash(r.source_hash)||!hash(r.config_hash)||!r.payload||Array.isArray(r.payload)||typeof r.payload!=='object')throw Error('Invalid native history envelope');
 const p=r.payload;
 if(p.schema_version!==3||p.id!==r.id||!stamp(p.at)||Date.parse(p.at)!==Date.parse(r.at))throw Error('Native history identity mismatch');
 for(const[k,v]of Object.entries(p)){
  if(!NATIVE_FIELDS.includes(k)||(v!==null&&!['string','number','boolean'].includes(typeof v))||typeof v==='string'&&v.length>1000||typeof v==='number'&&!Number.isFinite(v))throw Error('Non-public native history field');
  if(['verified_fee_dust','sold_entire_sellable_inventory'].includes(k)&&v!==null&&typeof v!=='boolean')throw Error('Boolean proof required');
  if(DECIMAL_FIELDS.includes(k)&&v!==null&&!decimal(v))throw Error('Exact decimal required');
 }
 const spec=p.asset==='binance:SOLUSDT'?['binance','USDT','SOL']:p.asset==='hyperliquid:@107'?['hyperliquid','USDC','HYPE']:null;
 if(!spec||p.quote_currency!==spec[1]||p.venue!=null&&p.venue!==spec[0]||p.currency!=null&&p.currency!==spec[1]||p.specialist_id!=null&&p.specialist_id!==spec[0])throw Error('Native instrument mismatch');
 for(const k of ['source_hash','config_hash'])if(p[k]!=null&&p[k]!==r[k])throw Error('Native history hash mismatch');
 if(p.position_status!=null){
  if(!['open','dust_held','closed'].includes(p.position_status)||!decimal(p.qty_remaining)||p.qty_remaining.startsWith('-'))throw Error('Invalid native position state');
  if((p.position_status==='closed')!==zero(p.qty_remaining))throw Error('Native closure quantity mismatch');
  if(p.position_status!=='closed'&&p.closed_at!=null)throw Error('Partial close cannot be closed');
 }
 if(p.verified_fee_dust===true&&(p.position_status!=='dust_held'||p.sold_entire_sellable_inventory!==true||!['protective_stop','net_r_target'].includes(p.exit_reason)||!positive(p.qty_remaining)||!positive(p.dust_inventory)||!zero(p.sellable_inventory)))throw Error('Invalid verified dust proof');
 if(r.kind==='native_fills'){
  if(!['buy','sell'].includes(p.side)||!positive(p.gross_qty)||!positive(p.gross_quote)||!decimal(p.fee_qty)||!decimal(p.fee_quote)||!decimal(p.net_inventory_delta)||!decimal(p.net_quote_delta)||p.fee_qty.startsWith('-')||p.fee_quote.startsWith('-')||p.fee_currency!==(p.side==='buy'?spec[2]:spec[1]))throw Error('Invalid native fill');
 }
 if(r.kind==='native_quote_ledger'&&(!['purchase_conversion','trade','fee','proceeds_conversion'].includes(p.ledger_kind)||!decimal(p.delta)||zero(p.delta)))throw Error('Invalid native ledger');
 if(r.kind==='native_receivables'&&!positive(p.amount))throw Error('Invalid native receivable');
 if(r.kind==='native_settlements'&&(!positive(p.quote_amount)||!positive(p.usd_amount)||!positive(p.cash_delta_base)||p.status!=='settled'))throw Error('Invalid native settlement');
 const payload=Object.fromEntries(NATIVE_FIELDS.filter(k=>k in p).map(k=>[k,p[k]]));
 return {seq:r.seq,kind:r.kind,id:r.id,at:r.at,payload,source_hash:r.source_hash,config_hash:r.config_hash};
}
export const nativeClosedProfit=p=>p?.schema_version===3&&p.position_status==='closed'&&zero(p.qty_remaining)&&stamp(p.closed_at)&&['settled'].includes(p.status||p.settlement_status)&&positive(p.pnl_base);
