import { renderState, dateTime } from './ui.mjs';
import { createPublicSession } from './src/market/public-session.mjs';
import { publicView } from './src/market/public-view.mjs';

export function mountPublicPreview(doc, { fetchImpl = globalThis.fetch, now = Date.now, host = globalThis.window, timeoutMs = 5000 } = {}) {
  const refresh = doc.getElementById('refresh'), cancel = doc.getElementById('cancel'), stop = doc.getElementById('stop');
  stop.disabled = true;
  const paint = () => {
    const state = session.getState();
    renderState(doc, publicView(state, now()), now());
    doc.getElementById('mode').textContent = 'PUBLIC DATA · READ-ONLY BROWSER PREVIEW';
    doc.getElementById('summary').textContent = 'Real public observations on opening and explicit Refresh. No strategy, execution, account or background service.';
    doc.getElementById('market-note').textContent = 'BTC-USD / ETH-USD: initial integration markets only, not final coverage or picks. Broad-market discovery is not implemented.';
    doc.getElementById('decision-note').textContent = 'WAIT · no strategy is running in this preview.';
    doc.getElementById('engine-note').textContent = 'Browser-only observation. No polling or autonomous worker. Quotes expire after 10 seconds; full refresh at most once per minute per page.';
    doc.getElementById('errors').textContent = state.errors.join(' | ') || 'None reported by the public adapter.';
    doc.getElementById('stop-state').textContent = 'EXECUTION DISABLED · no engine to stop';
    const freshness = doc.getElementById('freshness');
    freshness.textContent = freshness.textContent.replace('engine-validated', 'adapter-validated');
    const busy = state.phase === 'fetching' || state.phase === 'canceling';
    refresh.disabled = busy || now() < state.nextAllowedAt;
    cancel.disabled = !busy || state.phase === 'canceling';
    doc.getElementById('request-status').textContent = busy ? 'Reading Coinbase public data… Cancel aborts this observation.'
      : now() < state.nextAllowedAt ? `${state.phase} · next manual refresh after ${dateTime(state.nextAllowedAt)}; no automatic retry`
      : 'Ready for a manual public-data refresh. Stale prices stay hidden.';
    doc.getElementById('activity').textContent = state.activity.map(e => `${dateTime(e.at)} · ${e.event}${e.path ? ` ${e.path}` : ''}${e.status ? ` · HTTP ${e.status}` : ''}${e.bytes ? ` · ${e.bytes} bytes` : ''}${e.sourceTime ? ` · source ${e.sourceTime}` : ''}`).join('\n') || 'No requests recorded.';
  };
  const session = createPublicSession({ fetchImpl, now, onChange: paint, timeoutMs });
  const refreshNow = () => { void session.refresh(); };
  const cancelNow = () => session.cancel();
  refresh.addEventListener('click', refreshNow);
  cancel.addEventListener('click', cancelNow);
  host?.addEventListener('pagehide', cancelNow);
  paint();
  const timer = setInterval(paint, 1000); // Ages quotes and enables controls; never requests data or logs activity.
  void session.refresh();
  return { session, destroy() { clearInterval(timer); session.destroy(); refresh.removeEventListener('click', refreshNow); cancel.removeEventListener('click', cancelNow); host?.removeEventListener('pagehide', cancelNow); } };
}

if (typeof document !== 'undefined') mountPublicPreview(document);
