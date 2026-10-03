/** Pure display helpers for recorded holdings changes; no fetch, storage or synthetic history. */
import { signedDecimalDifference, recordedHistorySummary } from './history.mjs?v=20261002.details1';
import { valuationContext } from './model.mjs?v=20261003.personal1';

const DAY = 86400000;
const BALANCE_MAX_AGE = 36 * 3600000;
const QUOTE_MAX_AGE = 30 * 60000;
const FX_MAX_AGE = 7 * DAY;
const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const iso = value => value == null ? null : new Date(value).toISOString();
const hasText = value => typeof value === 'string' && value.trim().length > 0;

function parts(value, signed = false) {
  if (typeof value !== 'string' || value.length > 4096 || !DECIMAL.test(value) || !signed && value.startsWith('-')) return null;
  const negative = value.startsWith('-'), [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return { n: BigInt(whole + fraction), scale: fraction.length, negative };
}
const positive = value => { const p = parts(value); return p != null && p.n > 0n; };
const roundRatio = (numerator, denominator) => (numerator * 2n + denominator) / (2n * denominator);
const fixed2 = n => (n / 100n).toLocaleString('en-AU') + '.' + (n % 100n).toString().padStart(2, '0');

/** Exact change / baseline, displayed as a signed percentage. A zero baseline has no percentage. */
export function formatSignedPercent(change, baseline) {
  const delta = parts(change, true), start = parts(baseline);
  if (!delta || !start || start.n === 0n) return null;
  if (delta.n === 0n) return '0.00%';
  const sign = delta.negative ? '-' : '+';
  // Hundredths of a percentage point, entirely in decimal integers.
  const numerator = delta.n * 10n ** BigInt(start.scale) * 10000n;
  const denominator = start.n * 10n ** BigInt(delta.scale);
  if (numerator < denominator) return sign + '<0.01%';
  return sign + fixed2(roundRatio(numerator, denominator)) + '%';
}

function signedAud(value) {
  const p = parts(value, true);
  if (!p) return '—';
  const sign = p.n === 0n ? '' : p.negative ? '-' : '+';
  const numerator = p.n * 100n, denominator = 10n ** BigInt(p.scale);
  if (p.n !== 0n && numerator < denominator) return sign + '<A$0.01';
  return sign + 'A$' + fixed2(roundRatio(numerator, denominator));
}

function spanLabel(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return [hours && hours + 'h', minutes && minutes + 'm', seconds % 60 && seconds % 60 + 's'].filter(Boolean).join(' ');
}

function timestampLabel(value) {
  return value == null ? 'unavailable' : value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function dated(at, endAt, now, maxAge) {
  const start = time(at), end = time(endAt) ?? start;
  const unavailable = start == null || end == null || end < start || start > now || end > now;
  return { at: unavailable ? null : iso(start), endAt: unavailable ? null : iso(end),
    ageMs: unavailable ? null : now - start, stale: !unavailable && now - start > maxAge, unavailable };
}

function freshness(currentModel, now) {
  const snapshot = currentModel?.snapshot, context = valuationContext(snapshot);
  const valuation = snapshot?.provenance?.valuation || {};
  const verifiedBasis = context.carried || valuation.basis === 'fresh_pinned_balances' && valuation.balances_refreshed === true;
  const balance = dated(verifiedBasis ? context.balanceStart : null, verifiedBasis ? context.balanceEnd : null, now, BALANCE_MAX_AGE);
  balance.carried = context.carried;
  balance.label = balance.unavailable ? 'Balance observation unavailable' :
    `${balance.stale ? 'Stale balances' : context.carried ? 'Carried balances' : 'Balances last observed'} · ${timestampLabel(balance.at)}`;

  // Keep the latest eligible observed quote per asset, matching portfolio grouping.
  // Quote dates are never used as balance observation dates.
  const quotes = new Map();
  for (const row of Array.isArray(currentModel?.balances) ? currentModel.balances : []) {
    if (!row || row.price_status !== 'observed' || row.provenance?.quote?.held_valuation_eligible === false ||
        !positive(row.price_usd) || !hasText(row.price_source) || time(row.price_observed_at) == null) continue;
    const key = `${row.chain_id}:${String(row.asset_id).toLowerCase()}:${row.decimals}`;
    const at = time(row.price_observed_at);
    if (!quotes.has(key) || at > quotes.get(key)) quotes.set(key, at);
  }
  const quoteTimes = [...quotes.values()];
  const quote = dated(quoteTimes.length ? iso(Math.min(...quoteTimes)) : null,
    quoteTimes.length ? iso(Math.max(...quoteTimes)) : null, now, QUOTE_MAX_AGE);
  quote.label = quote.unavailable ? 'Quote time unavailable' : `${quote.stale ? 'Stale quotes' : 'Quotes observed'} · ${timestampLabel(quote.at)}`;
  const fx = dated(positive(snapshot?.usd_to_aud) && hasText(snapshot?.fx_source) ? snapshot.fx_observed_at : null,
    null, now, FX_MAX_AGE);
  fx.source = hasText(snapshot?.fx_source) ? snapshot.fx_source : null;
  fx.label = fx.unavailable ? 'FX time unavailable' : `${fx.stale ? 'Stale FX' : 'FX observed'} · ${timestampLabel(fx.at)}`;
  return { balance, quote, fx, valuationAt: iso(time(context.valuedAt)),
    lastVerifiedAt: balance.at, stale: balance.stale || quote.stale || fx.stale };
}

const REASONS = {
  history_unavailable: '1D change unavailable',
  range_not_1d: '1D comparison required',
  portfolio_summary_required: 'Portfolio comparison unavailable',
  current_snapshot_missing: 'No balance observation',
  current_model_mismatch: 'Current snapshot does not match history',
  current_snapshot_outside_range_or_superseded: 'No current observation in the 1D window',
  current_snapshot_stale: 'Balance observation is stale',
  carried_balances: 'Balances carried forward',
  insufficient_distinct_observations: 'Need two comparable observations in 1D',
  observation_gap: 'Comparable history has a gap',
  undated_observation_gap: 'History includes an undated observation',
  scope_changed: 'Holdings coverage changed',
  invalid_comparison: 'Comparable observations unavailable',
  comparison_outside_1d: 'Comparison is outside the current 1D window',
  unverified_balance_basis: 'Balance observation unverified',
  stale_price: 'Recorded quote was stale',
  stale_fx: 'Recorded FX was stale'
};

function comparison(summary, currentModel, now) {
  if (!summary) return { reason: 'history_unavailable' };
  if (summary.range !== '1D') return { reason: 'range_not_1d' };
  if (summary.coinKey != null || summary.metric !== 'value') return { reason: 'portfolio_summary_required' };
  if (!currentModel?.snapshot?.id) return { reason: 'current_snapshot_missing' };
  if (!summary.changeAvailable || summary.change == null || summary.reason) return { reason: summary.reason || 'invalid_comparison' };
  const points = Array.isArray(summary.points) ? summary.points : [];
  const baseline = points.find(p => p?.at === summary.baselineAt && p.eligible);
  const endpoint = points.find(p => p?.snapshotId === currentModel.snapshot.id);
  if (!endpoint || endpoint.at !== summary.endpointAt) return { reason: 'current_model_mismatch' };
  // A caller must not reuse another account's or an older model's summary just
  // because its snapshot ID/time matches. Revalidate the supplied endpoint.
  const actual = recordedHistorySummary({ currentModel, models: [], rangeKey: '1D', now }).points
    .find(p => p.snapshotId === currentModel.snapshot.id);
  if (!actual?.eligible || actual.scopeKey !== endpoint.scopeKey || actual.value !== endpoint.value || actual.at !== endpoint.at)
    return { reason: 'current_model_mismatch' };
  const start = time(baseline?.at), end = time(endpoint.at);
  if (!baseline || !endpoint.eligible || start == null || end == null || end <= start ||
      !parts(baseline.value) || !parts(endpoint.value) || !hasText(endpoint.scopeKey)) return { reason: 'invalid_comparison' };
  if (start < now - DAY || end > now) return { reason: 'comparison_outside_1d' };
  const span = points.filter(p => time(p?.at) >= start && time(p?.at) <= end);
  if (span.some(p => !p.eligible)) return { reason: 'observation_gap' };
  if (span.some(p => p.scopeKey !== endpoint.scopeKey)) return { reason: 'scope_changed' };
  const context = valuationContext(currentModel.snapshot);
  if (context.carried) return { reason: 'carried_balances' };
  if (time(context.balanceStart) !== end) return { reason: 'current_model_mismatch' };
  const change = signedDecimalDifference(endpoint.value, baseline.value);
  if (change !== summary.change) return { reason: 'invalid_comparison' };
  return { reason: null, change, baseline, endpoint, spanMs: end - start };
}

/**
 * Consume an actual recordedHistorySummary({ rangeKey: '1D', ... }), its currentModel
 * and explicit now (milliseconds, ISO string or Date) for deterministic rendering.
 * Missing/incompatible data remains null. Percent is value change / baseline, NOT a
 * cash-flow-adjusted investment return. lastVerifiedAt always means balance time.
 * quote.at is the oldest of the latest eligible per-asset quotes; quote.endAt is newest.
 * Historical comparisons may remain available with status='stale'; render the status
 * and actual observation span alongside them. No fetching or recalculation of balances.
 */
export function portfolioHeadline({ summary = null, currentModel = null, now } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(nowMs)) throw new TypeError('A valid current time is required');
  const fresh = freshness(currentModel, nowMs), result = comparison(summary, currentModel, nowMs);
  const available = result.reason === null;
  const percent = available ? formatSignedPercent(result.change, result.baseline.value) : null;
  const observedSpan = available ? spanLabel(result.spanMs) : null;
  const freshnessReason = fresh.balance.unavailable ? 'balance_time_unavailable' :
    fresh.quote.unavailable ? 'quote_time_unavailable' : fresh.fx.unavailable ? 'fx_time_unavailable' : null;
  const status = fresh.stale ? 'stale' : available && !freshnessReason ? 'available' : 'unavailable';
  const stateLabel = status === 'stale' ? 'Stale data' : status === 'available' ? 'Recorded change' :
    available ? 'Observation time unavailable' : 'Change unavailable';
  return {
    range: '1D', status, stateLabel, reason: result.reason, freshnessReason,
    reasonLabel: available ? null : REASONS[result.reason] || 'Comparable 1D observations unavailable',
    changeAvailable: available, change: available ? result.change : null,
    changeFormatted: available ? signedAud(result.change) : '—',
    percentAvailable: percent !== null, percentFormatted: percent ?? '—',
    percentReason: available && percent === null ? 'zero_baseline' : available ? null : result.reason,
    direction: !available ? null : parts(result.change, true).n === 0n ? 'flat' : result.change.startsWith('-') ? 'down' : 'up',
    changeLabel: '1D holdings value change',
    rangeLabel: observedSpan ? `1D · ${observedSpan} observed` : '1D · comparison unavailable',
    spanLabel: observedSpan, spanMs: available ? result.spanMs : null,
    baselineAt: available ? result.baseline.at : null, endpointAt: available ? result.endpoint.at : null,
    scopeLabel: !available ? null : result.endpoint.scope?.valuationKind === 'complete_valuation' ? 'Complete observed holdings' : 'Priced holdings subtotal',
    note: 'Includes deposits, withdrawals and market changes; cash flows are not adjusted',
    ...fresh
  };
}
