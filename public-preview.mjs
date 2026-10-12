import { renderState, dateTime, quoteFreshness, timestamp } from './ui.mjs';
import { createPublicSession } from './src/market/public-session.mjs';
import { publicView } from './src/market/public-view.mjs';
import { mountExchangeHandoff } from './exchange-handoff.mjs';
import { createResearchSession } from './reviewed-research.mjs';

const clockTime = value => timestamp(value) === null ? 'UNKNOWN' : new Date(timestamp(value)).toISOString().slice(11, 19) + 'Z';
const price = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function compactSummary(state, view, now) {
  const last = state.activity.at(-1);
  return {
    market: view.market.length ? view.market.map(quote => {
      const freshness = quoteFreshness(quote, view, now);
      return `${quote.symbol.replace(/-USD$/, '')} ${freshness.current ? price.format(quote.price) + ' USD' : '—'} · ${freshness.current ? 'FRESH' : freshness.label}`;
    }).join('\n') : 'UNKNOWN · no verified prices',
    decision: 'WAIT · no reviewed setup',
    execution: 'MANUAL · exchange review',
    account: 'UNKNOWN · no account',
    engine: `${state.phase.toUpperCase()} · browser only\n${last ? `${clockTime(last.at)} ${last.event.replace('Observation cancellation requested', 'Cancel requested')}${last.status ? ` ${last.status}` : ''}` : 'No requests yet'}`,
  };
}

export function mountPublicPreview(doc, { fetchImpl = globalThis.fetch, now = Date.now, host = globalThis.window, timeoutMs = 5000 } = {}) {
  const refresh = doc.getElementById('refresh'), cancel = doc.getElementById('cancel'), stop = doc.getElementById('stop');
  stop.disabled = true;
  const research = createResearchSession({ origin: host?.location?.origin, fetchImpl, now, onChange: () => paint(), timeoutMs });
  const handoff = mountExchangeHandoff(doc, { research, now });
  const paint = () => {
    const state = session.getState();
    const at = now(), view = publicView(state, at);
    renderState(doc, view, at);
    for (const [section, text] of Object.entries(compactSummary(state, view, at))) doc.getElementById(`${section}-brief`).textContent = text;
    doc.getElementById('mode').textContent = 'PUBLIC · READ ONLY · UTC';
    handoff.paint();
    doc.getElementById('summary').textContent = 'Real public observations on opening and explicit Refresh. No strategy, execution, account or background service.';
    doc.getElementById('market-note').textContent = 'BTC-USD / ETH-USD: initial integration markets only, not final coverage or picks. Broad-market discovery is not implemented.';
    doc.getElementById('decision-note').textContent = 'Reviewed research appears under EXECUTION for the selected venue and pair. Missing or expired research keeps Buy at WAIT. Sell is owner-directed exchange navigation.';
    doc.getElementById('engine-note').textContent = 'Browser-only observation. No polling or autonomous worker. Quotes expire after 10 seconds; full refresh at most once per minute per page.';
    doc.getElementById('errors').textContent = state.errors.join(' | ') || 'None reported by the public adapter.';
    doc.getElementById('stop-state').textContent = 'EXECUTION DISABLED · no engine to stop';
    const freshness = doc.getElementById('freshness');
    freshness.textContent = freshness.textContent.replace('engine-validated', 'adapter-validated');
    const busy = state.phase === 'fetching' || state.phase === 'canceling' || research.getState().phase === 'loading';
    refresh.disabled = busy || now() < state.nextAllowedAt;
    cancel.disabled = !busy || state.phase === 'canceling';
    const requestStatus = busy ? 'Reading public data…'
      : at < state.nextAllowedAt ? `Refresh after ${clockTime(state.nextAllowedAt)}` : 'Refresh ready · manual only';
    const status = doc.getElementById('request-status');
    if (status.textContent !== requestStatus) status.textContent = requestStatus;
    doc.getElementById('activity').textContent = state.activity.map(e => `${dateTime(e.at)} · ${e.event}${e.path ? ` ${e.path}` : ''}${e.status ? ` · HTTP ${e.status}` : ''}${e.bytes ? ` · ${e.bytes} bytes` : ''}${e.sourceTime ? ` · source ${e.sourceTime}` : ''}`).join('\n') || 'No requests recorded.';
  };
  const session = createPublicSession({ fetchImpl, now, onChange: paint, timeoutMs });
  const refreshNow = () => { void session.refresh(); void research.refresh(); };
  const cancelNow = () => { session.cancel(); research.cancel(); };
  const ageResearch = () => handoff.paint();
  refresh.addEventListener('click', refreshNow);
  cancel.addEventListener('click', cancelNow);
  host?.addEventListener('pagehide', cancelNow);
  doc.addEventListener?.('visibilitychange', ageResearch);
  paint();
  const timer = setInterval(paint, 1000); // Ages quotes and enables controls; never requests data or logs activity.
  void session.refresh();
  void research.refresh();
  return { session, research, destroy() { clearInterval(timer); session.destroy(); research.destroy(); handoff.destroy(); refresh.removeEventListener('click', refreshNow); cancel.removeEventListener('click', cancelNow); host?.removeEventListener('pagehide', cancelNow); doc.removeEventListener?.('visibilitychange', ageResearch); } };
}

if (typeof document !== 'undefined') mountPublicPreview(document);
