import { AUTH_CONFIG } from './portfolio/auth-config.mjs?v=20261001.data2';
import { resumeAuthentication, beginGitHubSignIn } from './portfolio/auth-client.mjs?v=20261001.data2';
import { COINS, SOCIALS, safeURL, socialURL, compactQuantity as displayDecimal, aud, groupHoldings, portfolioTotal, historyPoints, coinMetadata, snapshotFreshness, valuationContext, partitionHoldings, pricedHoldingsSummary } from './portfolio/model.mjs?v=20261002.details1';
import { formatUnits } from './portfolio/domain.mjs?v=20261001.data2';
import { createPortfolioAdapter } from './portfolio/adapter.mjs?v=20261002.details1';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const when=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-AU',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Date unavailable';
let adapter=createPortfolioAdapter(globalThis.seaChefPortfolioClient||null);
const initialHoldings=$('holdingsBody').innerHTML,initialStakingHoldings=$('stakingHoldingsBody').innerHTML,initialStake=$('stakeList').innerHTML;
const initialRefreshButton=$('refreshPortfolio').innerHTML;
// A display-only privacy switch for this page visit. Never persists or changes data.
let privacyHidden=false;
function setPrivacyHidden(hidden){
  privacyHidden=hidden;
  for(const region of document.querySelectorAll('[data-private]')){
    region.hidden=hidden;region.inert=hidden;
    if(hidden)region.setAttribute('aria-hidden','true');else region.removeAttribute('aria-hidden');
  }
  for(const placeholder of document.querySelectorAll('[data-privacy-placeholder]'))placeholder.hidden=!hidden;
  for(const button of document.querySelectorAll('[data-privacy-toggle]')){
    const label=hidden?'Show coins and values':'Hide coins and values';
    button.setAttribute('aria-pressed',String(hidden));button.setAttribute('aria-label',label);button.title=label;
  }
}
document.addEventListener('click',event=>{if(event.target.closest('[data-privacy-toggle]'))setPrivacyHidden(!privacyHidden);});
let walletChooser=null,walletLoad=null;
$('walletsButton').addEventListener('click',async()=>{const trigger=$('walletsButton');if(walletChooser){walletChooser.open(trigger);return;}if(walletLoad)return;const before=location.hash,previousRequest=requestId;trigger.disabled=true;walletLoad=import('./portfolio/wallets.mjs?v=20261002.details1').then(({createWalletChooser})=>{walletChooser=createWalletChooser({setPrivacyHidden,isPrivacyHidden:()=>privacyHidden});if(location.hash===before&&requestId===previousRequest)walletChooser.open(trigger);}).catch(()=>toast('Wallet chooser could not be loaded. Please try again.')).finally(()=>{walletLoad=null;trigger.disabled=false;});await walletLoad;});
let detailViews=null,detailLoad=null;
async function loadDetailViews(){
  if(detailViews)return detailViews;if(detailLoad)return detailLoad;
  detailLoad=import('./portfolio/details.mjs?v=20261002.details1').then(({createDetails})=>{detailViews=createDetails({getModel:()=>model,readHistoryModels:value=>adapter.readHistoryModels(value),renderHoldings,setPrivacyHidden,isPrivacyHidden:()=>privacyHidden,onAccessDenied:()=>{++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;},onHeadlineChange:summary=>{const c=summary?.change;$('portfolioChange').textContent=c?.available?`${c.formatted} · Value change since ${when(c.baselineAt)}`:'24h change unavailable · No comparable recorded values yet';},esc,when});return detailViews;}).catch(()=>{toast('Portfolio details could not be loaded. Please try again.');return null;}).finally(()=>{detailLoad=null;});return detailLoad;
}
function openDetailRoute(){if(!detailViews&&['#overview','#holdings'].includes(location.hash))void loadDetailViews().then(view=>view?.route());}
document.addEventListener('click',event=>{const launcher=event.target.closest('a[href="#overview"],a[href="#holdings"]'),coin=event.target.closest('[data-coin-key]'),before=location.hash,shownModel=model;if(launcher){event.preventDefault();const target=launcher.getAttribute('href');void loadDetailViews().then(view=>{if(location.hash===before&&model===shownModel)view?.openPortfolio(launcher,target);});}else if(coin&&!detailViews){event.preventDefault();void loadDetailViews().then(view=>{if(location.hash===before&&model===shownModel)view?.openCoin(coin.dataset.coinKey,coin);});}});
window.addEventListener('hashchange',openDetailRoute);
let visibleView='portfolio',stakingReturnView='portfolio';
let model=null,range=30,requestId=0,busy=false,toastTimer=null,authStatus='not-configured',researchBusy=false;
function toast(message){$('statusToast').textContent=message;$('statusToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('statusToast').hidden=true;},7000);}
function clearPrivate(){
  model=null;detailViews?.clear();$('portfolioChange').textContent='24h change unavailable · No comparable recorded values yet';$('refreshStatus').textContent='';$('portfolioValueLabel').textContent='Portfolio value';$('portfolioScope').textContent='Includes held balances in Staking & rewards. Unminted estimates are excluded.';$('stakingHoldingsBody').innerHTML=initialStakingHoldings;$('stakingCoinPrivacy').textContent='Balances appear only after authentication';for(const id of ['stakingValuationStatus','stakingValuationDetails'])$(id).hidden=true;$('stakingValuationStatus').textContent='';$('stakingValuationDetails').open=false;$('stakingValuationSources').replaceChildren();$('watchedWalletList').innerHTML='<p>Private wallet addresses appear after sign-in.</p>';$('holdingsBody').innerHTML=initialHoldings;$('holdingsBody').closest('table').querySelector('caption').textContent='Supported assets. Balances are unavailable until a private account is connected.';$('stakeList').innerHTML=initialStake;$('portfolioValue').textContent='A$ —';$('portfolioValue').setAttribute('aria-label','Portfolio value unavailable');$('walletSummary').textContent='Combined wallets · Ethereum';$('coinsSubtitle').textContent='Combined balances, kept private';$('portfolioCaption').textContent='Connect your private account to see verified balances';$('syncStatus').textContent='Not synced · Private connection pending';$('coinPrivacy').innerHTML='<img src="assets/ui/lock-keyhole.svg" width="18" height="18" alt="">Balances appear only after authentication';$('maturitySummary').textContent='Your stake maturities will appear after sync';$('liquidRewardBalances').innerHTML='<p>HDRN <span>—</span></p><p>ICSA <span>—</span></p>';$('rewardEstimates').innerHTML='<p>Private reward estimates are not connected yet.</p>';$('historyEmpty').querySelector('p').textContent='History starts after first sync';$('historyEmpty').querySelector('span').textContent='Only verified snapshots. No estimated past returns.';$('historyEmpty').hidden=false;$('historyData').hidden=true;$('historyTable').replaceChildren();const canvas=$('historyChart');canvas.getContext?.('2d')?.clearRect(0,0,canvas.width,canvas.height);$('historyCaption').textContent='No verified snapshots yet';$('signOut').hidden=true;$('valuationStatus').hidden=true;$('valuationStatus').textContent='';$('valuationDetails').hidden=true;$('valuationDetails').open=false;$('valuationSources').replaceChildren();renderSocials();
}
function connectionCopy(status){
  authStatus=status;$('connectionBadge').textContent=status==='ready'?'Private session':status==='signed-out'?'Signed out':['no-account','setup-pending'].includes(status)?'Setup pending':'Not connected';
  $('connectionDescription').textContent=status==='ready'?'Your private account is connected.':status==='signed-out'?'Sign in with GitHub to open your private account.':['no-account','setup-pending'].includes(status)?'Signed in. Your private portfolio setup is still pending.':'Your private portfolio is not connected yet.';
  $('connectionExplanation').textContent=status==='ready'?'Balances are read from your authenticated, owner-only snapshots and held in memory for this session.':status==='signed-out'?'Your session stays in this tab. Private wallet balances are loaded only after authentication and owner access are verified.':['no-account','setup-pending'].includes(status)?'Your sign-in succeeded. Owner access and verified wallet snapshots still need to be provisioned before balances can appear.':'Sign-in and verified balance snapshots still need to be enabled. Wallet addresses and balances are not stored in this public page.';
  $('signOut').hidden=!['ready','no-account','setup-pending'].includes(status);$('signIn').hidden=!AUTH_CONFIG.enabled||['ready','no-account','setup-pending'].includes(status);
}
function openConnection(){if(!$('connectionDialog').open)$('connectionDialog').showModal();}
function refreshFailureCopy(result){
  if(result.status==='auth-unavailable')return 'Sign-in could not be checked because the service is unavailable.';
  if(result.status==='throttled')return `Refresh is cooling down. Try again in ${result.retryAfterSeconds} seconds.`;
  const messages={ALCHEMY_KEY_NOT_CONFIGURED:'Wallet refresh setup is awaiting its secure provider configuration.',BACKEND_NOT_CONFIGURED:'Wallet refresh setup is not finished yet.',REFRESH_NOT_CONFIGURED:'Wallet refresh is not configured yet.',ALCHEMY_AUTH_OR_ACCESS_FAILED:'The refresh provider configuration needs attention.',ALCHEMY_CAPACITY_EXHAUSTED:'The refresh provider has reached its usage allowance.',ALCHEMY_RATE_LIMITED:'The refresh provider is busy. Please try again later.',AUTH_UNAVAILABLE:'Sign-in could not be checked because the service is unavailable.',COLLECTION_FAILED:'Fresh balances could not be verified. Please try again later.',REFRESH_UNCONFIRMED:'Refresh could not be confirmed. Check connection before trying again.'};
  return messages[result.code]||'Refresh is unavailable. Please try again later.';
}
function showRefreshStatus(message){$('refreshStatus').textContent=message;$('connectionResult').textContent=message;}
function keepSavedDisplay(message){showRefreshStatus(message+(model?' Your last verified saved balances remain shown.':' No new balances have been loaded.'));}
async function refreshPortfolio({announce=false,collect=false}={}){
  if(busy)return;busy=true;const focusedBefore=document.activeElement,id=++requestId;let collected=null;
  $('refreshPortfolio').disabled=true;$('checkConnection').disabled=true;$('refreshPortfolio').setAttribute('aria-busy','true');
  if(collect){$('refreshPortfolio').textContent='Refreshing…';showRefreshStatus('Reading watched wallets. Your saved balances remain visible while this runs.');}
  else $('connectionResult').textContent='Checking private connection…';
  try{
    if(collect){
      collected=await adapter.collectSnapshot();if(id!==requestId)return;
      if(['signed-out','not-configured','forbidden'].includes(collected.status)){
        clearPrivate();connectionCopy(collected.status==='forbidden'?'error':'signed-out');showRefreshStatus(collected.status==='forbidden'?'Refresh access was denied. Private balances have been cleared.':'Sign in with GitHub before refreshing watched wallets.');openConnection();return;
      }
      if(collected.status!=='saved'){keepSavedDisplay(refreshFailureCopy(collected));return;}
      showRefreshStatus('New snapshot saved. Loading the verified balances…');
    }
    const result=await adapter.readPortfolio();if(id!==requestId)return;
    if(result.status==='auth-unavailable'){if(!model)connectionCopy('error');keepSavedDisplay('Sign-in could not be checked because the service is unavailable.');return;}
    clearPrivate();if(result.status==='not-configured'&&AUTH_CONFIG.enabled)result.status='signed-out';connectionCopy(result.status);
    if(result.status==='ready'){
      model=result.model;renderModel();
      const message=collected?.status==='saved'?(model.snapshot?.id===collected.snapshotId?'Fresh watched-wallet balances loaded. Prices may still be incomplete.':'New snapshot saved. Showing the latest available saved record.'):model.snapshot?'Stored balances loaded. Dollar values depend on available prices and AUD conversion.':'Private account connected. First verified sync pending.';
      $('connectionResult').textContent=message;if(collect)showRefreshStatus(message);
      const links=await adapter.getSocialLinks();if(id===requestId&&model)renderSocials(links);
      if(announce&&!collect)toast(model.snapshot?'Saved observations reloaded. Wallet balances were not refreshed.':'First verified sync is pending.');
    }else{
      const message=result.status==='signed-out'?'No signed-in session. Your balances remain private.':['no-account','setup-pending'].includes(result.status)?'Signed in. Private owner access and snapshots are still pending.':'Private connection is not configured yet. No balances have been loaded.';
      $('connectionResult').textContent=message;if(announce)toast(message);
    }
  }catch(error){
    if(id!==requestId)return;
    if(collect&&model&&!['42501','PGRST301','PGRST302'].includes(error?.code)){
      const auth=await adapter.session().catch(()=>({status:'auth-unavailable'}));if(id!==requestId)return;
      if(auth.status==='auth-unavailable'||auth.status==='authenticated'&&auth.user.id===model.account.owner_id){keepSavedDisplay(collected?.status==='saved'?'The new snapshot was saved, but it could not be loaded. Use Check connection to reload it.':'Refresh could not be confirmed. Use Check connection before trying again.');return;}
    }
    clearPrivate();connectionCopy('error');$('connectionResult').textContent='The private snapshot could not be verified. Balances have been cleared.';$('syncStatus').textContent='Snapshot unavailable · Please retry';if(announce)toast('Snapshot unavailable. No cached private balances are being shown.');
  }finally{if(id===requestId){busy=false;$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;if(['refreshPortfolio','checkConnection'].includes(focusedBefore?.id)&&document.activeElement===document.body)focusedBefore.focus();}}
}
function renderModel(){
  if(!model)return;const snapshot=model.snapshot;
  $('walletSummary').textContent=model.wallets.length?`${model.account.kind==='smsf'?'Super · ':''}All ${model.wallets.length} watched wallets · Ethereum`:'No wallets provisioned';
  $('watchedWalletList').innerHTML=model.wallets.length?model.wallets.map(w=>`<div class="watched-wallet"><span>${esc(w.label||'Watched wallet')}</span><details><summary>View address</summary><p class="wallet-address">${esc(w.address)}</p></details></div>`).join(''):'<p>No watched wallets provisioned yet.</p>';
  if(!snapshot){$('portfolioCaption').textContent='First verified sync pending';$('coinsSubtitle').textContent='Private account connected · awaiting snapshot';$('syncStatus').textContent='Connected · No verified snapshot yet';$('coinPrivacy').textContent='Private account connected. Balances appear after first sync.';return;}
  const holdings=groupHoldings(model),total=portfolioTotal(model),freshness=snapshotFreshness(snapshot),timing=valuationContext(snapshot);
  $('coinsSubtitle').textContent=`Combined across ${snapshot.observed_wallets} of ${snapshot.expected_wallets} wallets`;
  const priced=pricedHoldingsSummary(holdings),headline=total??priced.value;
  $('portfolioValueLabel').textContent=total==null?'Priced holdings':'Portfolio value';
  $('portfolioValue').textContent=headline==null?'A$ —':aud(headline);
  $('portfolioValue').setAttribute('aria-label',headline==null?'AUD values unavailable':total==null?`${aud(headline)} priced holdings subtotal. Incomplete portfolio valuation.`:`${aud(total)} indicative portfolio value`);
  $('portfolioCaption').textContent=total!=null?(freshness==='stale'?'Saved value · Balances are over 36 hours old':'Indicative total · Liquid tokens + staked principal'):headline==null?'Balances loaded · AUD prices unavailable':`Incomplete valuation · ${priced.unpricedAssets?priced.unpricedAssets+' held asset'+(priced.unpricedAssets===1?' is':'s are')+' unpriced':timing.carried?'Balances carried forward':snapshot.observed_wallets!==snapshot.expected_wallets?'Wallet coverage incomplete':'Full coverage not verified'}`;
  $('portfolioScope').textContent=(total==null?'Only priced holdings. ':'')+(snapshot.provenance?.known_asset_inventory_only?'Watched coins and ETH only. ':'')+'Includes held balances in Staking & rewards once. Unminted estimates are excluded.';
  $('syncStatus').textContent=`${freshness==='stale'?'Older saved balances':freshness==='unverified-time'?'Balance time unverified':'Saved balances'} · ${when(timing.balanceStart)}${timing.carried?' · Carried forward, not refreshed':''}`;
  const views=partitionHoldings(holdings);
  renderValuationDetails(snapshot,views.main,timing);renderValuationDetails(snapshot,views.staking,timing,'staking');
  renderHoldings('holdingsBody',views.main);renderHoldings('stakingHoldingsBody',views.staking);
  const stakes=model.stakes.filter(s=>s.protocol==='hex'&&s.status!=='unlocked').sort((a,b)=>(a.maturity_date||'z').localeCompare(b.maturity_date||'z'));
  $('maturitySummary').textContent=stakes.length?`${stakes.length} recorded stake${stakes.length===1?'':'s'} · ${stakes[0].maturity_date?'Earliest maturity '+stakes[0].maturity_date:'Maturity date pending'}`:'No active HEX stakes in the latest snapshot';
  $('stakeList').classList.toggle('empty-detail',!stakes.length);
  $('stakeList').innerHTML=stakes.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Stake</th><th>Principal · HEX</th><th>Maturity</th><th>Status</th></tr></thead><tbody>${stakes.map(s=>`<tr><td>${esc(s.stake_id)}</td><td>${displayDecimal(formatUnits(s.principal_raw,s.decimals))}</td><td>${esc(s.maturity_date||'Unverified')}</td><td>${esc(({pending:'Pending',good_accounted:'Good Accounting recorded',active:'Active',matured:'Matured'})[s.status]||s.status)}</td></tr>`).join('')}</tbody></table></div><p class="fine-print">Principal only. Future payout is not estimated. Ending stakes is never performed here.</p>`:'<h2>No active HEX stakes recorded</h2><p>The latest snapshot has no active HEX stake observations.</p>';
  $('liquidRewardBalances').innerHTML=['HDRN','ICSA'].map(symbol=>{const coin=COINS.find(c=>c.symbol===symbol),row=holdings.find(h=>h.chainId===1&&h.assetId.toLowerCase()===coin.assetId);return `<p>${symbol}<span>${row?displayDecimal(row.liquid):'Not observed'}</span></p>`;}).join('');
  $('rewardEstimates').innerHTML=model.rewardEstimates.length?model.rewardEstimates.map(r=>`<div><p>${r.estimate_status==='estimated_unminted'&&r.amount_raw!=null?displayDecimal(formatUnits(r.amount_raw,r.decimals))+' HDRN':'Estimate unavailable'}</p><p class="fine-print">Stake ${esc(r.source_stake_id)} · ${esc(when(r.observed_at))}</p><p class="fine-print">${r.provenance?.carried_forward_estimate?'Saved estimate · not refreshed. ':''}${esc(r.caveat)}</p></div>`).join(''):'<p>No verified unminted reward estimates recorded.</p>';
  renderHistory();detailViews?.update();
  const fresh=(model.history||[]).filter(s=>s.provenance?.valuation?.basis==='fresh_pinned_balances'&&s.provenance?.valuation?.balances_refreshed===true&&Date.parse(s.observed_at)>=Date.now()-86400000);
  if(fresh.length>1)void loadDetailViews().then(view=>view?.loadHeadline());
}
function renderHoldings(bodyId,holdings){
  $(bodyId).innerHTML=holdings.length?holdings.map(h=>{
    const coin=coinMetadata(h),image=coin?`<img class="coin-icon" src="assets/coins/${coin.icon}" width="58" height="58" alt="">`:'',staked=h.staked!=='0';
    return `<tr><th scope="row"><button class="asset asset-button" data-coin-key="${esc(h.key)}" aria-label="Open ${esc(coin?.name||h.symbol||'Token')} details">${image}<span><span class="asset-name">${esc(coin?.name||h.symbol||'Token')}</span><span class="asset-symbol">${esc(h.symbol)}${!coin?' · Unlisted asset':''}</span></span></button></th><td><span class="amount" title="${esc(h.quantity)}">${displayDecimal(h.quantity)}</span><span class="holding-detail">${staked?`${displayDecimal(h.liquid)} liquid · ${displayDecimal(h.staked)} staked`:'Liquid tokens'}</span></td><td class="money">${aud(h.aud)}${h.aud==null?`<span class="holding-detail" title="${esc(h.priceSource||'Price unavailable')}">${h.usd!=null?aud(h.usd).replace('A$','US$')+' · AUD FX unavailable':h.unreliable?'Price unreliable · excluded':'Price unavailable'}</span>`:''}${h.quote?.low_liquidity===true?'<span class="holding-detail quote-warning">Low liquidity · indicative</span>':h.quote?.confidence==='low'?'<span class="holding-detail quote-warning">Low confidence · indicative</span>':''}</td></tr>`;
  }).join(''):'<tr><td colspan="3">No token observations in this snapshot. This does not establish a zero balance.</td></tr>';
  $(bodyId).closest('table').querySelector('caption').textContent='Saved held balances in this view, combined by chain and token contract. Other held assets remain in their separate view.';
}
function renderValuationDetails(snapshot,holdings,timing,prefix=''){
  const target=id=>$(prefix?prefix+id[0].toUpperCase()+id.slice(1):id);
  const unpriced=holdings.filter(h=>h.quantity!=='0'&&h.usd==null).map(h=>h.symbol),gaps=[];
  if(unpriced.length)gaps.push('Price unavailable or unreliable: '+unpriced.join(', '));
  if(!timing.fxAt)gaps.push('AUD conversion unavailable');
  if(snapshot.observed_wallets!==snapshot.expected_wallets)gaps.push('Wallet coverage incomplete');
  target('coinPrivacy').textContent=gaps.length?gaps.join(' · '):timing.carried?'Known coin values shown · Full total unavailable for carried-forward balances':'Values exclude unminted rewards';
  target('valuationStatus').hidden=false;
  target('valuationStatus').textContent=[timing.carried?'Saved partial valuation · Original balances carried forward; wallets were not reread':snapshot.status==='partial'?'Saved partial snapshot':'Saved valuation',timing.valuedAt?'Valuation saved '+when(timing.valuedAt):null,timing.fxAt?'USD → AUD reference rate dated '+when(timing.fxAt):null].filter(Boolean).join('. ')+'.';
  const rows=[`<p><strong>Balance observations</strong> · ${esc(when(timing.balanceStart))}${timing.balanceEnd&&timing.balanceEnd!==timing.balanceStart?' to '+esc(when(timing.balanceEnd)):''}</p>`];
  if(timing.fxAt)rows.push(`<p><strong>AUD conversion</strong> · ${esc(timing.fxSource)} · Provider date ${esc(when(timing.fxAt))}. A reference rate, not a live trading rate.</p>`);
  for(const h of holdings){
    if(h.usd==null){rows.push(`<p><strong>${esc(h.symbol)}</strong> · ${h.unreliable?'Unreliable price, excluded from valuation':'Price unavailable'}</p>`);continue;}
    const q=h.quote,notes=[q?.low_liquidity===true?'Low liquidity':null,q?.confidence==='low'?'Low confidence':null,'Indicative, before costs'].filter(Boolean);
    const times=q?.retrieved_at?`Retrieved ${when(q.retrieved_at)} · ${q.provider_as_of?'Provider time '+when(q.provider_as_of):'Provider price time unavailable'}`:`Observed ${when(h.priceAt)}`;
    rows.push(`<p><strong>${esc(h.symbol)}</strong> · ${esc(h.priceSource)} · ${esc(times)}<br>${esc(notes.join(' · '))}${q?.confidence_reason?' · '+esc(q.confidence_reason):''}</p>`);
  }
  target('valuationSources').innerHTML=rows.join('');target('valuationDetails').hidden=false;
}
function renderHistory(){
  const points=historyPoints(model?.history,range),available=points.filter(p=>p.value!=null);
  $('historyEmpty').querySelector('p').textContent=model?.snapshot?'History needs a complete valuation':'History starts after first sync';$('historyEmpty').querySelector('span').textContent=model?.snapshot?'Only complete, fully priced snapshots are plotted.':'Only verified snapshots. No estimated past returns.';$('historyEmpty').hidden=available.length>0;$('historyData').hidden=!available.length;
  $('historyCaption').textContent=available.length?`${available.length} verified value${available.length===1?'':'s'} · Portfolio value, not profit`:'No fully valued snapshots in this range';
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
const stakingRoutes=['staking','ladder','rewards'];
function closeStakingWindow(){
  if($('stakingDialog').open)$('stakingDialog').close();
  if(stakingRoutes.includes(location.hash.slice(1)))history.replaceState(null,'','#'+stakingReturnView);
  route();$('openStakingWindow').focus();
}
function route(){
  const name=location.hash.slice(1)||'portfolio',staking=stakingRoutes.includes(name);
  if(staking){
    if(!$('stakingDialog').open){stakingReturnView=visibleView;$('stakingDialog').showModal();}
  }else{
    visibleView=['portfolio','research','tools'].includes(name)?name:'portfolio';
    if($('stakingDialog').open)$('stakingDialog').close();
  }
  for(const v of ['portfolio','research','tools'])$(v+'View').hidden=v!==visibleView;
  document.querySelectorAll('[data-route]').forEach(link=>{if(link.dataset.route===(staking?'staking':visibleView))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.title=`Sea Chef Labs · ${staking?'Staking & rewards':{portfolio:'Portfolio',research:'Research',tools:'Wallets & trading'}[visibleView]}`;
  if(visibleView==='research')void loadResearch();if(visibleView==='portfolio'&&model)renderHistory();
}
$('closeStakingWindow').addEventListener('click',closeStakingWindow);
$('stakingDialog').addEventListener('cancel',event=>{event.preventDefault();closeStakingWindow();});
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
$('refreshPortfolio').addEventListener('click',()=>void refreshPortfolio({announce:true,collect:true}));$('checkConnection').addEventListener('click',()=>void refreshPortfolio({announce:true}));$('refreshResearch').addEventListener('click',()=>void loadResearch());
$('signOut').addEventListener('click',async()=>{++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;try{await adapter.signOut();$('connectionResult').textContent='Signed out. Private balances cleared.';}catch{$('connectionResult').textContent='Balances cleared from this page. Service sign-out could not be confirmed.';}});
for(const button of document.querySelectorAll('[data-range]'))button.addEventListener('click',()=>{range=Number(button.dataset.range);document.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));if(model)renderHistory();else toast('No verified history yet. Your selected range is saved for this visit.');});
window.addEventListener('hashchange',route);window.addEventListener('resize',()=>{if(model&&location.hash!=='#research')renderHistory();});
const onAuthChange=(event,ownerId)=>{if(event==='SIGNED_IN'&&ownerId&&(!model||ownerId!==model.account.owner_id)){if(model&&ownerId!==model.account.owner_id)walletChooser?.clear();++requestId;busy=false;clearPrivate();}if(['SIGNED_OUT','USER_DELETED'].includes(event)){++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;}else if(['SIGNED_IN','TOKEN_REFRESHED'].includes(event)){queueMicrotask(()=>void refreshPortfolio());}};
let subscription=adapter.subscribe(onAuthChange);
window.addEventListener('pagehide',()=>{++requestId;busy=false;clearPrivate();$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;subscription.unsubscribe();});
window.addEventListener('pageshow',event=>{if(event.persisted){subscription=adapter.subscribe(onAuthChange);void refreshPortfolio();}});
async function restoreSignIn(){
  if(!AUTH_CONFIG.enabled){void refreshPortfolio();return;}
  connectionCopy('signed-out');
  try{const result=await resumeAuthentication();if(result.client){subscription.unsubscribe();adapter=createPortfolioAdapter(result.client);subscription=adapter.subscribe(onAuthChange);await refreshPortfolio();}else await refreshPortfolio();if(result.error){$('connectionResult').textContent=result.error;openConnection();}}
  catch{$('connectionResult').textContent='This tab could not restore sign-in. Try signing in again.';connectionCopy('signed-out');}
}
$('signIn').addEventListener('click',async()=>{$('signIn').disabled=true;$('connectionResult').textContent='Opening GitHub sign-in…';try{await beginGitHubSignIn();}catch(error){$('connectionResult').textContent=error.message;$('signIn').disabled=false;}});
route();openDetailRoute();void restoreSignIn();
