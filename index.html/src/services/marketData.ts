// Real-time price and liquidity data service
// Using public APIs (CoinGecko, Binance, DexScreener)

export type MarketData = {
  symbol: string;
  price: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  lastUpdated: number;
};

export type DexPair = {
  chainId: string;
  pairAddress: string;
  baseToken: string;
  quoteToken: string;
  priceNative: string;
  priceUsd: string;
  liquidity: { usd: number };
  volume24h: number;
  txns24h: { buys: number; sells: number };
};

// CoinGecko API (free, no key required)
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Binance API (free, no key required)
const BINANCE_BASE = 'https://api.binance.com/api/v3';

// DexScreener API (free, no key required)
const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';

// Map symbols to CoinGecko IDs
const COIN_IDS: Record<string, string> = {
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
  'BAND': 'band-protocol',
  'REN': 'republic-protocol',
  'KNC': 'kyber-network-crystal',
  'BNT': 'bancor',
  'OMG': 'omisego',
  'ZRX': '0x',
  'DODO': 'dodo',
  '1INCH': '1inch',
  'GRT': 'the-graph',
  'LRC': 'loopring',
  'CVC': 'civic',
  'STORJ': 'storj',
  'FIL': 'filecoin',
  'AR': 'arweave',
  'OCEAN': 'ocean-protocol',
  'NMR': 'numeraire',
  'FET': 'fetch-ai',
  'AGIX': 'singularitynet',
  'OXT': 'orchid-protocol',
  'NU': 'nucypher',
};

// Fetch prices from CoinGecko
export async function fetchPricesFromCoinGecko(): Promise<Map<string, MarketData>> {
  const prices = new Map<string, MarketData>();
  
  try {
    const ids = Object.values(COIN_IDS).join(',');
    const response = await fetch(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h`
    );
    
    if (!response.ok) throw new Error('CoinGecko API error');
    
    const data = await response.json();
    
    data.forEach((coin: any) => {
      const symbol = Object.keys(COIN_IDS).find(key => COIN_IDS[key] === coin.id);
      if (symbol) {
        prices.set(symbol, {
          symbol,
          price: coin.current_price,
          priceChange1h: coin.price_change_percentage_1h_in_currency || 0,
          priceChange24h: coin.price_change_percentage_24h || 0,
          volume24h: coin.total_volume,
          liquidity: coin.total_volume * 0.1, // Estimate liquidity as 10% of volume
          marketCap: coin.market_cap,
          lastUpdated: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error('Error fetching from CoinGecko:', error);
  }
  
  return prices;
}

// Fetch prices from Binance
export async function fetchPricesFromBinance(): Promise<Map<string, MarketData>> {
  const prices = new Map<string, MarketData>();
  
  try {
    const response = await fetch(`${BINANCE_BASE}/ticker/24hr`);
    if (!response.ok) throw new Error('Binance API error');
    
    const data = await response.json();
    
    data.forEach((ticker: any) => {
      const symbol = ticker.symbol.replace('USDT', '');
      if (symbol in COIN_IDS) {
        prices.set(symbol, {
          symbol,
          price: parseFloat(ticker.lastPrice),
          priceChange1h: 0, // Binance doesn't provide 1h change
          priceChange24h: parseFloat(ticker.priceChangePercent),
          volume24h: parseFloat(ticker.quoteVolume),
          liquidity: parseFloat(ticker.quoteVolume) * 0.1,
          marketCap: 0,
          lastUpdated: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error('Error fetching from Binance:', error);
  }
  
  return prices;
}

// Fetch DEX pairs from DexScreener
export async function fetchDexPairs(symbol: string): Promise<DexPair[]> {
  try {
    const response = await fetch(`${DEXSCREENER_BASE}/tokens/${symbol}`);
    if (!response.ok) throw new Error('DexScreener API error');
    
    const data = await response.json();
    return data.pairs || [];
  } catch (error) {
    console.error(`Error fetching DEX pairs for ${symbol}:`, error);
    return [];
  }
}

// Get highest liquidity pair for a token
export async function getHighestLiquidityPair(symbol: string): Promise<DexPair | null> {
  const pairs = await fetchDexPairs(symbol);
  if (pairs.length === 0) return null;
  
  // Sort by liquidity and return highest
  return pairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd)[0];
}

// Fetch all market data (combines multiple sources)
export async function fetchAllMarketData(): Promise<Map<string, MarketData>> {
  const [coinGeckoData, binanceData] = await Promise.all([
    fetchPricesFromCoinGecko(),
    fetchPricesFromBinance(),
  ]);
  
  // Merge data, preferring CoinGecko (has more complete info)
  const merged = new Map<string, MarketData>();
  
  coinGeckoData.forEach((data, symbol) => {
    merged.set(symbol, data);
  });
  
  // Add any symbols only in Binance
  binanceData.forEach((data, symbol) => {
    if (!merged.has(symbol)) {
      merged.set(symbol, data);
    }
  });
  
  return merged;
}

// Calculate liquidity score (0-100)
export function calculateLiquidityScore(liquidity: number, volume: number): number {
  // Normalize liquidity (assuming max ~$1B)
  const liquidityScore = Math.min(liquidity / 1e9, 1) * 60;
  // Normalize volume (assuming max ~$5B)
  const volumeScore = Math.min(volume / 5e9, 1) * 40;
  return liquidityScore + volumeScore;
}

// Get trading recommendation based on liquidity
export function getLiquidityRecommendation(liquidity: number): {
  level: 'excellent' | 'good' | 'moderate' | 'low';
  color: string;
  message: string;
} {
  if (liquidity > 100_000_000) {
    return {
      level: 'excellent',
      color: 'text-emerald-400',
      message: 'Excellent liquidity - minimal slippage expected',
    };
  } else if (liquidity > 10_000_000) {
    return {
      level: 'good',
      color: 'text-green-400',
      message: 'Good liquidity - low slippage expected',
    };
  } else if (liquidity > 1_000_000) {
    return {
      level: 'moderate',
      color: 'text-amber-400',
      message: 'Moderate liquidity - some slippage possible',
    };
  } else {
    return {
      level: 'low',
      color: 'text-rose-400',
      message: 'Low liquidity - high slippage risk',
    };
  }
}
