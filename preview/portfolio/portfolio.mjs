import { AUTH_CONFIG } from './portfolio/auth-config.mjs';
import { resumeAuthentication, beginGitHubSignIn } from './portfolio/auth-client.mjs';
import { COINS, SOCIALS, safeURL, socialURL, displayDecimal, aud, groupHoldings, portfolioTotal, historyPoints, coinMetadata, snapshotFreshness } from './portfolio/model.mjs';
import { formatUnits } from './portfolio/domain.mjs';
import { createPortfolioAdapter } from './portfolio/adapter.mjs';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const when=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-AU',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Date unavailable';
// Production is intentionally unconfigured until private Auth and RLS have been verified.
// An approved bootstrap may supply an authenticated client; never embed service-role keys.
let adapter=createPortfolioAdapter(globalThis.seaChefPortfolioClient||null);
const initialHoldings=$('holdingsBody').innerHTML,initialStake=$('stakeList').innerHTML;
let model=null,range=30,requestId=0,busy=false,toastTimer=null,authStatus='not-configured',researchBusy=false;
function toast(message){$('statusToast').textContent=message;$('statusToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('statusToast').hidden=true;},7000);}
function clearPrivate(){
  model=null;$('watchedWalletList').innerHTML='<p>Private wallet addresses appear after sign-in.</p>';$('holdingsBody').innerHTML=initialHoldings;$('holdingsBody').closest('table').querySelector('caption').textContent='Supported assets. Balances are unavailable until a private account is connected.';$('stakeList').innerHTML=initialStake;$('portfolioValue').textContent='A$ —';$('portfolioValue').setAttribute('aria-label','Portfolio value unavailable');$('walletSummary').textContent='Combined wallets · Ethereum';$('coinsSubtitle').textContent='Combined balances, kept private';$('portfolioCaption').textContent='Connect your private account to see verified balances';$('syncStatus').textContent='Not synced · Private connection pending';$('coinPrivacy').innerHTML='<img src="assets/ui/lock-keyhole.svg" width="18" height="18" alt="">Balances appear only after authentication';$('maturitySummary').textContent='Your stake maturities will appear after sync';$('liquidRewardBalances').innerHTML='<p>HDRN <span>—</span></p><p>ICSA <span>—</span></p>';$('rewardEstimates').innerHTML='<p>Private reward estimates are not connected yet.</p>';$('historyEmpty').hidden=false;$('historyData').hidden=true;$('historyTable').replaceChildren();const canvas=$('historyChart');canvas.getContext?.('2d')?.clearRect(0,0,canvas.width,canvas.height);$('historyCaption').textContent='No verified snapshots yet';$('signOut').hidden=true;renderSocials();
}
function connectionCopy(status){
  authStatus=status;$('connectionBadge').textContent=status==='ready'?'Private session':status==='signed-out'?'Signed out':['no-account','setup-pending'].includes(status)?'Setup pending':'Not connected';
  $('connectionDescription').textContent=status==='ready'?'Your private account is connected.':status==='signed-out'?'Sign in with GitHub to open your private account.':['no-account','setup-pending'].includes(status)?'Signed in. Your private portfolio setup is still pending.':'Your private portfolio is not connected yet.';
  $('connectionExplanation').textContent=status==='ready'?'Balances are read from your authenticated, owner-only snapshots and held in memory for this session.':status==='signed-out'?'Your session stays in this tab. Private wallet balances are loaded only after authentication and owner access are verified.':['no-account','setup-pending'].includes(status)?'Your sign-in succeeded. Owner access and verified wallet snapshots still need to be provisioned before balances can appear.':'Sign-in and verified balance snapshots still need to be enabled. Wallet addresses and balances are not stored in this public page.';
  $('signOut').hidden=!['ready','no-account','setup-pending'].includes(status);$('signIn').hidden=!AUTH_CONFIG.enabled||['ready','no-account','setup-pending'].includes(status);
}
function openConnection(){if(!$('connectionDialog').open)$('connectionDialog').showModal();}
async function refreshPortfolio({announce=false}={}){
  if(busy)return;busy=true;const focusedBefore=document.activeElement;const id=++requestId;$('refreshPortfolio').disabled=true;$('checkConnection').disabled=true;$('connectionResult').textContent='Checking private connection…';
  try{
    const result=await adapter.readPortfolio();if(id!==requestId)return;clearPrivate();if(result.status==='not-configured'&&AUTH_CONFIG.enabled)result.status='signed-out';connectionCopy(result.status);
    if(result.status==='ready'){
      model=result.model;renderModel();$('connectionResult').textContent=model.snapshot?'Stored snapshot loaded.':'Private account connected. First verified sync pending.';
      const links=await adapter.getSocialLinks();if(id===requestId&&model)renderSocials(links);
      if(announce)toast(model.snapshot?'Latest stored snapshot loaded. Refresh does not trigger transactions or a new chain sync.':'First verified sync is pending.');
    }else{
      const message=result.status==='signed-out'?'No signed-in session. Your balances remain private.':['no-account','setup-pending'].includes(result.status)?'Signed in. Private owner access and snapshots are still pending.':'Private connection is not configured yet. No balances have been loaded.';
      $('connectionResult').textContent=message;if(announce)toast(message);
    }
  }catch(error){if(id!==requestId)return;clearPrivate();connectionCopy('error');$('connectionResult').textContent='The private snapshot could not be verified. Balances have been cleared.';$('syncStatus').textContent='Snapshot unavailable · Please retry';if(announce)toast('Snapshot unavailable. No cached private balances are being shown.');}
  finally{if(id===requestId){busy=false;$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;if(['refreshPortfolio','checkConnection'].includes(focusedBefore?.id)&&document.activeElement===document.body)focusedBefore.focus();}}
}
function renderModel(){
  if(!model)return;const snapshot=model.snapshot;
  $('walletSummary').textContent=model.wallets.length?`All ${model.wallets.length} wallets · Ethereum`:'No wallets provisioned';
  $('watchedWalletList').innerHTML=model.wallets.length?model.wallets.map(w=>`<div class="watched-wallet"><span>${esc(w.label||'Watched wallet')}</span><details><summary>View address</summary><p class="wallet-address">${esc(w.address)}</p></details></div>`).join(''):'<p>No watched wallets provisioned yet.</p>';
  if(!snapshot){$('portfolioCaption').textContent='First verified sync pending';$('coinsSubtitle').textContent='Private account connected · awaiting snapshot';$('syncStatus').textContent='Connected · No verified snapshot yet';$('coinPrivacy').textContent='Private account connected. Balances appear after first sync.';return;}
  const holdings=groupHoldings(model),total=portfolioTotal(model),freshness=snapshotFreshness(snapshot);
  $('coinsSubtitle').textContent=`Combined across ${snapshot.observed_wallets} of ${snapshot.expected_wallets} wallets`;
  $('portfolioValue').textContent=total==null?'A$ —':aud(total);$('portfolioValue').setAttribute('aria-label',total==null?'Complete AUD portfolio value unavailable':`${aud(total)} indicative portfolio value`);
  $('portfolioCaption').textContent=total==null?'Full AUD valuation unavailable · missing prices, FX or wallet coverage':freshness==='stale'?'Saved value · Snapshot is over 36 hours old':'Indicative total · Liquid tokens + staked principal';
  $('syncStatus').textContent=`${freshness==='stale'?'Stale snapshot':freshness==='unverified-time'?'Snapshot time unverified':snapshot.status==='partial'?'Saved partial snapshot':'Saved verified snapshot'} · ${when(snapshot.observed_at)}`;
  $('coinPrivacy').textContent=`${snapshot.unpriced_assets} unpriced asset${snapshot.unpriced_assets===1?'':'s'} · ${snapshot.balance_source||'Verified snapshot'} · Values exclude unminted rewards`;
  $('holdingsBody').innerHTML=holdings.length?holdings.map(h=>{
    const coin=coinMetadata(h),image=coin?`<img class="coin-icon" src="assets/coins/${coin.icon}" width="58" height="58" alt="">`:'',staked=h.staked!=='0';
    return `<tr><th scope="row"><div class="asset">${image}<div><span class="asset-name">${esc(coin?.name||h.symbol||'Token')}</span><span class="asset-symbol">${esc(h.symbol)}${!coin?' · Unlisted asset':''}</span></div></div></th><td><span class="amount" title="${esc(h.quantity)}">${displayDecimal(h.quantity)}</span><span class="holding-detail">${staked?`${displayDecimal(h.liquid)} liquid · ${displayDecimal(h.staked)} staked`:'Liquid tokens'}</span></td><td class="money">${aud(h.aud)}${h.aud==null?'<span class="holding-detail">Unpriced</span>':''}</td></tr>`;
  }).join(''):'<tr><td colspan="3">No token observations in this snapshot. This does not establish a zero balance.</td></tr>';
  $('holdingsBody').closest('table').querySelector('caption').textContent='Verified liquid token balances and staked principal, combined by chain and token contract.';
  const stakes=model.stakes.filter(s=>s.protocol==='hex'&&s.status!=='unlocked').sort((a,b)=>(a.maturity_date||'z').localeCompare(b.maturity_date||'z'));
  $('maturitySummary').textContent=stakes.length?`${stakes.length} recorded stake${stakes.length===1?'':'s'} · ${stakes[0].maturity_date?'Next maturity '+stakes[0].maturity_date:'Maturity date pending'}`:'No active HEX stakes in the latest snapshot';
  $('stakeList').classList.toggle('empty-detail',!stakes.length);
  $('stakeList').innerHTML=stakes.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Stake</th><th>Principal · HEX</th><th>Maturity</th><th>Status</th></tr></thead><tbody>${stakes.map(s=>`<tr><td>${esc(s.stake_id)}</td><td>${displayDecimal(formatUnits(s.principal_raw,s.decimals))}</td><td>${esc(s.maturity_date||'Unverified')}</td><td>${esc(s.status)}</td></tr>`).join('')}</tbody></table></div><p class="fine-print">Principal only. Future payout is not estimated. Ending stakes is never performed here.</p>`:'<h2>No active HEX stakes recorded</h2><p>The latest snapshot has no active HEX stake observations.</p>';
  $('liquidRewardBalances').innerHTML=['HDRN','ICSA'].map(symbol=>{const coin=COINS.find(c=>c.symbol===symbol),row=holdings.find(h=>h.chainId===1&&h.assetId.toLowerCase()===coin.assetId);return `<p>${symbol}<span>${row?displayDecimal(row.liquid):'Not observed'}</span></p>`;}).join('');
  $('rewardEstimates').innerHTML=model.rewardEstimates.length?model.rewardEstimates.map(r=>`<div><p>${r.estimate_status==='estimated_unminted'&&r.amount_raw!=null?displayDecimal(formatUnits(r.amount_raw,r.decimals))+' HDRN':'Estimate unavailable'}</p><p class="fine-print">Stake ${esc(r.source_stake_id)} · ${esc(when(r.observed_at))}</p><p class="fine-print">${esc(r.caveat)}</p></div>`).join(''):'<p>No verified unminted reward estimates recorded.</p>';
  renderHistory();
}
function renderHistory(){
  const points=historyPoints(model?.history,range),available=points.filter(p=>p.value!=null);
  $('historyEmpty').hidden=available.length>0;$('historyData').hidden=!available.length;
  $('historyCaption').textContent=available.length?`${available.length} verified value${available.length===1?'':'s'} · Portfolio value, not profit`:'No verified values in this range';
  if(!available.length)return;
  $('historyTable').innerHTML='<table class="data-table"><thead><tr><th>Date</th><th>Indicative AUD</th></tr></thead><tbody>'+points.map(p=>`<tr><td>${esc(when(p.at))}</td><td>${p.value==null?'Unavailable':aud(p.value)}</td></tr>`).join('')+'</tbody></table>';
  const canvas=$('historyChart'),width=canvas.clientWidth||400,height=160,dpr=Math.min(globalThis.devicePixelRatio||1,2);canvas.width=width*dpr;canvas.height=height*dpr;const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
  // Actual value snapshots only. Null observations break the line; no backfilled history.
  const numeric=available.map(p=>Number(p.value));if(numeric.some(v=>!Number.isFinite(v)))return;
  const min=Math.min(...numeric),max=Math.max(...numeric),span=max-min||Math.max(1,max*.05),start=Date.parse(points[0].at),end=Date.parse(points.at(-1).at),x=p=>20+(Date.parse(p.at)-start)/(end-start||1)*(width-40),y=p=>height-20-(Number(p.value)-min)/span*(height-40);
  ctx.strokeStyle='#2b596c';ctx.lineWidth=1;for(const yy of [20,80,140]){ctx.beginPath();ctx.moveTo(15,yy);ctx.lineTo(width-15,yy);ctx.stroke();}
  ctx.strokeStyle='#67f1d9';ctx.fillStyle='#67f1d9';ctx.lineWidth=2;let connected=false;ctx.beginPath();for(const p of points){if(p.value==null){connected=false;continue;}if(connected)ctx.lineTo(x(p),y(p));else ctx.moveTo(x(p),y(p));connected=true;}ctx.stroke();for(const p of available){ctx.beginPath();ctx.arc(x(p),y(p),4,0,2*Math.PI);ctx.fill();}
  canvas.setAttribute('aria-label',`${available.length} recorded portfolio values. ${available.length===1?'One verified observation; no earlier history.':'Read exact values in the table below.'}`);
}
function route(){const name=location.hash.slice(1)||'portfolio',valid=['portfolio','ladder','rewards','research','tools'].includes(name)?name:'portfolio';for(const v of ['portfolio','ladder','rewards','research','tools'])$(v+'View').hidden=v!==valid;document.querySelectorAll('[data-route]').forEach(link=>{if(link.dataset.route===valid||(valid==='rewards'&&link.dataset.route==='ladder'))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});document.title=`Sea Chef Labs · ${{portfolio:'Portfolio',ladder:'HEX ladder',rewards:'Wallet & rewards',research:'Research',tools:'Wallets & trading'}[valid]}`;if(valid==='research')void loadResearch();if(valid==='portfolio'&&model)renderHistory();}
async function loadResearch(){
  if(researchBusy)return;researchBusy=true;$('refreshResearch').disabled=true;
  try{const response=await fetch('../../data/bacon-shortlist.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const d=await response.json();if(d.schema!==1||d.paperOnly!==true||!Array.isArray(d.sourceChecks)||!Array.isArray(d.watchlist)||!Number.isFinite(Date.parse(d.checkedAt)))throw Error();
    const age=Date.now()-Date.parse(d.checkedAt),stale=age>26*3600000||age< -60000;
    $('researchChecked').textContent=`Checked ${when(d.checkedAt)} · ${stale?'Stale record':d.status==='partial'?'Partial source coverage':d.status==='unavailable'?'Source check unavailable':'Saved source check'}`;
    $('researchSummary').textContent=d.summary||'No complete current paper setup verified.';
    $('researchCards').innerHTML=d.watchlist.slice(0,3).map(r=>`<article class="research-card"><h3>${esc(r.symbol)}</h3><small>Incomplete research · Not a buy call</small><p>${esc(r.note)}</p>${safeURL(r.sourceUrl)?`<a href="${esc(safeURL(r.sourceUrl))}" target="_blank" rel="noopener noreferrer">Original source</a>`:''}</article>`).join('')||'<p>No additional source-linked watch notes in this record.</p>';
    $('researchSources').innerHTML=d.sourceChecks.map(s=>`<p>${safeURL(s.url)?`<a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>`:esc(s.name)} · ${esc(s.status)}<br>${esc(s.detail||'')}<br>${esc(when(s.checkedAt))}</p>`).join('');
  }catch{$('researchChecked').textContent='Saved research unavailable';$('researchSummary').textContent='The research record could not be loaded. Try again or open the paper desk.';$('researchCards').replaceChildren();$('researchSources').replaceChildren();}
  finally{researchBusy=false;$('refreshResearch').disabled=false;}
}
function renderSocials(links={}){document.querySelectorAll('[data-social]').forEach(link=>{const item=SOCIALS.find(s=>s.id===link.dataset.social);link.href=socialURL(item.id,links[item.id])||item.url;});}
$('accountButton').addEventListener('click',openConnection);$('manageWallets').addEventListener('click',()=>{if(!model)openConnection();else{$('walletsTitle').scrollIntoView({block:'center',behavior:'auto'});$('walletsTitle').focus();}});document.addEventListener('click',event=>{if(event.target.closest('[data-connection]'))openConnection();});
for(const id of ['closeConnection','dismissConnection'])$(id).addEventListener('click',()=>$('connectionDialog').close());
$('refreshPortfolio').addEventListener('click',()=>void refreshPortfolio({announce:true}));$('checkConnection').addEventListener('click',()=>void refreshPortfolio({announce:true}));$('refreshResearch').addEventListener('click',()=>void loadResearch());
$('signOut').addEventListener('click',async()=>{++requestId;busy=false;clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;try{await adapter.signOut();$('connectionResult').textContent='Signed out. Private balances cleared.';}catch{$('connectionResult').textContent='Balances cleared from this page. Service sign-out could not be confirmed.';}});
for(const button of document.querySelectorAll('[data-range]'))button.addEventListener('click',()=>{range=Number(button.dataset.range);document.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(model)renderHistory();else toast('No verified history yet. Your selected range is saved for this visit.');});
window.addEventListener('hashchange',route);window.addEventListener('resize',()=>{if(model&&location.hash!=='#research')renderHistory();});
const onAuthChange=event=>{if(['SIGNED_OUT','USER_DELETED'].includes(event)){++requestId;busy=false;clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;}else if(['SIGNED_IN','TOKEN_REFRESHED'].includes(event)){queueMicrotask(()=>void refreshPortfolio());}};
let subscription=adapter.subscribe(onAuthChange);
window.addEventListener('pagehide',()=>{++requestId;clearPrivate();subscription.unsubscribe();});
window.addEventListener('pageshow',event=>{if(event.persisted){subscription=adapter.subscribe(onAuthChange);void refreshPortfolio();}});
async function restoreSignIn(){
  if(!AUTH_CONFIG.enabled){void refreshPortfolio();return;}
  connectionCopy('signed-out');
  try{const result=await resumeAuthentication();if(result.client){subscription.unsubscribe();adapter=createPortfolioAdapter(result.client);subscription=adapter.subscribe(onAuthChange);await refreshPortfolio();}else await refreshPortfolio();if(result.error){$('connectionResult').textContent=result.error;openConnection();}}
  catch{$('connectionResult').textContent='This tab could not restore sign-in. Try signing in again.';connectionCopy('signed-out');}
}
$('signIn').addEventListener('click',async()=>{$('signIn').disabled=true;$('connectionResult').textContent='Opening GitHub sign-in…';try{await beginGitHubSignIn();}catch(error){$('connectionResult').textContent=error.message;$('signIn').disabled=false;}});
route();void restoreSignIn();
