import { validateLaunchResearch, researchFreshness } from './launch-research-data.mjs?v=20261007.launches1';

const DATA_URL = new URL('../data/launch-research.json', import.meta.url);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const stamp = value => new Intl.DateTimeFormat('en-AU', {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', timeZoneName:'short'}).format(new Date(value));
const statusLabel = {prelaunch:'Prelaunch', closed:'Closed', watch:'Watch only', available:'Reported available'};
const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}<span class="sr-only">, opens in a new tab</span> ↗</a>`;

export function launchResearchMarkup(data, now = Date.now()) {
  const stale = researchFreshness(data, now) === 'stale';
  const access = data.candidates.some(candidate => candidate.status !== 'closed' && candidate.venues.some(venue => venue.status === 'available'));
  const cards = data.candidates.map(candidate => {
    const launch = candidate.launch;
    const date = launch.date ? new Intl.DateTimeFormat('en-AU', {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(launch.date+'T12:00:00Z')) : null;
    const launchCopy = date ? `Announced launch: ${date}${launch.time_utc ? ' · '+launch.time_utc.slice(0,5)+' UTC' : ' · time unconfirmed'}` : 'Launch date unconfirmed';
    const venues = candidate.venues.filter(venue => venue.status !== 'unconfirmed');
    const venueCopy = venues.length ? venues.map(venue => `<p>${esc(venue.name)} · ${esc(venue.status === 'available' ? 'reported available' : venue.status)}${stale ? ' at last check' : ''}<br>${link(venue.url, 'Official '+venue.name+' page')}</p>`).join('') : '<p>No confirmed venue or trading link.</p>';
    return `<article class="launch-card"><div class="launch-card-heading"><div><h3>${esc(candidate.name)}</h3><p class="launch-symbol">${esc(candidate.symbol)}</p></div><span class="launch-status">${stale?'Last report: ':''}${statusLabel[candidate.status]}</span></div><p class="launch-summary">${esc(candidate.summary)}</p><p class="launch-date">${esc(launchCopy)}</p><div class="launch-venues">${venueCopy}</div><p class="launch-eligibility">Australian eligibility unverified.</p><details class="launch-details"><summary>Risks &amp; official sources</summary><ul>${candidate.risks.map(risk=>`<li>${esc(risk)}</li>`).join('')}</ul><p>${link(candidate.official_url, 'Official project site')}</p><ul class="launch-sources">${candidate.sources.map(source=>`<li>${link(source.url,source.label)}<small>Checked ${esc(stamp(source.checked_at))}</small></li>`).join('')}</ul></details></article>`;
  }).join('');
  return `<div class="launch-meta"><p>Checked ${esc(stamp(data.checked_at))}</p><span class="launch-freshness${stale?' is-stale':''}">${stale?'Needs recheck · details may have changed':'Source-checked research'}</span></div>${!access?'<p class="launch-access">No open opportunities confirmed in this check.</p>':''}${cards?`<div class="launch-grid">${cards}</div>`:'<p class="launch-empty">No current candidates passed the research checks.</p>'}`;
}

/** Public same-origin data only. Independent of authentication, holdings and wallet selection. */
export function createLaunchResearch({container, fetchImpl=globalThis.fetch?.bind(globalThis), now=()=>Date.now(), timeoutMs=8000}={}) {
  if (!container) throw new Error('Launch research container required');
  let active=null, disposed=false;
  const render = html => {if(!disposed)container.innerHTML=html;};
  async function load() {
    if(disposed||active)return;
    const controller=new AbortController();active=controller;
    container.setAttribute('aria-busy','true');
    render('<p class="launch-empty" role="status">Loading public launch research…</p>');
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      if(typeof fetchImpl!=='function')throw new Error('Fetch unavailable');
      const response=await fetchImpl(DATA_URL,{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      if(!response.ok)throw new Error('Research unavailable');
      if(Number(response.headers?.get('content-length')||0)>65536)throw new Error('Research too large');
      const text=await response.text();
      if(new TextEncoder().encode(text).length>65536)throw new Error('Research too large');
      if(controller.signal.aborted||disposed)return;
      const data=validateLaunchResearch(JSON.parse(text),{now:now()});
      render(launchResearchMarkup(data,now()));
    } catch {
      render('<p class="launch-empty" role="status">Launch research could not be verified. Portfolio balances are unaffected.</p><button class="button launch-retry" type="button" data-launch-retry>Retry research</button>');
    } finally {
      clearTimeout(timer);active=null;if(!disposed)container.removeAttribute('aria-busy');
    }
  }
  const onClick=event=>{if(event.target.closest('[data-launch-retry]'))void load();};
  container.addEventListener('click',onClick);
  return {load,destroy(){disposed=true;active?.abort();container.removeEventListener('click',onClick);container.removeAttribute('aria-busy');}};
}

const mount=globalThis.document?.getElementById('launchResearchContent');
if(mount){let research=createLaunchResearch({container:mount});void research.load();globalThis.addEventListener?.('pagehide',()=>research.destroy());globalThis.addEventListener?.('pageshow',event=>{if(event.persisted){research=createLaunchResearch({container:mount});void research.load();}});}
