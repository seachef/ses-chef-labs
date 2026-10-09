import {createHistory} from './paper-history-v2.mjs?v=neptune-v2-20261009-r4';
import {createOwnerControl} from './paper-owner-v2.mjs?v=neptune-v2-20261009-r4';
export function setupPaperPanels({document,fetcher=fetch,endpointRoot,publicKey,getClient}={}){
 const $=id=>document.getElementById(id);let report=null,historyStarted=false,exporting=false,authSubscription;
 const short=v=>v===null||v===undefined?'—':String(v);
 const history=createHistory({fetchPage:async({cursor,watermark,limit})=>{
  const url=new URL(endpointRoot+'/neptune_paper_v2_history');url.searchParams.set('select','seq,kind,id,at,payload,source_hash,config_hash');url.searchParams.set('and',`(seq.gt.${cursor},seq.lte.${watermark})`);url.searchParams.set('order','seq.asc');url.searchParams.set('limit',String(limit));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{const response=await fetcher(url.href,{headers:{apikey:publicKey},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});if(!response.ok)throw Error('History unavailable');return await response.json();}finally{clearTimeout(timer);}
 },onChange:renderHistory});
 const owner=createOwnerControl({getClient:getClient||(async()=>{
  // Reuse the existing same-tab session; do not add a new redirect or owner identity.
  const auth=await import('../portfolio/portfolio/auth-client.mjs?v=20261001.data2');const client=await auth.getAuthClient();
  if(client&&!authSubscription){authSubscription=client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='USER_UPDATED'||event==='SIGNED_IN'&&owner.getState().access==='owner')owner.invalidate();});}
  return client;
 }),onChange:renderOwner});
 function renderOwner(state){$('ownerStatus').textContent=state.message;$('ownerActions').hidden=state.access!=='owner';$('ownerCheck').disabled=state.busy;$('ownerStop').disabled=state.busy||state.access!=='owner';$('ownerResume').disabled=state.busy||state.access!=='owner'||report?.status==='capacity_paused';}
 function renderHistory(state){
  const visible=state.rows.filter(r=>['fills','results','settlements'].includes(r.kind)).slice(-100);
  const nodes=visible.map(r=>{const li=document.createElement('li'),p=r.payload;li.textContent=r.kind==='fills'?`${r.at} · SIMULATED ${short(p.side).toUpperCase()} ${short(p.asset)} · ${short(p.qty)} @ USD ${short(p.price)} · ${short(p.settlement_status)} · AUD cash ${short(p.cash_delta_base)} · fee AUD ${short(p.fee_base)} · FX cost AUD ${short(p.fx_cost_base)} · fill ${r.id}`:r.kind==='results'?`${r.at} · ${short(p.asset)} · ${short(p.status)} · realized AUD ${short(p.pnl_base)} · exit ${short(p.exit_fill_id)}`:`${r.at} · FX settlement · USD ${short(p.usd_amount)} → AUD ${short(p.cash_delta_base)} · realized AUD ${short(p.pnl_base)} · exit ${short(p.exit_fill_id)}`;return li;});
  if(!nodes.length){const li=document.createElement('li');li.textContent=state.complete?'No execution/result/settlement records in this snapshot.':'No execution records loaded yet. More may follow.';nodes.push(li);}
  $('completeHistory').replaceChildren(...nodes);
  $('historyStatus').textContent=state.error||(state.watermark===null?'Complete history has not been loaded.':`${state.rows.length} audit records loaded · ${state.complete?'complete fixed snapshot':'more records available'} · ${visible.length} latest execution/result/settlement records shown. CSV includes every audit kind.`);
  $('historyMore').disabled=state.busy||exporting||state.complete;$('historyExport').disabled=state.busy||exporting;$('historyReset').disabled=state.busy||exporting;
 }
 function beginHistory(){if(!historyStarted){if(!Number.isSafeInteger(report?.history_seq)||report.history_seq<0)throw Error('History snapshot unavailable');history.reset(report.history_seq);historyStarted=true;}}
 $('historyMore').addEventListener('click',async()=>{try{beginHistory();await history.more();}catch{$('historyStatus').textContent='History snapshot unavailable. Wait for a verified server report.';}});
 $('historyReset').addEventListener('click',()=>{if(history.getState().busy||exporting)return;try{historyStarted=false;beginHistory();}catch{$('historyStatus').textContent='A newer verified history snapshot is unavailable.';}});
 $('historyExport').addEventListener('click',async()=>{
  if(exporting)return;exporting=true;
  try{beginHistory();renderHistory(history.getState());const csv=await history.exportAll();const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='NEPTUNE-simulated-paper-history.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch{$('historyStatus').textContent='Complete export unavailable. No partial CSV was downloaded; retry after checking the feed.';}
  finally{exporting=false;const s=history.getState();$('historyMore').disabled=s.busy||s.complete;$('historyExport').disabled=s.busy;$('historyReset').disabled=s.busy;}
 });
 $('ownerCheck').addEventListener('click',()=>owner.refresh());$('ownerStop').addEventListener('click',()=>owner.requestEnabled(false));$('ownerResume').addEventListener('click',()=>owner.requestEnabled(true));
 renderHistory(history.getState());renderOwner(owner.getState());
 return {observe(next){report=next;owner.observe(next);},history,owner};
}
