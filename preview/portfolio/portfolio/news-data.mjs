// Public research and historical market observations only. Validation cannot
// establish source ownership or that prose is supported by the cited evidence.
export const ENTRY_WATCH_ASSETS = Object.freeze(['RENDER', 'POL', 'TAO', 'APT', 'AKT']);
export const NEWS_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}<>`]|\[[^\]]*\]\s*\(|\*\*|__|^#{1,6}\s/u;
const ASSURANCE = /\b(?:guaranteed?|assured|certain)\s+(?:(?:investment|financial|positive|high)\s+)?(?:returns?|profits?|gains?|safety)\b|\b(?:risk[ -]?free|zero[ -]risk|100%\s+safe)\b|\b(?:cannot|can't|will not)\s+lose\s+money\b|\b(?:returns?|profits?|gains?)\s+(?:are\s+)?guaranteed\b/i;
const RECORD_KEYS = ['id', 'asset', 'status', 'venue', 'pair', 'quote_currency', 'interval', 'candle_open_at', 'candle_close_at', 'low', 'close', 'volume', 'observed_at', 'source_url', 'assessment', 'compared_with', 'supersedes', 'note'];

function fail(path, message) { throw new Error(`News desk ${path}: ${message}`); }

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

function text(value, max, path) {
  if (typeof value !== 'string' || !value.length || value.length > max || value.trim() !== value || UNSAFE_TEXT.test(value)) {
    fail(path, `must be trimmed plain text of 1–${max} characters, without markup or control characters`);
  }
  if (ASSURANCE.test(value)) fail(path, 'must not claim assured investment safety or returns');
}

function identifier(value, path) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) fail(path, 'must be a lowercase hyphenated identifier of 1–64 characters');
}

function choice(value, choices, path) {
  if (!choices.includes(value)) fail(path, `must be one of: ${choices.join(', ')}`);
}

function nowValue(now) {
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) fail('now', 'must be a finite timestamp in milliseconds');
}

function timestamp(value, now, path) {
  if (typeof value !== 'string' || !UTC.test(value)) fail(path, 'must be a UTC ISO timestamp ending in Z');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(path, 'must be a real UTC date and time');
  if (millis > now + FUTURE_TOLERANCE_MS) fail(path, 'must not be more than five minutes in the future');
  return millis;
}

function date(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(path, 'must be a real YYYY-MM-DD date');
}

function https(value, path) {
  if (typeof value !== 'string' || !value.length || value.length > 2048
    || !/^https:\/\//i.test(value) || /[\s\\<>\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail(path, 'must be a public HTTPS URL of at most 2048 characters');
  let url;
  try { url = new URL(value); } catch { fail(path, 'must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0].includes('@')) fail(path, 'must use HTTPS without credentials');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host)
    || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|test|invalid|example|home|lan|corp|onion)$/.test(host)
    || host.endsWith('.home.arpa')
    || !host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) fail(path, 'must use a public DNS host, without IP addresses or local hosts');
  for (const key of url.searchParams.keys()) {
    if (/^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|credential|key|password|passwd|secret|token)$/i.test(key)) fail(path, 'must not contain credential query parameters');
  }
}

function decimal(value, path, positive = false) {
  if (typeof value !== 'string' || value.length > 64 || !DECIMAL.test(value)) fail(path, 'must be a nonnegative decimal string of at most 64 characters, without signs, exponents or leading zeroes');
  if (positive && !/[1-9]/.test(value)) fail(path, 'must be a positive price');
}

// Fixed-point comparison preserves distinctions below Number precision.
function compareDecimal(left, right) {
  const [li, lf = ''] = left.split('.'), [ri, rf = ''] = right.split('.');
  const places = Math.max(lf.length, rf.length);
  const a = BigInt(li + lf.padEnd(places, '0')), b = BigInt(ri + rf.padEnd(places, '0'));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function validateNewsDesk(raw, { now = Date.now() } = {}) {
  nowValue(now);
  object(raw, ['schema_version', 'checked_at', 'items'], 'root');
  if (raw.schema_version !== 1) fail('schema_version', 'must equal 1');
  list(raw.items, 0, 5, 'items');
  const checked = raw.checked_at === null ? null : timestamp(raw.checked_at, now, 'checked_at');
  if (checked === null && raw.items.length) fail('checked_at', 'may be null only for an empty initial feed');
  const ids = new Set();
  raw.items.forEach((item, index) => {
    const path = `items[${index}]`;
    object(item, ['id', 'coins', 'headline', 'what_happened', 'why_it_matters', 'risk', 'source'], path);
    identifier(item.id, `${path}.id`);
    if (ids.has(item.id)) fail(`${path}.id`, 'must be unique');
    ids.add(item.id);
    list(item.coins, 1, 5, `${path}.coins`);
    if (new Set(item.coins).size !== item.coins.length) fail(`${path}.coins`, 'must contain unique tickers');
    item.coins.forEach((coin, i) => {
      if (typeof coin !== 'string' || !/^[A-Z0-9]{2,12}$/.test(coin)) fail(`${path}.coins[${i}]`, 'must be an uppercase ticker of 2–12 alphanumeric characters');
    });
    text(item.headline, 140, `${path}.headline`);
    for (const field of ['what_happened', 'why_it_matters', 'risk']) text(item[field], 360, `${path}.${field}`);
    const sourcePath = `${path}.source`;
    object(item.source, ['name', 'url', 'published_at', 'published_date', 'retrieved_at'], sourcePath);
    text(item.source.name, 100, `${sourcePath}.name`);
    https(item.source.url, `${sourcePath}.url`);
    date(item.source.published_date, `${sourcePath}.published_date`);
    const retrieved = timestamp(item.source.retrieved_at, now, `${sourcePath}.retrieved_at`);
    if (retrieved > checked) fail(`${sourcePath}.retrieved_at`, 'must not be later than checked_at');
    if (item.source.published_date > item.source.retrieved_at.slice(0, 10)) fail(`${sourcePath}.published_date`, 'must not be after the retrieval date');
    if (item.source.published_at !== null) {
      const published = timestamp(item.source.published_at, now, `${sourcePath}.published_at`);
      if (published > retrieved) fail(`${sourcePath}.published_at`, 'must not be later than retrieved_at');
      if (item.source.published_at.slice(0, 10) !== item.source.published_date) fail(`${sourcePath}.published_date`, 'must match the UTC date in published_at');
    }
  });
  return raw;
}

export function newsFreshness(data, now = Date.now()) {
  validateNewsDesk(data, { now });
  if (data.checked_at === null) return { status: 'never', checkedAt: null, ageMs: null };
  const oldestCheck = Math.min(Date.parse(data.checked_at), ...data.items.map(item => Date.parse(item.source.retrieved_at)));
  const ageMs = Math.max(0, now - oldestCheck);
  return { status: ageMs > NEWS_STALE_AFTER_MS ? 'stale' : 'fresh', checkedAt: data.checked_at, ageMs };
}

const seriesKey = record => JSON.stringify([record.asset, record.venue, record.pair, record.quote_currency, record.interval]);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function validateEntryWatch(raw, { now = Date.now(), previous } = {}) {
  nowValue(now);
  object(raw, ['schema_version', 'assets', 'records'], 'watch');
  if (raw.schema_version !== 1) fail('watch.schema_version', 'must equal 1');
  list(raw.assets, 5, 5, 'watch.assets');
  if (raw.assets.some((asset, i) => asset !== ENTRY_WATCH_ASSETS[i])) fail('watch.assets', `must equal ${ENTRY_WATCH_ASSETS.join(', ')} in that order`);
  list(raw.records, 0, 5000, 'watch.records');
  const ids = new Set(), series = new Map();
  let priorObserved = -Infinity;
  raw.records.forEach((record, index) => {
    const path = `watch.records[${index}]`;
    object(record, RECORD_KEYS, path);
    identifier(record.id, `${path}.id`);
    if (ids.has(record.id)) fail(`${path}.id`, 'must be unique');
    ids.add(record.id);
    choice(record.asset, ENTRY_WATCH_ASSETS, `${path}.asset`);
    choice(record.status, ['observed', 'unavailable'], `${path}.status`);
    text(record.venue, 80, `${path}.venue`);
    text(record.pair, 40, `${path}.pair`);
    if (!/^[A-Z0-9]+(?:[/.:_-][A-Z0-9]+)*$/.test(record.pair)) fail(`${path}.pair`, 'must be an uppercase venue instrument identifier');
    choice(record.quote_currency, ['USD', 'USDT', 'USDC'], `${path}.quote_currency`);
    choice(record.interval, ['1d'], `${path}.interval`);
    const observed = timestamp(record.observed_at, now, `${path}.observed_at`);
    if (observed < priorObserved) fail(`${path}.observed_at`, 'records must be chronological by observation time');
    priorObserved = observed;
    text(record.note, 600, `${path}.note`);
    if (record.source_url !== null) https(record.source_url, `${path}.source_url`);
    if (record.status === 'unavailable') {
      for (const field of ['candle_open_at', 'candle_close_at', 'low', 'close', 'volume', 'compared_with', 'supersedes']) {
        if (record[field] !== null) fail(`${path}.${field}`, 'must be null when status is unavailable');
      }
      choice(record.assessment, ['unknown'], `${path}.assessment`);
      return;
    }
    if (record.source_url === null) fail(`${path}.source_url`, 'is required for an observed candle');
    const open = timestamp(record.candle_open_at, now, `${path}.candle_open_at`);
    const close = timestamp(record.candle_close_at, now, `${path}.candle_close_at`);
    if (close - open !== DAY_MS || open % DAY_MS !== 0) fail(path, 'must describe one complete UTC day using an exclusive next-day close');
    if (close > observed) fail(`${path}.candle_close_at`, 'must not be later than observed_at; only completed candles are allowed');
    if (close > now) fail(`${path}.candle_close_at`, 'must be complete at validation time, even within observation clock tolerance');
    decimal(record.low, `${path}.low`, true);
    decimal(record.close, `${path}.close`, true);
    decimal(record.volume, `${path}.volume`);
    if (compareDecimal(record.low, record.close) > 0) fail(`${path}.low`, 'must not exceed close');
    choice(record.assessment, ['baseline', 'lower_low', 'not_lower_low'], `${path}.assessment`);
    for (const field of ['compared_with', 'supersedes']) if (record[field] !== null) identifier(record[field], `${path}.${field}`);
    const key = seriesKey(record), candles = series.get(key) ?? new Map();
    const sameCandle = candles.get(open);
    if (sameCandle) {
      if (record.supersedes !== sameCandle.id) fail(`${path}.supersedes`, 'must reference the latest revision of the same candle and market series');
    } else {
      if (record.supersedes !== null) fail(`${path}.supersedes`, 'requires an earlier record of the same candle and market series');
      if ([...candles.keys()].some(time => time > open)) fail(`${path}.candle_open_at`, 'new candles must be appended in candle order within a market series');
    }
    let comparison = null, comparisonTime = -Infinity;
    for (const [time, candidate] of candles) if (time < open && time > comparisonTime) { comparison = candidate; comparisonTime = time; }
    if (!comparison) {
      if (record.assessment !== 'baseline' || record.compared_with !== null) fail(path, 'the first candle in a market series must be baseline with compared_with null');
    } else {
      if (record.compared_with !== comparison.id) fail(`${path}.compared_with`, 'must reference the latest effective preceding candle in the same market series');
      const expected = compareDecimal(record.low, comparison.low) < 0 ? 'lower_low' : 'not_lower_low';
      if (record.assessment !== expected) fail(`${path}.assessment`, `must equal ${expected} from an exact decimal low comparison`);
    }
    candles.set(open, record);
    series.set(key, candles);
  });
  if (previous !== undefined) {
    validateEntryWatch(previous, { now });
    if (raw.records.length < previous.records.length) fail('watch.records', 'must preserve the immutable previous ledger prefix');
    previous.records.forEach((record, i) => {
      if (JSON.stringify(canonical(record)) !== JSON.stringify(canonical(raw.records[i]))) fail(`watch.records[${i}]`, 'must preserve the immutable previous ledger prefix');
    });
  }
  return raw;
}
