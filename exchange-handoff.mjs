import { VENUES, DESTINATIONS, destinationFor, approvedDestination } from './exchange-destinations.mjs';
export { VENUES, DESTINATIONS, destinationFor, approvedDestination } from './exchange-destinations.mjs';
function selectionState({ venue = '', pair = '' } = {}) {
  const selectedVenue = VENUES.find(v => v.id === venue) ?? null;
  return Object.freeze({ venue: selectedVenue, destination: destinationFor(venue, pair) });
}

export function mountExchangeHandoff(doc, { research = null, now = Date.now } = {}) {
  const venueSelect = doc.getElementById('handoff-venue'), pairSelect = doc.getElementById('handoff-pair');
  const buy = doc.getElementById('handoff-buy'), sell = doc.getElementById('handoff-sell'), link = doc.getElementById('handoff-link');
  const owner = doc.getElementById('handoff-owner');
  let venue = '', pair = '', confirmed = null;
  const option = (value, text) => { const node = doc.createElement('option'); node.value = value; node.textContent = text; return node; };
  const clearConfirmation = () => { confirmed = null; owner.checked = false; };
  const resetPairs = () => {
    pair = ''; clearConfirmation(); pairSelect.replaceChildren(option('', 'Select spot pair'), ...DESTINATIONS.filter(d => d.venue === venue).map(d => option(d.pair, d.label)));
    pairSelect.value = ''; pairSelect.disabled = !VENUES.some(v => v.id === venue);
  };
  const assessment = () => research?.evaluate(venue, pair, now()) ?? { status: 'WAIT', setup: null, reason: 'No reviewed research loaded.' };
  const ready = result => result.status === 'READY' && result.setup?.venue === venue && result.setup?.pair === pair && result.setup?.quoteCurrency === pair.split('-')[1];
  const safeLink = (node, destination, enabled) => {
    node.disabled = !enabled; node.setAttribute('aria-disabled', String(!enabled));
    node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); node.setAttribute('referrerpolicy', 'no-referrer');
    if (enabled) { node.setAttribute('href', destination.url); node.tabIndex = 0; } else { node.removeAttribute('href'); node.tabIndex = -1; }
  };
  const paint = () => {
    const state = selectionState({ venue, pair }), result = assessment(), destination = state.destination;
    const canBuy = !!destination && ready(result), canSell = !!destination && confirmed === venue + ':' + pair && owner.checked;
    doc.getElementById('decision-brief').textContent = canBuy ? `REVIEW BUY · ${destination.label}` : 'WAIT · no reviewed setup';
    safeLink(buy, destination, canBuy); safeLink(sell, destination, canSell); safeLink(link, destination, !!destination);
    buy.textContent = state.venue ? `Review Buy · ${state.venue.name} ↗` : 'Review Buy';
    sell.textContent = state.venue ? `Review Sell · ${state.venue.name} ↗` : 'Review Sell';
    owner.disabled = !destination;
    const reason = doc.getElementById('handoff-reason');
    const message = canBuy ? 'Reviewed setup available · confirm current price, side and fees on the exchange.' : 'WAIT · ' + result.reason;
    if (reason.textContent !== message) reason.textContent = message;
    doc.getElementById('handoff-costs').textContent = canBuy && venue === 'okx'
      ? 'OKX: the research includes a reviewed pair-specific fee snapshot. Confirm the current applicable fee in your account before trading.'
      : state.venue?.costs ?? 'Select the exchange you intend to use. No holdings or account connection here.';
    doc.getElementById('handoff-selection').textContent = destination
      ? `${state.venue.name} · ${destination.label} · spot page only. No transfer is made.`
      : 'Select a venue and spot pair. Listed pairs are navigation choices, not picks.';
    doc.getElementById('handoff-sell-reason').textContent = canSell ? 'Owner-directed Sell review · independent of Buy research. Holdings are not verified here.' : 'To review a sale, select where you hold this asset and confirm below. Buy research expiry does not block a confirmed Sell handoff.';
    const details = doc.getElementById('handoff-research'); details.replaceChildren();
    if (canBuy) {
      const s = result.setup, c = result.economics;
      for (const value of [
        `Research snapshot · ${s.venue.toUpperCase()} ${s.pair} · ${s.quoteCurrency}`,
        `Reviewed entry ${s.entry} · stop ${s.stop} · targets ${s.targets.join(' / ')}. Levels are research; no protective orders are placed.`,
        `Public modeling quantity ${s.costs.quantity} · fee ${s.fees.buyBps / 100}% buy / ${s.fees.sellBps / 100}% sell · adverse slippage ${s.costs.slippageBps} bps per side.`,
        `Modeled buy cost ${c.buyCost.toFixed(4)} ${s.quoteCurrency} · first-target net ${c.targetNet.toFixed(4)} · stop net ${c.stopNet.toFixed(4)}. Estimates, not fills or guarantees.`,
        `Source ${new Date(s.market.sourceAt).toISOString()} · received ${new Date(s.market.receivedAt).toISOString()} · reviewed ${new Date(result.review.reviewedAt).toISOString()} · expires ${new Date(result.review.expiresAt).toISOString()}.`,
        `Review ${result.review.reviewerId} / ${s.id} · market source ${s.market.sourceUrl} · fee basis ${s.fees.basis} / ${s.fees.sourceUrl}.`
      ]) { const row = doc.createElement('p'); row.textContent = value; details.append(row); }
    }
    link.textContent = destination ? `Open ${state.venue.name} ${destination.label} spot page ↗` : 'Open spot page ↗';
  };
  const changeVenue = () => { venue = VENUES.some(v => v.id === venueSelect.value) ? venueSelect.value : ''; venueSelect.value = venue; resetPairs(); paint(); };
  const changePair = () => { pair = destinationFor(venue, pairSelect.value)?.pair ?? ''; pairSelect.value = pair; clearConfirmation(); paint(); };
  const confirmOwner = () => { confirmed = owner.checked && destinationFor(venue, pair) ? venue + ':' + pair : null; paint(); };
  const navigate = (event, node, side) => {
    if (venueSelect.value !== venue || pairSelect.value !== pair) { event.preventDefault(); venue = ''; venueSelect.value = ''; resetPairs(); paint(); return; }
    const valid = approvedDestination(venue, pair, node.getAttribute('href'));
    const eligible = side === 'buy' ? ready(assessment()) : side === 'sell' ? confirmed === venue + ':' + pair && owner.checked : true;
    if (!valid || !eligible) event.preventDefault();
    paint(); // Re-evaluate immediately; native HTTPS navigation is the only effect.
  };
  const handlers = [[link, e => navigate(e, link, 'open')], [buy, e => navigate(e, buy, 'buy')], [sell, e => navigate(e, sell, 'sell')]];
  venueSelect.replaceChildren(option('', 'Select exchange'), ...VENUES.map(v => option(v.id, v.name)));
  venueSelect.value = ''; resetPairs(); paint();
  venueSelect.addEventListener('change', changeVenue); pairSelect.addEventListener('change', changePair); owner.addEventListener('change', confirmOwner);
  for (const [node, fn] of handlers) { node.addEventListener('click', fn); node.addEventListener('auxclick', fn); }
  return { paint, destroy() {
    venueSelect.removeEventListener('change', changeVenue); pairSelect.removeEventListener('change', changePair); owner.removeEventListener('change', confirmOwner);
    for (const [node, fn] of handlers) { node.removeEventListener('click', fn); node.removeEventListener('auxclick', fn); }
    venue = ''; venueSelect.value = ''; resetPairs(); paint();
  } };
}
