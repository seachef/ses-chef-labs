import {createHoldingDailyController,dailyMoveMarkup} from './portfolio/holding-daily-view.mjs?v=20261007.moves1';
import { AUTH_CONFIG } from './portfolio/auth-config.mjs?v=20261001.data2';
import { resumeAuthentication, beginGitHubSignIn } from './portfolio/auth-client.mjs?v=20261001.data2';
import { COINS, SOCIALS, socialURL, compactQuantity as displayDecimal, aud, groupHoldings, visibleHoldings, isExcludedPortfolioAsset, portfolioTotal, coinMetadata, snapshotFreshness, valuationContext, pricedHoldingsSummary, displayValuation, valuationMoney, fxReferenceDate, verifiedFx, priceUsd } from './portfolio/model.mjs?v=20261007.moves1';
import { createWalletProjection, walletHoldingsView } from './portfolio/wallet-scope.mjs?v=20261007.wallets1';
import { formatUnits, multiplyDecimals } from './portfolio/domain.mjs?v=20261001.data2';
import { createPortfolioAdapter } from './portfolio/adapter.mjs?v=20261005.smsf1';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const when=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-AU',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Date unavailable';
let adapter=createPortfolioAdapter(globalThis.seaChefPortfolioClient||null);
const initialHoldings=$('holdingsBody').innerHTML,initialStakingHoldings=$('stakingHoldingsBody').innerHTML,initialStake=$('stakeList').innerHTML;
const initialRefreshButton=$('refreshPortfolio').innerHTML;
const dailyMoves=createHoldingDailyController({onChange:renderDailyMoves});
function dayMove(h,detail=false){return dailyMoveMarkup(h,dailyMoves.comparison(h),currentCurrency(),displayModel()?.snapshot,Date.now(),detail);}
function renderDailyMoves(){if(!model)return;const holdings=new Map(groupHoldings(displayModel()).map(h=>[h.key,h]));for(const element of document.querySelectorAll('[data-day-key]')){const h=holdings.get(element.dataset.dayKey);element.innerHTML=h?dayMove(h,element.hasAttribute('data-day-detail')):'';}setPrivacyHidden(privacyHidden);}

