import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const INDEX = new URL('index.html', ROOT);
const STATE_FILE = new URL('data/research-state.json', ROOT);
const SNAPSHOT_FILE = new URL('daily-snapshot.json', ROOT);
const FORCE = process.argv.includes('--force');
const now = new Date();
const sydneyParts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
const sydneyHour = Number(sydneyParts.hour);
const sydneyDate = `${sydneyParts.year}-${sydneyParts.month}-${sydneyParts.day}`;

if (!FORCE && (sydneyHour < 0 || sydneyHour >= 6)) {
  console.log(`Outside Sydney research window (${sydneyHour}:00); no research performed.`);
  process.exit(0);
}

function readJson(url, fallback) {
  try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; }
}

function coinCatalog() {
  const source = fs.readFileSync(INDEX, 'utf8');
  const match = source.match(/const dumpCoins = (\[[\s\S]*?\n\s*\]);\n\n\s*const checkerCoins/);
  if (!match) throw new Error('Verified coin catalog was not found in index.html');
  const rows = vm.runInNewContext(`(${match[1]})`, Object.create(null), {timeout: 1000});
  if (!Array.isArray(rows) || rows.length < 10) throw new Error('Verified coin catalog is invalid');
  return rows.filter(row => row && /^[A-Z0-9._-]{1,20}$/.test(row.symbol) && typeof row.cg === 'string');
}

async function fetchJson(url, attempts = 3) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, {headers: {Accept: 'application/json', 'User-Agent': 'Sea-Chef-Labs-Overnight-Research/1.0'}, signal: controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    } finally { clearTimeout(timer); }
  }
  throw last;
}

function threeSamples(samples) {
  const clean = samples.filter(sample => Number.isFinite(sample.price) && sample.price > 0 && Number.isFinite(sample.at)).slice(-3);
  if (clean.length !== 3) return null;
  if (clean[1].at - clean[0].at < 20 * 60 * 1000 || clean[2].at - clean[1].at < 20 * 60 * 1000) return null;
  return clean;
}

function sampleState(samples) {
  const three = threeSamples(samples);
  if (!three) return 'checking';
  const [a, b, c] = three;
  if (c.price > b.price && b.price >= a.price) return 'recovering';
  if (c.price < b.price && b.price <= a.price) return 'falling';
  return 'static';
}

function recoveryStrength(samples) {
  const three = threeSamples(samples);
  if (!three) return 0;
  return ((three[2].price / three[0].price) - 1) * 100;
}

const catalog = coinCatalog();
const state = readJson(STATE_FILE, {schema: 1, samples: {}, lastQualified: []});
if (state.schema !== 1 || !state.samples || typeof state.samples !== 'object') throw new Error('Research state schema is invalid');

const ids = [...new Set(catalog.map(row => row.cg))];
const endpoint = new URL('https://api.coingecko.com/api/v3/coins/markets');
endpoint.searchParams.set('vs_currency', 'usd');
endpoint.searchParams.set('ids', ids.join(','));
endpoint.searchParams.set('order', 'market_cap_desc');
endpoint.searchParams.set('per_page', '250');
endpoint.searchParams.set('sparkline', 'false');
endpoint.searchParams.set('price_change_percentage', '24h');
endpoint.searchParams.set('precision', 'full');

const payload = await fetchJson(endpoint);
if (!Array.isArray(payload) || !payload.length) throw new Error('Market feed returned no rows; previous published snapshot retained');
const byId = new Map(payload.map(row => [row.id, row]));
const observedAt = Date.now();
const candidates = [];
let failed = 0, staticCount = 0;

for (const coin of catalog) {
  const market = byId.get(coin.cg);
  const price = Number(market?.current_price);
  const change = Number(market?.price_change_percentage_24h);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) continue;
  const previous = Array.isArray(state.samples[coin.cg]) ? state.samples[coin.cg] : [];
  const samples = previous.filter(sample => observedAt - Number(sample.at) <= 8 * 60 * 60 * 1000);
  const last = samples.at(-1);
  if (!last || observedAt - last.at >= 20 * 60 * 1000) samples.push({at: observedAt, price, change});
  state.samples[coin.cg] = samples.slice(-12);
  if (change > -10 || change <= -50) continue;
  const direction = sampleState(state.samples[coin.cg]);
  if (direction === 'falling') { failed++; continue; }
  if (direction !== 'recovering') { staticCount++; continue; }
  const strength = recoveryStrength(state.samples[coin.cg]);
  candidates.push({
    kind: 'named', key: coin.cg, symbol: coin.symbol, chain: String(coin.chain || 'market').toUpperCase(),
    contract: String(coin.addr || ''), venue: 'Manual market route only', price, change,
    state: 'recovering', rating: Math.round(Math.min(100, Math.max(0, -change * 4) + Math.min(20, strength * 5) + 10)),
    recoveryStrength: Number(strength.toFixed(4)), chart: coin.chart || `https://www.coingecko.com/en/coins/${encodeURIComponent(coin.cg)}`,
    evidence: {samples: state.samples[coin.cg].slice(-3), rule: '24h drop between 10% and 50%, followed by two non-falling scheduled price moves'}
  });
}

for (const key of Object.keys(state.samples)) if (!ids.includes(key)) delete state.samples[key];
candidates.sort((a, b) => b.rating - a.rating || b.recoveryStrength - a.recoveryStrength || a.symbol.localeCompare(b.symbol));
const dumpOpps = candidates.slice(0, 12);
const pick = dumpOpps[0] || null;
const previousSnapshot = readJson(SNAPSHOT_FILE, null);
const snapshot = {
  schema: 1, sydneyDate, generatedAt: now.toISOString(), generatedAtSydney: `${sydneyDate} ${sydneyParts.hour}:${sydneyParts.minute}:${sydneyParts.second}`,
  source: 'scheduled-public-market-research', manualOnly: true, signing: false, submitting: false,
  counts: {failed, qualifying: dumpOpps.length, static: staticCount}, pick, dumpOpps,
  previousValidSydneyDate: previousSnapshot?.sydneyDate || null
};

state.updatedAt = now.toISOString();
state.sydneyDate = sydneyDate;
state.lastQualified = dumpOpps.map(row => row.key);
fs.mkdirSync(new URL('data/', ROOT), {recursive: true});
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Published ${dumpOpps.length} qualifying opportunities for ${sydneyDate}; pick: ${pick?.symbol || 'none'}.`);
