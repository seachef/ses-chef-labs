// Public research only. A review state is an invitation to inspect the evidence,
// never an order, recommendation to buy, or assurance of investment safety.
export const ENTRY_SETUP_ASSETS = Object.freeze(['RENDER', 'POL', 'TAO', 'APT', 'AKT']);
// Technical freshness limits, not entry strategy or market predictions.
export const ENTRY_SETUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ENTRY_QUOTE_MAX_AGE_MS = 15 * 60 * 1000;
export const ENTRY_SETUP_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}<>`]|\[[^\]]*\]\s*\(|\*\*|__|^#{1,6}\s/u;
const SETUP_KEYS = ['asset', 'venue', 'pair', 'quote_currency', 'entry_min', 'entry_max', 'stop', 'targets', 'checked_at', 'expires_at', 'review_status', 'source_security_checked', 'source_urls', 'quote'];
const QUOTE_KEYS = ['venue', 'pair', 'quote_currency', 'price', 'observed_at', 'source_url'];

function fail(path, message) { throw new Error(`Entry setups ${path}: ${message}`); }

function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'must be a plain object');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) fail(path, 'contains an unknown property');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(`${path}.${key}`, 'is required as a JSON value');
  }
}

function list(value, min, max, path) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must contain ${min}–${max} items`);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(path, 'must be a dense JSON array');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(path, 'must be a dense JSON array');
  }
}

function choice(value, choices, path) {
  if (!choices.includes(value)) fail(path, `must be one of: ${choices.join(', ')}`);
}

function venue(value, path) {
  if (typeof value !== 'string' || !value.length || value.length > 80
    || value.trim() !== value || UNSAFE_TEXT.test(value)) fail(path, 'must be trimmed plain text of 1–80 characters without markup or control characters');
}

function nowValue(now) {
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) fail('now', 'must be a finite timestamp in milliseconds');
}

function timestamp(value, now, path, { deadline = false } = {}) {
  if (typeof value !== 'string' || value.trim() !== value || !UTC.test(value)) fail(path, 'must be a UTC ISO timestamp ending in Z');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(path, 'must be a real UTC date and time');
  if (!deadline && millis > now + ENTRY_SETUP_FUTURE_TOLERANCE_MS) fail(path, 'must not be more than five minutes in the future');
  return millis;
}

function positiveDecimal(value, path) {
  if (typeof value !== 'string' || value.length > 64 || value.trim() !== value || !DECIMAL.test(value)) fail(path, 'must be a decimal string of at most 64 characters without signs, exponents or leading zeroes');
  if (!/[1-9]/.test(value)) fail(path, 'must be a positive price');
}

// Compare fixed-point integers without rounding prices through Number.
function compareDecimal(left, right) {
  const [li, lf = ''] = left.split('.'), [ri, rf = ''] = right.split('.');
  const places = Math.max(lf.length, rf.length);
  const a = BigInt(li + lf.padEnd(places, '0')), b = BigInt(ri + rf.padEnd(places, '0'));
  return a < b ? -1 : a > b ? 1 : 0;
}

function publicHttps(value, path) {
  if (typeof value !== 'string' || !value.length || value.length > 2048
    || !/^https:\/\//i.test(value) || /[\s\\<>\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail(path, 'must be a public HTTPS URL of at most 2048 characters');
  let url;
  try { url = new URL(value); } catch { fail(path, 'must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password
    || value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0].includes('@')) fail(path, 'must use HTTPS without credentials');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)
    || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|test|invalid|example|home|lan|corp|onion)$/.test(host)
    || host.endsWith('.home.arpa') || host.length > 253
    || !host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) fail(path, 'must use a public DNS host without IP addresses or local hosts');
  for (const key of url.searchParams.keys()) {
    if (/^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|credential|key|password|passwd|secret|token)$/i.test(key)) fail(path, 'must not contain credential query parameters');
  }
}

