import {ENTRY_WATCH_ASSETS,validateEntryWatch} from './news-data.mjs?v=20261007.edition1';
import {validateEntrySetups,evaluateEntrySetup,ENTRY_SETUP_MAX_AGE_MS,ENTRY_QUOTE_MAX_AGE_MS} from './entry-setups.mjs?v=20261007.shortlist1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');

/** Observation freshness only. A lower low or a boolean in a feed cannot qualify a buy. */
export function shortlistStates(data,now=Date.now(),setups=null){
 if(!data)return ENTRY_WATCH_ASSETS.map(asset=>({asset,status:'unavailable',label:'No data'}));
 validateEntryWatch(data,{now});
 let entries=[];try{if(setups)entries=validateEntrySetups(setups,{now}).setups;}catch{}
 const superseded=new Set(data.records.map(row=>row.supersedes).filter(Boolean));
 return ENTRY_WATCH_ASSETS.map(asset=>{
  const rows=data.records.filter(row=>row.asset===asset&&!superseded.has(row.id));
  const observed=rows.filter(row=>row.status==='observed').sort((a,b)=>Date.parse(a.candle_close_at)-Date.parse(b.candle_close_at));
  const lastAttempt=rows.at(-1),latest=lastAttempt?.status==='unavailable'?lastAttempt:observed.at(-1);
  if(!latest||latest.status==='unavailable')return {asset,status:'unavailable',label:'No data'};
  const stale=now-Date.parse(latest.observed_at)>36*3600000||now-Date.parse(latest.candle_close_at)>48*3600000;
  const comparisonChanged=latest.compared_with&&superseded.has(latest.compared_with);
  const setup=entries.find(item=>item.asset===asset);
  if(!stale&&!comparisonChanged&&setup&&evaluateEntrySetup(setup,now).status==='review')return {asset,status:'review',label:'Review entry'};
  return {asset,status:stale?'stale':'watch',label:stale?'Stale':!comparisonChanged&&latest.assessment==='lower_low'?'Lower low':'Watch'};
 });
}

export function createEntryShortlist({container,historyContainer,now=()=>Date.now(),fetchImpl=globalThis.fetch?.bind(globalThis),timeoutMs=8000}={}){
 if(!container||!historyContainer)throw Error('Shortlist and history containers required');
 let data=null,setups=null,controller=null,timer=null,disposed=false;
 function setupDetails(asset){
  const setup=setups?.setups.find(item=>item.asset===asset);
  if(!setup)return '<p>No reviewed entry setup is available.</p>';
  const state=evaluateEntrySetup(setup,now()),ready=shortlistStates(data,now(),setups).find(row=>row.asset===asset)?.status==='review';
  const status=ready?'Review entry':'Watch';
  return `<h4>${status} · ${esc(setup.venue)} ${esc(setup.pair)}</h4><p>Reference price: ${esc(setup.quote.price)} ${esc(setup.quote_currency)} · ${esc(when(setup.quote.observed_at))}</p><dl><dt>Entry range</dt><dd>${esc(setup.entry_min)}–${esc(setup.entry_max)} ${esc(setup.quote_currency)}</dd><dt>Stop trigger</dt><dd>${esc(setup.stop)} ${esc(setup.quote_currency)}</dd><dt>Targets</dt><dd>${setup.targets.map(esc).join(' / ')} ${esc(setup.quote_currency)}</dd></dl><p>${ready?'The recorded research checks pass. Review the live quote, fees and exit rules before deciding.':state.status==='review'?'Fresh supporting history is unavailable.':esc(state.reason.replaceAll('_',' '))+'.'}</p><p>A stop can slip or fail to fill. These levels are a research draft; no order is active.</p><p class="entry-setup-dates">Research checked ${esc(when(setup.checked_at))}<br>Expires ${esc(when(setup.expires_at))}</p>${setup.source_security_checked?`<p class="entry-setup-sources">${setup.source_urls.map((url,i)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Source ${i+1}<span class="sr-only">, opens in a new tab</span></a>`).join(' · ')}</p>`:'<p>Official sources have not been verified.</p>'}`;
 }
 function render(){
  if(disposed)return;
  try{if(setups)validateEntrySetups(setups,{now:now()});}catch{setups=null;}
  clearTimeout(timer);timer=null;
  let states;try{states=shortlistStates(data,now(),setups);}catch{data=null;states=shortlistStates(null,now());}
  for(const state of states){const button=container.querySelector(`[data-entry-coin="${state.asset}"]`);if(!button)continue;button.dataset.entryStatus=state.status;button.querySelector('[data-entry-label]').textContent=state.label;button.setAttribute('aria-label',state.asset+': '+state.label+'. Open research details');
   const target=historyContainer.querySelector(`[data-entry-asset="${state.asset}"]`);if(target){let panel=target.querySelector('[data-entry-setup]');if(!panel){panel=target.ownerDocument.createElement('section');panel.setAttribute('data-entry-setup','');panel.className='entry-setup';target.insertBefore(panel,target.querySelector('.watch-records'));}panel.innerHTML=setupDetails(state.asset);}
  }
  const green=states.filter(state=>state.status==='review').map(state=>setups.setups.find(setup=>setup.asset===state.asset));
  if(green.length){const deadline=Math.min(...green.flatMap(setup=>[Date.parse(setup.expires_at),Date.parse(setup.checked_at)+ENTRY_SETUP_MAX_AGE_MS,Date.parse(setup.quote.observed_at)+ENTRY_QUOTE_MAX_AGE_MS]));timer=setTimeout(render,Math.max(1,deadline-now()+1));timer?.unref?.();}
 }
 function update(next){
  data=next;render();
 }
 function updateSetups(next){try{setups=next?structuredClone(validateEntrySetups(next,{now:now()})):null;}catch{setups=null;}render();}
 async function loadSetups(){
  if(disposed||controller)return;updateSetups(null);controller=new AbortController();const active=controller,timeout=setTimeout(()=>active.abort(),timeoutMs);
  try{const response=await fetchImpl(new URL('../data/entry-setups.json',import.meta.url),{credentials:'omit',cache:'no-store',redirect:'error',signal:active.signal});if(!response.ok||Number(response.headers?.get('content-length')||0)>65536)throw Error('Setup unavailable');const text=await response.text();if(new TextEncoder().encode(text).length>65536)throw Error('Setup too large');if(!disposed&&!active.signal.aborted)updateSetups(JSON.parse(text));}catch{if(!disposed)updateSetups(null);}finally{clearTimeout(timeout);if(controller===active)controller=null;}
 }
 function click(event){
  const button=event.target.closest('[data-entry-coin]');if(!button)return;
  render();
  const parent=historyContainer.closest('details');if(parent)parent.open=true;
  const target=historyContainer.querySelector(`[data-entry-asset="${button.dataset.entryCoin}"]`);
  if(target){target.open=true;const summary=target.querySelector('summary');summary?.focus();target.scrollIntoView({block:'start',behavior:'auto'});}
  else{historyContainer.setAttribute('tabindex','-1');historyContainer.focus();historyContainer.scrollIntoView({block:'center',behavior:'auto'});}
 }
 container.addEventListener('click',click);
 return {update,updateSetups,loadSetups,recheck:render,destroy(){data=null;setups=null;render();disposed=true;controller?.abort();clearTimeout(timer);container.removeEventListener('click',click);}};
}
