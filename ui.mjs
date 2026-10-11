const UNKNOWN = 'UNKNOWN';
const KNOWN_MODES = new Set(['idle', 'observe', 'fixture-replay', 'replay']);
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const words = (value, fallback = UNKNOWN) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const list = (value) => Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
const format = (value, digits = 2) => number(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value) : UNKNOWN;
const money = (value, currency) => number(value) ? `${format(value, Math.abs(value) < 1 ? 8 : 2)} ${words(currency, 'currency unknown')}` : UNKNOWN;
const percent = (value) => number(value) ? `${format(value)}%` : UNKNOWN;

export function timestamp(value) {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && Number.isFinite(new Date(time).getTime()) ? time : null;
}

export function dateTime(value) {
  const time = timestamp(value);
  return time === null ? UNKNOWN : new Date(time).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

export function isFixture(state) {
  return state.mode === 'fixture-replay' || state.mode === 'replay';
}

/** A successful HTTP response does not establish quote freshness. */
export function quoteFreshness(quote, state, now = Date.now()) {
  if (isFixture(state)) return { current: false, label: 'FIXTURE / RECORDED' };
  const times = [quote.observedAt, quote.sourceAt, quote.bookSourceAt].map(timestamp);
  const maxAge = state.freshnessMaxAgeMs ?? state.worker?.freshnessMaxAgeMs;
  if (times.some((time) => time === null) || !number(maxAge) || maxAge <= 0) {
    return { current: false, label: 'UNVERIFIED' };
  }
  if (quote.stale !== false) {
    return { current: false, label: quote.stale === true ? 'STALE' : 'UNVERIFIED' };
  }
  const ages = times.map((time) => now - time);
  if (ages.some((age) => age < 0)) return { current: false, label: 'UNVERIFIED / FUTURE TIME' };
  const oldestAge = Math.max(...ages);
  if (oldestAge > maxAge) return { current: false, label: 'STALE' };
  return { current: true, label: `FRESH · oldest source ${Math.floor(oldestAge / 1000)}s` };
}

export function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid state response');
  if (!KNOWN_MODES.has(value.mode) || typeof value.stopped !== 'boolean') throw new Error('Invalid engine state');
  if (!value.worker || typeof value.worker !== 'object' || typeof value.worker.status !== 'string') throw new Error('Missing worker state');
  for (const field of ['market', 'decisions', 'executions']) {
    if (value[field] !== undefined && !Array.isArray(value[field])) throw new Error(`Invalid ${field} state`);
  }
  return value;
}

/** Clearing the whole view prevents retained marks being mistaken for current state. */
export function unavailableState(message) {
  return {
    mode: 'unavailable', worker: { status: 'UNKNOWN', error: message },
    stopped: null, market: [], decisions: [], executions: [], account: {}, risk: {}, errors: [message],
  };
}

function buildRow(doc, cells) {
  const row = doc.createElement('tr');
  for (const cell of cells) {
    const td = doc.createElement('td');
    if (Array.isArray(cell)) {
      td.textContent = cell[0];
      if (cell[1]) {
        const detail = doc.createElement('span');
        detail.className = 'detail';
        detail.textContent = cell[1];
        td.append(detail);
      }
    } else td.textContent = String(cell);
    row.append(td);
  }
  return row;
}

function fillRows(doc, id, rows, empty, columns) {
  const body = doc.getElementById(id);
  const labels = id === 'market-rows' ? ['Symbol', 'Price', '24h', 'Book depth USD', 'Spread', 'From low', 'History coverage']
    : id === 'execution-rows' ? ['Symbol / side', 'Entry / fill', 'Size', 'Stop', 'Target', 'Fees', 'Slippage'] : null;
  if (!rows.length) {
    const row = buildRow(doc, [empty]);
    row.firstChild.colSpan = columns;
    body.replaceChildren(row);
  } else body.replaceChildren(...rows.map((cells) => {
    const row = buildRow(doc, cells);
    if (labels) [...row.children].forEach((cell, index) => cell.setAttribute('data-label', labels[index]));
    return row;
  }));
}

