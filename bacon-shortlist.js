/* Read-only, source-linked paper research. Never connected to order controls. */
(function(root){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.href:null;}catch{return null;}};
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  const time=s=>Number.isFinite(Date.parse(s));
  const fmt=n=>n.toLocaleString('en-AU',{maximumFractionDigits:n<1?8:2});
  const when=s=>time(s)?new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Perth',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(s))+' WA':'Date unavailable';
  function validItem(x){
    if(!x||!x.id||!/^[A-Z0-9]{1,20}$/.test(x.symbol)||!x.pair||!/^[A-Z]{2,10}$/.test(x.currency)||!url(x.sourceUrl)||!time(x.publishedAt)||!time(x.expiresAt)||Date.parse(x.expiresAt)<=Date.parse(x.publishedAt)||!['source-explicit','research-derived'].includes(x.levelBasis))return false;
    const e=Array.isArray(x.entry)?x.entry:[x.entry];
    if(![1,2].includes(e.length)||!e.every(positive)||e[0]>e[e.length-1]||!positive(x.stop)||!Array.isArray(x.targets)||!x.targets.length||!x.targets.every(positive))return false;
    return x.side==='buy'?x.stop<e[0]&&x.targets.every(n=>n>e[e.length-1]):x.side==='sell'&&x.stop>e[e.length-1]&&x.targets.every(n=>n<e[0]);
  }
  function validDocument(d){return !!(d&&d.schema===1&&d.paperOnly===true&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&time(d.checkedAt)&&time(d.deadlineAt)&&['ready','nothing-to-report','partial','unavailable'].includes(d.status)&&typeof d.summary==='string'&&Array.isArray(d.items)&&d.items.every(validItem)&&Array.isArray(d.watchlist)&&Array.isArray(d.sourceChecks));}
  function render(d,now=Date.now()){
    if(!validDocument(d))throw Error('Invalid paper shortlist');
    const stale=now-Date.parse(d.checkedAt)>26*3600000||Date.parse(d.checkedAt)>now+60000;
    const seen=new Set();
    const active=d.items.filter(x=>Date.parse(x.expiresAt)>now&&Date.parse(x.publishedAt)<=now+60000&&!seen.has(x.id)&&seen.add(x.id));
    const hidden=d.items.length-active.length;
    let html='<p class="tiny">'+esc(d.date)+' · Checked '+esc(when(d.checkedAt))+' · Paper research only</p>';
    if(stale)html+='<p class="shortlist-warning" role="status">Research is stale. Last saved report shown; wait for the next check.</p>';
    if(d.status==='unavailable')html+='<p class="shortlist-warning" role="status">Source check unavailable. Coverage is incomplete.</p>';
    else if(d.status==='partial')html+='<p class="shortlist-warning">Some sources could not be fully checked.</p>';
    html+='<p>'+esc(d.summary||(!active.length?'Nothing to report.':'Paper shortlist updated.'))+'</p>';
    if(!active.length)html+='<p class="tiny">No complete, current paper setup verified. Entry, stop and targets are required.</p>';
    if(hidden)html+='<p class="tiny">'+hidden+' expired, future-dated or duplicate setup(s) withheld.</p>';
    html+=active.slice(0,3).map(x=>'<article class="tile shortlist-item"><div class="row"><h3>'+esc(x.symbol)+'</h3><span class="chip">Paper '+esc(x.side)+'</span></div><p class="tiny">'+esc(x.pair)+' · '+esc(x.currency)+' · '+esc(x.levelBasis==='source-explicit'?'Bacon’s explicit levels':'Research-derived levels, not Bacon’s call')+'</p><dl class="shortlist-levels"><div><dt>Entry · '+esc(x.currency)+'</dt><dd>'+esc((Array.isArray(x.entry)?x.entry:[x.entry]).map(fmt).join('–'))+'</dd></div><div><dt>Stop · '+esc(x.currency)+'</dt><dd>'+esc(fmt(x.stop))+'</dd></div><div><dt>Targets · '+esc(x.currency)+'</dt><dd>'+esc(x.targets.map(fmt).join(' / '))+'</dd></div></dl><p>'+esc(x.rationale||'')+'</p><small>Posted '+esc(when(x.publishedAt))+' · Expires '+esc(when(x.expiresAt))+'</small><p><a href="'+esc(url(x.sourceUrl))+'" target="_blank" rel="noopener noreferrer">'+esc(x.sourceName||'Original source')+' ↗</a></p></article>').join('');
    if(d.watchlist.length)html+='<details><summary>Incomplete research · '+d.watchlist.length+'</summary>'+d.watchlist.slice(0,5).map(x=>'<p class="details-body"><strong>'+esc(x.symbol)+'</strong> · '+esc(x.note)+'<br>Missing: '+esc((Array.isArray(x.missing)?x.missing:[]).join(', '))+'. '+(url(x.sourceUrl)?'<a href="'+esc(url(x.sourceUrl))+'" target="_blank" rel="noopener noreferrer">Source ↗</a>':'')+'</p>').join('')+'</details>';
    html+='<details><summary>Source checks & dated record</summary>'+d.sourceChecks.map(x=>'<p class="details-body">'+(url(x.url)?'<a href="'+esc(url(x.url))+'" target="_blank" rel="noopener noreferrer">'+esc(x.name)+'</a>':esc(x.name))+' · '+esc(x.status)+'<br>'+esc(x.detail||'')+'<br>'+esc(when(x.checkedAt))+'</p>').join('')+'<p><a href="data/bacon-research-log.json" target="_blank" rel="noopener noreferrer">Open dated research record ↗</a></p></details>';
    return html;
  }
  const api={validItem,validDocument,render};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BaconShortlist=api;
})(typeof globalThis==='object'?globalThis:this);
