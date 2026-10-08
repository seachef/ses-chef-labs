import { readCycleReference, CYCLE_QUOTE_AGE } from './entry-cycle.mjs?v=20261008.lows2';
import { decimal, decimalText, compare, multiply, subtract, percentageChange } from './exact-decimal.mjs';

// No active candidates passed the deeper liquidity-and-quality review.
// Removed 2Z and OPEN on 8 October 2026; retain dated research below only.
export const LOW_WATCH_ASSETS = Object.freeze([]);
export const LOW_WATCH_RESEARCH = Object.freeze({
  OPEN: Object.freeze({
    name: 'OpenLedger', checkedAt: '2026-10-08', flag: 'Unlock risk',
    activity: 'OpenLedger lists OctoClaw as live and provides a public mainnet explorer. Product usage and token demand still need scrutiny.',
    risk: 'Team and investor tokens vest monthly after a 12-month cliff: the project lists about 9.24m OPEN per month, plus community releases. Supply pressure can drive fresh lows; no entry setup is approved.',
    sources: Object.freeze([
      { label: 'Project', url: 'https://www.openledger.xyz/' },
      { label: 'Network', url: 'https://scan.openledger.xyz/' },
      { label: 'Unlock schedule', url: 'https://docs.openledgerfoundation.com/open-tokenomics/open-token-unlock-schedule' },
    ]),
  }),
  '2Z': Object.freeze({
    name: 'DoubleZero', checkedAt: '2026-10-08', flag: 'Unlock risk',
    activity: 'DoubleZero announced a live Phoenix market-data feed on Edge on 29 Sep 2026.',
    risk: 'The published schedule raises circulating supply from about 3.47bn in September to 5.11bn in October, with further releases afterwards. Supply pressure can drive fresh lows; no entry setup is approved.',
    sources: Object.freeze([
      { label: 'Project update', url: 'https://www.prnewswire.com/news-releases/doublezero-adds-phoenix-perpetual-futures-to-multi-venue-market-data-platform-edge-302892440.html' },
      { label: 'Supply schedule', url: 'https://static.upbit.com/guide/circulating_supply/2Z_20251002.pdf' },
    ]),
  }),
});

export function watchMarketSources(asset) {
  if (!Object.hasOwn(LOW_WATCH_RESEARCH, asset)) throw Error('Unsupported low-watch coin');
  return ['ticker/24hr', 'exchangeInfo'].map(path => 'https://data-api.binance.vision/api/v3/' + path + '?symbol=' + asset + 'USDT');
}

/** Require a fresh spot quote, daily turnover >= 1m USDT and spread <= 1%. */
export function applyWatchMarket(quote, ticker, info, now = Date.now()) {
  const asset = quote?.asset, pair = asset + 'USDT';
  if (!Object.hasOwn(LOW_WATCH_RESEARCH, asset) || ticker?.symbol !== pair || !Number.isSafeInteger(ticker.closeTime) || ticker.closeTime > now || now - ticker.closeTime >= CYCLE_QUOTE_AGE) throw Error('Current spot quote unavailable');
  const listing = info?.symbols?.find(row => row.symbol === pair);
  if (listing?.status !== 'TRADING' || listing.isSpotTradingAllowed !== true || listing.baseAsset !== asset || listing.quoteAsset !== 'USDT') throw Error('Spot market unavailable');
  const value = field => decimal(ticker[field], { positive: true });
  const current = value('lastPrice'), volume = value('quoteVolume'), bid = value('bidPrice'), ask = value('askPrice');
  if (compare(volume, decimal('1000000')) < 0 || compare(ask, bid) < 0 || compare(subtract(ask, bid), multiply(bid, decimal('0.01'))) > 0) throw Error('Trading liquidity does not qualify');
  const low = decimal(quote.low, { positive: true }), above = compare(current, low);
  if (above < 0) throw Error('Cycle low needs a new check');
  const percent = percentageChange(current, low, 1).value;
  return { ...quote, current: decimalText(current), percent, percentLabel: above === 0 ? 'At low' : percent === '0' ? '+<0.1%' : percent + '%',
    retrievedAt: Math.min(quote.retrievedAt, ticker.closeTime), quoteVolume: decimalText(volume),
    sources: [...quote.sources, ...watchMarketSources(asset)] };
}

export async function readLowWatch(asset, { fetchImpl = globalThis.fetch, signal, now = Date.now } = {}) {
  const urls = watchMarketSources(asset);
  const [quote, ...market] = await Promise.all([
    readCycleReference(asset, { fetchImpl, signal, now }),
    ...urls.map(async url => {
      const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', signal });
      if (!response.ok || response.redirected || (response.url && response.url !== url) || Number(response.headers?.get('content-length') || 0) > 65536) throw Error('Spot market unavailable');
      const text = await response.text();
      if (text.length > 65536) throw Error('Spot response too large');
      return JSON.parse(text);
    }),
  ]);
  if (signal?.aborted) throw Error('Price request cancelled');
  return applyWatchMarket(quote, market[0], market[1], now());
}
