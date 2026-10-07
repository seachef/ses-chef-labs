import {validateNewsDesk,validateEntryWatch,newsFreshness,ENTRY_WATCH_ASSETS} from './news-data.mjs?v=20261007.news1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>new Intl.DateTimeFormat('en-AU',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(v.slice(0,10)+'T12:00:00Z'));
const when=v=>new Intl.DateTimeFormat('en-AU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(v))+' UTC';
const source=(url,name)=>url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}<span class="sr-only">, opens in a new tab</span></a>`:esc(name);
const labels={baseline:'First recorded day',lower_low:'Lower daily low',not_lower_low:'No lower daily low',unknown:'Not verified'};

export function newsMarkup(data,now=Date.now()){
 validateNewsDesk(data,{now});const fresh=newsFreshness(data,now);
 const status=fresh.status==='never'?'First news check pending':fresh.status==='stale'?'Needs a new check':'Sources checked';
 return `<p class="news-check${fresh.status==='stale'?' is-stale':''}">${status}${data.checked_at?' · '+esc(when(data.checked_at)):''}</p>${data.items.length?`<ul class="news-bullets">${data.items.map(item=>`<li><div class="news-item-heading"><span class="news-coins">${item.coins.map(esc).join(' · ')}</span><h3>${esc(item.headline)}</h3></div><p>${esc(item.what_happened)} <strong>Why it matters:</strong> ${esc(item.why_it_matters)}</p><p class="news-risk"><strong>Keep in mind:</strong> ${esc(item.risk)}</p><p class="news-source">${source(item.source.url,item.source.name)} · Published ${esc(item.source.published_at?when(item.source.published_at):day(item.source.published_date)+' · time not supplied')}<span>Checked ${esc(when(item.source.retrieved_at))}</span></p></li>`).join('')}</ul>`:'<p class="news-empty">No source-checked stories yet. The next brief will appear here after its sources are verified.</p>'}`;
}

export function watchMarkup(data,now=Date.now()){
 validateEntryWatch(data,{now});
 const superseded=new Set(data.records.map(r=>r.supersedes).filter(Boolean));
 return `<p class="watch-explainer">A lower low means one finished day reached a lower price than the previous recorded day. It can also mean the fall is continuing. It is not a buy signal.</p><div class="watch-coins">${ENTRY_WATCH_ASSETS.map(asset=>{
  const all=data.records.filter(r=>r.asset===asset),effective=all.filter(r=>!superseded.has(r.id)),observed=effective.filter(r=>r.status==='observed').sort((a,b)=>Date.parse(a.candle_close_at)-Date.parse(b.candle_close_at)),lastAttempt=effective.at(-1),latest=lastAttempt?.status==='unavailable'?lastAttempt:observed.at(-1),old=latest&&(now-Date.parse(latest.observed_at)>36*3600000||latest.status==='observed'&&now-Date.parse(latest.candle_close_at)>48*3600000),comparisonChanged=latest?.compared_with&&superseded.has(latest.compared_with);
  return `<details class="watch-coin"><summary><strong>${esc(asset)}</strong><span>${latest?comparisonChanged?'Comparison needs recheck':esc(labels[latest.assessment]):'First check pending'}${old?' · needs recheck':''}</span><small>${latest?.status==='observed'?'Low '+esc(latest.low)+' '+esc(latest.quote_currency)+' · '+esc(day(latest.candle_open_at)):latest?'Price history unavailable':'No recorded candles yet'}</small></summary>${latest?.status==='unavailable'?`<p class="watch-note">${esc(latest.note)}</p>`:''}${all.length?`<ol class="watch-records">${[...all].reverse().map(record=>`<li><p><strong>${record.status==='observed'?esc(day(record.candle_open_at)):esc(day(record.observed_at))}</strong> · ${esc(labels[record.assessment])}${superseded.has(record.id)?' · corrected by a later record':''}${record.supersedes?' · correction':''}${record.compared_with&&superseded.has(record.compared_with)?' · earlier comparison candle was corrected':''}</p>${record.status==='observed'?`<p>Low ${esc(record.low)} · Close ${esc(record.close)} ${esc(record.quote_currency)}<br>Volume ${esc(record.volume)} ${esc(record.asset)}</p><p class="news-source">${esc(record.venue)} · ${esc(record.pair)} · daily candle<br>Closed ${esc(when(record.candle_close_at))}</p>`:'<p>No verified completed candle.</p>'}<p class="watch-note">${esc(record.note)}</p><p class="news-source">${source(record.source_url,'Public source')} · Checked ${esc(when(record.observed_at))}</p></li>`).join('')}</ol>`:'<p class="news-empty">No history has been invented. Verified daily checks will be logged here.</p>'}</details>`;
 }).join('')}</div>`;
}

/** Independent public files. Never reads accounts, holdings or the private plan. */
export function createNewsDesk({newsContainer,watchContainer,fetchImpl=globalThis.fetch?.bind(globalThis),now=()=>Date.now(),timeoutMs=8000}={}){
 if(!newsContainer||!watchContainer)throw Error('News and watch containers required');
 let disposed=false;const active=new Map();
 async function load(kind){
  if(disposed||active.has(kind))return;
  const container=kind==='news'?newsContainer:watchContainer,controller=new AbortController();active.set(kind,controller);container.setAttribute('aria-busy','true');
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const path=kind==='news'?'news-desk.json':'entry-watch.json';
   const response=await fetchImpl(new URL('../data/'+path,import.meta.url),{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
   const max=kind==='news'?65536:4000000;if(!response.ok||Number(response.headers?.get('content-length')||0)>max)throw Error('Feed unavailable');
   const text=await response.text();if(new TextEncoder().encode(text).length>max)throw Error('Feed too large');
   if(disposed||controller.signal.aborted)return;
   const data=JSON.parse(text);container.innerHTML=kind==='news'?newsMarkup(data,now()):watchMarkup(data,now());
  }catch{if(!disposed)container.innerHTML=`<p class="news-empty" role="status">${kind==='news'?'News':'Entry-watch history'} could not be verified. No new claims are shown.</p><button class="button news-retry" type="button" data-news-retry="${kind}">Retry ${kind==='news'?'news':'history'}</button>`;}
  finally{clearTimeout(timer);active.delete(kind);if(!disposed)container.removeAttribute('aria-busy');}
 }
 const click=event=>{const button=event.target.closest('[data-news-retry]');if(button)void load(button.dataset.newsRetry);};
 newsContainer.addEventListener('click',click);watchContainer.addEventListener('click',click);
 return {load:()=>Promise.all([load('news'),load('watch')]),destroy(){disposed=true;for(const controller of active.values())controller.abort();for(const container of [newsContainer,watchContainer]){container.removeEventListener('click',click);container.removeAttribute('aria-busy');}}};
}
const doc=globalThis.document,newsContainer=doc?.getElementById('newsDeskContent'),watchContainer=doc?.getElementById('entryWatchContent');
if(newsContainer&&watchContainer){let desk=createNewsDesk({newsContainer,watchContainer});void desk.load();globalThis.addEventListener?.('pagehide',()=>desk.destroy());globalThis.addEventListener?.('pageshow',event=>{if(event.persisted){desk=createNewsDesk({newsContainer,watchContainer});void desk.load();}});}
