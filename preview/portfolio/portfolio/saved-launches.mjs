import {validateLaunchResearch,validateLaunchLedger} from './launch-research-data.mjs?v=20261007.launches1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
export function savedLaunchMarkup(current,ledger,now=Date.now()){
 validateLaunchResearch(current,{now});validateLaunchLedger(ledger,{now});
 const leads=current.candidates.map(c=>`<li><strong>${esc(c.symbol)} · ${esc(c.status==='watch'?'Watch':c.status)}</strong><p>${esc(c.summary)}</p><p>${c.launch.date?'Announced date: '+esc(c.launch.date)+(c.launch.time_utc?' · '+esc(c.launch.time_utc)+' UTC':' · time unconfirmed'):'Launch date unconfirmed'}</p><p class="news-source"><a href="${esc(c.launch.source_url??c.official_url)}" target="_blank" rel="noopener noreferrer">Official source</a> · Last checked ${esc(when(current.checked_at))}</p></li>`).join('');
 return `${leads?'<ul class="watch-records">'+leads+'</ul>':'<p>No current launch leads saved.</p>'}<details class="watch-coin"><summary>Saved revisions · ${ledger.entries.length}</summary><ol class="watch-records">${[...ledger.entries].reverse().map(row=>`<li><strong>${esc(row.candidate_id)} · ${esc(row.event)}</strong><p>${esc(row.note)}</p><p class="news-source">${esc(when(row.checked_at))}</p></li>`).join('')}</ol></details>`;
}
export function createSavedLaunches({container,fetchImpl=globalThis.fetch?.bind(globalThis),now=()=>Date.now(),timeoutMs=8000}={}){
 let disposed=false,controller=null;
 async function load(){if(disposed||controller)return;controller=new AbortController();const active=controller,timer=setTimeout(()=>active.abort(),timeoutMs);container.setAttribute('aria-busy','true');
  try{const data=await Promise.all(['launch-research.json','launch-research-ledger.json'].map(async file=>{const response=await fetchImpl(new URL('../data/'+file,import.meta.url),{credentials:'omit',cache:'no-store',redirect:'error',signal:active.signal});if(!response.ok||Number(response.headers?.get('content-length')||0)>1000000)throw Error('Unavailable');const text=await response.text();if(new TextEncoder().encode(text).length>1000000)throw Error('Too large');return JSON.parse(text);}));if(!disposed&&!active.signal.aborted)container.innerHTML=savedLaunchMarkup(...data,now());}
  catch{if(!disposed)container.innerHTML='<p class="news-empty">Saved leads could not be verified. Close and reopen to retry.</p>';}
  finally{clearTimeout(timer);if(controller===active)controller=null;if(!disposed)container.removeAttribute('aria-busy');}
 }
 return {load,destroy(){disposed=true;controller?.abort();container.removeAttribute('aria-busy');}};
}
