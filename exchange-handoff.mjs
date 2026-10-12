// Navigation only. This frontend has no reviewed setup or account contract.
// No URL, side, amount, holding or eligibility is derived from public quotes.
export const VENUES = Object.freeze([
  Object.freeze({ id: 'okx', name: 'OKX', costs: 'OKX: your pair-specific maker/taker fee is unknown. Check your account fee before trading.' }),
  Object.freeze({ id: 'coinspot', name: 'CoinSpot', costs: 'CoinSpot Markets: 0.1% each side. Instant and conditional stop/target products: 1%. Check the product; these are different costs.' }),
]);
export const DESTINATIONS = Object.freeze([
  { venue: 'okx', pair: 'BTC-AUD', label: 'BTC / AUD', url: 'https://www.okx.com/en-au/trade-spot/btc-aud' },
  { venue: 'okx', pair: 'ETH-AUD', label: 'ETH / AUD', url: 'https://www.okx.com/en-au/trade-spot/eth-aud' },
  { venue: 'okx', pair: 'SOL-AUD', label: 'SOL / AUD', url: 'https://www.okx.com/en-au/trade-spot/sol-aud' },
  { venue: 'okx', pair: 'BTC-USDT', label: 'BTC / USDT', url: 'https://www.okx.com/en-au/trade-spot/btc-usdt' },
  { venue: 'okx', pair: 'ETH-USDT', label: 'ETH / USDT', url: 'https://www.okx.com/en-au/trade-spot/eth-usdt' },
  { venue: 'okx', pair: 'SOL-USDT', label: 'SOL / USDT', url: 'https://www.okx.com/en-au/trade-spot/sol-usdt' },
  { venue: 'coinspot', pair: 'BTC-AUD', label: 'BTC / AUD', url: 'https://www.coinspot.com.au/trade/BTC' },
  { venue: 'coinspot', pair: 'ETH-AUD', label: 'ETH / AUD', url: 'https://www.coinspot.com.au/trade/ETH' },
  { venue: 'coinspot', pair: 'SOL-AUD', label: 'SOL / AUD', url: 'https://www.coinspot.com.au/trade/SOL' },
  { venue: 'coinspot', pair: 'USDT-AUD', label: 'USDT / AUD', url: 'https://www.coinspot.com.au/trade/USDT' },
].map(Object.freeze));

export function destinationFor(venue, pair) {
  return DESTINATIONS.find(d => d.venue === venue && d.pair === pair) ?? null;
}
export function approvedDestination(venue, pair, url) {
  const destination = destinationFor(venue, pair);
  return typeof url === 'string' && !!destination && url === destination.url;
}
export function handoffState({ venue = '', pair = '' } = {}) {
  const selectedVenue = VENUES.find(v => v.id === venue) ?? null;
  return Object.freeze({ venue: selectedVenue, destination: destinationFor(venue, pair), action: 'WAIT',
    buyEnabled: false, sellEnabled: false, reason: 'WAIT · no fresh independently reviewed setup. Buy and Sell are unavailable.' });
}

export function mountExchangeHandoff(doc) {
  const venueSelect = doc.getElementById('handoff-venue'), pairSelect = doc.getElementById('handoff-pair');
  const buy = doc.getElementById('handoff-buy'), sell = doc.getElementById('handoff-sell'), link = doc.getElementById('handoff-link');
  let venue = '', pair = '';
  const option = (value, text) => { const node = doc.createElement('option'); node.value = value; node.textContent = text; return node; };
  const resetPairs = () => {
    pair = ''; pairSelect.replaceChildren(option('', 'Select spot pair'), ...DESTINATIONS.filter(d => d.venue === venue).map(d => option(d.pair, d.label)));
    pairSelect.value = ''; pairSelect.disabled = !VENUES.some(v => v.id === venue);
  };
  const paint = () => {
    const state = handoffState({ venue, pair });
    // Public market freshness and arbitrary setup-like data cannot enable these.
    buy.disabled = true; sell.disabled = true;
    buy.textContent = state.destination ? `Buy · ${state.venue.name}` : 'Buy';
    sell.textContent = state.destination ? `Sell · ${state.venue.name}` : 'Sell';
    const reason = doc.getElementById('handoff-reason');
    if (reason.textContent !== state.reason) reason.textContent = state.reason;
    doc.getElementById('handoff-costs').textContent = state.venue?.costs ?? 'Select the exchange you intend to use. No holdings or account connection here.';
    doc.getElementById('handoff-selection').textContent = state.destination
      ? `${state.venue.name} · ${state.destination.label} · spot page only. For a sale, choose the venue where you hold the asset. No transfer is made.`
      : 'Select a venue and spot pair. Listed pairs are navigation choices, not picks.';
    link.textContent = state.destination ? `Open ${state.venue.name} ${state.destination.label} spot page ↗` : 'Open spot page ↗';
    link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('referrerpolicy', 'no-referrer'); link.setAttribute('aria-disabled', String(!state.destination));
    if (state.destination) { link.setAttribute('href', state.destination.url); link.tabIndex = 0; }
    else { link.removeAttribute('href'); link.tabIndex = -1; }
  };
  const changeVenue = () => {
    venue = VENUES.some(v => v.id === venueSelect.value) ? venueSelect.value : '';
    venueSelect.value = venue; resetPairs(); paint();
  };
  const changePair = () => { pair = destinationFor(venue, pairSelect.value)?.pair ?? ''; pairSelect.value = pair; paint(); };
  const navigate = event => {
    // Recheck the exact venue/pair/URL tuple, including a modified DOM href.
    if (venueSelect.value !== venue || pairSelect.value !== pair) {
      event.preventDefault(); venue = ''; venueSelect.value = ''; resetPairs(); paint(); return;
    }
    if (!approvedDestination(venue, pair, link.getAttribute('href'))) { event.preventDefault(); paint(); }
    // Native HTTPS navigation is the entire action. Repeated clicks have no
    // economic effect, no order/fill callback and no local account mutation.
  };
  venueSelect.replaceChildren(option('', 'Select exchange'), ...VENUES.map(v => option(v.id, v.name)));
  venueSelect.value = ''; resetPairs(); paint();
  venueSelect.addEventListener('change', changeVenue); pairSelect.addEventListener('change', changePair);
  link.addEventListener('click', navigate); link.addEventListener('auxclick', navigate);
  return { paint, destroy() {
    venueSelect.removeEventListener('change', changeVenue); pairSelect.removeEventListener('change', changePair);
    link.removeEventListener('click', navigate); link.removeEventListener('auxclick', navigate);
    venue = ''; venueSelect.value = ''; resetPairs(); paint();
  } };
}
