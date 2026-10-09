// Called only with validated history rows; preserve exact decimal strings for audit.
export function formatNativeHistory(r){
 const p=r.payload,s=v=>v===null||v===undefined?'—':String(v),kind=r.kind.replace(/^native_/,'').replaceAll('_',' ');
 const common=`${r.at} · SIMULATED NATIVE ${kind.toUpperCase()} · ${s(p.venue)} · ${s(p.asset)}`;
 if(r.kind==='native_fills')return `${common} · ${s(p.side).toUpperCase()} · gross ${s(p.gross_qty)} · inventory delta ${s(p.net_inventory_delta)} · fee ${s(p.fee_qty)} base / ${s(p.fee_quote)} ${s(p.quote_currency)} · fee currency ${s(p.fee_currency)} · quote delta ${s(p.net_quote_delta)} ${s(p.quote_currency)} · AUD cash ${s(p.cash_delta_base)} · ${s(p.settlement_status)} · fill ${r.id}`;
 if(r.kind==='native_results'||r.kind==='native_settlements'||r.kind==='native_fill_attribution')return `${common} · ${s(p.position_status)} · remaining ${s(p.qty_remaining)} · dust ${s(p.dust_inventory)} · sold-portion result AUD ${s(p.pnl_base)} · ${s(p.status||p.settlement_status)} · quote ${s(p.quote_amount)} ${s(p.quote_currency)} → USD ${s(p.usd_amount)} → AUD ${s(p.cash_delta_base)} · cost ${s(p.cost_base)} · retained cost ${s(p.cost_remaining)} · fee AUD ${s(p.fee_base)} · FX cost AUD ${s(p.fx_cost_base)} · record ${r.id}`;
 if(r.kind==='native_quote_ledger')return `${common} · ${s(p.ledger_kind)} · exact delta ${s(p.delta)} ${s(p.currency||p.quote_currency)} · source fill ${s(p.fill_id)}`;
 if(r.kind==='native_receivables')return `${common} · ${s(p.amount)} ${s(p.currency||p.quote_currency)} awaiting conversion · no settled AUD inferred · source exit ${s(p.exit_fill_id)}`;
 return `${common} · ${s(p.action||p.side||p.status)} · ${s(p.reason)} · source ${s(p.source)} · observation ${s(p.observation_id)} · record ${r.id}`;
}
