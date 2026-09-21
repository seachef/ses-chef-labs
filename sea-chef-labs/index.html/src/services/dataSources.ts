// ─── Complete Exchange & DEX Registry ───
// All data sources for live price & liquidity research

export type DataSourceType = 'dex' | 'cex' | 'aggregator';
export type ChainName = string;

export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  chains: ChainName[];
  icon: string;
  color: string;
  apiEndpoint?: string;
  status: 'live' | 'connecting' | 'offline';
  latency: number; // ms
  pairs: number;
}

export const DEXES: DataSource[] = [
  { id: 'hyperliquid', name: 'Hyperliquid', type: 'dex', chains: ['Hyperliquid L1'], icon: '🔥', color: '#5B5FFF', apiEndpoint: 'https://api.hyperliquid.xyz', status: 'live', latency: 12, pairs: 89 },
  { id: 'dydx', name: 'dYdX', type: 'dex', chains: ['dYdX Chain', 'Ethereum'], icon: '📐', color: '#6966FF', apiEndpoint: 'https://api.dydx.exchange', status: 'live', latency: 18, pairs: 67 },
  { id: 'gmx', name: 'GMX', type: 'dex', chains: ['Arbitrum', 'Avalanche'], icon: '🎯', color: '#3B82F6', apiEndpoint: 'https://arbitrum-api.gmxinfra.io', status: 'live', latency: 22, pairs: 45 },
  { id: 'drift', name: 'Drift', type: 'dex', chains: ['Solana'], icon: '🌊', color: '#14F195', apiEndpoint: 'https://api.drift.trade', status: 'live', latency: 8, pairs: 52 },
  { id: 'jupiter', name: 'Jupiter', type: 'aggregator', chains: ['Solana'], icon: '🪐', color: '#7B61FF', apiEndpoint: 'https://quote-api.jup.ag', status: 'live', latency: 15, pairs: 1200 },
  { id: 'sushiswap', name: 'SushiSwap', type: 'dex', chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Base', 'Avalanche', 'BSC'], icon: '🍣', color: '#FA52A0', apiEndpoint: 'https://api.sushi.com', status: 'live', latency: 25, pairs: 340 },
  { id: 'camelot', name: 'Camelot', type: 'dex', chains: ['Arbitrum'], icon: '🐪', color: '#00C896', apiEndpoint: 'https://api.camelot.exchange', status: 'live', latency: 14, pairs: 180 },
  { id: 'traderjoe', name: 'Trader Joe', type: 'dex', chains: ['Avalanche', 'Arbitrum', 'BSC'], icon: '🥜', color: '#FF6B35', apiEndpoint: 'https://api.traderjoexyz.com', status: 'live', latency: 19, pairs: 210 },
  { id: 'velodrome', name: 'Velodrome', type: 'dex', chains: ['Optimism', 'Base'], icon: '🌀', color: '#FFC107', apiEndpoint: 'https://api.velodrome.finance', status: 'live', latency: 16, pairs: 156 },
  { id: 'pulsex', name: 'PulseX', type: 'dex', chains: ['PulseChain'], icon: '💚', color: '#00FF87', apiEndpoint: 'https://api.pulsex.com', status: 'live', latency: 28, pairs: 95 },
  { id: 'thorswap', name: 'THORSwap', type: 'aggregator', chains: ['Cross-chain', 'Thorchain'], icon: '⚡', color: '#33FF88', apiEndpoint: 'https://api.thorswap.net', status: 'live', latency: 35, pairs: 45 },
  { id: 'uniswap', name: 'Uniswap', type: 'dex', chains: ['Ethereum', 'Base', 'Arbitrum', 'Polygon', 'Optimism', 'BNB Chain'], icon: '🦄', color: '#FF007A', apiEndpoint: 'https://api.uniswap.org', status: 'live', latency: 20, pairs: 2500 },
  { id: 'pancakeswap', name: 'PancakeSwap', type: 'dex', chains: ['BNB Chain', 'Ethereum', 'Arbitrum', 'Base', 'Polygon', 'zkSync', 'Linea', 'Aptos'], icon: '🥞', color: '#D1884F', apiEndpoint: 'https://api.pancakeswap.com', status: 'live', latency: 22, pairs: 1800 },
  { id: 'raydium', name: 'Raydium', type: 'dex', chains: ['Solana'], icon: '💎', color: '#8B5CF6', apiEndpoint: 'https://api.raydium.io', status: 'live', latency: 10, pairs: 890 },
  { id: 'orca', name: 'Orca', type: 'dex', chains: ['Solana'], icon: '🐋', color: '#FFD700', apiEndpoint: 'https://api.orca.so', status: 'live', latency: 11, pairs: 420 },
  { id: 'aerodrome', name: 'Aerodrome', type: 'dex', chains: ['Base'], icon: '✈️', color: '#0052FF', apiEndpoint: 'https://api.aerodrome.finance', status: 'live', latency: 13, pairs: 280 },
  { id: 'curve', name: 'Curve', type: 'dex', chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Avalanche', 'Optimism', 'Base', 'Gnosis'], icon: '📈', color: '#FF6B6B', apiEndpoint: 'https://api.curve.fi', status: 'live', latency: 17, pairs: 180 },
  { id: 'balancer', name: 'Balancer', type: 'dex', chains: ['Ethereum', 'Polygon', 'Arbitrum', 'Base', 'Avalanche'], icon: '⚖️', color: '#1E1E1E', apiEndpoint: 'https://api.balancer.fi', status: 'live', latency: 21, pairs: 320 },
  { id: 'lfj', name: 'LFJ (LFG)', type: 'dex', chains: ['Avalanche', 'Arbitrum', 'Ethereum', 'BNB Chain', 'Polygon'], icon: '🚀', color: '#FF4444', apiEndpoint: 'https://api.lfj.io', status: 'live', latency: 19, pairs: 165 },
  // NEW 2026 DEXes
  { id: 'uniswap_v4', name: 'Uniswap V4', type: 'dex', chains: ['Ethereum', 'Base', 'Arbitrum', 'Unichain', 'Polygon', 'Optimism', 'BNB Chain'], icon: '🦄', color: '#FF007A', apiEndpoint: 'https://api.uniswap.org/v4', status: 'live', latency: 18, pairs: 3200 },
  { id: 'uniswapx', name: 'UniswapX', type: 'aggregator', chains: ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'Unichain'], icon: '🔮', color: '#FF007A', apiEndpoint: 'https://api.uniswap.org/v2', status: 'live', latency: 22, pairs: 2500 },
  { id: 'cowswap', name: 'CoW Swap', type: 'aggregator', chains: ['Ethereum', 'Arbitrum', 'Base', 'Polygon'], icon: '🐄', color: '#007AFF', apiEndpoint: 'https://api.cow.fi', status: 'live', latency: 24, pairs: 1800 },
  { id: 'hashflow', name: 'Hashflow', type: 'dex', chains: ['Ethereum', 'Arbitrum', 'Polygon', 'BNB Chain', 'Avalanche', 'Solana'], icon: '#️⃣', color: '#00D395', apiEndpoint: 'https://api.hashflow.com', status: 'live', latency: 16, pairs: 450 },
  { id: 'lifi', name: 'LI.FI', type: 'aggregator', chains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Base', 'BNB Chain', 'Avalanche', 'Solana'], icon: '🔄', color: '#1399FF', apiEndpoint: 'https://li.quest', status: 'live', latency: 20, pairs: 5000 },
  { id: 'aerodrome_v2', name: 'Aerodrome V2', type: 'dex', chains: ['Base'], icon: '✈️', color: '#0052FF', apiEndpoint: 'https://api.aerodrome.finance/v2', status: 'live', latency: 11, pairs: 520 },
  { id: 'hyperliquid_perp', name: 'Hyperliquid Perps', type: 'dex', chains: ['Hyperliquid L1'], icon: '🔥', color: '#5B5FFF', apiEndpoint: 'https://api.hyperliquid.xyz/info', status: 'live', latency: 8, pairs: 89 },
  { id: 'dydx_v4', name: 'dYdX v4', type: 'dex', chains: ['dYdX Chain', 'Ethereum', 'Cosmos'], icon: '📐', color: '#6966FF', apiEndpoint: 'https://api.dydx.exchange/v4', status: 'live', latency: 15, pairs: 72 },
];

export const CEX_AUSTRALIA: DataSource[] = [
  { id: 'coinspot', name: 'CoinSpot', type: 'cex', chains: ['Australia'], icon: '🟠', color: '#3263E0', apiEndpoint: 'https://api.coinspot.com.au', status: 'live', latency: 45, pairs: 420 },
  { id: 'swyftx', name: 'Swyftx', type: 'cex', chains: ['Australia'], icon: '🔵', color: '#0066FF', apiEndpoint: 'https://api.swyftx.com.au', status: 'live', latency: 42, pairs: 340 },
  { id: 'independent_reserve', name: 'Independent Reserve', type: 'cex', chains: ['Australia', 'NZ'], icon: '🟢', color: '#00B894', apiEndpoint: 'https://api.independentreserve.com', status: 'live', latency: 55, pairs: 55 },
  { id: 'btc_markets', name: 'BTC Markets', type: 'cex', chains: ['Australia'], icon: '🟡', color: '#F1C40F', apiEndpoint: 'https://api.btcmarkets.net', status: 'live', latency: 48, pairs: 85 },
  { id: 'coinjar', name: 'Coinjar', type: 'cex', chains: ['Australia', 'UK'], icon: '🟣', color: '#6C5CE7', apiEndpoint: 'https://api.coinjar.com', status: 'live', latency: 52, pairs: 120 },
  { id: 'kraken_au', name: 'Kraken Australia', type: 'cex', chains: ['Australia'], icon: '🐙', color: '#5741D9', apiEndpoint: 'https://api.kraken.com', status: 'live', latency: 38, pairs: 280 },
  { id: 'binance_au', name: 'Binance Australia', type: 'cex', chains: ['Australia'], icon: '🟨', color: '#F0B90B', apiEndpoint: 'https://api.binance.com.au', status: 'live', latency: 32, pairs: 350 },
  { id: 'digital_surplus', name: 'Digital Surge', type: 'cex', chains: ['Australia'], icon: '🔷', color: '#2196F3', apiEndpoint: 'https://api.digitalsurge.com.au', status: 'live', latency: 58, pairs: 65 },
];

export const CEX_GLOBAL: DataSource[] = [
  { id: 'crypto_com', name: 'Crypto.com', type: 'cex', chains: ['Cronos', 'Multi'], icon: '🔷', color: '#002D74', apiEndpoint: 'https://api.crypto.com', status: 'live', latency: 28, pairs: 350 },
  { id: 'binance', name: 'Binance', type: 'cex', chains: ['BNB Chain', 'Multi'], icon: '🟨', color: '#F0B90B', apiEndpoint: 'https://api.binance.com', status: 'live', latency: 15, pairs: 1600 },
  { id: 'coinbase', name: 'Coinbase', type: 'cex', chains: ['Base', 'Ethereum'], icon: '🔵', color: '#0052FF', apiEndpoint: 'https://api.coinbase.com', status: 'live', latency: 25, pairs: 280 },
  { id: 'kraken', name: 'Kraken', type: 'cex', chains: ['Multi'], icon: '🐙', color: '#5741D9', apiEndpoint: 'https://api.kraken.com', status: 'live', latency: 30, pairs: 320 },
  { id: 'okx', name: 'OKX', type: 'cex', chains: ['OKX Chain', 'Multi'], icon: '⬛', color: '#FFFFFF', apiEndpoint: 'https://www.okx.com', status: 'live', latency: 22, pairs: 680 },
  { id: 'bybit', name: 'Bybit', type: 'cex', chains: ['Multi'], icon: '🟧', color: '#F7A600', apiEndpoint: 'https://api.bybit.com', status: 'live', latency: 20, pairs: 580 },
  { id: 'kucoin', name: 'KuCoin', type: 'cex', chains: ['Multi'], icon: '🟩', color: '#24AE8F', apiEndpoint: 'https://api.kucoin.com', status: 'live', latency: 28, pairs: 780 },
  { id: 'gate_io', name: 'Gate.io', type: 'cex', chains: ['Multi'], icon: '🟪', color: '#2354E6', apiEndpoint: 'https://api.gateio.ws', status: 'live', latency: 32, pairs: 1700 },
  { id: 'mexc', name: 'MEXC', type: 'cex', chains: ['Multi'], icon: '🔷', color: '#00B897', apiEndpoint: 'https://api.mexc.com', status: 'live', latency: 35, pairs: 1500 },
  { id: 'bitget', name: 'Bitget', type: 'cex', chains: ['Multi'], icon: '🟦', color: '#00B5FB', apiEndpoint: 'https://api.bitget.com', status: 'live', latency: 26, pairs: 650 },
  { id: 'gemini', name: 'Gemini', type: 'cex', chains: ['Ethereum'], icon: '♊', color: '#00A1E0', apiEndpoint: 'https://api.gemini.com', status: 'live', latency: 40, pairs: 120 },
  { id: 'bitfinex', name: 'Bitfinex', type: 'cex', chains: ['Multi'], icon: '🟢', color: '#16B157', apiEndpoint: 'https://api.bitfinex.com', status: 'live', latency: 38, pairs: 220 },
  { id: 'bthumb', name: 'Bthumb', type: 'cex', chains: ['Multi'], icon: '👍', color: '#FF6B35', apiEndpoint: 'https://api.bthumb.com', status: 'connecting', latency: 0, pairs: 45 },
  { id: 'htx', name: 'HTX', type: 'cex', chains: ['Multi'], icon: '🔶', color: '#2B6AF5', apiEndpoint: 'https://api.htx.com', status: 'live', latency: 33, pairs: 620 },
  { id: 'bullish', name: 'Bullish', type: 'cex', chains: ['EOS'], icon: '🐂', color: '#0052FF', apiEndpoint: 'https://api.bullish.com', status: 'live', latency: 42, pairs: 85 },
];

export const CHAINS = [
  { name: 'Ethereum', color: '#627EEA', icon: '⟠' },
  { name: 'Solana', color: '#14F195', icon: '◎' },
  { name: 'Arbitrum', color: '#28A0F0', icon: '🔵' },
  { name: 'Base', color: '#0052FF', icon: '🔷' },
  { name: 'Polygon', color: '#8247E5', icon: '🟣' },
  { name: 'BNB Chain', color: '#F0B90B', icon: '🟨' },
  { name: 'Avalanche', color: '#E84142', icon: '🔺' },
  { name: 'Optimism', color: '#FF0420', icon: '🔴' },
  { name: 'Hyperliquid L1', color: '#5B5FFF', icon: '🔥' },
  { name: 'Monad', color: '#522FFF', icon: '⚡' }, // NEW 2026 - $494M raise
  { name: 'MegaETH', color: '#FF0080', icon: '⚡' }, // NEW 2026 - 100k TPS
  { name: 'Berachain', color: '#8B4513', icon: '🐻' }, // NEW 2026 - Proof of Liquidity
  { name: 'Eclipse', color: '#6F3FF5', icon: '🌑' }, // NEW 2026 - SVM on ETH
  { name: 'Unichain', color: '#FF007A', icon: '🦄' }, // NEW 2026 - Uniswap L2
  { name: 'PulseChain', color: '#00FF87', icon: '💚' },
  { name: 'dYdX Chain', color: '#6966FF', icon: '📐' },
  { name: 'Thorchain', color: '#33FF88', icon: '⚡' },
  { name: 'Cronos', color: '#002D74', icon: '🔷' },
  { name: 'zkSync', color: '#8C8DFC', icon: '🔮' },
  { name: 'Linea', color: '#61DFFF', icon: '💠' },
  { name: 'Aptos', color: '#2DD8A3', icon: '🅰️' },
  { name: 'Gnosis', color: '#04795B', icon: '🟩' },
  { name: 'EOS', color: '#000000', icon: '🐂' },
  { name: 'Blast', color: '#FCFC03', icon: '💛' },
  { name: 'Scroll', color: '#FFDBB0', icon: '📜' },
  { name: 'Mode', color: '#DFFE00', icon: '🎮' },
];

// Telegram Trading Bots (2026)
export const TELEGRAM_BOTS: DataSource[] = [
  { id: 'banana_gun', name: 'Banana Gun', type: 'aggregator', chains: ['Ethereum', 'Solana', 'Base', 'Blast', 'BNB Chain'], icon: '🍌', color: '#FFD700', apiEndpoint: 'https://t.me/bananagunbot', status: 'live', latency: 5, pairs: 800 },
  { id: 'maestro', name: 'Maestro', type: 'aggregator', chains: ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'BNB Chain', 'Polygon'], icon: '🎵', color: '#FF6B35', apiEndpoint: 'https://t.me/maestro', status: 'live', latency: 7, pairs: 1200 },
  { id: 'unibot', name: 'Unibot', type: 'aggregator', chains: ['Ethereum', 'Arbitrum', 'Base', 'Polygon', 'BNB Chain'], icon: '🤖', color: '#00D4FF', apiEndpoint: 'https://t.me/unibot', status: 'live', latency: 8, pairs: 600 },
  { id: 'bonkbot', name: 'BonkBot', type: 'aggregator', chains: ['Solana'], icon: '🔨', color: '#FF6B35', apiEndpoint: 'https://t.me/bonkbot', status: 'live', latency: 4, pairs: 350 },
  { id: 'trojan', name: 'Trojan', type: 'aggregator', chains: ['Solana'], icon: '🐴', color: '#8B4513', apiEndpoint: 'https://t.me/solana_trojanbot', status: 'live', latency: 5, pairs: 280 },
  { id: 'openliquid', name: 'OpenLiquid', type: 'aggregator', chains: ['Ethereum', 'Solana', 'Base', 'Arbitrum'], icon: '💧', color: '#00BFFF', apiEndpoint: 'https://t.me/openliquid', status: 'live', latency: 6, pairs: 450 },
];

// AI Agent Platforms (2026)
export const AI_AGENTS: DataSource[] = [
  { id: 'gemini_agent', name: 'Gemini Agentic', type: 'aggregator', chains: ['Multi'], icon: '✨', color: '#4285F4', apiEndpoint: 'https://gemini.com', status: 'live', latency: 30, pairs: 250 },
  { id: 'binance_agents', name: 'Binance AI Agents', type: 'aggregator', chains: ['Multi'], icon: '🟨', color: '#F0B90B', apiEndpoint: 'https://binance.com', status: 'live', latency: 25, pairs: 1600 },
  { id: 'okx_agent', name: 'OKX Agent Kit', type: 'aggregator', chains: ['Multi'], icon: '⬛', color: '#FFFFFF', apiEndpoint: 'https://okx.com', status: 'live', latency: 28, pairs: 680 },
  { id: 'millionpool', name: 'MillionPool AI', type: 'aggregator', chains: ['Multi'], icon: '🏊', color: '#00D4FF', apiEndpoint: 'https://millionpool.ai', status: 'live', latency: 35, pairs: 500 },
  { id: 'cryptohopper', name: 'Cryptohopper', type: 'aggregator', chains: ['Multi'], icon: '🦘', color: '#00B894', apiEndpoint: 'https://cryptohopper.com', status: 'live', latency: 20, pairs: 150 },
  { id: '3commas', name: '3Commas', type: 'aggregator', chains: ['Multi'], icon: '📊', color: '#6C5CE7', apiEndpoint: 'https://3commas.io', status: 'live', latency: 22, pairs: 200 },
];

// MEV Protection Services
export const MEV_PROTECTION: DataSource[] = [
  { id: 'flashbots', name: 'Flashbots Protect', type: 'aggregator', chains: ['Ethereum'], icon: '🛡️', color: '#FF4444', apiEndpoint: 'https://rpc.flashbots.net', status: 'live', latency: 3, pairs: 0 },
  { id: 'mev_blocker', name: 'MEV Blocker', type: 'aggregator', chains: ['Ethereum'], icon: '🚫', color: '#00D4FF', apiEndpoint: 'https://rpc.mevblocker.io', status: 'live', latency: 4, pairs: 0 },
  { id: 'cow_protocol', name: 'CoW Protocol', type: 'aggregator', chains: ['Ethereum', 'Arbitrum', 'Base'], icon: '🐄', color: '#007AFF', apiEndpoint: 'https://api.cow.fi', status: 'live', latency: 12, pairs: 1800 },
];

export const ALL_SOURCES: DataSource[] = [...DEXES, ...CEX_AUSTRALIA, ...CEX_GLOBAL, ...TELEGRAM_BOTS, ...AI_AGENTS, ...MEV_PROTECTION];

// Get best venue for a given symbol based on liquidity
export function getBestVenue(symbol: string, sources: DataSource[]): DataSource[] {
  // In production, this would query each source's API for the symbol's liquidity
  // For now, we rank by known liquidity depth per venue
  const venueScores: Record<string, number> = {
    'binance': 98, 'coinbase': 92, 'kraken': 88, 'okx': 86,
    'bybit': 84, 'kucoin': 80, 'gate_io': 78, 'mexc': 76,
    'uniswap': 90, 'pancakeswap': 85, 'jupiter': 82, 'sushiswap': 70,
    'hyperliquid': 75, 'dydx': 73, 'gmx': 71, 'drift': 69,
    'curve': 88, 'balancer': 74, 'raydium': 72, 'orca': 68,
    'camelot': 65, 'traderjoe': 63, 'velodrome': 61, 'aerodrome': 59,
    'lfj': 57, 'thorswap': 55, 'pulsex': 50,
    'coinspot': 45, 'swyftx': 43, 'kraken_au': 42, 'binance_au': 48,
    'crypto_com': 60, 'bitget': 58, 'htx': 56, 'gemini': 54,
    'bitfinex': 52, 'bullish': 40, 'bthumb': 35,
  };
  
  return sources
    .map(s => ({ ...s, matchScore: venueScores[s.id] || 30 + Math.random() * 20 }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);
}

// Calculate aggregate price from multiple sources
export function aggregatePrice(symbol: string, prices: { source: string; price: number; weight: number }[]): number {
  if (prices.length === 0) return 0;
  const totalWeight = prices.reduce((sum, p) => sum + p.weight, 0);
  return prices.reduce((sum, p) => sum + p.price * p.weight, 0) / totalWeight;
}
