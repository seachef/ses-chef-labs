import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url);
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

const SUPPORTED_PLATFORMS = Object.freeze({
  ethereum:'ETHEREUM', 'binance-smart-chain':'BNB CHAIN', solana:'SOLANA',
  'arbitrum-one':'ARBITRUM', optimism:'OPTIMISM', 'polygon-pos':'POLYGON',
  avalanche:'AVALANCHE'
});
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
async function discoverCatalog() {
  // Public bulk listing is a bounded screen, not all worldwide markets.
  const markets=[];
  for(let page=1;page<=4;page++) {
    const url=new URL('https://api.coingecko.com/api/v3/coins/markets');
    url.searchParams.set('vs_currency','usd');url.searchParams.set('order','market_cap_desc');
    url.searchParams.set('per_page','250');url.searchParams.set('page',String(page));
    url.searchParams.set('sparkline','false');url.searchParams.set('price_change_percentage','24h');
    const batch=await fetchJson(url);
    if(!Array.isArray(batch))throw Error('Public market page invalid');
    markets.push(...batch);
    if(batch.length<250)break;
    await wait(2300);
  }
  const identities=await fetchJson('https://api.coingecko.com/api/v3/coins/list?include_platform=true');
  if(!Array.isArray(identities))throw Error('Public identity list invalid');
  const byId=new Map(identities.map(row=>[row.id,row]));
  const now=Date.now(),seen=new Set(),catalog=[];
  for(const market of markets) {
    if(!market || typeof market.id!=='string' || seen.has(market.id))continue;
    seen.add(market.id);
    const change=Number(market.price_change_percentage_24h),price=Number(market.current_price);
    const at=new Date(market.last_updated).getTime();
    if(!(price>0) || !Number.isFinite(change) || !(change<=-10 && change>-50) ||
      !Number.isFinite(at) || at>now || now-at>5*60*1000)continue;
    const identity=byId.get(market.id);
    const options=Object.entries(identity?.platforms||{}).filter(([platform,address])=>
      Object.hasOwn(SUPPORTED_PLATFORMS,platform) && typeof address==='string' &&
      (platform==='solana'?/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address):/^0x[a-fA-F0-9]{40}$/.test(address)));
    if(options.length!==1 || !/^[a-z0-9._-]{2,100}$/.test(market.id) ||
       !/^[A-Z0-9._-]{1,20}$/.test(String(market.symbol||'').toUpperCase()))continue;
    const [platform,address]=options[0];
    catalog.push({cg:market.id,symbol:market.symbol.toUpperCase(),
      chain:SUPPORTED_PLATFORMS[platform],addr:address,
      chart:'https://www.coingecko.com/en/coins/'+encodeURIComponent(market.id),market});
  }
  console.log('Screened '+seen.size+' distinct public market rows; '+catalog.length+' met the drop and unambiguous supported-contract prefilter.');
  return catalog;
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

const catalog = await discoverCatalog();
const state = readJson(STATE_FILE, {schema: 1, samples: {}, lastQualified: []});
if (state.schema !== 1 || !state.samples || typeof state.samples !== 'object') throw new Error('Research state schema is invalid');

const ids = [...new Set(catalog.map(row => row.cg))];
const payload = catalog.map(row => row.market);
if(!payload.length) console.log('No identified 10%-to-50% decliners in bounded public screen.');
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
    evidence: {samples: state.samples[coin.cg].slice(-3), rule: '24h drop between 10% and 50%, followed by two non-falling scheduled price moves; further liquidity and selling checks needed'}
  });
}

for (const key of Object.keys(state.samples)) if (!ids.includes(key)) delete state.samples[key];
candidates.sort((a, b) => b.rating - a.rating || b.recoveryStrength - a.recoveryStrength || a.symbol.localeCompare(b.symbol));
const ageChecked=[];
for(const row of candidates.slice(0,12)) {
  try {
    await wait(2300);
    const history=await fetchJson('https://api.coingecko.com/api/v3/coins/'+encodeURIComponent(row.key)+'/market_chart?vs_currency=usd&days=8',1);
    const prices=Array.isArray(history?.prices)?history.prices:[];
    const traded=prices.filter(x=>Array.isArray(x)&&Number.isFinite(x[0])&&Number.isFinite(x[1])&&x[1]>0);
    if(traded.length<2 || traded[0][0]>observedAt-7*24*60*60*1000)continue;
    row.evidence.oldestObservedTradeAt=new Date(traded[0][0]).toISOString();
    ageChecked.push(row);
  } catch(error) { console.warn('Age evidence unavailable for '+row.key+': '+error.message); }
}

const dumpOpps = ageChecked;
const pick = null; // Price-only screen cannot authorise a Trade of the Day.
const previousSnapshot = readJson(SNAPSHOT_FILE, null);
const snapshot = {
  schema: 1, sydneyDate, generatedAt: now.toISOString(), generatedAtSydney: `${sydneyDate} ${sydneyParts.hour}:${sydneyParts.minute}:${sydneyParts.second}`,
  source: 'bounded-public-market-screen', manualOnly: true, signing: false, submitting: false,
  counts: {failed, qualifying: 0, static: staticCount}, coverage: {marketRows: new Set(payload.map(x=>x.id)).size, identifiedDecliners: catalog.length, ageChecked: Math.min(candidates.length,12), preliminary: dumpOpps.length}, pick, dumpOpps,
  previousValidSydneyDate: previousSnapshot?.sydneyDate || null
};

state.updatedAt = now.toISOString();
state.sydneyDate = sydneyDate;
state.lastQualified = dumpOpps.map(row => row.key);
fs.mkdirSync(new URL('data/', ROOT), {recursive: true});
fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Published ${dumpOpps.length} preliminary review cards for ${sydneyDate}; no execution-qualified pick.`);
