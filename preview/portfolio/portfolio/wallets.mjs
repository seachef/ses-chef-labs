// Connection-only, tab-memory wallet sessions. No account request runs on import or open.
const SITE_URL = 'https://seachef.github.io/ses-chef-labs/preview/portfolio/';
const SITE_ORIGIN = 'https://seachef.github.io';
const REQUEST_TIMEOUT_MS = 60_000;
const CHAIN_TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CHAINS = { '0x1': 'Ethereum', '0xa': 'Optimism', '0x38': 'BNB Smart Chain', '0x89': 'Polygon', '0x2105': 'Base', '0xa4b1': 'Arbitrum One', '0xa86a': 'Avalanche C-Chain' };
const waitingCopy = 'The wallet prompt may still be open. Finish or reject it in your wallet before trying again. Closing this window does not cancel that prompt.';

function accountsFrom(value) {
  if (!Array.isArray(value) || value.length > 100 || !value.every(address => typeof address === 'string' && ADDRESS.test(address))) return null;
  const seen = new Set();
  return value.filter(address => { const key = address.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}
function chainFrom(value) {
  return typeof value === 'string' && /^0x[0-9a-f]{1,64}$/i.test(value) ? `0x${BigInt(value).toString(16)}` : null;
}
function solanaAddress(value) {
  try {
    const address = typeof value === 'string' ? value : typeof value?.toBase58 === 'function' ? value.toBase58() : value?.toString?.();
    return typeof address === 'string' && BASE58.test(address) ? address : null;
  } catch { return null; }
}
function walletName(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 64) || 'Browser wallet' : 'Browser wallet';
}
function failureCopy(error) {
  switch (error?.code) {
    case 4001: return 'Connection declined. Nothing was connected here. You can try again when ready.';
    case 4100: return 'Account access was not authorized. Check this site’s permissions in your wallet, then try again.';
    case 4200: return 'This wallet does not support this connection request. Try another available wallet.';
    case 4900: return 'Your wallet is disconnected. Open it and check its connection, then try again.';
    case 4901: return 'Your wallet’s selected network is unavailable. Check it in your wallet, then try again.';
    case -32002: return waitingCopy;
    default: return 'The wallet could not connect. Open or unlock it, then try again.';
  }
}

export function createWalletChooser({ setPrivacyHidden, isPrivacyHidden }) {
  const doc = document, win = window;
  const records = new Map(), uuids = new Map(), evmProviders = new Map();
  // An unresolved prompt remains locked even after clear/close/timeout. It cannot be cancelled by a page.
  const pendingProviders = new WeakMap();
  let sequence = 0, listening = false, lastTrigger = null, live = false;
  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function button(text, action, className = 'button') {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function privateRegion(className) {
    const node = element('div', className);
    node.setAttribute('data-private', '');
    return node;
  }
  function privacy() { setPrivacyHidden(isPrivacyHidden()); }
  if (!doc.getElementById('walletChooserStyles')) {
    const css = element('link');
    css.id = 'walletChooserStyles'; css.rel = 'stylesheet';
    css.href = new URL('./wallets.css?v=20261002.wallets1', import.meta.url).href;
    doc.head.append(css);
  }
  const dialog = element('dialog', 'wallet-chooser'); dialog.id = 'walletChooser';
  dialog.setAttribute('aria-labelledby', 'walletChooserTitle');
  const heading = element('div', 'dialog-heading');
  const title = element('h2', '', 'Wallets'); title.id = 'walletChooserTitle';
  const headingActions = element('div', 'wallet-heading-actions');
  const eye = button('', () => {}, 'icon-button privacy-toggle');
  eye.setAttribute('data-privacy-toggle', '');
  eye.setAttribute('aria-label', 'Hide coins and values');
  const eyeSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '23', height: '23', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) eyeSvg.setAttribute(key, value);
  for (const [tag, attributes] of [['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z' }], ['circle', { cx: '12', cy: '12', r: '3' }], ['path', { class: 'eye-slash', d: 'm3 3 18 18' }]]) {
    const shape = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    eyeSvg.append(shape);
  }
  eye.append(eyeSvg);
  const closeButton = button('Close', dismiss); closeButton.setAttribute('data-wallet-close', '');
  headingActions.append(eye, closeButton); heading.append(title, headingActions);
  const disclosure = element('div', 'wallet-disclosure');
  disclosure.append(element('p', '', 'Connect to show your public address in this tab. This does not add it to your tracked Super portfolio. No signature or transaction is requested.'), element('p', '', 'Wallet site permissions apply across seachef.github.io, including its other pages.'));
  const intro = element('p', 'wallet-intro', 'Choose one wallet and network. Account access is requested only when you press Connect.');
  const list = element('div', 'wallet-choice-list'); list.setAttribute('data-wallet-choices', '');
  const empty = element('p', 'wallet-empty', 'No compatible wallet was detected in this browser. Open this page in your wallet app, or enable a supported browser extension.');
  const note = element('p', 'wallet-note', 'Wallet names are reported by extensions. Connections stay in this tab’s memory. Private portfolio sign-in and its saved watched wallets are separate.');
  const status = element('p', 'wallet-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const mobile = element('details', 'wallet-mobile');
  mobile.append(element('summary', '', 'Open in wallet app'));
  mobile.append(element('p', '', 'On mobile, use the wallet’s built-in browser. Opening an app does not connect it; choose Connect on this page once it opens.'));
  const appLinks = element('div', 'wallet-app-options');
  function appLink(text, href) {
    const a = element('a', 'button', text); a.href = href; a.rel = 'noopener noreferrer';
    return a;
  }
  appLinks.append(appLink('Open MetaMask', `https://link.metamask.io/dapp/${SITE_URL.replace(/^https:\/\//, '')}`), appLink('Open Phantom', `https://phantom.app/ul/browse/${encodeURIComponent(SITE_URL)}?ref=${encodeURIComponent(SITE_ORIGIN)}`));
  mobile.append(appLinks, element('p', '', 'Rabby: copy this page link, then paste it into Rabby’s built-in browser.'));
  const site = element('a', 'wallet-site-link', SITE_URL); site.href = SITE_URL;
  const copy = button('Copy page link', async () => {
    try { await win.navigator.clipboard.writeText(SITE_URL); status.textContent = 'Page link copied. Paste it in Rabby’s built-in browser.'; }
    catch { status.textContent = 'Copy the page link shown here, then paste it in your wallet’s built-in browser.'; }
  });
  mobile.append(site, copy, element('p', '', 'Phantom may not be detected inside an embedded preview. Open the full page in a supported browser.'));
  dialog.append(heading, disclosure, intro, list, empty, status, mobile, note);
  doc.body.append(dialog); privacy();

  function renderRecord(record) {
    record.nameNode.textContent = record.name;
    const locked = pendingProviders.has(record.provider);
    record.connect.disabled = locked || !!record.session;
    record.connect.textContent = record.session ? 'Connected' : locked ? 'Pending in wallet…' : 'Connect';
    record.connect.setAttribute('aria-label', `${record.session ? 'Connected to' : 'Connect'} ${record.name} · ${record.kind === 'evm' ? 'EVM' : 'Solana'}`);
    record.connect.setAttribute('aria-busy', String(locked));
    record.forget.hidden = !record.session && !record.operation;
    record.message.textContent = record.messageText || (locked ? waitingCopy : '');
    record.details.replaceChildren();
    record.sessionWrap.hidden = !record.session;
    if (record.session) {
      const { accounts, chain } = record.session;
      record.details.append(element('p', 'wallet-account', accounts[0]));
      const network = record.kind === 'solana' ? 'Solana · Network managed in Phantom' : chain ? `${CHAINS[chain] || 'EVM network'} · Chain ${BigInt(chain).toString()}` : 'EVM · Network unavailable';
      record.details.append(element('p', 'wallet-network', network));
      if (accounts.length > 1) record.details.append(element('p', 'wallet-network', `${accounts.length} accounts shared. Showing the first account.`));
      record.details.append(element('p', 'wallet-network', 'Connected here for address display only.'));
    }
    privacy();
  }
  function render() {
    empty.hidden = records.size > 0;
    for (const record of records.values()) renderRecord(record);
    privacy();
  }
  function add(provider, kind, name, source, uuid = null) {
    if (!provider || !['object', 'function'].includes(typeof provider)) return;
    if (kind === 'evm' && typeof provider.request !== 'function') return;
    if (kind === 'solana' && typeof provider.connect !== 'function') return;
    if (uuid && uuids.has(uuid)) return;
    const existing = kind === 'evm' ? evmProviders.get(provider) : [...records.values()].find(record => record.kind === kind && record.provider === provider);
    if (existing) {
      if (uuid) { uuids.set(uuid, existing); existing.name = walletName(name); existing.source = source; renderRecord(existing); }
      return;
    }
    const record = { id: ++sequence, provider, kind, name: walletName(name), source, generation: 0, session: null, operation: null, binding: null, messageText: '' };
    const row = element('section', 'wallet-choice'); row.setAttribute('data-wallet-id', String(record.id));
    const rowHead = element('div', 'wallet-choice-heading'), label = element('div');
    const icon = element('span', 'wallet-generic-icon', '◇'); icon.setAttribute('aria-hidden', 'true');
    record.nameNode = element('h3');
    label.append(record.nameNode, element('p', 'wallet-kind', kind === 'evm' ? 'EVM networks' : 'Solana'));
    record.connect = button('Connect', () => { void connect(record); }); record.connect.setAttribute('data-wallet-connect', String(record.id));
    rowHead.append(icon, label, record.connect);
    record.message = element('p', 'wallet-row-status'); record.message.setAttribute('role', 'status');
    record.sessionWrap = element('div', 'wallet-session');
    record.details = privateRegion('wallet-session-details');
    const placeholder = element('p', 'wallet-private-placeholder', 'Wallet details hidden'); placeholder.setAttribute('data-privacy-placeholder', '');
    record.sessionWrap.append(record.details, placeholder);
    record.forget = button('Disconnect here', () => { forget(record, 'Disconnected here. You can also remove this site’s account permission in your wallet.'); });
    record.forget.setAttribute('data-wallet-disconnect', String(record.id));
    row.append(rowHead, record.message, record.sessionWrap, record.forget);
    record.row = row; records.set(record.id, record);
    if (kind === 'evm') evmProviders.set(provider, record);
    if (uuid) uuids.set(uuid, record);
    list.append(row); render();
  }
  function removeBinding(record) {
    const binding = record.binding; record.binding = null;
    if (!binding) return;
    binding.observedAccounts = undefined; binding.chain = null;
    for (const [event, handler] of binding.listeners) {
      try {
        if (typeof record.provider.removeListener === 'function') record.provider.removeListener(event, handler);
        else if (typeof record.provider.off === 'function') record.provider.off(event, handler);
      } catch { /* Invalidated handlers cannot repopulate a cleared session. */ }
    }
  }
  function forget(record, message = '') {
    ++record.generation; removeBinding(record);
    if (record.operation) { record.operation.abandoned = !record.operation.settled; win.clearTimeout(record.operation.timer); record.operation = null; }
    record.session = null; record.messageText = message;
    renderRecord(record);
  }
  function bind(record) {
    removeBinding(record);
    const binding = { listeners: [], observedAccounts: undefined, chain: null, chainVersion: 0 };
    record.binding = binding;
    function on(event, callback) {
      if (typeof record.provider.on !== 'function') return;
      const handler = value => { if (record.binding === binding) callback(value); };
      try { record.provider.on(event, handler); binding.listeners.push([event, handler]); } catch { /* Some providers omit events. */ }
    }
    if (record.kind === 'evm') {
      on('accountsChanged', value => {
        const accounts = accountsFrom(value);
        if (!accounts?.length) { forget(record, accounts ? 'Account access ended. Connect again to show an address.' : 'The wallet returned an invalid account update. Connect again.'); return; }
        binding.observedAccounts = accounts;
        if (record.session) { record.session.accounts = accounts; renderRecord(record); }
      });
      on('chainChanged', value => { binding.chain = chainFrom(value); ++binding.chainVersion; if (record.session) { record.session.chain = binding.chain; renderRecord(record); } });
      on('disconnect', () => forget(record, 'The wallet disconnected. Open it, then connect again when ready.'));
    } else {
      on('accountChanged', value => {
        const address = solanaAddress(value);
        if (!address) { forget(record, 'Solana account access ended. Connect again to show an address.'); return; }
        binding.observedAccounts = [address];
        if (record.session) { record.session.accounts = [address]; renderRecord(record); }
      });
      on('disconnect', () => forget(record, 'Phantom disconnected. Connect again when ready.'));
    }
    return binding;
  }
  async function readChain(record, generation, binding) {
    const version = binding.chainVersion;
    let timer;
    try {
      const chain = await Promise.race([
        Promise.resolve(record.provider.request({ method: 'eth_chainId' })),
        new Promise(resolve => { timer = win.setTimeout(() => resolve(null), CHAIN_TIMEOUT_MS); })
      ]);
      if (generation === record.generation && record.session && record.binding === binding && version === binding.chainVersion) {
        record.session.chain = chainFrom(chain); renderRecord(record);
      }
    } catch { /* Address permission remains valid when the optional network read fails. */ }
    finally { win.clearTimeout(timer); }
  }
  async function connect(record) {
    if (!live || !dialog.open || record.session || pendingProviders.has(record.provider)) return;
    const generation = ++record.generation, binding = bind(record);
    const operation = {}; record.operation = operation; pendingProviders.set(record.provider, operation);
    record.messageText = 'Check your wallet to allow account access.';
    operation.timer = win.setTimeout(() => {
      if (record.operation === operation && record.generation === generation) forget(record, waitingCopy);
    }, REQUEST_TIMEOUT_MS);
    renderRecord(record);
    try {
      // Called synchronously from this selected wallet's button, preserving the user gesture.
      const result = await (record.kind === 'evm' ? record.provider.request({ method: 'eth_requestAccounts' }) : record.provider.connect());
      operation.settled = true;
      if (!live || record.generation !== generation || record.operation !== operation) return;
      const received = record.kind === 'evm' ? accountsFrom(result) : (() => { const address = solanaAddress(result?.publicKey ?? record.provider.publicKey); return address ? [address] : null; })();
      if (!received?.length) { forget(record, 'No valid account was shared. Choose an account in your wallet and try again.'); return; }
      record.session = { accounts: binding.observedAccounts || received, chain: binding.chain };
      record.messageText = '';
      if (record.kind === 'evm') void readChain(record, generation, binding);
    } catch (error) {
      operation.settled = true;
      if (record.generation === generation && record.operation === operation) forget(record, failureCopy(error));
    } finally {
      win.clearTimeout(operation.timer);
      if (pendingProviders.get(record.provider) === operation) pendingProviders.delete(record.provider);
      if (record.operation === operation) record.operation = null;
      if (operation.abandoned && record.messageText === waitingCopy) record.messageText = 'That earlier wallet request finished. Its result was ignored here. Choose Connect to try again.';
      if (records.get(record.id) === record) renderRecord(record);
      // A cleared chooser may have rediscovered this same provider before the prompt settled.
      for (const current of records.values()) if (current !== record && current.provider === record.provider) renderRecord(current);
    }
  }
  function announce(event) {
    try {
      const { info, provider } = event.detail || {};
      if (!info || !UUID.test(info.uuid) || typeof info.name !== 'string' || !provider || typeof provider.request !== 'function') return;
      add(provider, 'evm', info.name, 'eip6963', info.uuid.toLowerCase());
      // Avoid an ambiguous global router when explicit EIP-6963 choices are available.
      for (const record of records.values()) if (record.source === 'legacy' && !record.session && !record.operation && !pendingProviders.has(record.provider)) {
        records.delete(record.id); evmProviders.delete(record.provider); record.row.remove();
      }
      render();
    } catch { /* Untrusted extension metadata is never executable content. */ }
  }
  function discover() {
    if (!listening) { win.addEventListener('eip6963:announceProvider', announce); listening = true; }
    // Install the listener first: providers may announce synchronously.
    win.dispatchEvent(new win.Event('eip6963:requestProvider'));
    try {
      const phantom = win.phantom;
      if (phantom?.ethereum?.isPhantom === true) add(phantom.ethereum, 'evm', 'Phantom', 'phantom');
      if (phantom?.solana?.isPhantom === true) add(phantom.solana, 'solana', 'Phantom', 'phantom');
      if (![...records.values()].some(record => record.source === 'eip6963')) add(win.ethereum, 'evm', 'Browser wallet', 'legacy');
    } catch { /* Missing/inaccessible injection is handled by the app-browser choices. */ }
    render();
  }
  function stopDiscovery() { if (listening) win.removeEventListener('eip6963:announceProvider', announce); listening = false; }
  function endDiscovery() {
    stopDiscovery();
    for (const record of records.values()) if (record.operation) forget(record, waitingCopy);
  }
  function dismiss(restoreFocus = true) {
    endDiscovery();
    if (dialog.open) dialog.close();
    if (restoreFocus && lastTrigger?.isConnected) lastTrigger.focus();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open) endDiscovery(); });
  function route() { if (dialog.open) dismiss(false); }
  win.addEventListener('hashchange', route);
  function clear() {
    live = false; stopDiscovery();
    for (const record of records.values()) forget(record);
    records.clear(); uuids.clear(); evmProviders.clear(); list.replaceChildren(); status.textContent = '';
    if (dialog.open) dialog.close();
    lastTrigger = null; render();
  }
  win.addEventListener('pagehide', clear);
  return {
    open(trigger) { live = true; lastTrigger = trigger || doc.activeElement; if (!dialog.open) dialog.showModal(); discover(); },
    clear,
    route
  };
}
