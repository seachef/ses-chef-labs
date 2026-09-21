// Real-time price data from CoinGecko API (FREE - no API key needed)
// Docs: https://docs.coingecko.com/reference/introduction

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Map our symbols to CoinGecko IDs
export const COIN_IDS: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'BNB': 'binancecoin',
  'XRP': 'ripple',
  'ADA': 'cardano',
  'AVAX': 'avalanche-2',
  'DOT': 'polkadot',
  'POL': 'polygon-ecosystem-token',
  'LTC': 'litecoin',
  'HYPE': 'hyperliquid',
  'LINK': 'chainlink',
  'SUI': 'sui',
  'ONDO': 'ondo-finance',
  'AAVE': 'aave',
  'INJ': 'injective-protocol',
  'PENDLE': 'pendle',
  'TAO': 'bittensor',
  'NEAR': 'near',
  'OP': 'optimism',
  'ARB': 'arbitrum',
  'RUNE': 'thorchain',
  'PEPE': 'pepe',
  'WIF': 'dogwifcoin',
  'BONK': 'bonk',
  'FLOKI': 'floki',
  'SHIB': 'shiba-inu',
  'DOGE': 'dogecoin',
  'UNI': 'uniswap',
  'SUSHI': 'sushi',
  'CRV': 'curve-dao-token',
  'COMP': 'compound-governance-token',
  'MKR': 'maker',
  'SNX': 'havven',
  'YFI': 'yearn-finance',
  'BAL': 'balancer',
  'GRT': 'the-graph',
  'FIL': 'filecoin',
  'AR': 'arweave',
  'FET': 'artificial-superintelligence-alliance',
  'RENDER': 'render-token',
  'AKT': 'akash-network',
  'OM': 'mantra-dao',
  'MON': 'monad',
  'BERA': 'berachain-bera',
  'METH': 'megaeth',
  'VIRTUAL': 'virtual-protocol',
  'AI16Z': 'ai16z',
  'GRIFFAIN': 'griFFAIN',
  'IO': 'io-net',
  'HNT': 'helium',
  'POLYX': 'polymesh',
};

export type LivePrice = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  marketCap: number;
  lastUpdated: number;
};

// Fetch prices for multiple coins at once (up to 250 per call)
export async function fetchLivePrices(symbols: string[]): Promise<Map<string, LivePrice>> {
  const prices = new Map<string, LivePrice>();
  
  try {
    // Get CoinGecko IDs for our symbols
    const ids = symbols
      .map(s => COIN_IDS[s])
      .filter(id => id)
      .join(',');
    
    if (!ids) return prices;
    
    // Fetch market data (includes price, 24h change, volume, market cap)
    const response = await fetch(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h`,
      {
        headers: {
          'Accept': 'application/json',
        }
      }
    );
    
    if (!response.ok) {
      console.error('CoinGecko API error:', response.status);
      return prices;
    }
    
    const data = await response.json();
    
    // Map back to our symbols
    data.forEach((coin: any) => {
      const symbol = Object.keys(COIN_IDS).find(key => COIN_IDS[key] === coin.id);
      if (symbol) {
        prices.set(symbol, {
          symbol,
          price: coin.current_price,
          change24h: coin.price_change_percentage_24h || 0,
          volume24h: coin.total_volume,
          marketCap: coin.market_cap,
          lastUpdated: Date.now(),
        });
      }
    });
    
    console.log(`✅ Fetched ${prices.size} live prices from CoinGecko`);
  } catch (error) {
    console.error('Error fetching live prices:', error);
  }
  
  return prices;
}

// Fetch AUD exchange rate
export async function fetchAUDRate(): Promise<number> {
  try {
    const response = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=usd-coin&vs_currencies=aud`
    );
    const data = await response.json();
    return data['usd-coin']?.aud || 1.529; // Fallback to static rate
  } catch {
    return 1.529; // Fallback
  }
}

// Check if API is available
export async function checkAPIStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${COINGECKO_BASE}/ping`);
    return response.ok;
  } catch {
    return false;
  }
}
