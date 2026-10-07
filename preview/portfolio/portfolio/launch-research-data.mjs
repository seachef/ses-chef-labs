// Public research only. Syntax checks cannot establish that a source is official
// or that its prose supports a claim; the researcher must verify both.
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Cs}<>`]|\[[^\]]*\]\s*\(|\*\*|__|^#{1,6}\s/u;
const ASSURANCE = /\b(?:guaranteed?|assured|certain)\s+(?:(?:investment|financial|positive|high)\s+)?(?:returns?|profits?|gains?|safety)\b|\b(?:risk[ -]?free|zero[ -]risk|100%\s+safe)\b|\b(?:cannot|can't|will not)\s+lose\s+money\b|\b(?:returns?|profits?|gains?)\s+(?:are\s+)?guaranteed\b/i;

function fail(path, message) { throw new Error(`Launch research ${path}: ${message}`); }

function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'must be a plain object');
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !keys.includes(key))) fail(path, 'contains an unknown property');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail(`${path}.${key}`, 'is required as a JSON value');
  }
}

function list(value, min, max, path) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must contain ${min}–${max} items`);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(path, 'must be a dense JSON array');
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail(path, 'must be a dense JSON array');
}

function text(value, max, path) {
  if (typeof value !== 'string' || !value.length || value.length > max || value.trim() !== value || UNSAFE_TEXT.test(value)) {
    fail(path, `must be trimmed plain text of 1–${max} characters, without markup or control characters`);
  }
  if (ASSURANCE.test(value)) fail(path, 'must not claim assured investment safety or returns');
}

function identifier(value, path) {
  text(value, 64, path);
  if (!ID.test(value)) fail(path, 'must be a lowercase hyphenated identifier');
}

function choice(value, allowed, path) {
  if (!allowed.includes(value)) fail(path, `must be one of: ${allowed.join(', ')}`);
}

function nowValue(now) {
  if (typeof now !== 'number' || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) fail('now', 'must be a finite timestamp in milliseconds');
  return now;
}

function timestamp(value, now, path, upper = Infinity) {
  if (typeof value !== 'string' || !UTC.test(value)) fail(path, 'must be a UTC ISO timestamp ending in Z');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(path, 'must be a real UTC date and time');
  if (millis > now + FUTURE_TOLERANCE_MS) fail(path, 'must not be more than five minutes in the future');
  if (millis > upper) fail(path, 'must not be later than the report checked_at');
  return millis;
}

function privateIPv4(host) {
  const [a, b, c] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113);
}

