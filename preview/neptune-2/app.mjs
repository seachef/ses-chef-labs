import {AUTH_CONFIG} from '../portfolio/portfolio/auth-config.mjs?v=20261001.data2';
import {validateV2} from '../research-desk/status-v2.mjs?v=experiment-provenance-v3-r2';
import {createOwnerControl, controlAcknowledgement} from '../research-desk/paper-owner-v2.mjs?v=neptune-native-20261009';
import {createHistory} from '../research-desk/paper-history-v2.mjs?v=experiment-provenance-v3-r2';
import {historyExperimentLabels} from '../research-desk/experiment-provenance.mjs?v=experiment-provenance-v3-r2';
import {formatNativeHistory} from '../research-desk/native-history-display.mjs?v=neptune-native-20261009';
import {pageView, START_BLOCK, amount, price, timestamp} from './model.mjs?v=neptune2-20261011';

export function createController({fetcher=fetch, getClient, onChange=()=>{}, now=()=>Date.now(), timeoutMs=8000}={}) {
  let state={report:null, connected:false, loading:true, busy:false}, disposed=false, authClient=null, subscription=null, activeRequest=null;
  const emit=patch=>{if(!disposed){state={...state,...patch};onChange(snapshot());}};
  const loadClient=getClient || (async()=>{const auth=await import('../portfolio/portfolio/auth-client.mjs?v=20261001.data2');return auth.getAuthClient();});
  const owner=createOwnerControl({now, timeoutMs, getClient:async()=>{
    const client=await loadClient();
    if(disposed)return null;
    if(client!==authClient){
      subscription?.data?.subscription?.unsubscribe?.();
      if(authClient)owner.invalidate();
      authClient=client;
      subscription=client?.auth?.onAuthStateChange?.(event=>{if(['SIGNED_OUT','SIGNED_IN','USER_UPDATED','PASSWORD_RECOVERY','TOKEN_REFRESHED'].includes(event))owner.invalidate();});
    }
    return client;
  }, onChange:()=>emit({})});
  const history=createHistory({fetchPage:({cursor,watermark,limit})=>read('neptune_paper_v2_history',{select:'seq,kind,id,at,payload,source_hash,config_hash',and:`(seq.gt.${cursor},seq.lte.${watermark})`,order:'seq.asc',limit:String(limit)}),onChange:()=>emit({})});
  async function read(table, params, controller=new AbortController()) {
    const url=new URL(AUTH_CONFIG.url+'/rest/v1/'+table);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {const response=await fetcher(url.href,{headers:{apikey:AUTH_CONFIG.publishableKey},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});if(!response.ok)throw Error('Feed unavailable');return await response.json();} finally {clearTimeout(timer);}
  }
  function snapshot(){const o=owner.getState();return {...state, owner:o, history:history.getState(), canStart:false, canStop:!disposed && o.access==='owner' && !o.busy && o.control?.enabled===true};}
  async function refreshFeed(){
    if(disposed||state.busy)return;
    const request=new AbortController();activeRequest=request;emit({busy:true});
    try {const rows=await read('neptune_paper_v2_status',{id:'eq.neptune-paper-v2',select:'id,payload'},request);if(disposed)return;const report=Array.isArray(rows)&&rows.length===0?null:validateV2(rows);state={...state,report,connected:true};owner.observe(report);}
    catch {if(!disposed){state={...state,connected:false};owner.observe(null);}}
    finally {activeRequest=null;emit({busy:false,loading:false});}
  }
  async function refresh(){if(disposed)return;await Promise.all([refreshFeed(),owner.refresh()]);}
  async function stop(){if(!snapshot().canStop)return false;await owner.requestEnabled(false);await refreshFeed();return true;}
  // There is deliberately no resume write path in this page.
  function start(){return false;}
  async function loadHistory(){
    if(disposed||history.getState().busy)return;
    const h=history.getState(),seq=state.report?.history_seq;
    if(!Number.isSafeInteger(seq)||seq<0)return;
    if(h.watermark===null || h.complete && seq>h.watermark)history.reset(seq);
    await history.more();
  }
  function destroy(){disposed=true;activeRequest?.abort();subscription?.data?.subscription?.unsubscribe?.();owner.invalidate();}
  return {refresh,refreshFeed,start,stop,loadHistory,destroy,snapshot};
}