// A display-only privacy switch for this page visit. Never persists or changes data.
let privacyHidden=false;
let selectedWalletId=null;const walletProjection=createWalletProjection();
const displayModel=()=>walletProjection.get(model,selectedWalletId);
const listedHoldings=holdings=>visibleHoldings(holdings,currentCurrency(),{walletView:selectedWalletId!==null});
function syncHoldingsPolicy(){for(const note of document.querySelectorAll('[data-holdings-policy]'))note.textContent=selectedWalletId?'All saved nonzero holdings for this wallet are listed, including small and unpriced coins. Excluded tokens remain hidden. Missing prices are unavailable, not zero.':'Only priced holdings over $50 in the selected currency are listed. Totals include smaller priced holdings; unpriced holdings are hidden.';}
const scopeName=()=>selectedWalletId?model?.wallets.find(w=>w.id===selectedWalletId)?.label||'Selected wallet':'All wallets';
const currencyStorageKey='seaChef.display.currency.v1';let preferredCurrency=null;
try{const saved=globalThis.sessionStorage?.getItem(currencyStorageKey);if(['USD','AUD'].includes(saved))preferredCurrency=saved;}catch{}
const currentCurrency=()=>preferredCurrency||(model?displayValuation(model).currency:'AUD');
function syncCurrencyControls(){if(!model?.snapshot)$('portfolioValue').textContent=(currentCurrency()==='USD'?'US$':'A$')+' —';for(const button of document.querySelectorAll('[data-display-currency]'))button.setAttribute('aria-pressed',String(button.dataset.displayCurrency===currentCurrency()));for(const heading of document.querySelectorAll('.holdings-table thead th:last-child'))heading.textContent='Indicative '+currentCurrency();}
document.addEventListener('click',event=>{const button=event.target.closest('[data-display-currency]');if(!button)return;const next=button.dataset.displayCurrency;if(!['USD','AUD'].includes(next))return;preferredCurrency=next;try{globalThis.sessionStorage?.setItem(currencyStorageKey,next);}catch{}syncCurrencyControls();if(model)renderModel();else void renderPortfolioSummary();detailViews?.update({force:true});});
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
  detailLoad=import('./portfolio/details.mjs?v=20261007.moves1').then(({createDetails})=>{detailViews=createDetails({getModel:displayModel,getCurrency:currentCurrency,isWalletView:()=>selectedWalletId!==null,renderHoldings,renderDayMove:dayMove,setPrivacyHidden,isPrivacyHidden:()=>privacyHidden,esc,when});return detailViews;}).catch(()=>{toast('Portfolio details could not be loaded. Please try again.');return null;}).finally(()=>{detailLoad=null;});return detailLoad;
}
function openDetailRoute(){if(!detailViews&&['#overview','#holdings'].includes(location.hash))void loadDetailViews().then(view=>view?.route());}
document.addEventListener('click',event=>{const launcher=event.target.closest('a[href="#overview"],a[href="#holdings"]'),coin=event.target.closest('[data-coin-key]'),before=location.hash,shownModel=displayModel();if(launcher){event.preventDefault();const target=launcher.getAttribute('href');void loadDetailViews().then(view=>{if(location.hash===before&&displayModel()===shownModel)view?.openPortfolio(launcher,target);});}else if(coin&&!detailViews){event.preventDefault();void loadDetailViews().then(view=>{if(location.hash===before&&displayModel()===shownModel)view?.openCoin(coin.dataset.coinKey,coin);});}});
window.addEventListener('hashchange',openDetailRoute);
let visibleView='portfolio',stakingReturnView='portfolio';
let model=null,accountModels=[],requestId=0,busy=false,toastTimer=null,authStatus='not-configured';
function toast(message){$('statusToast').textContent=message;$('statusToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('statusToast').hidden=true;},7000);}
function clearPrivate({keepAccounts=false}={}){
  dailyMoves.clear();
  selectedWalletId=null;walletProjection.clear();syncHoldingsPolicy();$('coinsTitle').textContent='Your coins';$('walletScopeLabel').textContent='Choose wallets';if($('walletScopePicker'))$('walletScopePicker').open=false;
  if(!keepAccounts){accountModels=[];$('accountList').replaceChildren();$('accountSection').hidden=true;}
  if($('walletActivity'))$('walletActivity').textContent='Choose your wallets to see activity.';
  model=null;tradePlanner?.clear();detailViews?.clear();$('portfolioChange').textContent='Daily change unavailable · No comparable recorded values yet';$('portfolioChange').className='recorded-headline';$('portfolioFreshness').replaceChildren();$('refreshStatus').textContent='';$('portfolioValueLabel').textContent='Portfolio value';$('portfolioScope').textContent='Includes held balances in Staking & rewards. Unminted estimates are excluded.';$('stakingHoldingsBody').innerHTML=initialStakingHoldings;$('stakingCoinPrivacy').textContent='Balances appear only after authentication';for(const id of ['stakingValuationStatus','stakingValuationDetails'])$(id).hidden=true;$('stakingValuationStatus').textContent='';$('stakingValuationDetails').open=false;$('stakingValuationSources').replaceChildren();$('watchedWalletList').innerHTML='<p>Private wallet addresses appear after sign-in.</p>';$('holdingsBody').innerHTML=initialHoldings;$('holdingsBody').closest('table').querySelector('caption').textContent='Supported assets. Balances are unavailable until a private account is connected.';$('stakeList').innerHTML=initialStake;$('portfolioValue').textContent=(currentCurrency()==='USD'?'US$':'A$')+' —';$('portfolioValue').setAttribute('aria-label','Portfolio value unavailable');$('walletSummary').textContent='Combined wallets · Ethereum';$('coinsSubtitle').textContent='Combined balances, kept private';$('portfolioCaption').textContent='Connect your private account to see verified balances';$('syncStatus').textContent='Not synced · Private connection pending';$('coinPrivacy').innerHTML='<img src="assets/ui/lock-keyhole.svg" width="18" height="18" alt="">Balances appear only after authentication';$('maturitySummary').textContent='Your stake maturities will appear after sync';$('liquidRewardBalances').innerHTML='<p>Sign in to load priced reward holdings.</p>';$('rewardEstimates').innerHTML='<p>Private reward estimates are not connected yet.</p>';++comparisonRequest;comparisonBusy=false;comparisonError=false;comparisonHistory.clear();void renderPortfolioSummary();$('signOut').hidden=true;$('valuationStatus').hidden=true;$('valuationStatus').textContent='';$('valuationDetails').hidden=true;$('valuationDetails').open=false;$('valuationSources').replaceChildren();renderSocials();
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
function keepSavedDisplay(message){showRefreshStatus(message+(model?' Your last verified saved balances remain shown.':' No new balances have been loaded.'));void renderPortfolioSummary();}
function syncWalletControls(){for(const button of document.querySelectorAll('[data-wallet-scope],[data-account-id]'))button.disabled=busy;$('walletScopePicker').setAttribute('aria-busy',String(busy));}
function syncRefreshControl(){$('refreshPortfolio').disabled=busy;$('refreshPortfolio').innerHTML=initialRefreshButton;syncWalletControls();}
async function refreshPortfolio({announce=false,collect=false}={}){
  if(busy)return;busy=true;const focusedBefore=document.activeElement,id=++requestId;let collected=null;
  syncWalletControls();$('refreshPortfolio').disabled=true;$('checkConnection').disabled=true;$('refreshPortfolio').setAttribute('aria-busy','true');
  if(collect){$('refreshPortfolio').textContent='Refreshing balances…';showRefreshStatus('Reading watched wallets. Your saved balances remain visible while this runs.');}
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
    const previousWallet=selectedWalletId,previousAccount=model?.account.id;clearPrivate();if(result.status==='not-configured'&&AUTH_CONFIG.enabled)result.status='signed-out';connectionCopy(result.status);
    if(result.status==='ready'){
      accountModels=result.models||[result.model];model=result.model;if(model.account.id===previousAccount&&model.wallets.some(w=>w.id===previousWallet))selectedWalletId=previousWallet;renderModel();
      const message=collected?.status==='saved'?(model.snapshot?.id===collected.snapshotId?'Fresh watched-wallet balances loaded. Prices may still be incomplete.':'New snapshot saved. Showing the latest available saved record.'):model.snapshot?'Stored balances loaded. Dollar values depend on available prices and AUD conversion.':'Private account connected. First verified sync pending.';
      $('connectionResult').textContent=message;if(collect)showRefreshStatus(message);
      // Optional shortcuts must not hold wallet refresh or account selection open.
      void adapter.getSocialLinks().then(links=>{if(id===requestId&&model)renderSocials(links);}).catch(()=>{});
      if(announce&&!collect)toast(model.snapshot?'Saved observations reloaded. Wallet balances were not refreshed.':'First verified sync is pending.');
    }else{
      const message=result.status==='signed-out'?'No signed-in session. Your balances remain private.':result.status==='no-account'?'Signed in. No private portfolio account is available.':result.status==='setup-pending'?'Signed in. Private owner access and snapshots are still pending.':'Private connection is not configured yet. No balances have been loaded.';
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
function accountName(account){return account.kind==='smsf'?'SMSF':'Personal';}
function walletNetwork(wallet){return wallet.network==='solana'?'Solana':wallet.network==='ethereum'||wallet.chain_id===1?'Ethereum':'Network unverified';}
function renderAccounts(){
  $('accountSection').hidden=!accountModels.length;
  $('walletScopeLabel').textContent=model?accountName(model.account)+' · '+scopeName():'Choose wallets';
  $('accountList').innerHTML=accountModels.map(item=>{
    const display=displayValuation(item,currentCurrency()),pending=item.wallets.filter(w=>w.provider_status==='provider_pending'),value=display.value;
    const status=!item.snapshot?'First sync pending':display.incomplete?`${display.currency} subtotal · incomplete`:'Recorded portfolio value';
    return `<button class="account-row" data-account-id="${esc(item.account.id)}" aria-pressed="${item===model}"><span class="account-avatar" aria-hidden="true">${item.account.kind==='smsf'?'S':'P'}</span><span class="account-copy"><strong>${accountName(item.account)}</strong><small>${item.wallets.length} watched wallets${pending.length?' · '+pending.map(walletNetwork).filter((v,i,a)=>a.indexOf(v)===i).join(', ')+' pending':''}</small></span><span class="account-value"><strong>${value==null?'—':valuationMoney(value,display.currency)}</strong><small>${status}</small></span></button><div class="wallet-scope-options">${[{id:'',label:'All wallets'},...item.wallets].map(w=>`<button type="button" data-scope-account="${esc(item.account.id)}" data-wallet-scope="${esc(w.id)}" aria-pressed="${item===model&&(selectedWalletId||'')===w.id}">${esc(w.label||'Watched wallet')}${w.provider_status==='provider_pending'?'<small>Balance pending</small>':''}</button>`).join('')}</div>`;
  }).join('');
  setPrivacyHidden(privacyHidden);
}
document.addEventListener('click',event=>{
  const walletButton=event.target.closest('[data-wallet-scope]');
  if(walletButton&&!busy){const next=accountModels.find(item=>item.account.id===walletButton.dataset.scopeAccount),id=walletButton.dataset.walletScope||null;if(!next||(id&&!next.wallets.some(w=>w.id===id)))return;clearPrivate({keepAccounts:true});model=next;selectedWalletId=id;connectionCopy('ready');renderModel();$('walletScopeSummary').focus();return;}
  const button=event.target.closest('[data-account-id]');if(!button||busy)return;
  const next=accountModels.find(item=>item.account.id===button.dataset.accountId);if(!next||next===model&&selectedWalletId===null)return;
  clearPrivate({keepAccounts:true});model=next;connectionCopy('ready');renderModel();
  [...document.querySelectorAll('[data-account-id]')].find(b=>b.dataset.accountId===next.account.id)?.focus();
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('walletScopePicker').open){$('walletScopePicker').open=false;$('walletScopeSummary').focus();}});
document.addEventListener('click',event=>{if(!$('walletScopePicker').contains(event.target))$('walletScopePicker').open=false;});
function renderModel(){
  if(!model)return;const shown=displayModel(),snapshot=shown.snapshot;syncCurrencyControls();renderAccounts();syncRefreshControl();
  $('coinsTitle').textContent=selectedWalletId?'Wallet coins':'Your coins';syncHoldingsPolicy();
  $('walletActivity').textContent=accountName(model.account)+' · '+scopeName()+'. Transaction history is not loaded yet. Saved balance observations are not a transaction list.';
  const networks=[...new Set(shown.wallets.map(walletNetwork))];
  $('walletSummary').textContent=shown.wallets.length?`${accountName(model.account)} · ${scopeName()} · ${networks.join(' + ')}`:'No wallets provisioned';
  $('watchedWalletList').innerHTML=shown.wallets.length?shown.wallets.map(w=>`<div class="watched-wallet"><span>${esc(w.label||'Watched wallet')}<small class="wallet-network">${walletNetwork(w)}${w.provider_status==='provider_pending'?' · Provider pending · Balance unknown':''}</small></span><details><summary>View address</summary><p class="wallet-address">${esc(w.address)}</p></details></div>`).join(''):'<p>No watched wallets provisioned yet.</p>';
  if(!snapshot){$('portfolioValue').textContent=(currentCurrency()==='USD'?'US$':'A$')+' —';$('portfolioCaption').textContent='First verified sync pending';$('coinsSubtitle').textContent='Private account connected · awaiting snapshot';$('syncStatus').textContent='Connected · No verified snapshot yet';$('coinPrivacy').textContent='Private account connected. Balances appear after first sync.';$('holdingsBody').innerHTML='<tr><td colspan="4">No verified observations yet. Balances are unknown, not zero.</td></tr>';$('stakingHoldingsBody').innerHTML='<tr><td colspan="3">No verified observations yet.</td></tr>';void renderPortfolioSummary();$('portfolioCaption').textContent=shown.wallets.some(w=>w.provider_status==='provider_pending')?'First Ethereum sync pending · Solana provider pending, balance unknown':'First verified sync pending';detailViews?.update();return;}
  const holdings=groupHoldings(shown);dailyMoves.setScope(shown,listedHoldings(holdings));const total=portfolioTotal(shown),freshness=snapshotFreshness(snapshot),timing=valuationContext(snapshot);
  $('coinsSubtitle').textContent=`${accountName(model.account)}${selectedWalletId?' · '+scopeName():''} · ${snapshot.observed_wallets} of ${snapshot.expected_wallets} wallets observed${shown.wallets.some(w=>w.provider_status==='provider_pending')?' · Solana balance unknown':''}`;
  const display=displayValuation(shown,currentCurrency()),priced=pricedHoldingsSummary(holdings,display.currency),headline=display.value;
  $('portfolioValueLabel').textContent=display.label;
  $('portfolioValue').textContent=headline==null?(display.currency==='AUD'?'A$ —':'US$ —'):valuationMoney(headline,display.currency);
  $('portfolioValue').setAttribute('aria-label',headline==null?'Holdings value unavailable':`${valuationMoney(headline,display.currency)} ${display.incomplete?'priced holdings subtotal. Incomplete portfolio valuation.':'indicative portfolio value'}`);
  $('portfolioCaption').textContent=!display.incomplete?(freshness==='stale'?'Saved value · Balances are over 36 hours old':'Indicative total · Liquid tokens + staked principal'):headline==null?'Balances loaded · AUD prices unavailable':`Incomplete valuation · ${priced.unpricedAssets?priced.unpricedAssets+' held asset'+(priced.unpricedAssets===1?' is':'s are')+' unpriced':timing.carried?'Balances carried forward':snapshot.observed_wallets!==snapshot.expected_wallets?'Wallet coverage incomplete':'Full coverage not verified'}`;
  if(display.currency==='USD'&&!valuationContext(snapshot).fxAt)$('portfolioCaption').textContent=`AUD conversion unavailable · ${display.pricedAssets} priced held asset${display.pricedAssets===1?'':'s'}${display.unpricedAssets?' · '+display.unpricedAssets+' unpriced or excluded':''}${display.pendingWallets?' · '+display.pendingNetworks.join(', ')+' balance unknown':''}`;
  if(display.fxUnavailable)$('portfolioCaption').textContent='AUD conversion unavailable in this snapshot. Select USD, or use Refresh balances above.';
  $('portfolioScope').textContent=(display.incomplete?'Value includes only priced holdings. ':'')+(snapshot.provenance?.token_discovery?.status&&snapshot.provenance.token_discovery.status!=='complete'?'Ethereum token discovery incomplete. ':'')+(snapshot.provenance?.known_asset_inventory_only?'Watched coins and ETH only. ':'')+'Includes held balances in Staking & rewards once. Unminted estimates are excluded.';
  $('syncStatus').textContent=`${freshness==='stale'?'Older saved balances':freshness==='unverified-time'?'Balance time unverified':'Saved balances'} · ${when(timing.balanceStart)}${timing.carried?' · Carried forward, not refreshed':''}`;
  const views=walletHoldingsView(holdings,selectedWalletId);
  renderValuationDetails(snapshot,views.main,timing);renderValuationDetails(snapshot,views.staking,timing,'staking');
  renderHoldings('holdingsBody',views.main.filter(h=>h.quantity!=='0'));renderHoldings('stakingHoldingsBody',views.staking);
  const stakes=shown.stakes.filter(s=>s.protocol==='hex'&&s.status!=='unlocked'&&!isExcludedPortfolioAsset(s.chain_id,s.asset_id)).sort((a,b)=>(a.maturity_date||'z').localeCompare(b.maturity_date||'z'));
  $('maturitySummary').textContent=stakes.length?`${stakes.length} recorded stake${stakes.length===1?'':'s'} · ${stakes[0].maturity_date?'Earliest maturity '+stakes[0].maturity_date:'Maturity date pending'}`:'No active HEX stakes in the latest snapshot';
  $('stakeList').classList.toggle('empty-detail',!stakes.length);
  $('stakeList').innerHTML=stakes.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Stake</th><th>Principal · HEX</th><th>Maturity</th><th>Status</th></tr></thead><tbody>${stakes.map(s=>`<tr><td>${esc(s.stake_id)}</td><td>${displayDecimal(formatUnits(s.principal_raw,s.decimals))}</td><td>${esc(s.maturity_date||'Unverified')}</td><td>${esc(({pending:'Pending',good_accounted:'Good Accounting recorded',active:'Active',matured:'Matured'})[s.status]||s.status)}</td></tr>`).join('')}</tbody></table></div><p class="fine-print">Principal only. Future payout is not estimated. Ending stakes is never performed here.</p>`:'<h2>No active HEX stakes recorded</h2><p>The latest snapshot has no active HEX stake observations.</p>';
  const listedKeys=new Set(listedHoldings(holdings).map(h=>h.key));
  $('liquidRewardBalances').innerHTML=['HDRN','ICSA'].map(symbol=>{const coin=COINS.find(c=>c.symbol===symbol),row=holdings.find(h=>h.chainId===1&&h.assetId.toLowerCase()===coin.assetId);if(!row||!listedKeys.has(row.key))return '';return `<p>${symbol}<span>${displayDecimal(row.liquid)}</span></p>`;}).join('')||(selectedWalletId?'<p>No liquid reward balances recorded for this wallet.</p>':'<p>No priced reward holdings over $50.</p>');
  const rewardEstimates=shown.rewardEstimates.filter(r=>!isExcludedPortfolioAsset(r.chain_id,r.asset_id));
  $('rewardEstimates').innerHTML=rewardEstimates.length?rewardEstimates.map(r=>`<div><p>${r.estimate_status==='estimated_unminted'&&r.amount_raw!=null?displayDecimal(formatUnits(r.amount_raw,r.decimals))+' HDRN':'Estimate unavailable'}</p><p class="fine-print">Stake ${esc(r.source_stake_id)} · ${esc(when(r.observed_at))}</p><p class="fine-print">${r.provenance?.carried_forward_estimate?'Saved estimate · not refreshed. ':''}${esc(r.caveat)}</p></div>`).join(''):'<p>No verified unminted reward estimates recorded.</p>';
  loadHeadlineComparison();detailViews?.update();

}
function renderHoldings(bodyId,holdings){
  const currency=currentCurrency(),key=currency==='USD'?'usd':'aud',showPrice=$(bodyId).closest('table').hasAttribute('data-unit-price'),fx=verifiedFx(displayModel()?.snapshot);$(bodyId).closest('table').querySelector('thead th:last-child').textContent='Indicative '+currency;
  holdings=listedHoldings(holdings);
  $(bodyId).innerHTML=holdings.length?holdings.map(h=>{
    const unit=h.unitPriceUsd==null?null:currency==='USD'?h.unitPriceUsd:fx?multiplyDecimals(h.unitPriceUsd,fx):null;const unitCopy=unit==null?'—':priceUsd(unit).replace('US$',currency==='USD'?'US$':'A$');
    const valueCopy=valuationMoney(h[key],currency),listedValue=h[key]!=null&&valueCopy===valuationMoney('50',currency)&&visibleHoldings([h],currency).length?'>'+valueCopy:valueCopy;
    const coin=coinMetadata(h),image=coin?`<img class="coin-icon" src="assets/coins/${coin.icon}" width="58" height="58" alt="">`:'',staked=h.staked!=='0';
    return `<tr><th scope="row"><button class="asset asset-button" data-coin-key="${esc(h.key)}" aria-label="Open ${esc(coin?.name||h.symbol||'Token')} details">${image}<span><span class="asset-name">${esc(coin?.name||h.symbol||'Token')}</span><span class="asset-symbol">${esc(h.symbol)}${!coin?' · Unlisted asset':''}</span></span></button></th>${showPrice?`<td class="unit-price" title="${esc(unit==null?'Price unavailable':currency+' '+unit)}">${esc(unitCopy)}</td>`:''}<td><span class="amount" title="${esc(h.quantity)}">${displayDecimal(h.quantity)}</span><span class="holding-detail">${staked?`${displayDecimal(h.liquid)} liquid · ${displayDecimal(h.staked)} staked (locked)`:'Liquid tokens'}</span></td><td class="money" title="${esc(h[key]==null?'Value unavailable':currency+' '+h[key])}"><span data-holding-value>${esc(listedValue)}</span>${h[key]==null?`<span class="holding-detail" title="${esc(h.priceSource||'Price unavailable')}">${currency==='AUD'&&h.usd!=null?'AUD FX unavailable · USD available':h.unreliable?'Price unreliable · excluded':'Price unavailable'}</span>`:''}${h.quote?.low_liquidity===true?'<span class="holding-detail quote-warning">Low liquidity · indicative</span>':h.quote?.confidence==='low'?'<span class="holding-detail quote-warning">Low confidence · indicative</span>':''}<span data-day-key="${esc(h.key)}">${dayMove(h)}</span></td></tr>`;
  }).join(''):`<tr><td colspan="${showPrice?4:3}">${selectedWalletId?'No nonzero holdings recorded for this wallet. Saved coverage may be incomplete.':`No priced holdings over ${currency} 50 in this view. Unpriced holdings are hidden; totals include smaller priced holdings.`}</td></tr>`;
  $(bodyId).closest('table').querySelector('caption').textContent=selectedWalletId?'All saved nonzero balances for the selected wallet, including small and unpriced holdings. Liquid coins and locked staked principal are identified separately. Excluded tokens remain hidden.':`Saved held balances in this view, combined by chain and token contract. Holdings worth ${currency} 50 or less are hidden from this list only. Unpriced holdings are hidden. Totals include smaller priced holdings.`;
}
function renderValuationDetails(snapshot,holdings,timing,prefix=''){
  const target=id=>$(prefix?prefix+id[0].toUpperCase()+id.slice(1):id);
  const unpriced=holdings.filter(h=>h.quantity!=='0'&&h.usd==null).map(h=>h.symbol),gaps=[];
  if(unpriced.length)gaps.push(unpriced.length+' unpriced holding'+(unpriced.length===1?'':'s')+(selectedWalletId?' shown without dollar values; excluded from valuation':' hidden; excluded from valuation'));
  if(!timing.fxAt)gaps.push('AUD conversion unavailable');
  if(snapshot.observed_wallets!==snapshot.expected_wallets)gaps.push('Wallet coverage incomplete');
  target('coinPrivacy').textContent=gaps.length?gaps.join(' · '):timing.carried?'Known coin values shown · Full total unavailable for carried-forward balances':'Values exclude unminted rewards';
  target('valuationStatus').hidden=false;
  target('valuationStatus').textContent=[timing.carried?'Saved partial valuation · Original balances carried forward; wallets were not reread':snapshot.status==='partial'?'Saved partial snapshot':'Saved valuation',timing.valuedAt?'Valuation saved '+when(timing.valuedAt):null,fxReferenceDate(snapshot)?'USD → AUD daily reference dated '+fxReferenceDate(snapshot):timing.fxAt?'USD → AUD reference rate dated '+when(timing.fxAt):null].filter(Boolean).join('. ')+'.';
  const rows=[`<p><strong>Balance observations</strong> · ${esc(when(timing.balanceStart))}${timing.balanceEnd&&timing.balanceEnd!==timing.balanceStart?' to '+esc(when(timing.balanceEnd)):''}</p>`];
  if(timing.fxAt)rows.push(`<p><strong>AUD conversion</strong> · ${esc(timing.fxSource)} · ${fxReferenceDate(snapshot)?'Reference date '+esc(fxReferenceDate(snapshot))+' · Retrieved '+esc(when(snapshot.fx_observed_at)):'Provider date '+esc(when(timing.fxAt))}. A daily reference rate, not a live trading rate.${snapshot.provenance?.valuation?.fx?.attribution?' '+esc(snapshot.provenance.valuation.fx.attribution):''}</p>`);
  for(const h of listedHoldings(holdings)){
    if(h.usd==null){rows.push(`<p><strong>${esc(h.symbol)}</strong> · ${h.unreliable?'Unreliable price, excluded from valuation':'Price unavailable'}</p>`);continue;}
    const q=h.quote,notes=[q?.low_liquidity===true?'Low liquidity':null,q?.confidence==='low'?'Low confidence':null,'Indicative, before costs'].filter(Boolean);
    const times=q?.retrieved_at?`Retrieved ${when(q.retrieved_at)} · ${q.provider_as_of?'Provider time '+when(q.provider_as_of):'Provider price time unavailable'}`:`Observed ${when(h.priceAt)}`;
    rows.push(`<p><strong>${esc(h.symbol)}</strong> · ${esc(h.priceSource)} · ${esc(times)}<br>${esc(notes.join(' · '))}${q?.confidence_reason?' · '+esc(q.confidence_reason):''}</p>`);
  }
  target('valuationSources').innerHTML=rows.join('');target('valuationDetails').hidden=false;
}
let summaryHelper=null,headlineHelper=null,summaryLoad=null,comparisonBusy=false,comparisonError=false,comparisonRequest=0;
const comparisonHistory=new Map();
async function renderPortfolioSummary(){
  if(!summaryHelper){
    if(!summaryLoad)summaryLoad=Promise.all([import('./portfolio/history.mjs?v=20261007.exclusions1'),import('./portfolio/headline.mjs?v=20261007.exclusions1')]).then(([module,headline])=>{
      summaryHelper=module.recordedHistorySummary;headlineHelper=headline.portfolioHeadline;
    }).catch(()=>{$('portfolioChange').textContent='Recorded comparison unavailable.';}).finally(()=>{summaryLoad=null;});
    await summaryLoad;if(!summaryHelper)return;
  }
  const current=displayModel(),historyModels=(model?.history||[]).map(s=>s.id===model.snapshot?.id?current:walletProjection.get(comparisonHistory.get(s.id)||{account:model.account,wallets:model.wallets,snapshot:s,balances:[],stakes:[],rewardEstimates:[]},selectedWalletId));
  syncCurrencyControls();
  const now=Date.now(),summary=summaryHelper({currentModel:current,models:historyModels,rangeKey:'1D',now,allowPartial:true,currency:currentCurrency()});
  renderHeadline(headlineHelper({summary,currentModel:current,now}),current);
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
    const reason=comparisonBusy?'Loading recorded comparison…':comparisonError?'Recorded comparison could not be loaded':headline.reasonLabel.replaceAll('1D','past day');
    change.innerHTML=`<strong>Daily change unavailable</strong><span>${esc(reason)}</span>`;
  }
  const dateLabel=(name,item)=>`${name} ${item.at?when(item.at):'time unavailable'}${item.stale?' · stale':''}`;
  const balanceLabel=headline.balance.unavailable?'Last verified balances unavailable':`${headline.balance.carried?'Balances carried from':'Balances last verified'} ${when(headline.lastVerifiedAt)}`;
  const badge=headline.stale?'Stale data':headline.freshnessReason?'Timing incomplete':'Saved observations';
  freshness.innerHTML=`<p class="headline-verification"><span class="headline-badge${headline.stale?' is-stale':''}">${esc(badge)}</span><span>${esc(balanceLabel)}</span></p><p class="headline-sources"><span class="${headline.quote.stale?'is-stale':''}">${esc(dateLabel('Oldest price',headline.quote))}</span><span class="${headline.fx.stale?'is-stale':''}">${esc(fxReferenceDate(current.snapshot)?'FX reference date '+fxReferenceDate(current.snapshot)+' · Daily reference rate':dateLabel('FX',headline.fx))}</span></p>`;
}
async function loadHeadlineComparison(){
  void renderPortfolioSummary();if(!model?.snapshot||comparisonBusy)return;
  const current=model,cutoff=Date.now()-86400000,wanted=(current.history||[]).filter(s=>Date.parse(valuationContext(s).balanceStart)>=cutoff&&s.provenance?.valuation?.basis==='fresh_pinned_balances'&&s.provenance?.valuation?.balances_refreshed===true&&s.id!==current.snapshot.id&&!comparisonHistory.has(s.id));
  if(!wanted.length)return;const id=++comparisonRequest;comparisonBusy=true;comparisonError=false;void renderPortfolioSummary();
  try{const result=await adapter.readHistoryModels({...current,history:wanted});if(id!==comparisonRequest||model!==current)return;if(result.status==='signed-out'){++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;return;}if(result.status!=='ready'){comparisonError=true;return;}for(const item of result.models)comparisonHistory.set(item.snapshot.id,item);}
  catch{if(id===comparisonRequest)comparisonError=true;}
  finally{if(id===comparisonRequest){comparisonBusy=false;void renderPortfolioSummary();if(!comparisonError)void loadHeadlineComparison();}}
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
    visibleView=['portfolio','tools','plan'].includes(name)?name:'portfolio';
    if($('stakingDialog').open)$('stakingDialog').close();
  }
  for(const v of ['portfolio','tools','plan'])$(v+'View').hidden=v!==visibleView;
  document.querySelectorAll('[data-route]').forEach(link=>{if(link.dataset.route===(staking?'staking':visibleView))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.title=`Sea Chef Labs · ${staking?'Staking & rewards':{portfolio:'Portfolio',tools:'Wallets & trading',plan:'Spot trade plan'}[visibleView]}`;
  if(visibleView==='plan')void loadTradePlanner();
  if(visibleView==='portfolio'&&model)loadHeadlineComparison();
}
$('closeStakingWindow').addEventListener('click',closeStakingWindow);
$('stakingDialog').addEventListener('cancel',event=>{event.preventDefault();closeStakingWindow();});
function renderSocials(links={}){document.querySelectorAll('[data-social]').forEach(link=>{const item=SOCIALS.find(s=>s.id===link.dataset.social);link.href=socialURL(item.id,links[item.id])||item.url;});}
$('accountButton').addEventListener('click',openConnection);$('manageWallets').addEventListener('click',()=>{if(!model)openConnection();else{$('walletsTitle').scrollIntoView({block:'center',behavior:'auto'});$('walletsTitle').focus();}});document.addEventListener('click',event=>{if(event.target.closest('[data-connection]'))openConnection();});
for(const id of ['closeConnection','dismissConnection'])$(id).addEventListener('click',()=>$('connectionDialog').close());
$('refreshPortfolio').addEventListener('click',()=>void refreshPortfolio({announce:true,collect:true}));$('checkConnection').addEventListener('click',()=>void refreshPortfolio({announce:true}));
$('signOut').addEventListener('click',async()=>{++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;try{await adapter.signOut();$('connectionResult').textContent='Signed out. Private balances cleared.';}catch{$('connectionResult').textContent='Balances cleared from this page. Service sign-out could not be confirmed.';}});
window.addEventListener('hashchange',route);
const onAuthChange=(event,ownerId)=>{if(event==='SIGNED_IN'&&ownerId&&(!model||ownerId!==model.account.owner_id)){if(model&&ownerId!==model.account.owner_id)walletChooser?.clear();++requestId;busy=false;clearPrivate();}if(['SIGNED_OUT','USER_DELETED'].includes(event)){++requestId;busy=false;walletChooser?.clear();clearPrivate();connectionCopy('signed-out');$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;}else if(['SIGNED_IN','TOKEN_REFRESHED'].includes(event)){queueMicrotask(()=>void refreshPortfolio());}};
let subscription=adapter.subscribe(onAuthChange);
window.addEventListener('pagehide',()=>{++requestId;busy=false;clearPrivate();$('refreshPortfolio').disabled=false;$('checkConnection').disabled=false;$('refreshPortfolio').removeAttribute('aria-busy');$('refreshPortfolio').innerHTML=initialRefreshButton;subscription.unsubscribe();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){dailyMoves.recheck();dailyMoves.refresh();void renderPortfolioSummary();}else dailyMoves.pause();});
window.addEventListener('pageshow',event=>{if(event.persisted){subscription=adapter.subscribe(onAuthChange);void refreshPortfolio();}});
async function restoreSignIn(){
  if(!AUTH_CONFIG.enabled){void refreshPortfolio();return;}
  connectionCopy('signed-out');
  try{const result=await resumeAuthentication();if(result.client){subscription.unsubscribe();adapter=createPortfolioAdapter(result.client);subscription=adapter.subscribe(onAuthChange);await refreshPortfolio();}else await refreshPortfolio();if(result.error){$('connectionResult').textContent=result.error;openConnection();}}
  catch{$('connectionResult').textContent='This tab could not restore sign-in. Try signing in again.';connectionCopy('signed-out');}
}
$('signIn').addEventListener('click',async()=>{$('signIn').disabled=true;$('connectionResult').textContent='Opening GitHub sign-in…';try{await beginGitHubSignIn();}catch(error){$('connectionResult').textContent=error.message;$('signIn').disabled=false;}});
// Load the SMSF summary and read-only saved observations.
route();openDetailRoute();void renderPortfolioSummary();void restoreSignIn();