function publicHost(host) {
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    const parts = host.slice(1, -1).split(':');
    const first = parseInt(parts[0] || '0', 16), second = parseInt(parts[1] || '0', 16);
    // Global-unicast only: excludes local, loopback, IPv4-mapped and NAT64 forms.
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002
      && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !privateIPv4(host);
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan)$/.test(host)) return false;
  return host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function https(value, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.length || value.length > 2048
    || !/^https:\/\//i.test(value) || /[\s\\<>\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail(path, 'must be a public HTTPS URL of at most 2048 characters');
  let url;
  try { url = new URL(value); } catch { fail(path, 'must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || value.slice(value.indexOf('//') + 2).split(/[/?#]/, 1)[0].includes('@')) fail(path, 'must use HTTPS without credentials');
  if (!publicHost(url.hostname)) fail(path, 'must use a public host, without localhost or private/reserved IP addresses');
}

function date(value, path) {
  if (value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(path, 'must be a real YYYY-MM-DD date or null');
}

export function validateLaunchResearch(raw, { now = Date.now() } = {}) {
  nowValue(now);
  object(raw, ['schema_version', 'checked_at', 'candidates'], 'root');
  if (raw.schema_version !== 1) fail('schema_version', 'must equal 1');
  const checked = timestamp(raw.checked_at, now, 'checked_at');
  list(raw.candidates, 0, 3, 'candidates');
  const ids = new Set();
  for (const [index, candidate] of raw.candidates.entries()) {
    const path = `candidates[${index}]`;
    object(candidate, ['id', 'name', 'symbol', 'status', 'summary', 'risks', 'official_url', 'launch', 'venues', 'sources', 'australia_eligibility'], path);
    identifier(candidate.id, `${path}.id`);
    if (ids.has(candidate.id)) fail(`${path}.id`, 'must be unique');
    ids.add(candidate.id);
    text(candidate.name, 100, `${path}.name`);
    text(candidate.symbol, 20, `${path}.symbol`);
    if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(candidate.symbol)) fail(`${path}.symbol`, 'must be an uppercase ticker using A-Z, 0-9, dot, underscore or hyphen');
    choice(candidate.status, ['prelaunch', 'closed', 'watch', 'available'], `${path}.status`);
    text(candidate.summary, 600, `${path}.summary`);
    list(candidate.risks, 1, 3, `${path}.risks`);
    candidate.risks.forEach((risk, i) => text(risk, 240, `${path}.risks[${i}]`));
    https(candidate.official_url, `${path}.official_url`);
    choice(candidate.australia_eligibility, ['unverified'], `${path}.australia_eligibility`);
    list(candidate.sources, 1, 6, `${path}.sources`);
    const citations = new Set();
    candidate.sources.forEach((source, i) => {
      const sourcePath = `${path}.sources[${i}]`;
      object(source, ['label', 'url', 'checked_at'], sourcePath);
      text(source.label, 120, `${sourcePath}.label`);
      https(source.url, `${sourcePath}.url`);
      timestamp(source.checked_at, now, `${sourcePath}.checked_at`, checked);
      if (citations.has(source.url)) fail(`${sourcePath}.url`, 'must not duplicate a source citation');
      citations.add(source.url);
    });
    object(candidate.launch, ['date', 'time_utc', 'source_url'], `${path}.launch`);
    date(candidate.launch.date, `${path}.launch.date`);
    if (candidate.launch.time_utc !== null && (typeof candidate.launch.time_utc !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(candidate.launch.time_utc))) fail(`${path}.launch.time_utc`, 'must be HH:mm:ss UTC or null');
    https(candidate.launch.source_url, `${path}.launch.source_url`, true);
    if (candidate.launch.date !== null && candidate.launch.source_url === null) fail(`${path}.launch.source_url`, 'is required for a known launch date');
    if (candidate.launch.time_utc !== null && candidate.launch.date === null) fail(`${path}.launch.time_utc`, 'requires a launch date');
    if (candidate.launch.source_url !== null && !citations.has(candidate.launch.source_url)) fail(`${path}.launch.source_url`, 'must match a source citation exactly');
    list(candidate.venues, 0, 3, `${path}.venues`);
    candidate.venues.forEach((venue, i) => {
      const venuePath = `${path}.venues[${i}]`;
      object(venue, ['name', 'status', 'url', 'source_url', 'checked_at'], venuePath);
      text(venue.name, 80, `${venuePath}.name`);
      choice(venue.status, ['unconfirmed', 'announced', 'available', 'closed'], `${venuePath}.status`);
      https(venue.url, `${venuePath}.url`, true);
      https(venue.source_url, `${venuePath}.source_url`, true);
      timestamp(venue.checked_at, now, `${venuePath}.checked_at`, checked);
      if (venue.status === 'unconfirmed' && venue.url !== null) fail(`${venuePath}.url`, 'must be null for an unconfirmed venue');
      if (venue.status !== 'unconfirmed' && (venue.url === null || venue.source_url === null)) fail(venuePath, 'a confirmed venue requires its official URL and source URL');
      if (venue.source_url !== null && !citations.has(venue.source_url)) fail(`${venuePath}.source_url`, 'must match a source citation exactly');
    });
    if (candidate.status === 'available' && !candidate.venues.some(venue => venue.status === 'available')) fail(`${path}.status`, 'available requires an available venue');
  }
  return raw;
}

export function researchFreshness(data, now = Date.now()) {
  validateLaunchResearch(data, { now });
  const observations = [Date.parse(data.checked_at)];
  for (const candidate of data.candidates) {
    observations.push(...candidate.sources.map(source => Date.parse(source.checked_at)));
    observations.push(...candidate.venues.map(venue => Date.parse(venue.checked_at)));
  }
  return now - Math.min(...observations) > STALE_AFTER_MS ? 'stale' : 'current';
}

// Hash this UTF-8 string with SHA-256 after validating the candidate's report.
// Observation times alone do not make a meaningful public candidate revision.
export function candidateFingerprintInput(candidate) {
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value)
      .filter(key => key !== 'checked_at').sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  return JSON.stringify(canonical(candidate));
}

export function validateLaunchLedger(raw, { now = Date.now() } = {}) {
  nowValue(now);
  object(raw, ['schema_version', 'entries'], 'ledger');
  if (raw.schema_version !== 1) fail('ledger.schema_version', 'must equal 1');
  list(raw.entries, 0, 1000, 'ledger.entries');
  const revisions = new Set();
  let previousChecked = -Infinity;
  raw.entries.forEach((entry, i) => {
    const path = `ledger.entries[${i}]`;
    object(entry, ['candidate_id', 'checked_at', 'event', 'fingerprint', 'note'], path);
    identifier(entry.candidate_id, `${path}.candidate_id`);
    const checked = timestamp(entry.checked_at, now, `${path}.checked_at`);
    if (checked < previousChecked) fail(`${path}.checked_at`, 'ledger entries must be chronological');
    previousChecked = checked;
    choice(entry.event, ['added', 'updated', 'closed', 'removed'], `${path}.event`);
    if (typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) fail(`${path}.fingerprint`, 'must be a lowercase SHA-256 hex digest');
    text(entry.note, 600, `${path}.note`);
    const key = `${entry.candidate_id}:${checked}`;
    if (revisions.has(key)) fail(path, 'must not duplicate or conflict with a candidate revision at the same time');
    revisions.add(key);
  });
  return raw;
}