export function render(document,state,now=Date.now()) {
  const $=id=>document.getElementById(id), set=(id,value)=>{$(id).textContent=value;};
  const view=pageView({...state,now}), o=state.owner;
  set('engineStatus',view.title);set('engineDetail',view.detail);set('startBlock',START_BLOCK);
  const age=now-Date.parse(view.reportAt), old=!Number.isFinite(age)||age<0||age>90000;
  set('freshness',view.reportAt?'Report '+timestamp(view.reportAt)+(old?' · stale':' · '+Math.floor(age/1000)+'s ago'):'No report yet');
  set('balance',amount(view.balance));set('cash','Cash '+amount(view.cash));set('realised',amount(view.realised));set('unrealised',amount(view.unrealised));set('valuationNote',view.valuationMessage);
  const ownerMessage=o.access==='owner'&&!o.busy?controlAcknowledgement(o.control,state.connected?state.report:null,now).message:o.message;
  set('ownerStatus',o.access==='signed-out'?'Owner signed out. Use the existing sign-in below in this tab, then return and refresh.':ownerMessage);
  $('start').disabled=true;$('stop').disabled=!state.canStop;$('refresh').disabled=state.busy||o.busy;
  $('refresh').textContent=state.busy||o.busy?'Checking…':'Refresh';
  set('positionsStatus',view.positionsMessage);
  const cells=['Coin / venue','Entry','Current bid','Stop','Target'];
  const rows=view.positions.map(p=>{const tr=document.createElement('tr');const texts=[p.displayAsset+' · '+p.venue,price(p.entry,p.currency),price(p.current,p.currency),price(p.stop,p.currency),price(p.target,p.currency)];texts.forEach((text,i)=>{const td=document.createElement('td');td.dataset.label=cells[i];td.textContent=text;if(i===0){const small=document.createElement('small');small.textContent=(p.classificationLabel||'')+(p.status.startsWith('DUST')?'Dust held. ':'')+p.note;td.append(small);}tr.append(td);});return tr;});
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent=view.positionsMessage;tr.append(td);rows.push(tr);}
  $('positions').replaceChildren(...rows);
  function list(id,texts,fallback){const nodes=(texts.length?texts:[fallback]).map(text=>{const li=document.createElement('li');li.textContent=text;return li;});$(id).replaceChildren(...nodes);}
  set('fillsStatus',view.historyMessage);
  list('fills',view.fills.map(f=>`${timestamp(f.at)} · PAPER ${f.side.toUpperCase()} ${f.coin} · ${f.quote}\n${f.label}${f.detail}`),'No verified fills in this snapshot.');
  const history=state.history, label=historyExperimentLabels(history.rows,{complete:history.complete});
  const visible=history.rows.filter(r=>['fills','results','settlements','native_fills','native_results','native_settlements','native_fill_attribution'].includes(r.kind)).slice(-100).reverse();
  list('historyRows',visible.map(r=>label(r)+(r.kind.startsWith('native_')?formatNativeHistory(r):r.kind==='fills'?`${timestamp(r.at)} · PAPER ${r.payload.side.toUpperCase()} ${r.payload.asset} · ${price(r.payload.price,'USD')} · cash ${amount(r.payload.cash_delta_base)} · ${r.payload.settlement_status}`:`${timestamp(r.at)} · ${r.payload.asset||'FX settlement'} · realised ${amount(r.payload.pnl_base)} · ${r.payload.status||'settled'}`)),history.watermark===null?'Use Load history to read older server records.':'No fills or results in the loaded history pages.');
  set('historyStatus',history.error||(history.watermark===null?'History has not been loaded.':`${history.rows.length} audit records checked; showing ${visible.length} latest loaded fills and results. ${history.complete?'Fixed snapshot complete.':'More audit pages remain.'}`));
  const newer=history.complete && Number.isSafeInteger(state.report?.history_seq) && state.report.history_seq>history.watermark;
  $('historyMore').disabled=history.busy||history.complete&&!newer||!Number.isSafeInteger(state.report?.history_seq)||state.report.history_seq<0;
  $('historyMore').textContent=history.busy?'Loading…':newer?'Load latest':history.complete?'History loaded':history.watermark===null?'Load history':'Load more';
}

export function mount(document, options={}) {
  const now=options.now||(()=>Date.now());
  const controller=createController({...options,onChange:state=>render(document,state,now())});
  const events=[['start',()=>controller.start()],['stop',()=>void controller.stop()],['refresh',()=>void controller.refresh()],['historyMore',()=>void controller.loadHistory()]];
  for(const [id,handler] of events)document.getElementById(id).addEventListener('click',handler);
  render(document,controller.snapshot(),now());void controller.refresh();
  const poll=setInterval(()=>void controller.refreshFeed(),10000),clock=setInterval(()=>render(document,controller.snapshot(),now()),1000);
  return {controller,destroy(){clearInterval(poll);clearInterval(clock);for(const [id,handler] of events)document.getElementById(id).removeEventListener('click',handler);controller.destroy();}};
}
if(typeof document!=='undefined'&&document.body?.classList.contains('neptune2')) {
  let page=mount(document);
  globalThis.addEventListener('pagehide',()=>{page?.destroy();page=null;});
  globalThis.addEventListener('pageshow',()=>{if(!page)page=mount(document);});
}
