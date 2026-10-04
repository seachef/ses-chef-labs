import { AUTH_CONFIG } from './portfolio/auth-config.mjs?v=20261001.data2';
import { resumeAuthentication, beginGitHubSignIn } from './portfolio/auth-client.mjs?v=20261001.data2';
import { COINS, SOCIALS, safeURL, socialURL, compactQuantity as displayDecimal, aud, groupHoldings, portfolioTotal, coinMetadata, snapshotFreshness, valuationContext, partitionHoldings, pricedHoldingsSummary } from './portfolio/model.mjs?v=20261003.personal1';
import { formatUnits } from './portfolio/domain.mjs?v=20261001.data2';
import { createPortfolioAdapter } from './portfolio/adapter.mjs?v=20261003.personal1';
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
let detailViews=null,detailLoad=null,tradePlanner=null,plannerLoad=null;
async function loadTradePlanner(){
  if(tradePlanner){tradePlanner.refresh();return;}if(plannerLoad)return plannerLoad;
  plannerLoad=import('./portfolio/trade-planner.mjs?v=20261003.charts2').then(({createTradePlanner})=>{tradePlanner=createTradePlanner({container:$('tradePlanner'),onRender:()=>setPrivacyHidden(privacyHidden)});setPrivacyHidden(privacyHidden);}).catch(()=>{$('tradePlanner').textContent='The planner could not be loaded. Return to Home and try again.';}).finally(()=>{plannerLoad=null;});return plannerLoad;
}
async function loadDetailViews(){
  if(detailViews)return detailViews;if(detailLoad)return detailLoad;
  detailLoad=import('./portfolio/details.mjs?v=20261003.personal1').then(({createDetails})=>{detailViews=createDetails({getModel:()=>model,readHistoryModels:value=>adapter.readHistoryModels(value),renderHoldings,setPrivacyHidden,isPrivacyHidden:()=>privacyHidden,onAccessDenied:()=>{++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;},onHeadlineChange:()=>{},esc,when});return detailViews;}).catch(()=>{toast('Portfolio details could not be loaded. Please try again.');return null;}).finally(()=>{detailLoad=null;});return detailLoad;
}
function openDetailRoute(){if(!detailViews&&['#overview','#holdings'].includes(location.hash))void loadDetailViews().then(view=>view?.route());}
document.addEventListener('click',event=>{const launcher=event.target.closest('a[href="#overview"],a[href="#holdings"]'),coin=event.target.closest('[data-coin-key]'),before=location.hash,shownModel=model;if(launcher){event.preventDefault();const target=launcher.getAttribute('href');void loadDetailViews().then(view=>{if(location.hash===before&&model===shownModel)view?.openPortfolio(launcher,target);});}else if(coin&&!detailViews){event.preventDefault();void loadDetailViews().then(view=>{if(location.hash===before&&model===shownModel)view?.openCoin(coin.dataset.coinKey,coin);});}});
window.addEventListener('hashchange',openDetailRoute);
let visibleView='portfolio',stakingReturnView='portfolio';
let model=null,accountModels=[],requestId=0,busy=false,toastTimer=null,authStatus='not-configured',researchBusy=false;
function toast(message){$('statusToast').textContent=message;$('statusToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('statusToast').hidden=true;},7000);}
function clearPrivate({keepAccounts=false}={}){
  if(!keepAccounts){accountModels=[];$('accountList').replaceChildren();$('accountSection').hidden=true;}
  model=null;homeVisual?.destroy();homeVisual=null;tradePlanner?.clear();detailViews?.clear();$('portfolioChange').textContent='Daily change unavailable · No comparable recorded values yet';$('portfolioChange').className='recorded-headline';$('portfolioFreshness').replaceChildren();$('refreshStatus').textContent='';$('portfolioValueLabel').textContent='Portfolio value';$('portfolioScope').textContent='Includes held balances in Staking & rewards. Unminted estimates are excluded.';$('stakingHoldingsBody').innerHTML=initialStakingHoldings;$('stakingCoinPrivacy').textContent='Balances appear only after authentication';for(const id of ['stakingValuationStatus','stakingValuationDetails'])$(id).hidden=true;$('stakingValuationStatus').textContent='';$('stakingValuationDetails').open=false;$('stakingValuationSources').replaceChildren();$('watchedWalletList').innerHTML='<p>Private wallet addresses appear after sign-in.</p>';$('holdingsBody').innerHTML=initialHoldings;$('holdingsBody').closest('table').querySelector('caption').textContent='Supported assets. Balances are unavailable until a private account is connected.';$('stakeList').innerHTML=initialStake;$('portfolioValue').textContent='A$ —';$('portfolioValue').setAttribute('aria-label','Portfolio value unavailable');$('walletSummary').textContent='Combined wallets · Ethereum';$('coinsSubtitle').textContent='Combined balances, kept private';$('portfolioCaption').textContent='Connect your private account to see verified balances';$('syncStatus').textContent='Not synced · Private connection pending';$('coinPrivacy').innerHTML='<img src="assets/ui/lock-keyhole.svg" width="18" height="18" alt="">Balances appear only after authentication';$('maturitySummary').textContent='Your stake maturities will appear after sync';$('liquidRewardBalances').innerHTML='<p>HDRN <span>—</span></p><p>ICSA <span>—</span></p>';$('rewardEstimates').innerHTML='<p>Private reward estimates are not connected yet.</p>';++visualRequest;visualBusy=false;visualError=false;visualHistory.clear();$('portfolioVisualOutput').replaceChildren();void renderVisuals();$('signOut').hidden=true;$('valuationStatus').hidden=true;$('valuationStatus').textContent='';$('valuationDetails').hidden=true;$('valuationDetails').open=false;$('valuationSources').replaceChildren();renderSocials();
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
  const messages={ALCHEMY_UNAUTHORIZED_401:'The refresh provider rejected its saved key. Secure configuration needs attention.',ALCHEMY_ACCESS_DENIED_403:'The refresh provider denied access for this app.',ALCHEMY_ALLOWLIST_DENIED:'The refresh provider blocked this app’s allowed-origin settings.',ALCHEMY_APP_INACTIVE:'The refresh provider app is inactive.',ALCHEMY_KEY_NOT_CONFIGURED:'Wallet refresh setup is awaiting its secure provider configuration.',BACKEND_NOT_CONFIGURED:'Wallet refresh setup is not finished yet.',REFRESH_NOT_CONFIGURED:'Wallet refresh is not configured yet.',ALCHEMY_AUTH_OR_ACCESS_FAILED:'The refresh provider configuration needs attention.',ALCHEMY_CAPACITY_EXHAUSTED:'The refresh provider has reached its usage allowance.',ALCHEMY_RATE_LIMITED:'The refresh provider is busy. Please try again later.',AUTH_UNAVAILABLE:'Sign-in could not be checked because the service is unavailable.',COLLECTION_FAILED:'Fresh balances could not be verified. Please try again later.',REFRESH_UNCONFIRMED:'Refresh could not be confirmed. Check connection before trying again.'};
  return messages[result.code]||'Refresh is unavailable. Please try again later.';
}
function showRefreshStatus(message){$('refreshStatus').textContent=message;$('connectionResult').textContent=message;}
function keepSavedDisplay(message){showRefreshStatus(message+(model?' Your last verified saved balances remain shown.':' No new balances have been loaded.'));void renderVisuals();}
function syncRefreshControl(){$('refreshPortfolio').disabled=busy;$('refreshPortfolio').innerHTML=initialRefreshButton;}
async function refreshPortfolio({announce=false,collect=false}={}){
  if(busy)return;busy=true;const focusedBefore=document.activeElement,id=++requestId;let collected=null;
  $('refreshPortfolio').disabled=true;$('checkConnection').disabled=true;$('refreshPortfolio').setAttribute('aria-busy','true');
  if(collect){$('refreshPortfolio').textContent='Refreshing…';showRefreshStatus('Reading watched wallets. Your saved balances remain visible while this runs.');}
  else $('connectionResult').textContent='Checking private connection…';
  try{
    if(collect){
      collected=await adapter.collectSnapshot({accountId:model?.account.id});if(id!==requestId)return;
      if(['signed-out','not-configured','forbidden'].includes(collected.status)){
        clearPrivate();connectionCopy(collected.status==='forbidden'?'error':'signed-out');showRefreshStatus(collected.status==='forbidden'?'Refresh access was denied. Private balances have been cleared.':'Sign in with GitHub before refreshing watched wallets.');openConnection();return;
      }
      if(collected.status!=='saved'){keepSavedDisplay(refreshFailureCopy(collected));return;}
      showRefreshStatus('New snapshot saved. Loading the verified balances…');
    }
    const result=await adapter.readPortfolio(model?.account.id);if(id!==requestId)return;
    if(result.status==='auth-unavailable'){if(!model)connectionCopy('error');keepSavedDisplay('Sign-in could not be checked because the service is unavailable.');return;}
    clearPrivate();if(result.status==='not-configured'&&AUTH_CONFIG.enabled)result.status='signed-out';connectionCopy(result.status);
    if(result.status==='ready'){
      accountModels=result.models||[result.model];model=result.model;renderModel();
      const message=collected?.status==='saved'?(model.snapshot?.id===collected.snapshotId?'Fresh watched-wallet balances loaded. Prices may still be incomplete.':'New snapshot saved. Showing the latest available saved record.'):model.snapshot?'Stored balances loaded. Dollar values depend on available prices and AUD conversion.':'Private account connected. First verified sync pending.';
      $('connectionResult').textContent=message;if(collect)showRefreshStatus(message);
      // Optional shortcuts must not hold wallet refresh or account selection open.
      void adapter.getSocialLinks().then(links=>{if(id===requestId&&model)renderSocials(links);}).catch(()=>{});
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
  }finally{if(id===requestId){busy=false;$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');syncRefreshControl();if(['refreshPortfolio','checkConnection'].includes(focusedBefore?.id)&&document.activeElement===document.body)focusedBefore.focus();}}
}
function accountName(account){return account.kind==='smsf'?'Super':'Personal';}
function walletNetwork(wallet){return wallet.network==='solana'?'Solana':wallet.network==='ethereum'||wallet.chain_id===1?'Ethereum':'Network unverified';}
function renderAccounts(){
  $('accountSection').hidden=!accountModels.length;
  $('accountList').innerHTML=accountModels.map(item=>{
    const total=portfolioTotal(item),priced=pricedHoldingsSummary(groupHoldings(item)),pending=item.wallets.filter(w=>w.provider_status==='provider_pending'),value=total??priced.value;
    const status=!item.snapshot?'First sync pending':total==null?'Priced holdings · incomplete':'Recorded portfolio value';
    return `<button class="account-row" data-account-id="${esc(item.account.id)}" aria-pressed="${item===model}"><span class="account-avatar" aria-hidden="true">${item.account.kind==='smsf'?'S':'P'}</span><span class="account-copy"><strong>${accountName(item.account)}</strong><small>${item.wallets.length} watched wallets${pending.length?' · '+pending.map(walletNetwork).filter((v,i,a)=>a.indexOf(v)===i).join(', ')+' pending':''}</small></span><span class="account-value"><strong>${value==null?'A$ —':aud(value)}</strong><small>${status}</small></span><span class="account-selected" aria-hidden="true">${item===model?'●':'›'}</span></button>`;
  }).join('');
  setPrivacyHidden(privacyHidden);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-account-id]');if(!button||busy)return;
  const next=accountModels.find(item=>item.account.id===button.dataset.accountId);if(!next||next===model)return;
  clearPrivate({keepAccounts:true});model=next;connectionCopy('ready');renderModel();
  [...document.querySelectorAll('[data-account-id]')].find(b=>b.dataset.accountId===next.account.id)?.focus();
});
function renderModel(){
  if(!model)return;const snapshot=model.snapshot;renderAccounts();syncRefreshControl();
  const networks=[...new Set(model.wallets.map(walletNetwork))];
  $('walletSummary').textContent=model.wallets.length?`${accountName(model.account)} · ${model.wallets.length} watched wallets · ${networks.join(' + ')}`:'No wallets provisioned';
  $('watchedWalletList').innerHTML=model.wallets.length?model.wallets.map(w=>`<div class="watched-wallet"><span>${esc(w.label||'Watched wallet')}<small class="wallet-network">${walletNetwork(w)}${w.provider_status==='provider_pending'?' · Provider pending · Balance unknown':''}</small></span><details><summary>View address</summary><p class="wallet-address">${esc(w.address)}</p></details></div>`).join(''):'<p>No watched wallets provisioned yet.</p>';
  if(!snapshot){$('portfolioCaption').textContent='First verified sync pending';$('coinsSubtitle').textContent='Private account connected · awaiting snapshot';$('syncStatus').textContent='Connected · No verified snapshot yet';$('coinPrivacy').textContent='Private account connected. Balances appear after first sync.';$('holdingsBody').innerHTML='<tr><td colspan="3">No verified observations yet. Balances are unknown, not zero.</td></tr>';$('stakingHoldingsBody').innerHTML='<tr><td colspan="3">No verified observations yet.</td></tr>';void renderVisuals();$('portfolioCaption').textContent=model.wallets.some(w=>w.provider_status==='provider_pending')?'First Ethereum sync pending · Solana provider pending, balance unknown':'First verified sync pending';detailViews?.update();return;}
  const holdings=groupHoldings(model),total=portfolioTotal(model),freshness=snapshotFreshness(snapshot),timing=valuationContext(snapshot);
  $('coinsSubtitle').textContent=`${accountName(model.account)} · ${snapshot.observed_wallets} of ${snapshot.expected_wallets} wallets observed${model.wallets.some(w=>w.provider_status==='provider_pending')?' · Solana balance unknown':''}`;
  const priced=pricedHoldingsSummary(holdings),headline=total??priced.value;
  $('portfolioValueLabel').textContent=total==null?'Priced holdings':'Portfolio value';
  $('portfolioValue').textContent=headline==null?'A$ —':aud(headline);
  $('portfolioValue').setAttribute('aria-label',headline==null?'AUD values unavailable':total==null?`${aud(headline)} priced holdings subtotal. Incomplete portfolio valuation.`:`${aud(total)} indicative portfolio value`);
  $('portfolioCaption').textContent=total!=null?(freshness==='stale'?'Saved value · Balances are over 36 hours old':'Indicative total · Liquid tokens + staked principal'):headline==null?'Balances loaded · AUD prices unavailable':`Incomplete valuation · ${priced.unpricedAssets?priced.unpricedAssets+' held asset'+(priced.unpricedAssets===1?' is':'s are')+' unpriced':timing.carried?'Balances carried forward':snapshot.observed_wallets!==snapshot.expected_wallets?'Wallet coverage incomplete':'Full coverage not verified'}`;
  $('portfolioScope').textContent=(total==null?'Only priced holdings. ':'')+(snapshot.provenance?.token_discovery?.status&&snapshot.provenance.token_discovery.status!=='complete'?'Ethereum token discovery incomplete. ':'')+(snapshot.provenance?.known_asset_inventory_only?'Watched coins and ETH only. ':'')+'Includes held balances in Staking & rewards once. Unminted estimates are excluded.';
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

}
function renderHoldings(bodyId,holdings){
  $(bodyId).innerHTML=holdings.length?holdings.map(h=>{
    const coin=coinMetadata(h),image=coin?`<img class="coin-icon" src="assets/coins/${coin.icon}" width="58" height="58" alt="">`:'',staked=h.staked!=='0';
    return `<tr><th scope="row"><button class="asset asset-button" data-coin-key="${esc(h.key)}" aria-label="Open ${esc(coin?.name||h.symbol||'Token')} details">${image}<span><span class="asset-name">${esc(coin?.name||h.symbol||'Token')}</span><span class="asset-symbol">${esc(h.symbol)}${!coin?' · Unlisted asset':''}</span><span class="coin-trend" data-coin-trend="${esc(h.key)}"></span></span></button></th><td><span class="amount" title="${esc(h.quantity)}">${displayDecimal(h.quantity)}</span><span class="holding-detail">${staked?`${displayDecimal(h.liquid)} liquid · ${displayDecimal(h.staked)} staked`:'Liquid tokens'}</span></td><td class="money">${aud(h.aud)}${h.aud==null?`<span class="holding-detail" title="${esc(h.priceSource||'Price unavailable')}">${h.usd!=null?aud(h.usd).replace('A$','US$')+' · AUD FX unavailable':h.unreliable?'Price unreliable · excluded':'Price unavailable'}</span>`:''}${h.quote?.low_liquidity===true?'<span class="holding-detail quote-warning">Low liquidity · indicative</span>':h.quote?.confidence==='low'?'<span class="holding-detail quote-warning">Low confidence · indicative</span>':''}</td></tr>`;
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
let visuals=null,headlineHelper=null,homeVisual=null,visualLoad=null,visualRange='MAX',visualBusy=false,visualError=false,visualRequest=0;
const visualHistory=new Map(),visualWindows={'1H':3600000,'1D':86400000,'1W':604800000,'1M':2592000000,'1Y':31536000000,MAX:Infinity};
async function renderVisuals(){
  if(!visuals){
    if(!visualLoad)visualLoad=Promise.all([import('./portfolio/visuals.mjs?v=20261003.charts1'),import('./portfolio/headline.mjs?v=20261003.headline1')]).then(([module,headline])=>{
      visuals=module;headlineHelper=headline.portfolioHeadline;
    }).catch(()=>{$('portfolioVisualOutput').textContent='Visuals could not be loaded. Your recorded holdings remain available.';}).finally(()=>{visualLoad=null;});
    await visualLoad;if(!visuals)return;
  }
  const current=model,historyModels=(current?.history||[]).map(s=>s.id===current.snapshot?.id?current:visualHistory.get(s.id)||{account:current.account,wallets:current.wallets,snapshot:s,balances:[],stakes:[],rewardEstimates:[]});
  const now=Date.now();homeVisual=visuals.renderVisuals({container:$('portfolioVisualOutput'),model:current,historyModels,rangeKey:visualRange,now,loading:visualBusy,error:visualError,onRangeChange:key=>{visualRange=key;void renderHistory();},showAllocation:false,showChange:false,interactive:true});
  $('portfolioAllocation').innerHTML=visuals.renderAllocation(current);
  // Home always compares compatible observations in the past day, independently
  // of the chart range. The visible label states the actual span, never a made-up 24h.
  const summary=visuals.scopedHistory({model:current,historyModels,rangeKey:'1D',now});
  renderHeadline(headlineHelper({summary,currentModel:current,now}),current);
  for(const row of document.querySelectorAll('[data-coin-trend]'))row.innerHTML=visuals.renderCoinSparkline({model:current,historyModels,coinKey:row.dataset.coinTrend,rangeKey:visualRange});
  setPrivacyHidden(privacyHidden);
}
function renderHeadline(headline,current){
  const change=$('portfolioChange'),freshness=$('portfolioFreshness');
  change.className='recorded-headline';freshness.replaceChildren();
  if(!current?.snapshot){change.textContent='Daily change unavailable · No comparable recorded values yet';return;}
  if(headline.changeAvailable){
    const percent=headline.percentAvailable?` (${headline.percentFormatted})`:' · % unavailable (zero starting value)';
    change.innerHTML=`<strong class="${headline.direction==='up'?'pv-positive':headline.direction==='down'?'pv-negative':'headline-flat'}">${esc(headline.changeFormatted+percent)}</strong><span>${esc(headline.spanLabel)} observed · ${esc(headline.scopeLabel)}</span><small>Includes deposits, withdrawals and market changes</small>`;
  }else{
    const reason=visualBusy?'Loading recorded comparison…':visualError?'Recorded comparison could not be loaded':headline.reasonLabel.replaceAll('1D','past day');
    change.innerHTML=`<strong>Daily change unavailable</strong><span>${esc(reason)}</span>`;
  }
  const dateLabel=(name,item)=>`${name} ${item.at?when(item.at):'time unavailable'}${item.stale?' · stale':''}`;
  const balanceLabel=headline.balance.unavailable?'Last verified balances unavailable':`${headline.balance.carried?'Balances carried from':'Balances last verified'} ${when(headline.lastVerifiedAt)}`;
  const badge=headline.stale?'Stale data':headline.freshnessReason?'Timing incomplete':'Saved observations';
  freshness.innerHTML=`<p class="headline-verification"><span class="headline-badge${headline.stale?' is-stale':''}">${esc(badge)}</span><span>${esc(balanceLabel)}</span></p><p class="headline-sources"><span class="${headline.quote.stale?'is-stale':''}">${esc(dateLabel('Oldest price',headline.quote))}</span><span class="${headline.fx.stale?'is-stale':''}">${esc(dateLabel('FX',headline.fx))}</span></p>`;
}
async function renderHistory(){
  void renderVisuals();if(!model?.snapshot||visualBusy)return;
  const current=model,cutoff=Date.now()-Math.max(86400000,visualWindows[visualRange]),wanted=(current.history||[]).filter(s=>Date.parse(valuationContext(s).balanceStart)>=cutoff&&s.provenance?.valuation?.basis==='fresh_pinned_balances'&&s.provenance?.valuation?.balances_refreshed===true&&s.id!==current.snapshot.id&&!visualHistory.has(s.id));
  if(!wanted.length)return;const id=++visualRequest;visualBusy=true;visualError=false;void renderVisuals();
  try{const result=await adapter.readHistoryModels({...current,history:wanted});if(id!==visualRequest||model!==current)return;if(result.status==='signed-out'){++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;return;}if(result.status!=='ready'){visualError=true;return;}for(const item of result.models)visualHistory.set(item.snapshot.id,item);}
  catch{if(id===visualRequest)visualError=true;}
  finally{if(id===visualRequest){visualBusy=false;void renderVisuals();if(!visualError)void renderHistory();}}
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
    visibleView=['portfolio','research','tools','plan'].includes(name)?name:'portfolio';
    if($('stakingDialog').open)$('stakingDialog').close();
  }
  for(const v of ['portfolio','research','tools','plan'])$(v+'View').hidden=v!==visibleView;
  document.querySelectorAll('[data-route]').forEach(link=>{if(link.dataset.route===(staking?'staking':visibleView))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.title=`Sea Chef Labs · ${staking?'Staking & rewards':{portfolio:'Portfolio',research:'Research',tools:'Wallets & trading',plan:'Spot trade plan'}[visibleView]}`;
  if(visibleView==='plan')void loadTradePlanner();
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
window.addEventListener('hashchange',route);
const onAuthChange=(event,ownerId)=>{if(event==='SIGNED_IN'&&ownerId&&(!model||ownerId!==model.account.owner_id)){if(model&&ownerId!==model.account.owner_id)walletChooser?.clear();++requestId;busy=false;clearPrivate();}if(['SIGNED_OUT','USER_DELETED'].includes(event)){++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;}else if(['SIGNED_IN','TOKEN_REFRESHED'].includes(event)){queueMicrotask(()=>void refreshPortfolio());}};
let subscription=adapter.subscribe(onAuthChange);
window.addEventListener('pagehide',()=>{++requestId;busy=false;clearPrivate();$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;subscription.unsubscribe();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void renderVisuals();});
window.addEventListener('pageshow',event=>{if(event.persisted){subscription=adapter.subscribe(onAuthChange);void refreshPortfolio();}});
async function restoreSignIn(){
  if(!AUTH_CONFIG.enabled){void refreshPortfolio();return;}
  connectionCopy('signed-out');
  try{const result=await resumeAuthentication();if(result.client){subscription.unsubscribe();adapter=createPortfolioAdapter(result.client);subscription=adapter.subscribe(onAuthChange);await refreshPortfolio();}else await refreshPortfolio();if(result.error){$('connectionResult').textContent=result.error;openConnection();}}
  catch{$('connectionResult').textContent='This tab could not restore sign-in. Try signing in again.';connectionCopy('signed-out');}
}
$('signIn').addEventListener('click',async()=>{$('signIn').disabled=true;$('connectionResult').textContent='Opening GitHub sign-in…';try{await beginGitHubSignIn();}catch(error){$('connectionResult').textContent=error.message;$('signIn').disabled=false;}});
// Public chart frames do not depend on authentication or private snapshot availability.
route();openDetailRoute();void renderVisuals();void restoreSignIn();