function validateSetup(setup, now, path) {
  object(setup, SETUP_KEYS, path);
  choice(setup.asset, ENTRY_SETUP_ASSETS, `${path}.asset`);
  venue(setup.venue, `${path}.venue`);
  choice(setup.quote_currency, ['USD', 'USDT', 'USDC'], `${path}.quote_currency`);
  if (typeof setup.pair !== 'string' || setup.pair.trim() !== setup.pair || !new RegExp(`^${setup.asset}[/_-]?${setup.quote_currency}$`).test(setup.pair)) fail(`${path}.pair`, 'must be the exact asset and quote currency with an optional single /, - or _ separator');
  for (const field of ['entry_min', 'entry_max', 'stop']) positiveDecimal(setup[field], `${path}.${field}`);
  if (compareDecimal(setup.stop, setup.entry_min) >= 0) fail(`${path}.stop`, 'must be strictly below entry_min');
  if (compareDecimal(setup.entry_min, setup.entry_max) > 0) fail(`${path}.entry_max`, 'must be at least entry_min');
  list(setup.targets, 1, 3, `${path}.targets`);
  let previous = setup.entry_max;
  setup.targets.forEach((target, index) => {
    positiveDecimal(target, `${path}.targets[${index}]`);
    if (compareDecimal(previous, target) >= 0) fail(`${path}.targets[${index}]`, 'must be strictly above entry_max and all preceding targets');
    previous = target;
  });
  const checked = timestamp(setup.checked_at, now, `${path}.checked_at`);
  const expires = timestamp(setup.expires_at, now, `${path}.expires_at`, { deadline: true });
  if (expires <= checked || expires - checked > ENTRY_SETUP_MAX_AGE_MS) fail(`${path}.expires_at`, 'must be after checked_at and at most 24 hours later');
  choice(setup.review_status, ['pending', 'reviewed'], `${path}.review_status`);
  if (typeof setup.source_security_checked !== 'boolean') fail(`${path}.source_security_checked`, 'must be a boolean');
  list(setup.source_urls, 1, 5, `${path}.source_urls`);
  const sources = new Set();
  setup.source_urls.forEach((source, index) => {
    publicHttps(source, `${path}.source_urls[${index}]`);
    if (sources.has(source)) fail(`${path}.source_urls[${index}]`, 'must not duplicate a source citation');
    sources.add(source);
  });
  object(setup.quote, QUOTE_KEYS, `${path}.quote`);
  for (const field of ['venue', 'pair', 'quote_currency']) {
    if (setup.quote[field] !== setup[field]) fail(`${path}.quote.${field}`, 'must exactly match the setup market identity');
  }
  positiveDecimal(setup.quote.price, `${path}.quote.price`);
  const observed = timestamp(setup.quote.observed_at, now, `${path}.quote.observed_at`);
  publicHttps(setup.quote.source_url, `${path}.quote.source_url`);
  if (!sources.has(setup.quote.source_url)) fail(`${path}.quote.source_url`, 'must exactly match a source citation');
  return { checked, expires, observed };
}

/** Return the original public feed, without mutation, or throw a path-specific error. */
export function validateEntrySetups(raw, { now = Date.now() } = {}) {
  nowValue(now);
  object(raw, ['schema_version', 'checked_at', 'setups'], 'root');
  if (raw.schema_version !== 1) fail('schema_version', 'must equal 1');
  list(raw.setups, 0, 5, 'setups');
  const checked = raw.checked_at === null ? null : timestamp(raw.checked_at, now, 'checked_at');
  if (checked === null && raw.setups.length) fail('checked_at', 'may be null only for an empty initial feed');
  const assets = new Set();
  raw.setups.forEach((setup, index) => {
    const path = `setups[${index}]`;
    const times = validateSetup(setup, now, path);
    if (assets.has(setup.asset)) fail(`${path}.asset`, 'must be unique');
    assets.add(setup.asset);
    if (times.checked > checked || times.observed > checked) fail('checked_at', 'must cover every setup checked_at and quote observed_at');
  });
  return raw;
}

/** Validate one setup and derive only review/watch. Invalid data throws; it never qualifies. */
export function evaluateEntrySetup(setup, now = Date.now()) {
  nowValue(now);
  const { checked, expires, observed } = validateSetup(setup, now, 'setup');
  if (setup.review_status !== 'reviewed') return { status: 'watch', reason: 'review_pending' };
  if (!setup.source_security_checked) return { status: 'watch', reason: 'sources_unchecked' };
  if (checked > now || observed > now) return { status: 'watch', reason: 'awaiting_observation' };
  if (now >= expires) return { status: 'watch', reason: 'expired' };
  if (now - checked > ENTRY_SETUP_MAX_AGE_MS) return { status: 'watch', reason: 'research_stale' };
  if (now - observed > ENTRY_QUOTE_MAX_AGE_MS) return { status: 'watch', reason: 'quote_stale' };
  if (compareDecimal(setup.quote.price, setup.stop) <= 0) return { status: 'watch', reason: 'quote_at_or_below_stop' };
  if (compareDecimal(setup.quote.price, setup.entry_min) < 0 || compareDecimal(setup.quote.price, setup.entry_max) > 0) return { status: 'watch', reason: 'outside_entry_range' };
  return { status: 'review', reason: 'review_ready' };
}
