import {ATH_MAX_AGE,isFreshATH,readATHMarkets} from './entry-ath.mjs?v=20261008.ath1';
import {CYCLE_QUOTE_AGE,NEAR_LOW_PERCENT,isNearCycleLow} from './entry-cycle.mjs?v=20261008.lows2';
import {LOW_WATCH_ASSETS,LOW_WATCH_RESEARCH,readLowWatch} from './near-low-watch.mjs?v=20261008.empty1';
import {ENTRY_WATCH_ASSETS,validateEntryWatch} from './news-data.mjs?v=20261007.edition1';
import {validateEntrySetups,evaluateEntrySetup,ENTRY_SETUP_MAX_AGE_MS,ENTRY_QUOTE_MAX_AGE_MS} from './entry-setups.mjs?v=20261007.shortlist1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');

// Freshness is not entry approval.
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

export function createEntryShortlist({container,historyContainer,now=()=>Date.now(),fetchImpl=globalThis.fetch?.bind(globalThis),timeoutMs=15000}={}){
if(!container||!historyContainer)throw Error('Shortlist and history containers required');
let data=null,setups=null,controller=null,timer=null,cycleTimer=null,disposed=false,expanded=null;
let aths=new Map(),athReq=null;
const cycles=new Map(),cycleRequests=new Map(),cycleFailures=new Set();
const detail=container.ownerDocument.createElement('div');detail.id='entryCycleDetails';detail.className='entry-cycle-detail';detail.hidden=true;container.append(detail);
const filter=container.ownerDocument.createElement('div');filter.className='entry-low-filter';filter.innerHTML='<span role="status" aria-live="polite"></span><button type="button" data-cycle-refresh>Refresh</button>';container.insertBefore(filter,detail);
const price=value=>Number(value).toLocaleString('en-AU',{maximumSignificantDigits:5});
const date=value=>new Date(value).toISOString().slice(0,10);
const freshATH=asset=>isFreshATH(aths.get(asset),now())?aths.get(asset):null;
function renderCycle(state,button){
const saved=cycles.get(state.asset),fresh=saved&&now()-saved.retrievedAt>=0&&now()-saved.retrievedAt<CYCLE_QUOTE_AGE,quote=fresh?saved:null;
button.hidden=!isNearCycleLow(quote,now());if(button.hidden&&expanded===state.asset){expanded=null;if(detail.contains(container.ownerDocument.activeElement)||container.ownerDocument.activeElement===button)filter.querySelector('button').focus();}
const ath=freshATH(state.asset);
const loading=cycleRequests.has(state.asset);button.dataset.cycleState=fresh?'current':loading?'loading':'unavailable';
for(const [field,value] of Object.entries({current:quote?price(quote.current):loading?'…':'—',low:quote?price(quote.low):'—',percent:quote?quote.percentLabel:saved?'Refresh':'—',ath:ath?price(ath.ath):'Unavailable',below:ath?ath.belowLabel:'—'})){const node=button.querySelector('[data-cycle-'+field+']');if(node)node.textContent=value;}
button.setAttribute('aria-expanded',String(expanded===state.asset));button.setAttribute('aria-controls',detail.id);
button.setAttribute('aria-label',state.asset+': '+state.label+'. '+(quote?'Current '+quote.current+' '+quote.currency+', bear-cycle low '+quote.low+', '+quote.percentLabel+' above low. ':'Cycle prices unavailable. ')+(ath?'CoinGecko ATH '+ath.ath+' USD, '+ath.belowLabel+' below (USD). ':'ATH unavailable. ')+'Toggle compact price details');
}
function renderCycleDetail(){
detail.hidden=!expanded;if(!expanded)return;
const quote=cycles.get(expanded),research=LOW_WATCH_RESEARCH[expanded];
if(!isNearCycleLow(quote,now())){expanded=null;detail.hidden=true;return;}
const ath=freshATH(expanded);
const athHtml=ath?`<p>ATH: ${price(ath.ath)} USD on ${date(ath.at)} · <a href="${esc(ath.source)}" target="_blank" rel="noopener noreferrer">CoinGecko</a> all-time aggregate high. ${esc(ath.belowLabel)} below uses its ${price(ath.current)} USD quote, updated ${esc(when(ath.observedAt))}. Exchange highs differ from this aggregate USD record.</p>`:'<p>ATH unavailable: no fresh CoinGecko USD record. Cycle peaks are not ATH.</p>';
detail.innerHTML=`<p><strong>${esc(expanded)} · ${esc(research.name)}</strong> · ${esc(quote.venue)} ${esc(quote.currency)} · Low week ${date(quote.lowAt)} · Checked ${esc(when(quote.retrievedAt))}</p><p>Bear low: lowest traded wick after the strongest completed weekly close (${date(quote.peakAt)}); history starts ${date(quote.startsAt)}. 24h turnover ${price(quote.quoteVolume)} USDT.</p>${athHtml}<p>${esc(research.activity)} <strong>${esc(research.flag)}:</strong> ${esc(research.risk)}</p><p>${quote.sources.map((url,i)=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${i===0?'Price history':i===1?'Spot quote':'Market status'}</a>`).join(' · ')} · ${research.sources.map(source=>`<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)}</a>`).join(' · ')} · Research checked ${esc(research.checkedAt)}</p>`;
}
function renderFilter(){
const fresh=LOW_WATCH_ASSETS.filter(asset=>{const q=cycles.get(asset);return q&&now()>=q.retrievedAt&&now()-q.retrievedAt<CYCLE_QUOTE_AGE;});
const shown=fresh.filter(asset=>isNearCycleLow(cycles.get(asset),now())).length,loading=cycleRequests.size;
filter.querySelector('[role="status"]').textContent=!LOW_WATCH_ASSETS.length?'No qualifying coins shortlisted.':`Near lows · ≤${NEAR_LOW_PERCENT}% above bear low · `+(loading?'Checking…':shown?`${shown} watch candidate${shown===1?'':'s'}`:fresh.length===LOW_WATCH_ASSETS.length?'No tracked candidate close enough':'No verified matches · refresh prices');
filter.querySelector('button').disabled=loading>0;
filter.querySelector('button').hidden=!LOW_WATCH_ASSETS.length;
}
async function loadATHs({force=false}={}){
if(disposed||!LOW_WATCH_ASSETS.length||athReq||!force&&LOW_WATCH_ASSETS.every(freshATH))return;
const active=new AbortController();athReq=active;const timeout=setTimeout(()=>active.abort(),timeoutMs);
try{const result=await readATHMarkets({fetchImpl,signal:active.signal,now});if(!disposed&&!active.signal.aborted)aths=result;}
catch{if(!disposed)aths.clear();}
finally{clearTimeout(timeout);if(athReq===active)athReq=null;if(!disposed)render();}
}
async function loadCycles({force=false}={}){
if(disposed)return;
void loadATHs({force});
await Promise.all(LOW_WATCH_ASSETS.map(async asset=>{
const saved=cycles.get(asset);if(cycleRequests.has(asset)||!force&&saved&&now()>=saved.retrievedAt&&now()-saved.retrievedAt<CYCLE_QUOTE_AGE)return;
const active=new AbortController();cycleRequests.set(asset,active);cycleFailures.delete(asset);const timeout=setTimeout(()=>active.abort(),timeoutMs);
render();
try{const result=await readLowWatch(asset,{fetchImpl,signal:active.signal,now});if(!disposed&&!active.signal.aborted)cycles.set(asset,result);}
catch{if(!disposed){cycles.delete(asset);cycleFailures.add(asset);}}
finally{clearTimeout(timeout);cycleRequests.delete(asset);if(!disposed)render();}
}));
}
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
for(const asset of LOW_WATCH_ASSETS){const button=container.querySelector(`[data-entry-coin="${asset}"]`);if(button){button.dataset.entryStatus='watch';button.querySelector('[data-entry-label]').textContent='Watch';renderCycle({asset,label:'Watch'},button);}}
for(const state of states){
const target=historyContainer.querySelector(`[data-entry-asset="${state.asset}"]`);if(target){let panel=target.querySelector('[data-entry-setup]');if(!panel){panel=target.ownerDocument.createElement('section');panel.setAttribute('data-entry-setup','');panel.className='entry-setup';target.insertBefore(panel,target.querySelector('.watch-records'));}panel.innerHTML=setupDetails(state.asset);}
}
renderCycleDetail();renderFilter();clearTimeout(cycleTimer);const nextExpiry=[...[...cycles.values()].map(q=>q.retrievedAt+CYCLE_QUOTE_AGE),...[...aths.values()].map(q=>q.observedAt+ATH_MAX_AGE)].filter(t=>t>now());if(nextExpiry.length){cycleTimer=setTimeout(render,Math.min(...nextExpiry)-now()+1);cycleTimer?.unref?.();}
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
if(event.target.closest('[data-cycle-refresh]')){void loadCycles({force:true});return;}
const research=event.target.closest('[data-entry-history]');
if(research){const parent=historyContainer.closest('details');if(parent)parent.open=true;const target=historyContainer.querySelector(`[data-entry-asset="${research.dataset.entryHistory}"]`);if(target){target.open=true;target.querySelector('summary')?.focus();target.scrollIntoView({block:'start',behavior:'auto'});}return;}
const button=event.target.closest('[data-entry-coin]');if(!button||button.hidden)return;
expanded=expanded===button.dataset.entryCoin?null:button.dataset.entryCoin;render();void loadCycles();
}
container.addEventListener('click',click);render();
return {update,updateSetups,loadSetups,loadCycles,recheck(){render();void loadCycles();},destroy(){disposed=true;data=null;setups=null;cycles.clear();aths.clear();athReq?.abort();for(const active of cycleRequests.values())active.abort();cycleRequests.clear();controller?.abort();clearTimeout(timer);clearTimeout(cycleTimer);detail.remove();filter.remove();container.removeEventListener('click',click);}};
}
