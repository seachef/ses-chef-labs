// Navigation catalog only; research qualification is a separate contract.
// No URL, side, amount, holding or eligibility is derived from public quotes.
export const VENUES = Object.freeze([
  Object.freeze({ id: 'okx', name: 'OKX', costs: 'OKX: your pair-specific maker/taker fee is unknown. Check your account fee before trading.' }),
  Object.freeze({ id: 'coinspot', name: 'CoinSpot', costs: 'CoinSpot Markets: 0.1% each side. Instant and conditional stop/target products: 1%. Check the product; these are different costs.' }),
]);
export const DESTINATIONS = Object.freeze([
  { venue: 'okx', pair: 'BTC-AUD', label: 'BTC / AUD', url: 'https://www.okx.com/en-au/trade-spot/btc-aud' },
  { venue: 'okx', pair: 'ETH-AUD', label: 'ETH / AUD', url: 'https://www.okx.com/en-au/trade-spot/eth-aud' },
  { venue: 'okx', pair: 'SOL-AUD', label: 'SOL / AUD', url: 'https://www.okx.com/en-au/trade-spot/sol-aud' },
  { venue: 'okx', pair: 'BTC-USDT', label: 'BTC / USDT', url: 'https://www.okx.com/en-au/trade-spot/btc-usdt' },
  { venue: 'okx', pair: 'ETH-USDT', label: 'ETH / USDT', url: 'https://www.okx.com/en-au/trade-spot/eth-usdt' },
  { venue: 'okx', pair: 'SOL-USDT', label: 'SOL / USDT', url: 'https://www.okx.com/en-au/trade-spot/sol-usdt' },
  { venue: 'coinspot', pair: 'BTC-AUD', label: 'BTC / AUD', url: 'https://www.coinspot.com.au/trade/BTC' },
  { venue: 'coinspot', pair: 'ETH-AUD', label: 'ETH / AUD', url: 'https://www.coinspot.com.au/trade/ETH' },
  { venue: 'coinspot', pair: 'SOL-AUD', label: 'SOL / AUD', url: 'https://www.coinspot.com.au/trade/SOL' },
  { venue: 'coinspot', pair: 'USDT-AUD', label: 'USDT / AUD', url: 'https://www.coinspot.com.au/trade/USDT' },
].map(Object.freeze));

export function destinationFor(venue, pair) {
  return DESTINATIONS.find(d => d.venue === venue && d.pair === pair) ?? null;
}
export function approvedDestination(venue, pair, url) {
  const destination = destinationFor(venue, pair);
  return typeof url === 'string' && !!destination && url === destination.url;
}
