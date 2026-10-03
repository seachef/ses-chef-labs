/** Display-only, account-scoped portfolio visuals. Never fetch, cache or synthesize history. */
import {groupHoldings,decimalSum,aud,priceUsd,portfolioTotal,valuationContext} from './model.mjs?v=20261003.personal1';
import {recordedHistorySummary,RANGE_OPTIONS,signedDecimalDifference} from './history.mjs?v=20261002.details1';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const positive=v=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)&&/[1-9]/.test(v);
const valid=v=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v);
const colors=['#82e5cb','#a7adff','#77c7f5','#edb689','#da9dd7','#bfd88c'];
const date=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}):'Unknown time';
const fullDate=v=>Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-AU',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}):'Unknown time';
const money=(v,metric)=>v==null?'Unavailable':metric==='price'?priceUsd(v):aud(v);
function parts(v){const [w,f='']=v.split('.');return {n:BigInt(w+f),s:f.length};}
// Only the bounded graphical ratio becomes a Number. Monetary totals stay exact.
function ratio(a,b,scale=1000000n){if(!positive(b))return 0;const x=parts(a),y=parts(b);return Number(x.n*10n**BigInt(y.s)*scale/(y.n*10n**BigInt(x.s)))/Number(scale);}
function scope(model){return !!model?.account?.id&&!!model.account.owner_id&&model.snapshot?.account_id===model.account.id&&model.snapshot?.owner_id===model.account.owner_id;}
export function scopedHistory({model,historyModels=[],rangeKey='1D',now=Date.now(),coinKey=null,metric='value'}={}){
 const models=scope(model)?historyModels.filter(m=>scope(m)&&m.account.id===model.account.id&&m.account.owner_id===model.account.owner_id):[];
 return recordedHistorySummary({currentModel:scope(model)?model:null,models,rangeKey,now,coinKey,metric,historyLimited:(model?.history?.length||0)>=730});
}
export function allocationSummary(model){
 const pendingWallets=(model?.wallets||[]).filter(w=>w.provider_status==='provider_pending').length;
 const holdings=scope(model)?groupHoldings(model):[],held=holdings.filter(h=>positive(h.quantity)),priced=held.filter(h=>valid(h.aud)),total=priced.length?decimalSum(priced.map(h=>h.aud)):null;
 const assets=priced.sort((a,b)=>{const d=signedDecimalDifference(b.aud,a.aud);return d==='0'?a.key.localeCompare(b.key):d.startsWith('-')?-1:1;}).map((h,i)=>{const share=ratio(h.aud,total);return {...h,share,percent:positive(h.aud)&&share<.001?'<0.1%':(share*100).toFixed(1)+'%',color:colors[i%colors.length]};});
 return {hasSnapshot:scope(model),pendingWallets,assets,total,pricedAssets:priced.length,unpricedAssets:held.length-priced.length,incomplete:pendingWallets>0||portfolioTotal(model)==null||model?.snapshot?.provenance?.known_asset_inventory_only===true,heldAssets:held.length,carried:valuationContext(model?.snapshot).carried};
}
/** Actual observation coordinates only; invalid rows remain explicit gaps. */
export function chartGeometry(summary,{width=680,height=210,padding=22}={}){
 const points=summary?.points||[],dated=points.filter(p=>Number.isFinite(Date.parse(p.at))),eligible=dated.filter(p=>p.eligible&&valid(p.value));
 if(!eligible.length)return {points:[],gaps:dated.map(p=>({at:p.at})),undated:points.length-dated.length};
 const times=dated.map(p=>Date.parse(p.at)),start=Math.min(...times),end=Math.max(...times);
 let min=eligible[0].value,max=min;for(const p of eligible){if(signedDecimalDifference(p.value,min).startsWith('-'))min=p.value;if(signedDecimalDifference(p.value,max).startsWith('-')===false)max=p.value;}
 const span=signedDecimalDifference(max,min),x=at=>start===end?width/2:padding+(Date.parse(at)-start)/(end-start)*(width-padding*2);
 return {points:eligible.map(p=>({...p,index:points.indexOf(p),x:x(p.at),y:span==='0'?height/2:height-padding-ratio(signedDecimalDifference(p.value,min),span)*(height-padding*2)})),gaps:dated.filter(p=>!p.eligible||!valid(p.value)).map(p=>({at:p.at,x:x(p.at)})),undated:points.length-dated.length,start:dated[0]?.at,end:dated.at(-1)?.at,min,max};
}
function pointCopy(p,metric){return `${fullDate(p?.at)} · ${money(p?.eligible?p.value:null,metric)}${metric==='price'?' · Quote '+fullDate(p?.priceAt):''}`;}
function changeCopy(summary){return summary?.changeAvailable?`${summary.changeFormatted} · ${summary.metric==='price'?'Price':'Value'} change since ${date(summary.baselineAt)}`:'Change unavailable · No comparable recorded values yet';}
function direction(s){return !s?.changeAvailable||s.change==='0'?'neutral':s.change.startsWith('-')?'negative':'positive';}
export function renderRecordedChart(summary,{compact=false,loading=false,error=false}={}){
 const width=compact?112:680,height=compact?40:210,g=chartGeometry(summary,{width,height,padding:compact?5:22}),points=summary?.points||[],metric=summary?.metric;
 if(compact){if(g.points.length<2)return '<span class="pv-no-trend">No trend yet</span>';return `<svg class="pv-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(g.points.length+' recorded observations. No interpolated trend.')}" focusable="false">${g.points.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="2.5"/>`).join('')}${g.gaps.map(p=>`<path class="pv-gap" d="M${p.x} 8v24"/>`).join('')}</svg>`;}
 const latest=g.points.at(-1),selected=latest?.index??0;
 let html=`<div class="pv-recorded"><p class="pv-change pv-${direction(summary)}">${esc(changeCopy(summary))}</p>${loading?'<p class="pv-note" role="status">Loading saved observations…</p>':''}${error?'<p class="pv-note" role="status">Saved history could not be loaded. Current holdings are unchanged.</p>':''}`;
 if(!g.points.length)html+='<div class="pv-empty"><strong>No comparable recorded values in this range</strong><span>Fresh observations will appear here. Imported or carried-forward balances do not create a trend.</span></div>';
 else html+=`<div class="pv-chart-wrap"><svg class="pv-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Saved observations at actual balance observation times. Values are available below." focusable="false"><path class="pv-grid" d="M22 22H658M22 105H658M22 188H658"/>${g.gaps.map(p=>`<path class="pv-gap" d="M${p.x} 22V188"><title>Unavailable observation at ${esc(fullDate(p.at))}</title></path>`).join('')}${g.points.map(p=>`<circle class="pv-observation${p.index===selected?' pv-selected':''}" data-pv-point="${p.index}" cx="${p.x}" cy="${p.y}" r="${p.index===selected?6:4}"><title>${esc(pointCopy(p,metric))}</title></circle>`).join('')}</svg></div><div class="pv-axis"><span>${esc(date(g.start))}</span><span>${esc(date(g.end))}</span></div><label class="pv-inspect"><span>Inspect saved observations</span><input type="range" min="0" max="${points.length-1}" step="1" value="${selected}" data-pv-scrub aria-label="Inspect saved observations" aria-valuetext="${esc(pointCopy(points[selected],metric))}" ${points.length<2?'disabled':''}></label><output class="pv-reading" data-pv-reading aria-live="polite">${esc(pointCopy(points[selected],metric))}</output>`;
 html+=`<p class="pv-note">${g.points.length===1?'One observation; no trend yet. ':''}Recorded points only; gaps are not filled.${g.points.length&&g.gaps.length?' Unavailable observations are marked by dashed guides.':''}${g.undated?' Some observations have no verified date.':''}</p>`;
 if(points.length)html+=`<details class="pv-observations"><summary>Recorded observations (${points.length})</summary><div class="pv-table-wrap"><table><thead><tr><th>Balances observed</th><th>${metric==='price'?'Token price · USD':'Held value · AUD'}</th></tr></thead><tbody>${points.map(p=>`<tr><td>${esc(fullDate(p.at))}${metric==='price'?'<small>Quote '+esc(fullDate(p.priceAt))+'</small>':''}</td><td>${esc(money(p.eligible?p.value:null,metric))}</td></tr>`).join('')}</tbody></table></div></details>`;
 if(summary?.historyLimited)html+='<p class="pv-note">MAX shows available loaded history, which may be limited to the latest 730 observations.</p>';
 return html+'</div>';
}
export function bindRecordedChart(container,summary){
 const input=container.querySelector('[data-pv-scrub]');if(!input)return ()=>{};
 const inspect=()=>{const index=Number(input.value),p=summary.points[index];if(!p)return;const copy=pointCopy(p,summary.metric);input.setAttribute('aria-valuetext',copy);container.querySelector('[data-pv-reading]').textContent=copy;for(const dot of container.querySelectorAll('[data-pv-point]')){const selected=Number(dot.dataset.pvPoint)===index;dot.classList.toggle('pv-selected',selected);dot.setAttribute('r',selected?'6':'4');}};
 input.addEventListener('input',inspect);return ()=>input.removeEventListener('input',inspect);
}
export function renderAllocation(model){
 const a=allocationSummary(model);let offset=0;
 const arcs=a.assets.filter(h=>h.share>0).map(h=>{const arc=`<circle class="pv-arc" cx="80" cy="80" r="62" pathLength="100" stroke="${h.color}" stroke-dasharray="${h.share*100} ${100-h.share*100}" stroke-dashoffset="${-offset}"/>`;offset+=h.share*100;return arc;}).join('');
 return `<section class="pv-allocation"><div class="pv-section-head"><h3>Allocation</h3><span class="pv-badge">PRICED HOLDINGS</span></div><div class="pv-allocation-body"><div class="pv-donut"><svg viewBox="0 0 160 160" aria-hidden="true" focusable="false"><circle class="pv-ring" cx="80" cy="80" r="62"/>${arcs}</svg><div><strong>${a.hasSnapshot?a.pricedAssets:'—'}</strong><span>${a.hasSnapshot?'priced '+(a.pricedAssets===1?'asset':'assets'):'Awaiting snapshot'}</span></div></div><ul class="pv-legend">${a.assets.map(h=>`<li><span class="pv-key" style="--pv-color:${h.color}"></span><span>${esc(h.symbol||'Token')}</span><strong>${esc(h.percent)}</strong></li>`).join('')||(a.hasSnapshot?'<li>No priced held assets yet</li>':'<li>No verified holdings snapshot</li>')}</ul></div><p class="pv-note">${a.incomplete?'Incomplete valuation. ':''}${a.pendingWallets?`${a.pendingWallets} wallet ${a.pendingWallets===1?'provider is':'providers are'} pending; those balances are unknown. `:''}${a.unpricedAssets?`${a.unpricedAssets} held ${a.unpricedAssets===1?'asset is':'assets are'} unpriced or excluded. `:''}Percentages use priced liquid holdings + staked principal only. Unminted rewards are excluded.${a.carried?' Balances are carried forward, not refreshed.':''}</p></section>`;
}
export function renderCoinSparkline(options={}){return renderRecordedChart(scopedHistory({...options,metric:'value'}),{compact:true});}
const bindings=new WeakMap();
/** Call again after parent-owned range/history/account updates. Return destroy() on teardown. */
export function renderVisuals({container,model,historyModels=[],rangeKey='1D',now=Date.now(),loading=false,error=false,onRangeChange}={}){
 if(!container)throw TypeError('A visual container is required');bindings.get(container)?.();
 const options={model,historyModels,rangeKey,now},summary=scopedHistory(options),a=allocationSummary(model);
 container.innerHTML=`<div class="pv-layout"><section class="pv-performance"><div class="pv-section-head"><h3>Holdings value</h3><span class="pv-badge">SAVED OBSERVATIONS</span></div>${renderRecordedChart(summary,{loading,error})}<div class="pv-ranges" role="group" aria-label="Portfolio history range">${RANGE_OPTIONS.map(r=>`<button type="button" data-pv-range="${r.key}" aria-pressed="${r.key===summary.range}">${r.label}</button>`).join('')}</div><p class="pv-note">Recorded AUD holdings value. Changes include holdings and market prices; deposits and withdrawals are not separated. This is not investment profit.</p></section>${renderAllocation(model)}</div>`;
 const unbind=bindRecordedChart(container,summary),click=event=>{const range=event.target.closest('[data-pv-range]');if(range&&container.contains(range))onRangeChange?.(range.dataset.pvRange,range);};container.addEventListener('click',click);
 const destroy=()=>{unbind();container.removeEventListener('click',click);if(bindings.get(container)===destroy)bindings.delete(container);};bindings.set(container,destroy);return {summary,allocation:a,destroy};
}