export function renderState(doc, state, now = Date.now()) {
  const set = (id, value) => { doc.getElementById(id).textContent = value; };
  const fixture = isFixture(state);
  const unavailable = state.mode === 'unavailable';
  const markets = list(state.market);
  const account = state.account || {};
  const fixtureAccount = fixture || ['synthetic', 'fixture'].includes(account.provenance);
  const worker = state.worker || {};
  const currency = account.currency;
  const fresh = markets.map((quote) => quoteFreshness(quote, state, now));
  const allFresh = markets.length > 0 && fresh.every((value) => value.current);
  const hasMarks = fixtureAccount || allFresh;
  const mode = fixture ? 'SIMULATED · SYNTHETIC FIXTURE' : state.mode === 'observe' ? 'SIMULATED · PUBLIC DATA READ-ONLY' : state.mode === 'idle' ? 'SIMULATED · IDLE' : 'SIMULATED · STATE UNAVAILABLE';
  set('mode', mode);
  set('summary', fixture ? 'Recorded offline replay. Values and fills below are synthetic fixtures, not real market performance.' : state.mode === 'observe' ? 'Venue-qualified observations only. Public observations cannot create simulated fills in this slice.' : 'No autonomous deployment confirmed. No public-price simulated trades are enabled.');
  set('market-note', fixture ? `${markets.length} synthetic fixture market${markets.length === 1 ? '' : 's'} · recorded observations` : `${markets.length || 'No'} market observation${markets.length === 1 ? '' : 's'} received · coverage is limited`);

  fillRows(doc, 'market-rows', markets.map((quote, index) => {
    const displayMark = fixture || fresh[index].current;
    return [
      [words(quote.symbol), words(quote.venue, words(quote.source, 'source unknown'))],
      [displayMark ? money(quote.price, quote.quoteCurrency) : UNKNOWN, fresh[index].label],
      displayMark ? percent(quote.change24hPct) : UNKNOWN,
      displayMark ? money(quote.liquidityUsd, 'USD') : UNKNOWN,
      displayMark && number(quote.spreadBps) ? `${format(quote.spreadBps, 6)} bps` : UNKNOWN,
      displayMark ? percent(quote.distanceFromLowPct) : UNKNOWN,
      words(quote.historyCoverage, 'UNKNOWN · no verified history'),
    ];
  }), unavailable ? 'UNKNOWN · market state unavailable; earlier marks cleared' : 'UNKNOWN · no verified observations', 7);
  set('market-source', markets.length ? markets.map((quote, index) => `${words(quote.symbol)} · ${words(quote.source, 'source unknown')} · ticker source ${dateTime(quote.sourceAt)} · book source ${dateTime(quote.bookSourceAt)} · observed ${dateTime(quote.observedAt)} · ${fresh[index].label}`).join(' | ') : 'Source unknown · quote time unknown · freshness unknown');

  set('decision-note', fixture ? 'Recorded deterministic fixture decisions. No individual trade selection.' : 'Deterministic screening only. No individual trade selection.');
  fillRows(doc, 'decision-rows', list(state.decisions ?? state.decision).map((decision) => [
    words(decision.symbol), ['BUY', 'WAIT', 'REJECT'].includes(decision.action ?? decision.decision) ? (decision.action ?? decision.decision) : UNKNOWN,
    words(decision.reason ?? decision.why, 'No reason supplied'),
  ]), unavailable ? 'WAIT · engine state unavailable' : 'WAIT · no decision recorded', 3);

  const executions = list(state.executions ?? state.execution);
  const pending = list(state.pendingOrders);
  const transition = state.lastOrderTransition;
  const pendingNote = pending.map(order => `${words(order.productId)} ${words(order.side)} PENDING · eligible ${dateTime(order.eligibleAt)} · expires ${dateTime(order.expiresAt)}`).join(' | ');
  const transitionNote = transition ? `Last order: ${words(transition.status)} · ${words(transition.lifecycleReason ?? transition.reason)}` : '';
  set('execution-note', [pendingNote, transitionNote, executions.length ? 'Last recorded synthetic fill below · fees and slippage are fixture assumptions' : 'No simulated fills recorded. No public-price execution is enabled.'].filter(Boolean).join(' | '));
  fillRows(doc, 'execution-rows', executions.map((execution) => [
    [words(execution.symbol), `${words(execution.side)} · ${words(execution.provenance, 'provenance unknown')} · ${dateTime(execution.at)}`],
    money(execution.entry ?? execution.fillPrice ?? execution.price, execution.currency ?? currency),
    format(execution.size ?? execution.quantity, 8),
    money(execution.stop, execution.currency ?? currency),
    money(execution.target, execution.currency ?? currency),
    money(execution.fees ?? execution.fee, execution.currency ?? currency),
    number(execution.slippageBps) ? `${format(execution.slippageBps)} bps` : money(execution.slippage, execution.currency ?? currency),
  ]), unavailable ? 'UNKNOWN · no execution history received' : 'No simulated fills recorded', 7);

  const reservationNote = state.reservations ? ` · reserved for buys ${money(state.reservations.buyCash, currency)} · available ${money(account.availableCash, currency)}` : '';
  set('account-note', (fixtureAccount ? 'SYNTHETIC FIXTURE account · net values include recorded fees and fill slippage' : number(account.cash) ? 'Simulated ledger · mark-dependent values require fresh verified data' : 'No account initialized. Balances and returns are unknown.') + reservationNote);
  set('cash', money(account.cash, currency));
  const positions = Array.isArray(account.positions) ? list(account.positions) : null;
  set('position-count', positions ? String(positions.length) : UNKNOWN);
  set('realized', money(account.realizedPnl, currency));
  set('unrealized', hasMarks ? money(account.unrealizedPnl, currency) : UNKNOWN);
  set('drawdown', hasMarks ? percent(account.drawdownPct) : UNKNOWN);
  set('net-pnl', hasMarks ? money(account.netPnl, currency) : UNKNOWN);
  set('net-return', hasMarks ? percent(account.netReturnPct) : UNKNOWN);
  set('fees-paid', money(account.feesPaid, currency));
  set('positions', positions ? positions.length ? positions.map((position) => `${words(position.symbol)} · ${format(position.quantity ?? position.size, 8)} units · basis/unit ${money(position.costPerUnit ?? position.entryPrice ?? position.entry, currency)} (fee inclusive)`).join(' | ') : 'No open simulated positions.' : 'Position details unknown.');

  let workerStatus = words(worker.status);
  if (workerStatus.toLowerCase() === 'running') {
    const heartbeat = timestamp(worker.lastCycleAt);
    const maxAge = state.freshnessMaxAgeMs ?? worker.freshnessMaxAgeMs;
    if (heartbeat === null || !number(maxAge) || maxAge <= 0 || now < heartbeat || now - heartbeat > maxAge) {
      workerStatus = 'UNKNOWN · cached running report; heartbeat stale or unverified';
    }
  }
  set('worker', `${workerStatus}${fixture ? ' · offline fixture replay' : state.mode === 'observe' ? ' · read-only observation' : ''}`);
  set('last-cycle', dateTime(worker.lastCycleAt));
  set('freshness', fixture ? 'RECORDED FIXTURE · no live market freshness claimed' : allFresh ? 'FRESH · engine-validated observations within configured quote age' : markets.length ? 'STALE / UNVERIFIED · current marks hidden' : 'UNKNOWN · no verified market observations');
  const risk = state.risk || {};
  set('risk', [words(risk.status, 'UNKNOWN'), words(risk.reason, '')].filter(Boolean).join(' · '));
  const errors = [...(Array.isArray(state.errors) ? state.errors : []), worker.error].filter(Boolean).map((error) => typeof error === 'string' ? error : words(error.message, 'Unspecified engine error'));
  set('errors', errors.length ? [...new Set(errors)].join(' | ') : unavailable ? 'State unavailable.' : 'None reported by engine.');
  set('stop-state', state.stopped === true ? 'STOP · new entries blocked' : state.stopped === false ? 'ENTRIES ENABLED · fixture policy still enforced' : 'STOP UNCONFIRMED · engine unreachable');
  set('stop-policy', words(state.stopPolicy, 'Block new entries. Protective exit policy unknown.'));
}

export function mountDashboard(doc, fetcher = globalThis.fetch, clock = Date.now) {
  let state = unavailableState('State endpoint not checked.');
  let loading = false;
  let stopping = false;
  let revision = 0;
  const status = doc.getElementById('request-status');
  const refreshButton = doc.getElementById('refresh');
  const stopButton = doc.getElementById('stop');
  const activity = [];
  function recordActivity(message) {
    activity.push(`${dateTime(clock())} · ${message}`);
    if (activity.length > 20) activity.shift();
    doc.getElementById('activity').textContent = activity.join('\n');
  }

  async function request(path, method = 'GET') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetcher(path, {
        method, signal: controller.signal, cache: 'no-store',
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      if (!response.ok) throw new Error(`Local state request failed (${response.status})`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  async function refresh() {
    if (loading || stopping) return;
    loading = true;
    const requestRevision = revision;
    refreshButton.disabled = true;
    status.textContent = 'Reading local state…';
    recordActivity('GET /api/state started');
    try {
      const next = validateState(await request('/api/state'));
      if (stopping || requestRevision !== revision) return;
      state = next;
      renderState(doc, state, clock());
      status.textContent = `State received ${dateTime(clock())} · source times shown above`;
      recordActivity(`GET /api/state received · revision ${Number.isSafeInteger(next.revision) ? next.revision : UNKNOWN} · ${words(next.worker.status)}`);
    } catch (error) {
      if (stopping || requestRevision !== revision) return;
      state = unavailableState(words(error?.message, 'State unavailable'));
      renderState(doc, state, clock());
      status.textContent = 'Local service unavailable. Current marks cleared. STOP unconfirmed.';
      recordActivity('GET /api/state failed · current marks cleared; STOP unconfirmed');
    } finally { loading = false; refreshButton.disabled = stopping; }
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    revision += 1;
    stopButton.disabled = true;
    refreshButton.disabled = true;
    status.textContent = 'Persisting emergency stop…';
    doc.getElementById('stop-state').textContent = 'STOP REQUESTED · persistence unconfirmed';
    recordActivity('POST /api/stop requested · persistence unconfirmed');
    try {
      const next = validateState(await request('/api/stop', 'POST'));
      if (next.stopped !== true || (next.stopPersisted !== true && next.persisted !== true)) throw new Error('Stop persistence was not acknowledged');
      state = next;
      renderState(doc, state, clock());
      status.textContent = 'Emergency stop persisted. New entries blocked; see protective exit policy.';
      recordActivity('POST /api/stop acknowledged · emergency entry pause persisted');
    } catch (error) {
      state = unavailableState(words(error?.message, 'Emergency stop request failed'));
      renderState(doc, state, clock());
      status.textContent = 'STOP UNCONFIRMED. Request failed; use the local CLI stop command.';
      recordActivity('POST /api/stop failed · STOP unconfirmed');
    } finally { stopping = false; stopButton.disabled = false; refreshButton.disabled = false; }
  }

  refreshButton.addEventListener('click', refresh);
  stopButton.addEventListener('click', stop);
  renderState(doc, state, clock());
  // This timer only ages displayed observations. It is not a trading worker.
  const timer = setInterval(() => { if (!stopping) renderState(doc, state, clock()); }, 1000);
  void refresh();
  return { refresh, stop, destroy() { clearInterval(timer); refreshButton.removeEventListener('click', refresh); stopButton.removeEventListener('click', stop); } };
}

if (typeof document !== 'undefined') mountDashboard(document);
