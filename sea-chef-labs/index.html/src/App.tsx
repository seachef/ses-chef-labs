import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Starfield from './components/Starfield';
import { useWallet } from './hooks/useWallet';
import { ALL_SOURCES, DEXES, CEX_AUSTRALIA, CEX_GLOBAL, CHAINS, getBestVenue, type DataSource } from './services/dataSources';
import { calculateFeeBreakdown, getSafetyColor, type FeeBreakdown as FeeBreakdownType } from './services/bridgeFees';
import { fetchLivePrices, fetchAUDRate, checkAPIStatus, COIN_IDS } from './services/livePrices';

// ─── Types ───
type Coin = {
  symbol: string;
  name: string;
  price: number;
  change1h: number;
  change24h: number;
  score: number;
  volume: number;
  liquidity: number;
  liquidityScore: number;
  icon: string;
  researching: boolean;
  researchProgress: number;
  socials: { twitter?: string; discord?: string; website?: string };
  lastUpdated: number;
  bestVenue: string;
  sources: number;
};

type Holding = { symbol: string; qty: number; avg: number };
type LogEntry = { time: string; msg: string; type: 'ai' | 'trade' | 'wallet' | 'system' | 'data' };

// ─── 46 Coins ───
const COIN_BASE = [
  { symbol: 'HYPE', name: 'Hyperliquid', price: 42.18, change1h: 5.32, change24h: 12.4, score: 94.2, volume: 284000000, liquidity: 156000000, icon: '🔥', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/HyperliquidX', discord: 'https://discord.gg/hyperliquid', website: 'https://hyperliquid.xyz' } },
  { symbol: 'LINK', name: 'Chainlink', price: 18.92, change1h: 3.11, change24h: 8.7, score: 87.5, volume: 512000000, liquidity: 312000000, icon: '🔗', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/chainlink', discord: 'https://discord.gg/chainlink', website: 'https://chain.link' } },
  { symbol: 'SUI', name: 'Sui', price: 4.67, change1h: 4.88, change24h: 15.2, score: 85.1, volume: 398000000, liquidity: 245000000, icon: '💧', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/SuiNetwork', discord: 'https://discord.gg/sui', website: 'https://sui.io' } },
  { symbol: 'ONDO', name: 'Ondo Finance', price: 1.23, change1h: 2.1, change24h: 6.5, score: 78.3, volume: 156000000, liquidity: 89000000, icon: '🌊', researching: true, researchProgress: 87, socials: { twitter: 'https://x.com/OndoFinance', website: 'https://ondo.finance' } },
  { symbol: 'AAVE', name: 'Aave', price: 312.45, change1h: 1.8, change24h: 5.2, score: 76.9, volume: 423000000, liquidity: 278000000, icon: '👻', researching: true, researchProgress: 92, socials: { twitter: 'https://x.com/AaveAave', discord: 'https://discord.gg/aave', website: 'https://aave.com' } },
  { symbol: 'INJ', name: 'Injective', price: 28.91, change1h: -0.5, change24h: 3.1, score: 72.4, volume: 187000000, liquidity: 95000000, icon: '💉', researching: true, researchProgress: 78, socials: { twitter: 'https://x.com/Injective_', discord: 'https://discord.gg/injective', website: 'https://injective.com' } },
  { symbol: 'PENDLE', name: 'Pendle', price: 6.78, change1h: 1.2, change24h: 4.8, score: 70.1, volume: 98000000, liquidity: 56000000, icon: '🎵', researching: true, researchProgress: 65, socials: { twitter: 'https://x.com/PendleFinance', discord: 'https://discord.gg/pendle', website: 'https://pendle.finance' } },
  { symbol: 'TAO', name: 'Bittensor', price: 512.33, change1h: 0.9, change24h: 2.3, score: 68.7, volume: 267000000, liquidity: 145000000, icon: '🧠', researching: true, researchProgress: 71, socials: { twitter: 'https://x.com/opentensor', discord: 'https://discord.gg/bittensor', website: 'https://bittensor.com' } },
  { symbol: 'NEAR', name: 'NEAR Protocol', price: 5.42, change1h: -1.1, change24h: 1.9, score: 65.2, volume: 145000000, liquidity: 78000000, icon: 'Ⓝ', researching: true, researchProgress: 58, socials: { twitter: 'https://x.com/nearprotocol', discord: 'https://discord.gg/near', website: 'https://near.org' } },
  { symbol: 'OP', name: 'Optimism', price: 1.87, change1h: 0.7, change24h: 3.4, score: 62.8, volume: 178000000, liquidity: 92000000, icon: '🔴', researching: true, researchProgress: 54, socials: { twitter: 'https://x.com/optimism', discord: 'https://discord.gg/optimism', website: 'https://optimism.io' } },
  { symbol: 'ARB', name: 'Arbitrum', price: 0.92, change1h: -0.3, change24h: 2.1, score: 59.4, volume: 234000000, liquidity: 134000000, icon: '🔵', researching: true, researchProgress: 49, socials: { twitter: 'https://x.com/arbitrum', discord: 'https://discord.gg/arbitrum', website: 'https://arbitrum.io' } },
  { symbol: 'RUNE', name: 'THORChain', price: 5.67, change1h: 2.4, change24h: 7.8, score: 57.1, volume: 112000000, liquidity: 67000000, icon: '⚡', researching: true, researchProgress: 45, socials: { twitter: 'https://x.com/thorchain_org', discord: 'https://discord.gg/thorchain', website: 'https://thorchain.org' } },
  { symbol: 'PEPE', name: 'Pepe', price: 0.00001234, change1h: 8.2, change24h: 22.1, score: 55.8, volume: 892000000, liquidity: 445000000, icon: '🐸', researching: true, researchProgress: 42, socials: { twitter: 'https://x.com/pepecoineth', website: 'https://pepe.vip' } },
  { symbol: 'WIF', name: 'dogwifhat', price: 2.34, change1h: 6.7, change24h: 18.9, score: 54.2, volume: 445000000, liquidity: 234000000, icon: '🐕', researching: true, researchProgress: 38, socials: { twitter: 'https://x.com/dogwifcoin', website: 'https://wifcoin.org' } },
  { symbol: 'BONK', name: 'Bonk', price: 0.0000234, change1h: 5.1, change24h: 14.3, score: 52.7, volume: 312000000, liquidity: 178000000, icon: '🔨', researching: true, researchProgress: 35, socials: { twitter: 'https://x.com/bonk_in', discord: 'https://discord.gg/bonk', website: 'https://bonkcoin.com' } },
  { symbol: 'FLOKI', name: 'Floki', price: 0.000187, change1h: 4.8, change24h: 12.7, score: 51.3, volume: 267000000, liquidity: 145000000, icon: '⚔️', researching: true, researchProgress: 32, socials: { twitter: 'https://x.com/FlokiInu', discord: 'https://discord.gg/floki', website: 'https://floki.com' } },
  { symbol: 'SHIB', name: 'Shiba Inu', price: 0.0000245, change1h: 3.9, change24h: 9.8, score: 49.8, volume: 534000000, liquidity: 312000000, icon: '🐕‍🦺', researching: true, researchProgress: 29, socials: { twitter: 'https://x.com/Shibtoken', website: 'https://shibatoken.com' } },
  { symbol: 'DOGE', name: 'Dogecoin', price: 0.1234, change1h: 2.8, change24h: 7.2, score: 48.1, volume: 1230000000, liquidity: 678000000, icon: '🐶', researching: true, researchProgress: 26, socials: { twitter: 'https://x.com/dogecoin', website: 'https://dogecoin.com' } },
  { symbol: 'UNI', name: 'Uniswap', price: 7.89, change1h: 1.9, change24h: 5.4, score: 46.7, volume: 198000000, liquidity: 112000000, icon: '🦄', researching: true, researchProgress: 23, socials: { twitter: 'https://x.com/Uniswap', discord: 'https://discord.gg/uniswap', website: 'https://uniswap.org' } },
  { symbol: 'SUSHI', name: 'SushiSwap', price: 1.23, change1h: 1.2, change24h: 3.8, score: 45.2, volume: 87000000, liquidity: 45000000, icon: '🍣', researching: true, researchProgress: 20, socials: { twitter: 'https://x.com/SushiSwap', discord: 'https://discord.gg/sushiswap', website: 'https://sushi.com' } },
  { symbol: 'CRV', name: 'Curve', price: 0.67, change1h: 0.8, change24h: 2.9, score: 43.8, volume: 156000000, liquidity: 89000000, icon: '📈', researching: true, researchProgress: 17, socials: { twitter: 'https://x.com/CurveFinance', discord: 'https://discord.gg/curve', website: 'https://curve.fi' } },
  { symbol: 'COMP', name: 'Compound', price: 56.78, change1h: 1.5, change24h: 4.2, score: 42.3, volume: 78000000, liquidity: 42000000, icon: '🏦', researching: true, researchProgress: 14, socials: { twitter: 'https://x.com/compikiud', discord: 'https://discord.gg/compound', website: 'https://compound.finance' } },
  { symbol: 'MKR', name: 'Maker', price: 1234.56, change1h: 2.1, change24h: 6.1, score: 41.1, volume: 134000000, liquidity: 78000000, icon: '🏛️', researching: true, researchProgress: 11, socials: { twitter: 'https://x.com/MakerDAO', discord: 'https://discord.gg/maker', website: 'https://makerdao.com' } },
  { symbol: 'SNX', name: 'Synthetix', price: 2.34, change1h: 1.7, change24h: 4.9, score: 39.8, volume: 92000000, liquidity: 51000000, icon: '⚙️', researching: true, researchProgress: 8, socials: { twitter: 'https://x.com/synthetix_io', discord: 'https://discord.gg/synthetix', website: 'https://synthetix.io' } },
  { symbol: 'YFI', name: 'yearn.finance', price: 7890.12, change1h: 0.9, change24h: 2.8, score: 38.5, volume: 45000000, liquidity: 23000000, icon: '📊', researching: true, researchProgress: 5, socials: { twitter: 'https://x.com/iearnfinance', discord: 'https://discord.gg/yearn', website: 'https://yearn.fi' } },
  { symbol: 'BAL', name: 'Balancer', price: 3.45, change1h: 1.3, change24h: 3.7, score: 37.2, volume: 56000000, liquidity: 31000000, icon: '⚖️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Balancer', discord: 'https://discord.gg/balancer', website: 'https://balancer.fi' } },
  { symbol: 'BAND', name: 'Band Protocol', price: 1.89, change1h: 2.4, change24h: 6.8, score: 36.1, volume: 34000000, liquidity: 18000000, icon: '📡', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/BandProtocol', website: 'https://bandprotocol.com' } },
  { symbol: 'REN', name: 'Ren', price: 0.087, change1h: -0.5, change24h: 1.2, score: 35.0, volume: 23000000, liquidity: 12000000, icon: '🔄', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/renprotocol', website: 'https://renproject.io' } },
  { symbol: 'KNC', name: 'Kyber Network', price: 0.78, change1h: 1.1, change24h: 3.2, score: 34.2, volume: 28000000, liquidity: 15000000, icon: '💎', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/KyberNetwork', website: 'https://kyber.network' } },
  { symbol: 'BNT', name: 'Bancor', price: 0.56, change1h: 0.7, change24h: 2.1, score: 33.5, volume: 19000000, liquidity: 10000000, icon: '🏗️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Bancor', website: 'https://bancor.network' } },
  { symbol: 'OMG', name: 'OMG Network', price: 0.34, change1h: 0.9, change24h: 2.6, score: 32.8, volume: 21000000, liquidity: 11000000, icon: '🌐', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/omgnetwork', website: 'https://omg.network' } },
  { symbol: 'ZRX', name: '0x Protocol', price: 0.29, change1h: 1.4, change24h: 3.9, score: 32.1, volume: 26000000, liquidity: 14000000, icon: '0️⃣', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/0xproject', website: 'https://0x.org' } },
  { symbol: 'DODO', name: 'DODO', price: 0.12, change1h: 2.1, change24h: 5.7, score: 31.5, volume: 18000000, liquidity: 9500000, icon: '🦆', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/BreederDodo', website: 'https://dodoex.io' } },
  { symbol: '1INCH', name: '1inch', price: 0.45, change1h: 1.8, change24h: 4.9, score: 30.9, volume: 32000000, liquidity: 17000000, icon: '🥇', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/1inch', website: 'https://1inch.io' } },
  { symbol: 'GRT', name: 'The Graph', price: 0.23, change1h: 2.5, change24h: 6.8, score: 30.3, volume: 41000000, liquidity: 22000000, icon: '📊', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/graphprotocol', discord: 'https://discord.gg/graph', website: 'https://thegraph.com' } },
  { symbol: 'LRC', name: 'Loopring', price: 0.31, change1h: 1.2, change24h: 3.4, score: 29.7, volume: 22000000, liquidity: 12000000, icon: '🔁', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/loopringorg', website: 'https://loopring.org' } },
  { symbol: 'CVC', name: 'Civic', price: 0.098, change1h: 0.8, change24h: 2.3, score: 29.1, volume: 15000000, liquidity: 8000000, icon: '🆔', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/civickey', website: 'https://civic.com' } },
  { symbol: 'STORJ', name: 'Storj', price: 0.67, change1h: 1.5, change24h: 4.2, score: 28.5, volume: 27000000, liquidity: 14000000, icon: '💾', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/storj', website: 'https://storj.io' } },
  { symbol: 'FIL', name: 'Filecoin', price: 5.67, change1h: 2.1, change24h: 5.9, score: 27.9, volume: 89000000, liquidity: 48000000, icon: '📁', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Filecoin', discord: 'https://discord.gg/filecoin', website: 'https://filecoin.io' } },
  { symbol: 'AR', name: 'Arweave', price: 23.45, change1h: 3.2, change24h: 8.7, score: 27.3, volume: 56000000, liquidity: 31000000, icon: '🗄️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/arweaveteam', discord: 'https://discord.gg/arweave', website: 'https://arweave.org' } },
  { symbol: 'OCEAN', name: 'Ocean Protocol', price: 0.78, change1h: 1.9, change24h: 5.2, score: 26.7, volume: 34000000, liquidity: 18000000, icon: '🌊', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/oceanprotocol', discord: 'https://discord.gg/ocean', website: 'https://oceanprotocol.com' } },
  { symbol: 'NMR', name: 'Numeraire', price: 18.90, change1h: 2.4, change24h: 6.5, score: 26.1, volume: 21000000, liquidity: 11000000, icon: '🔢', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/numerai', website: 'https://numer.ai' } },
  { symbol: 'FET', name: 'Fetch.ai', price: 1.23, change1h: 4.1, change24h: 11.2, score: 25.5, volume: 67000000, liquidity: 36000000, icon: '🤖', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/fetch_ai', discord: 'https://discord.gg/fetch', website: 'https://fetch.ai' } },
  { symbol: 'AGIX', name: 'SingularityNET', price: 0.67, change1h: 3.8, change24h: 10.4, score: 24.9, volume: 45000000, liquidity: 24000000, icon: '🧬', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/singularity_net', discord: 'https://discord.gg/singularitynet', website: 'https://singularitynet.io' } },
  { symbol: 'OXT', name: 'Orchid', price: 0.089, change1h: 1.7, change24h: 4.6, score: 24.3, volume: 18000000, liquidity: 9500000, icon: '🌸', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/OrchidProtocol', website: 'https://orchid.com' } },
  { symbol: 'NU', name: 'NuCypher', price: 0.23, change1h: 2.1, change24h: 5.7, score: 23.7, volume: 14000000, liquidity: 7500000, icon: '🔐', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/nucypher', website: 'https://nucypher.com' } },
  // ─── 2026 NARRATIVE TOKENS ───
  // AI Agent Tokens
  { symbol: 'VIRTUAL', name: 'Virtuals Protocol', price: 2.34, change1h: 7.8, change24h: 24.5, score: 82.1, volume: 456000000, liquidity: 234000000, icon: '🤖', researching: true, researchProgress: 75, socials: { twitter: 'https://x.com/virtuals_io', website: 'https://virtuals.io' } },
  { symbol: 'AI16Z', name: 'ai16z', price: 0.89, change1h: 12.3, change24h: 38.7, score: 79.5, volume: 312000000, liquidity: 178000000, icon: '🧠', researching: true, researchProgress: 68, socials: { twitter: 'https://x.com/ai16zdao', website: 'https://ai16z.fun' } },
  { symbol: 'GRIFFAIN', name: 'GRIFFAIN', price: 0.45, change1h: 9.1, change24h: 28.3, score: 74.2, volume: 189000000, liquidity: 98000000, icon: '🦅', researching: true, researchProgress: 62, socials: { twitter: 'https://x.com/griFFAIN_sol', website: 'https://griffain.com' } },
  // DePIN Tokens
  { symbol: 'RENDER', name: 'Render Network', price: 8.92, change1h: 3.4, change24h: 11.2, score: 71.8, volume: 234000000, liquidity: 145000000, icon: '🎨', researching: true, researchProgress: 55, socials: { twitter: 'https://x.com/rendernetwork', website: 'https://rendernetwork.com' } },
  { symbol: 'AKT', name: 'Akash Network', price: 4.56, change1h: 2.8, change24h: 9.7, score: 67.3, volume: 156000000, liquidity: 89000000, icon: '☁️', researching: true, researchProgress: 48, socials: { twitter: 'https://x.com/abore_net', website: 'https://akash.network' } },
  { symbol: 'IO', name: 'io.net', price: 3.21, change1h: 4.5, change24h: 14.8, score: 65.9, volume: 178000000, liquidity: 95000000, icon: '🌐', researching: true, researchProgress: 42, socials: { twitter: 'https://x.com/ionet', website: 'https://io.net' } },
  { symbol: 'HNT', name: 'Helium', price: 6.78, change1h: 1.9, change24h: 7.3, score: 62.4, volume: 134000000, liquidity: 78000000, icon: '📡', researching: true, researchProgress: 36, socials: { twitter: 'https://x.com/helium', website: 'https://helium.com' } },
  // RWA Tokens
  { symbol: 'OM', name: 'Mantra', price: 1.45, change1h: 3.2, change24h: 10.8, score: 69.7, volume: 198000000, liquidity: 112000000, icon: '🏛️', researching: true, researchProgress: 58, socials: { twitter: 'https://x.com/MANTRA_Chain', website: 'https://mantrachain.io' } },
  { symbol: 'POLYX', name: 'Polymesh', price: 0.34, change1h: 2.1, change24h: 8.4, score: 58.2, volume: 67000000, liquidity: 38000000, icon: '📜', researching: true, researchProgress: 32, socials: { twitter: 'https://x.com/Polymesh', website: 'https://polymesh.network' } },
  // New L1/L2 Tokens
  { symbol: 'MON', name: 'Monad', price: 3.45, change1h: 15.2, change24h: 45.8, score: 88.9, volume: 567000000, liquidity: 312000000, icon: '⚡', researching: true, researchProgress: 82, socials: { twitter: 'https://x.com/maboroshi_monad', website: 'https://monad.xyz' } },
  { symbol: 'BERA', name: 'Berachain', price: 5.67, change1h: 8.7, change24h: 22.4, score: 76.3, volume: 289000000, liquidity: 167000000, icon: '🐻', researching: true, researchProgress: 71, socials: { twitter: 'https://x.com/beaborachi', website: 'https://berachain.com' } },
  { symbol: 'METH', name: 'MegaETH', price: 1.23, change1h: 11.4, change24h: 34.2, score: 81.5, volume: 423000000, liquidity: 245000000, icon: '⚡', researching: true, researchProgress: 77, socials: { twitter: 'https://x.com/megaeth_labs', website: 'https://megaeth.com' } },
  // ─── TOP 10 BLUECHIPS (Best Liquidity) ───
  { symbol: 'BTC', name: 'Bitcoin', price: 98456.78, change1h: 0.8, change24h: 3.2, score: 99.5, volume: 45600000000, liquidity: 28900000000, icon: '₿', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/Bitcoin', website: 'https://bitcoin.org' } },
  { symbol: 'ETH', name: 'Ethereum', price: 3234.56, change1h: 1.2, change24h: 4.8, score: 98.2, volume: 18900000000, liquidity: 12400000000, icon: '⟠', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/ethereum', website: 'https://ethereum.org' } },
  { symbol: 'SOL', name: 'Solana', price: 187.34, change1h: 2.4, change24h: 7.9, score: 96.8, volume: 4560000000, liquidity: 2890000000, icon: '◎', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/solana', website: 'https://solana.com' } },
  { symbol: 'BNB', name: 'BNB', price: 623.45, change1h: 0.9, change24h: 2.8, score: 95.4, volume: 1890000000, liquidity: 1230000000, icon: '🟨', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/bnbchain', website: 'https://bnbchain.org' } },
  { symbol: 'XRP', name: 'Ripple', price: 2.34, change1h: 1.5, change24h: 5.6, score: 94.1, volume: 3450000000, liquidity: 2120000000, icon: '💧', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/Ripple', website: 'https://ripple.com' } },
  { symbol: 'ADA', name: 'Cardano', price: 0.89, change1h: 1.8, change24h: 6.2, score: 92.7, volume: 890000000, liquidity: 567000000, icon: '🔵', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/Cardano', website: 'https://cardano.org' } },
  { symbol: 'AVAX', name: 'Avalanche', price: 38.67, change1h: 2.1, change24h: 8.4, score: 91.3, volume: 1230000000, liquidity: 789000000, icon: '🔺', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/avalancheavax', website: 'https://avax.network' } },
  { symbol: 'DOT', name: 'Polkadot', price: 7.23, change1h: 1.4, change24h: 4.9, score: 89.8, volume: 678000000, liquidity: 423000000, icon: '●', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/Polkadot', website: 'https://polkadot.network' } },
  { symbol: 'POL', name: 'Polygon', price: 0.56, change1h: 1.7, change24h: 5.8, score: 88.5, volume: 567000000, liquidity: 345000000, icon: '🟣', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/0xPolygon', website: 'https://polygon.technology' } },
  { symbol: 'LTC', name: 'Litecoin', price: 112.34, change1h: 0.6, change24h: 2.3, score: 87.2, volume: 456000000, liquidity: 289000000, icon: 'Ł', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/LitecoinProject', website: 'https://litecoin.org' } },
];

// Initialize coins with liquidity scores and best venues
const INITIAL_COINS: Coin[] = COIN_BASE.map(c => ({
  ...c,
  liquidityScore: Math.min(100, (c.liquidity / 5e8) * 100),
  lastUpdated: Date.now(),
  bestVenue: getBestVenue(c.symbol, ALL_SOURCES)[0]?.name || 'Unknown',
  sources: ALL_SOURCES.length,
}));

const DEX_ROUTERS: Record<number, string> = {
  1: 'Uniswap V3', 56: 'PancakeSwap', 137: 'QuickSwap', 42161: 'Camelot', 8453: 'BaseSwap',
};

// ─── Helpers ───
const formatNum = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const formatVol = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;
const timeNow = () => new Date().toLocaleTimeString('en-US', { hour12: false });

// ─── UI Components ───
function GlassCard({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`relative rounded-3xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl shadow-2xl shadow-black/20 overflow-hidden ${className}`}>
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none" />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

function GlowOrb({ color, size, top, left, delay = 0 }: { color: string; size: number; top: string; left: string; delay?: number }) {
  return <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 2, delay }} className="absolute rounded-full blur-3xl pointer-events-none" style={{ width: size, height: size, top, left, background: color }} />;
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
      <motion.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 1.2, ease: 'easeOut' }} className="h-full rounded-full bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400" />
    </div>
  );
}

function LiquidityBar({ score }: { score: number }) {
  const color = score > 70 ? 'from-emerald-500 to-green-400' : score > 40 ? 'from-amber-500 to-yellow-400' : 'from-rose-500 to-pink-400';
  return (
    <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
      <motion.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 1.2 }} className={`h-full rounded-full bg-gradient-to-r ${color}`} />
    </div>
  );
}

function ResearchProgress({ progress }: { progress: number }) {
  return (
    <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
      <motion.div animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" />
    </div>
  );
}

function SocialLinks({ socials }: { socials: Coin['socials'] }) {
  return (
    <div className="flex gap-1.5">
      {socials.twitter && <a href={socials.twitter} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-blue-500/20 flex items-center justify-center text-xs transition-all" title="Twitter/X">𝕏</a>}
      {socials.discord && <a href={socials.discord} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-indigo-500/20 flex items-center justify-center text-xs transition-all" title="Discord">💬</a>}
      {socials.website && <a href={socials.website} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-emerald-500/20 flex items-center justify-center text-xs transition-all" title="Website">🌐</a>}
    </div>
  );
}

function SourceStatusDot({ status }: { status: DataSource['status'] }) {
  return <div className={`w-1.5 h-1.5 rounded-full ${status === 'live' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'}`} />;
}

function FeeBreakdownPanel({ coin, amount = 100, convertPrice, currencySymbol }: { coin: Coin; amount?: number; convertPrice: (price: number) => number; currencySymbol: string }) {
  const convertedAmount = convertPrice(amount);
  // Determine venue type from best venue
  const venueType = coin.bestVenue.toLowerCase().includes('swap') || coin.bestVenue.toLowerCase().includes('uniswap') || coin.bestVenue.toLowerCase().includes('sushi') 
    ? 'dex' 
    : coin.bestVenue.toLowerCase().includes('binance') || coin.bestVenue.toLowerCase().includes('coinbase') || coin.bestVenue.toLowerCase().includes('kraken')
    ? 'cex'
    : 'aggregator';
  
  // Map coins to their primary chains (in production, this would come from the coin data)
  const coinChainMap: Record<string, string> = {
    'HYPE': 'Hyperliquid L1',
    'LINK': 'Ethereum',
    'SUI': 'Solana',
    'ONDO': 'Ethereum',
    'AAVE': 'Ethereum',
    'INJ': 'Injective',
    'PENDLE': 'Ethereum',
    'TAO': 'Bittensor',
    'NEAR': 'NEAR',
    'OP': 'Optimism',
    'ARB': 'Arbitrum',
    'RUNE': 'Thorchain',
    'PEPE': 'Ethereum',
    'WIF': 'Solana',
    'BONK': 'Solana',
    'FLOKI': 'Ethereum',
    'SHIB': 'Ethereum',
    'DOGE': 'Dogecoin',
    'UNI': 'Ethereum',
    'SUSHI': 'Ethereum',
    'CRV': 'Ethereum',
    'COMP': 'Ethereum',
    'MKR': 'Ethereum',
    'SNX': 'Ethereum',
    'YFI': 'Ethereum',
    'BAL': 'Ethereum',
    'BAND': 'Ethereum',
    'REN': 'Ethereum',
    'KNC': 'Ethereum',
    'BNT': 'Ethereum',
    'OMG': 'Ethereum',
    'ZRX': 'Ethereum',
    'DODO': 'Ethereum',
    '1INCH': 'Ethereum',
    'GRT': 'Ethereum',
    'LRC': 'Ethereum',
    'CVC': 'Ethereum',
    'STORJ': 'Ethereum',
    'FIL': 'Filecoin',
    'AR': 'Arweave',
    'OCEAN': 'Ethereum',
    'NMR': 'Ethereum',
    'FET': 'Ethereum',
    'AGIX': 'Ethereum',
    'OXT': 'Ethereum',
    'NU': 'Ethereum',
  };
  
  // User's wallet is on Ethereum (in production, this would come from wallet state)
  const fromChain = 'Ethereum';
  const toChain = coinChainMap[coin.symbol] || 'Ethereum';
  
  const fees = calculateFeeBreakdown(amount, fromChain, toChain, venueType);
  
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-3 pt-3 border-t border-white/[0.05] space-y-3"
    >
      {/* Fee Breakdown Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300">💰 Fee Breakdown</span>
        <span className="text-[10px] text-gray-500">Based on {currencySymbol}{convertedAmount.toFixed(0)} trade</span>
      </div>

      {/* Fee Details */}
      <div className="space-y-2">
        {/* Trading Fee */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Trading Fee</span>
            <span className="text-[10px] text-gray-600">({venueType.toUpperCase()})</span>
          </div>
          <div className="text-right">
            <div className="text-xs font-mono text-white">{currencySymbol}{convertPrice(fees.tradingFeeUSD).toFixed(2)}</div>
            <div className="text-[10px] text-gray-500">{fees.tradingFee}%</div>
          </div>
        </div>

        {/* Network Fee */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Network Fee</span>
            <span className="text-[10px] text-gray-600">({fromChain})</span>
          </div>
          <div className="text-right">
            <div className="text-xs font-mono text-white">{currencySymbol}{convertPrice(fees.networkFee).toFixed(2)}</div>
            <div className="text-[10px] text-gray-500">Gas</div>
          </div>
        </div>

        {/* Bridge Fee (if applicable) */}
        {fees.recommendedBridge && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Bridge Fee</span>
              <span className="text-[10px] text-gray-600">({fees.recommendedBridge.name})</span>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-white">{currencySymbol}{convertPrice(fees.bridgeFeeUSD).toFixed(2)}</div>
              <div className="text-[10px] text-gray-500">{fees.bridgeFee}%</div>
            </div>
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
          <span className="text-xs font-semibold text-violet-300">Total Fees</span>
          <div className="text-right">
            <div className="text-sm font-mono font-bold text-white">{currencySymbol}{convertPrice(fees.totalFee).toFixed(2)}</div>
            <div className="text-[10px] text-violet-400">{fees.totalFeePercent.toFixed(2)}%</div>
          </div>
        </div>

        {/* You Receive */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <span className="text-xs font-semibold text-emerald-300">You Receive</span>
          <div className="text-right">
            <div className="text-sm font-mono font-bold text-white">{currencySymbol}{convertPrice(amount - fees.totalFee).toFixed(2)}</div>
            <div className="text-[10px] text-emerald-400">{((amount - fees.totalFee) / amount * 100).toFixed(2)}% of input</div>
          </div>
        </div>
      </div>

      {/* Recommended Bridge */}
      {fees.recommendedBridge && (
        <div className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">{fees.recommendedBridge.icon}</span>
              <span className="text-xs font-semibold text-emerald-300">Recommended Bridge</span>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getSafetyColor(fees.recommendedBridge.safety)}`}>
              {fees.recommendedBridge.safety.toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[10px] text-gray-500">TVL</div>
              <div className="text-xs font-mono text-white">{formatVol(fees.recommendedBridge.tvl)}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Speed</div>
              <div className="text-xs font-mono text-white">{fees.recommendedBridge.speed}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Audits</div>
              <div className="text-xs font-mono text-white">{fees.recommendedBridge.audits}</div>
            </div>
          </div>
          {fees.recommendedBridge.exploitHistory && (
            <div className="mt-2 text-[10px] text-amber-400 flex items-center gap-1">
              <span>⚠️</span>
              <span>Has exploit history - use with caution</span>
            </div>
          )}
        </div>
      )}

      {/* Alternative Bridges */}
      {fees.alternativeBridges.length > 0 && (
        <div>
          <div className="text-[10px] text-gray-500 mb-1.5">Alternative Bridges:</div>
          <div className="flex flex-wrap gap-1.5">
            {fees.alternativeBridges.map(bridge => (
              <div key={bridge.id} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <span className="text-xs">{bridge.icon}</span>
                <span className="text-[10px] text-gray-400">{bridge.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${getSafetyColor(bridge.safety)}`}>
                  {bridge.safety}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Route Visualization */}
      <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
        <div className="text-[10px] text-gray-500 mb-2">🗺️ Trade Route</div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20">
            <span className="text-[10px] text-violet-300 font-medium">{fromChain}</span>
          </div>
          {fees.recommendedBridge ? (
            <>
              <div className="flex items-center gap-1">
                <div className="w-4 h-px bg-gray-600" />
                <span className="text-xs">{fees.recommendedBridge.icon}</span>
                <div className="w-4 h-px bg-gray-600" />
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <span className="text-[10px] text-cyan-300 font-medium">{toChain}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <div className="w-6 h-px bg-gray-600" />
                <span className="text-[10px] text-gray-500">→</span>
                <div className="w-6 h-px bg-gray-600" />
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-[10px] text-emerald-300 font-medium">Same Chain ✓</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Estimated Time */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
        <span className="text-xs text-gray-400">⏱️ Estimated Time</span>
        <span className="text-xs font-mono text-white">{fees.estimatedTime}</span>
      </div>

      {/* Warnings */}
      {fees.warnings.length > 0 && (
        <div className="space-y-1">
          {fees.warnings.map((warning, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <span className="text-xs">⚠️</span>
              <span className="text-[10px] text-amber-300">{warning}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CoinCard({ coin, rank, onBuy, onSell, convertPrice, currencySymbol }: { coin: Coin; rank: number; onBuy: () => void; onSell?: () => void; convertPrice: (price: number) => number; currencySymbol: string }) {
  const [showFees, setShowFees] = useState(false);
  const positive = coin.change24h >= 0;
  const liqRec = coin.liquidityScore > 70 ? { label: 'HIGH', color: 'text-emerald-400' } : coin.liquidityScore > 40 ? { label: 'MED', color: 'text-amber-400' } : { label: 'LOW', color: 'text-rose-400' };
  const displayPrice = convertPrice(coin.price);
  
  return (
    <motion.div layout className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.05] hover:border-violet-500/30 transition-all duration-500">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center text-lg">{coin.icon}</div>
          <div className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white shadow-lg">{rank}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white text-sm">{coin.symbol}</span>
            <span className="font-mono text-sm text-white">{currencySymbol}{formatNum(displayPrice)}</span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-xs text-gray-500 truncate">{coin.name}</span>
            <span className={`text-xs font-mono ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>{positive ? '+' : ''}{coin.change24h.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Score & Liquidity */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-10">Score</span>
          <div className="flex-1"><ScoreBar score={coin.score} /></div>
          <span className="text-xs font-mono text-violet-300 w-8 text-right">{coin.score.toFixed(0)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-10">Liq</span>
          <div className="flex-1"><LiquidityBar score={coin.liquidityScore} /></div>
          <span className={`text-xs font-mono ${liqRec.color} w-8 text-right`}>{liqRec.label}</span>
        </div>
      </div>

      {/* Best Venue & Chain */}
      <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        <span className="text-[10px] text-gray-500">Best venue:</span>
        <span className="text-xs font-medium text-cyan-300">{coin.bestVenue}</span>
        <span className="text-[10px] text-gray-600 ml-auto">{coin.sources} sources</span>
      </div>

      {/* Chain Info */}
      <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        <span className="text-[10px] text-gray-500">Chain:</span>
        <span className="text-xs font-medium text-amber-300">
          {coin.symbol === 'HYPE' ? 'Hyperliquid' : 
           coin.symbol === 'SUI' ? 'Solana' : 
           coin.symbol === 'OP' ? 'Optimism' : 
           coin.symbol === 'ARB' ? 'Arbitrum' : 
           coin.symbol === 'NEAR' ? 'NEAR' : 
           coin.symbol === 'RUNE' ? 'Thorchain' : 
           coin.symbol === 'INJ' ? 'Injective' : 
           coin.symbol === 'TAO' ? 'Bittensor' : 
           coin.symbol === 'FIL' ? 'Filecoin' : 
           coin.symbol === 'AR' ? 'Arweave' : 
           coin.symbol === 'DOGE' ? 'Dogecoin' : 'Ethereum'}
        </span>
        {(coin.symbol === 'SUI' || coin.symbol === 'WIF' || coin.symbol === 'BONK' || coin.symbol === 'HYPE') && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 ml-auto">Bridge needed</span>
        )}
      </div>

      <div className="flex gap-2 mb-3">
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.05] px-2 py-1.5 text-center">
          <div className="text-[10px] text-gray-500">1h</div>
          <div className={`text-xs font-mono ${coin.change1h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{coin.change1h >= 0 ? '+' : ''}{coin.change1h.toFixed(1)}%</div>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.05] px-2 py-1.5 text-center">
          <div className="text-[10px] text-gray-500">Vol</div>
          <div className="text-xs font-mono text-gray-300">{formatVol(coin.volume)}</div>
        </div>
        <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.05] px-2 py-1.5 text-center">
          <div className="text-[10px] text-gray-500">Liq</div>
          <div className="text-xs font-mono text-emerald-300">{formatVol(coin.liquidity)}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={onBuy} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold py-2 transition-all duration-300 hover:shadow-lg hover:shadow-violet-500/20 active:scale-95">BUY</button>
        {onSell && <button onClick={onSell} className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-semibold py-2 transition-all duration-300 hover:shadow-lg hover:shadow-rose-500/20 active:scale-95">SELL</button>}
      </div>

      {/* Fee Breakdown Toggle */}
      <button
        onClick={() => setShowFees(!showFees)}
        className="w-full mt-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all duration-300 flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">💰</span>
          <span className="text-[10px] text-gray-400 group-hover:text-gray-300">View Fee Structure</span>
        </div>
        <motion.span
          animate={{ rotate: showFees ? 180 : 0 }}
          transition={{ duration: 0.3 }}
          className="text-xs text-gray-500"
        >
          ▼
        </motion.span>
      </button>

      {/* Fee Breakdown Panel */}
      <AnimatePresence>
        {showFees && <FeeBreakdownPanel coin={coin} amount={100} convertPrice={convertPrice} currencySymbol={currencySymbol} />}
      </AnimatePresence>

      <div className="mt-3 pt-3 border-t border-white/[0.05] flex items-center justify-between">
        <SocialLinks socials={coin.socials} />
        <span className="text-[10px] text-gray-600 font-mono">Updated {Math.round((Date.now() - coin.lastUpdated) / 1000)}s ago</span>
      </div>
    </motion.div>
  );
}

function BottomTicker({ coins, onBuy, researchingCoins }: { coins: Coin[]; onBuy: (coin: Coin) => void; researchingCoins: number }) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3 px-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center text-xs">🔬</div>
          <h3 className="text-sm font-semibold text-gray-300">Research Queue</h3>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] text-amber-400 font-mono">{researchingCoins} ACTIVE</span>
          </div>
        </div>
        <span className="text-xs text-gray-500">{coins.length} tokens tracked</span>
      </div>
      <div className="overflow-x-auto pb-2 custom-scrollbar">
        <div className="flex gap-3 min-w-max">
          {coins.map((coin) => (
            <motion.div key={coin.symbol} layout className={`flex-shrink-0 w-48 rounded-2xl border p-3 transition-all duration-300 ${coin.researching ? 'bg-amber-500/[0.03] border-amber-500/20 hover:border-amber-500/40' : 'bg-white/[0.02] border-white/[0.06] hover:border-violet-500/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{coin.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{coin.symbol}</div>
                  <div className="text-[10px] text-gray-500 truncate">{coin.name}</div>
                </div>
                {coin.researching && <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-white">${formatNum(coin.price)}</span>
                <span className={`text-[10px] font-mono ${coin.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-gray-500">Liquidity</span>
                <span className="text-[10px] font-mono text-emerald-300">{formatVol(coin.liquidity)}</span>
              </div>
              {coin.researching ? (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-amber-400">Researching...</span>
                    <span className="text-[10px] font-mono text-amber-300">{coin.researchProgress.toFixed(0)}%</span>
                  </div>
                  <ResearchProgress progress={coin.researchProgress} />
                </div>
              ) : (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500">Score</span>
                    <span className="text-[10px] font-mono text-violet-300">{coin.score.toFixed(0)}</span>
                  </div>
                  <ScoreBar score={coin.score} />
                </div>
              )}
              <button onClick={() => onBuy(coin)} className={`w-full rounded-xl text-xs font-semibold py-1.5 transition-all duration-300 active:scale-95 ${coin.researching ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20' : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white hover:shadow-lg hover:shadow-violet-500/20'}`}>
                {coin.researching ? 'WATCH' : 'BUY'}
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataSourcesPanel({ sources }: { sources: DataSource[] }) {
  const [filter, setFilter] = useState<string>('all');
  const filtered = filter === 'all' ? sources : sources.filter(s => {
    if (filter === 'dex') return s.id && DEXES.some(d => d.id === s.id);
    if (filter === 'cex_au') return CEX_AUSTRALIA.some(c => c.id === s.id);
    if (filter === 'cex_global') return CEX_GLOBAL.some(c => c.id === s.id);
    if (filter === 'tg') return s.id && ['banana_gun', 'maestro', 'unibot', 'bonkbot', 'trojan', 'openliquid'].includes(s.id);
    if (filter === 'ai') return s.id && ['gemini_agent', 'binance_agents', 'okx_agent', 'millionpool', 'cryptohopper', '3commas'].includes(s.id);
    if (filter === 'mev') return s.id && ['flashbots', 'mev_blocker', 'cow_protocol'].includes(s.id);
    return true;
  });
  const liveCount = sources.filter(s => s.status === 'live').length;

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">📡</div>
          <div>
            <h3 className="font-semibold text-white text-sm">Live Data Sources</h3>
            <p className="text-xs text-gray-500">{liveCount}/{sources.length} connected</p>
          </div>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-mono">LIVE</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { id: 'all', label: `All (${sources.length})` },
          { id: 'dex', label: 'DEX' },
          { id: 'cex_au', label: 'CEX AU' },
          { id: 'cex_global', label: 'CEX Global' },
          { id: 'tg', label: '💬 TG Bots' },
          { id: 'ai', label: '🤖 AI Agents' },
          { id: 'mev', label: '🛡️ MEV' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`px-3 py-1 rounded-xl text-xs font-medium transition-all ${filter === f.id ? 'bg-white/[0.08] text-white' : 'text-gray-500 hover:text-gray-300'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Sources grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
        {filtered.map(source => (
          <div key={source.id} className="flex items-center gap-2 p-2 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all">
            <span className="text-sm">{source.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <SourceStatusDot status={source.status} />
                <span className="text-xs font-medium text-white truncate">{source.name}</span>
              </div>
              <div className="text-[10px] text-gray-500">{source.pairs} pairs • {source.latency}ms</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ChainsPanel() {
  return (
    <GlassCard className="p-6" delay={0.2}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center">🌐</div>
        <div>
          <h3 className="font-semibold text-white text-sm">Supported Chains</h3>
          <p className="text-xs text-gray-500">{CHAINS.length} networks</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {CHAINS.map(chain => (
          <div key={chain.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-all cursor-default">
            <span className="text-sm">{chain.icon}</span>
            <span className="text-xs text-gray-300">{chain.name}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function MEVProtectionToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
      <div className="flex items-center gap-2">
        <span className="text-sm">🛡️</span>
        <div>
          <div className="text-xs font-semibold text-white">MEV Protection</div>
          <div className="text-[10px] text-gray-500">{enabled ? 'Private mempool active' : 'Standard routing'}</div>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`ml-auto relative w-12 h-6 rounded-full transition-all duration-300 ${enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}
      >
        <motion.div
          animate={{ x: enabled ? 24 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-lg"
        />
      </button>
    </div>
  );
}

function SmartMoneyPanel() {
  const whaleAlerts = [
    { wallet: '0x7a25...f3d2', action: 'BUY', symbol: 'VIRTUAL', amount: '$2.4M', time: '2m ago', pnl: '+34.2%' },
    { wallet: '0x3b91...a8c7', action: 'SELL', symbol: 'PEPE', amount: '$890K', time: '5m ago', pnl: '+156.7%' },
    { wallet: '0xf2d4...1e9b', action: 'BUY', symbol: 'MON', amount: '$1.8M', time: '8m ago', pnl: '+45.8%' },
    { wallet: '0x8c17...4d2a', action: 'BUY', symbol: 'RENDER', amount: '$3.1M', time: '12m ago', pnl: '+11.2%' },
    { wallet: '0x5e82...9f3c', action: 'SELL', symbol: 'WIF', amount: '$567K', time: '15m ago', pnl: '+89.3%' },
    { wallet: '0x1a4d...7b2e', action: 'BUY', symbol: 'AI16Z', amount: '$1.2M', time: '18m ago', pnl: '+38.7%' },
  ];

  return (
    <GlassCard className="p-6" delay={0.1}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">🐋</div>
          <div>
            <h3 className="font-semibold text-white text-sm">Smart Money & Whale Alerts</h3>
            <p className="text-xs text-gray-500">Live on-chain tracking • Copy trades available</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] text-amber-400 font-mono">LIVE</span>
        </div>
      </div>
      <div className="space-y-2">
        {whaleAlerts.map((alert, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all"
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${alert.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              {alert.action === 'BUY' ? '↑' : '↓'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">{alert.wallet}</span>
                <span className={`text-[10px] font-bold ${alert.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{alert.action}</span>
                <span className="text-xs font-semibold text-white">{alert.symbol}</span>
              </div>
              <div className="text-[10px] text-gray-500">{alert.amount} • {alert.time}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-emerald-400">{alert.pnl}</div>
              <button className="text-[10px] text-violet-400 hover:text-violet-300 mt-0.5">Copy →</button>
            </div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  );
}

function AIAgentPanel() {
  const agents = [
    { name: 'Alpha Scanner', icon: '🔍', status: 'Active', trades: 24, pnl: '+12.4%', desc: 'Scans for momentum plays' },
    { name: 'DePIN Hunter', icon: '📡', status: 'Active', trades: 8, pnl: '+8.7%', desc: 'Tracks DePIN narrative tokens' },
    { name: 'Whale Follower', icon: '🐋', status: 'Active', trades: 15, pnl: '+18.2%', desc: 'Copies top whale wallets' },
    { name: 'MEV Shield', icon: '🛡️', status: 'Active', trades: 0, pnl: 'Saved $340', desc: 'Blocks sandwich attacks' },
    { name: 'DCA Bot', icon: '📊', status: 'Paused', trades: 45, pnl: '+5.3%', desc: 'Dollar-cost averaging' },
    { name: 'Sniper Bot', icon: '🎯', status: 'Active', trades: 3, pnl: '+42.1%', desc: 'New listing sniping' },
  ];

  return (
    <GlassCard className="p-6" delay={0.2}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-pink-500/20 flex items-center justify-center">🤖</div>
          <div>
            <h3 className="font-semibold text-white text-sm">AI Trading Agents</h3>
            <p className="text-xs text-gray-500">Autonomous trading • 2026 agentic AI</p>
          </div>
        </div>
        <button className="px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/20 transition-all">
          + New Agent
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {agents.map((agent, i) => (
          <div key={i} className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{agent.icon}</span>
              <div className="flex-1">
                <div className="text-xs font-semibold text-white">{agent.name}</div>
                <div className="text-[10px] text-gray-500">{agent.desc}</div>
              </div>
              <div className={`w-2 h-2 rounded-full ${agent.status === 'Active' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500">{agent.trades} trades</span>
              <span className="text-xs font-mono text-emerald-400">{agent.pnl}</span>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function TelegramBotsPanel() {
  const bots = [
    { name: 'Banana Gun', icon: '🍌', chains: 'ETH, SOL, BASE', speed: '5ms', fee: '1%', specialty: 'Multi-chain sniper' },
    { name: 'Maestro', icon: '🎵', chains: 'ETH, SOL, BASE, ARB', speed: '7ms', fee: '1%', specialty: 'Full DeFi suite' },
    { name: 'Unibot', icon: '🤖', chains: 'ETH, ARB, BASE', speed: '8ms', fee: '1%', specialty: 'Limit orders' },
    { name: 'BonkBot', icon: '🔨', chains: 'Solana only', speed: '4ms', fee: '1%', specialty: 'Solana speed king' },
    { name: 'Trojan', icon: '🐴', chains: 'Solana only', speed: '5ms', fee: '0.9%', specialty: 'DCA + sniping' },
    { name: 'OpenLiquid', icon: '💧', chains: 'ETH, SOL, BASE, ARB', speed: '6ms', fee: '0.8%', specialty: 'Lowest fees' },
  ];

  return (
    <GlassCard className="p-6" delay={0.3}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">💬</div>
        <div>
          <h3 className="font-semibold text-white text-sm">Telegram Trading Bots</h3>
          <p className="text-xs text-gray-500">Fastest execution • Direct from Telegram</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {bots.map((bot, i) => (
          <div key={i} className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-cyan-500/30 hover:bg-white/[0.04] transition-all cursor-pointer">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{bot.icon}</span>
              <span className="text-xs font-semibold text-white">{bot.name}</span>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] text-gray-500">Chains: <span className="text-gray-300">{bot.chains}</span></div>
              <div className="text-[10px] text-gray-500">Speed: <span className="text-emerald-400">{bot.speed}</span></div>
              <div className="text-[10px] text-gray-500">Fee: <span className="text-amber-400">{bot.fee}</span></div>
              <div className="text-[10px] text-gray-500">Best for: <span className="text-cyan-300">{bot.specialty}</span></div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

type WatchWallet = {
  address: string;
  label: string;
  chain: string;
  balance: number;
  holdings: { symbol: string; amount: number; value: number }[];
};

function WatchOnlyWallets({ wallets, onAdd, onRemove, convertPrice, currencySymbol }: { 
  wallets: WatchWallet[]; 
  onAdd: (wallet: WatchWallet) => void;
  onRemove: (address: string) => void;
  convertPrice: (price: number) => number;
  currencySymbol: string;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newChain, setNewChain] = useState('Ethereum');

  const totalValue = wallets.reduce((sum, w) => sum + w.balance, 0);

  const handleAdd = () => {
    if (!newAddress.trim()) return;
    
    // Simulate fetching wallet data
    const mockHoldings = [
      { symbol: 'ETH', amount: 2.5, value: 8086.4 },
      { symbol: 'USDC', amount: 5000, value: 5000 },
      { symbol: 'LINK', amount: 150, value: 2838 },
    ];
    
    const newWallet: WatchWallet = {
      address: newAddress,
      label: newLabel || `Wallet ${wallets.length + 1}`,
      chain: newChain,
      balance: mockHoldings.reduce((sum, h) => sum + h.value, 0),
      holdings: mockHoldings,
    };
    
    onAdd(newWallet);
    setNewAddress('');
    setNewLabel('');
    setShowAddForm(false);
  };

  return (
    <GlassCard className="p-6" delay={0.1}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center">👁️</div>
          <div>
            <h3 className="font-semibold text-white text-sm">Watch-Only Wallets</h3>
            <p className="text-xs text-gray-500">Track your portfolios without connecting</p>
          </div>
        </div>
        <button 
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1.5 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/20 transition-all"
        >
          {showAddForm ? 'Cancel' : '+ Add Wallet'}
        </button>
      </div>

      {/* Total Portfolio Value */}
      <div className="mb-4 p-4 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-500/20">
        <div className="text-xs text-gray-400 mb-1">Total Portfolio Value</div>
        <div className="text-2xl font-bold text-white font-mono">{currencySymbol}{convertPrice(totalValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
        <div className="text-xs text-emerald-400 mt-1">▲ +12.4% (24h)</div>
      </div>

      {/* Add Wallet Form */}
      {showAddForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-4 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-3"
        >
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Wallet Address</label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="0x... or solana address"
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/[0.06] text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Label (optional)</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="My Main Wallet"
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/[0.06] text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Chain</label>
              <select
                value={newChain}
                onChange={(e) => setNewChain(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/[0.06] text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="Ethereum">Ethereum</option>
                <option value="Solana">Solana</option>
                <option value="Polygon">Polygon</option>
                <option value="Arbitrum">Arbitrum</option>
                <option value="Base">Base</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleAdd}
            className="w-full py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-sm font-semibold transition-all"
          >
            Add Wallet
          </button>
        </motion.div>
      )}

      {/* Wallet List */}
      {wallets.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">👁️</div>
          <p className="text-sm text-gray-500">No wallets added yet</p>
          <p className="text-xs text-gray-600 mt-1">Add your wallet addresses to track your complete portfolio</p>
        </div>
      ) : (
        <div className="space-y-3">
          {wallets.map((wallet) => (
            <motion.div
              key={wallet.address}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-white">{wallet.label}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400">
                      {wallet.chain}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-gray-500">
                    {wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}
                  </div>
                </div>
                <button
                  onClick={() => onRemove(wallet.address)}
                  className="text-gray-600 hover:text-rose-400 transition-colors"
                >
                  ✕
                </button>
              </div>
              
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs text-gray-500">Total Value</div>
                  <div className="text-lg font-bold text-white font-mono">
                    {currencySymbol}{convertPrice(wallet.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Holdings */}
              <div className="space-y-2">
                {wallet.holdings.map((holding, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-t border-white/[0.03]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white">{holding.symbol}</span>
                      <span className="text-xs text-gray-500">{holding.amount} tokens</span>
                    </div>
                    <span className="text-xs font-mono text-gray-300">
                      {currencySymbol}{convertPrice(holding.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function ConnectModal({ open, onClose, onConnect }: { open: boolean; onClose: () => void; onConnect: (method: string) => void }) {
  const wallets = [
    { id: 'metamask', name: 'MetaMask', icon: '🦊', desc: 'Browser Extension' },
    { id: 'walletconnect', name: 'WalletConnect', icon: '🔗', desc: 'Scan with mobile' },
    { id: 'coinbase', name: 'Coinbase', icon: '🔵', desc: 'Smart Wallet' },
    { id: 'trust', name: 'Trust Wallet', icon: '🛡️', desc: 'Mobile Wallet' },
    { id: 'rainbow', name: 'Rainbow', icon: '🌈', desc: 'Multi-chain' },
    { id: 'phantom', name: 'Phantom', icon: '👻', desc: 'Solana & EVM' },
  ];
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-md rounded-3xl border border-white/10 bg-gray-950/90 backdrop-blur-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Connect Wallet</h3>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 transition">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {wallets.map(w => (
                <button key={w.id} onClick={() => onConnect(w.id)} className="group flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-violet-500/30 transition-all duration-300">
                  <span className="text-3xl group-hover:scale-110 transition-transform">{w.icon}</span>
                  <span className="text-sm font-medium text-white">{w.name}</span>
                  <span className="text-[10px] text-gray-500">{w.desc}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Main App ───
export default function App() {
  const { wallet, connecting, connect, disconnect, chains } = useWallet();
  const [coins, setCoins] = useState<Coin[]>(INITIAL_COINS);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: timeNow(), msg: 'Sea Chef Labs initialized', type: 'system' },
    { time: timeNow(), msg: `Connecting to ${ALL_SOURCES.length} data sources...`, type: 'data' },
    { time: timeNow(), msg: `${ALL_SOURCES.filter(s => s.status === 'live').length} sources online`, type: 'data' },
    { time: timeNow(), msg: 'AI scanning 68 tokens across all venues...', type: 'ai' },
    { time: timeNow(), msg: '10 Bluechips loaded (BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOT, POL, LTC)', type: 'ai' },
  ]);
  const [showConnect, setShowConnect] = useState(false);
  const [toast, setToast] = useState('');
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<'sources' | 'chains' | 'whales' | 'agents' | 'tg' | 'watch'>('sources');
  const [mevProtection, setMevProtection] = useState(true);
  const [watchWallets, setWatchWallets] = useState<WatchWallet[]>([]);
  const [currency, setCurrency] = useState<'USD' | 'AUD'>('AUD');
  const [apiStatus, setApiStatus] = useState<'checking' | 'live' | 'offline'>('checking');
  const [audRate, setAudRate] = useState(1.529); // Default AUD for Australian user
  
  // Live AUD/USD exchange rate (fetched from CoinGecko API)
  const convertPrice = useCallback((usdPrice: number) => {
    return currency === 'AUD' ? usdPrice * audRate : usdPrice;
  }, [currency, audRate]);
  
  const currencySymbol = currency === 'AUD' ? 'A$' : 'US$';

  const addWatchWallet = (wallet: WatchWallet) => {
    setWatchWallets(prev => [...prev, wallet]);
    addLog(`Added watch wallet: ${wallet.label} (${wallet.chain})`, 'wallet');
    showToast(`Added ${wallet.label}! 👁️`);
  };

  const removeWatchWallet = (address: string) => {
    const wallet = watchWallets.find(w => w.address === address);
    setWatchWallets(prev => prev.filter(w => w.address !== address));
    if (wallet) {
      addLog(`Removed watch wallet: ${wallet.label}`, 'wallet');
      showToast(`Removed ${wallet.label}`);
    }
  };

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'system') => {
    setLogs(prev => [...prev.slice(-30), { time: timeNow(), msg, type }]);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const top3 = coins.filter(c => !c.researching).sort((a, b) => b.score - a.score).slice(0, 3);
  const researchingCoins = coins.filter(c => c.researching).length;
  const bottomTickerCoins = coins.filter(c => !top3.includes(c));

  // Check API status on mount
  useEffect(() => {
    const checkApi = async () => {
      const isLive = await checkAPIStatus();
      setApiStatus(isLive ? 'live' : 'offline');
      if (isLive) {
        addLog('🌐 CoinGecko API connected - LIVE prices active', 'data');
      } else {
        addLog('⚠️ CoinGecko API offline - using simulated prices', 'data');
      }
    };
    checkApi();
  }, []);

  // Fetch AUD exchange rate
  useEffect(() => {
    const fetchRate = async () => {
      const rate = await fetchAUDRate();
      setAudRate(rate);
    };
    fetchRate();
    const interval = setInterval(fetchRate, 300000); // Every 5 minutes
    return () => clearInterval(interval);
  }, []);

  // Fetch LIVE prices from CoinGecko every 30 seconds
  useEffect(() => {
    const fetchPrices = async () => {
      if (apiStatus !== 'live') return;
      
      const symbols = coins.map(c => c.symbol);
      const livePrices = await fetchLivePrices(symbols);
      
      if (livePrices.size > 0) {
        setCoins(prev => prev.map(c => {
          const live = livePrices.get(c.symbol);
          if (live) {
            return {
              ...c,
              price: live.price,
              change24h: live.change24h,
              volume: live.volume24h,
              lastUpdated: Date.now(),
            };
          }
          return c;
        }));
        setLastUpdate(new Date());
        addLog(`📊 Updated ${livePrices.size} prices from CoinGecko`, 'data');
      }
    };

    // Initial fetch
    fetchPrices();
    
    // Fetch every 30 seconds
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, [apiStatus]);

  // Simulated price updates (only when API is offline)
  useEffect(() => {
    if (apiStatus === 'live') return; // Don't simulate if API is live
    
    const interval = setInterval(() => {
      setCoins(prev => prev.map(c => {
        const priceDelta = (Math.random() - 0.5) * 0.003;
        const liqDelta = (Math.random() - 0.5) * 0.02;
        const newLiq = Math.max(1000000, c.liquidity * (1 + liqDelta));
        const newScore = Math.max(20, Math.min(99, c.score + (Math.random() - 0.5) * 0.5));
        return {
          ...c,
          price: c.price * (1 + priceDelta),
          change1h: c.change1h + (Math.random() - 0.5) * 0.05,
          score: newScore,
          liquidity: newLiq,
          liquidityScore: Math.min(100, (newLiq / 5e8) * 100),
          lastUpdated: Date.now(),
          bestVenue: getBestVenue(c.symbol, ALL_SOURCES)[0]?.name || c.bestVenue,
        };
      }));
      setLastUpdate(new Date());
    }, 2000);
    return () => clearInterval(interval);
  }, [apiStatus]);

  // Research progress
  useEffect(() => {
    const interval = setInterval(() => {
      setCoins(prev => prev.map(c => c.researching ? { ...c, researchProgress: Math.min(100, c.researchProgress + Math.random() * 2) } : c));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Complete research
  useEffect(() => {
    const interval = setInterval(() => {
      setCoins(prev => {
        const completed = prev.find(c => c.researching && c.researchProgress >= 100);
        if (completed) {
          addLog(`Research complete: ${completed.symbol} ready for trading`, 'ai');
          return prev.map(c => c.symbol === completed.symbol ? { ...c, researching: false, researchProgress: 100 } : c);
        }
        return prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [addLog]);

  // Simulate data source status changes
  useEffect(() => {
    const interval = setInterval(() => {
      const sources = ALL_SOURCES.length;
      const randomSource = ALL_SOURCES[Math.floor(Math.random() * sources)];
      if (randomSource.status === 'live') {
        addLog(`📡 ${randomSource.name}: ${randomSource.pairs} pairs • ${randomSource.latency}ms`, 'data');
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [addLog]);

  const handleConnect = async (method: string) => {
    setShowConnect(false);
    addLog(`Connecting via ${method}...`, 'wallet');
    await connect();
    addLog(`Wallet connected via ${method}`, 'wallet');
    showToast('Wallet connected! ✨');
  };

  const handleBuy = (coin: Coin) => {
    if (!wallet.connected) { setShowConnect(true); return; }
    const spend = 0.01;
    const qty = (spend * 2500) / coin.price;
    setHoldings(prev => {
      const existing = prev.find(h => h.symbol === coin.symbol);
      if (existing) return prev.map(h => h.symbol === coin.symbol ? { ...h, qty: h.qty + qty, avg: (h.avg * h.qty + coin.price * qty) / (h.qty + qty) } : h);
      return [...prev, { symbol: coin.symbol, qty, avg: coin.price }];
    });
    addLog(`BUY ${coin.symbol} @ $${coin.price.toFixed(2)} via ${coin.bestVenue}`, 'trade');
    showToast(`Bought ${coin.symbol} via ${coin.bestVenue}! 🚀`);
  };

  const handleSell = (coin: Coin) => {
    const holding = holdings.find(h => h.symbol === coin.symbol);
    if (!holding) return;
    const pnl = ((coin.price - holding.avg) / holding.avg) * 100;
    setHoldings(prev => prev.filter(h => h.symbol !== coin.symbol));
    addLog(`SELL ${coin.symbol} @ $${coin.price.toFixed(2)} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}% P&L)`, 'trade');
    showToast(`Sold ${coin.symbol}! ${pnl >= 0 ? '📈' : '📉'}`);
    setTimeout(() => {
      setCoins(prev => {
        const nextReady = prev.filter(c => !c.researching && !top3.find(t => t.symbol === c.symbol) && c.symbol !== coin.symbol).sort((a, b) => b.score - a.score)[0];
        if (nextReady) addLog(`${nextReady.symbol} promoted to Top 3 (score: ${nextReady.score.toFixed(1)})`, 'ai');
        const notResearching = prev.filter(c => !c.researching && !top3.find(t => t.symbol === c.symbol) && c.symbol !== coin.symbol && c.symbol !== nextReady?.symbol);
        if (notResearching.length > 0) {
          const toResearch = notResearching[Math.floor(Math.random() * notResearching.length)];
          addLog(`Started researching ${toResearch.symbol}...`, 'ai');
          return prev.map(c => c.symbol === toResearch.symbol ? { ...c, researching: true, researchProgress: 0 } : c);
        }
        return prev;
      });
    }, 1000);
  };

  const portfolioValue = holdings.reduce((sum, h) => { const coin = coins.find(c => c.symbol === h.symbol); return sum + (coin ? coin.price * h.qty : 0); }, 0);

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white overflow-x-hidden">
      <Starfield />
      <GlowOrb color="rgba(139,92,246,0.08)" size={500} top="-10%" left="-10%" delay={0} />
      <GlowOrb color="rgba(6,182,212,0.06)" size={400} top="30%" left="70%" delay={0.5} />
      <GlowOrb color="rgba(236,72,153,0.05)" size={350} top="70%" left="20%" delay={1} />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95 }} className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl border border-violet-500/30 bg-gray-950/80 backdrop-blur-xl shadow-2xl shadow-violet-500/10">
            <span className="text-sm text-violet-200 font-medium">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <ConnectModal open={showConnect} onClose={() => setShowConnect(false)} onConnect={handleConnect} />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 flex items-center justify-center text-xl shadow-lg shadow-violet-500/20">🧑‍🍳</div>
              <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full border-2 border-[#0a0a12] animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">Sea Chef Labs</h1>
              <p className="text-xs text-gray-500 font-mono">2026 AI Trading • {ALL_SOURCES.length} Sources • {CHAINS.length} Chains • MEV Protected</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full ${apiStatus === 'live' ? 'bg-emerald-400 animate-pulse' : apiStatus === 'checking' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'}`} />
                <span className={`text-[10px] font-mono ${apiStatus === 'live' ? 'text-emerald-400' : apiStatus === 'checking' ? 'text-amber-400' : 'text-rose-400'}`}>
                  {apiStatus === 'live' ? '🌐 LIVE Prices from CoinGecko' : apiStatus === 'checking' ? '⏳ Connecting to API...' : '⚠️ Simulated Prices'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Currency Toggle */}
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <button
                onClick={() => setCurrency('USD')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                  currency === 'USD' 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                US$
              </button>
              <button
                onClick={() => setCurrency('AUD')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${
                  currency === 'AUD' 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                A$
              </button>
            </div>
            <button
              onClick={() => {
                const html = document.documentElement.outerHTML;
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'sea-chef-labs.html';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                addLog('📥 Downloaded sea-chef-labs.html to your Downloads folder!', 'system');
                showToast('Downloaded! Check your Downloads folder 📥');
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white text-sm font-semibold transition-all hover:shadow-lg hover:shadow-emerald-500/30 active:scale-95"
            >
              📥 Download App
            </button>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-gray-400 font-mono">{lastUpdate.toLocaleTimeString()}</span>
            </div>
            {wallet.connected ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:block px-3 py-1.5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="text-xs font-mono text-violet-300">{chains[wallet.chainId]?.name || 'Unknown'}</span>
                </div>
                <button onClick={disconnect} className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 hover:bg-white/[0.06] transition-all duration-300">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-mono text-gray-300">{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span>
                </button>
              </div>
            ) : (
              <button onClick={() => setShowConnect(true)} disabled={connecting} className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-sm font-semibold transition-all duration-300 hover:shadow-lg hover:shadow-violet-500/20 active:scale-95">
                {connecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </motion.header>

        {/* Top 3 AI Picks - HERO SECTION */}
        <GlassCard className="p-6 mb-6 border-2 border-violet-500/30 shadow-2xl shadow-violet-500/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-xl shadow-lg shadow-violet-500/30">🧠</div>
              <div>
                <h2 className="text-lg font-bold text-white">AI Research Picks</h2>
                <p className="text-xs text-gray-400">Continuously analyzed for maximum win potential</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-mono font-bold">LIVE RESEARCH</span>
            </div>
          </div>
          
          {/* Research Criteria */}
          <div className="mb-5 p-3 rounded-xl bg-gradient-to-r from-violet-500/5 to-cyan-500/5 border border-violet-500/20">
            <div className="text-xs text-gray-400 mb-2 font-semibold">🔬 Research Criteria:</div>
            <div className="flex flex-wrap gap-2">
              <span className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">💧 High Liquidity</span>
              <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">🔥 Hype & Momentum</span>
              <span className="text-[10px] px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">📊 Volume Analysis</span>
              <span className="text-[10px] px-2 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400">⚡ Price Action</span>
              <span className="text-[10px] px-2 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400">🎯 Win Probability</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {top3.map((coin, i) => {
              const holding = holdings.find(h => h.symbol === coin.symbol);
              return <CoinCard key={coin.symbol} coin={coin} rank={i + 1} onBuy={() => handleBuy(coin)} onSell={holding ? () => handleSell(coin) : undefined} convertPrice={convertPrice} currencySymbol={currencySymbol} />;
            })}
          </div>
        </GlassCard>

        {/* Portfolio Summary */}
        {holdings.length > 0 && (
          <GlassCard className="p-6 mb-6" delay={0.1}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">💼</div>
                <div>
                  <h2 className="font-semibold text-white">Your Portfolio</h2>
                  <p className="text-xs text-gray-500">{holdings.length} positions</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white font-mono">{currencySymbol}{formatNum(convertPrice(portfolioValue))}</div>
                <div className="text-xs text-emerald-400">▲ +12.4% 24h</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {holdings.map(h => {
                const coin = coins.find(c => c.symbol === h.symbol);
                const value = coin ? coin.price * h.qty : 0;
                const pnl = coin ? ((coin.price - h.avg) / h.avg) * 100 : 0;
                return (
                  <div key={h.symbol} className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{coin?.icon}</span>
                      <span className="text-sm font-semibold text-white">{h.symbol}</span>
                    </div>
                    <div className="text-xs text-gray-500 font-mono mb-1">{h.qty.toFixed(4)}</div>
                    <div className="text-sm font-mono text-white">{currencySymbol}{formatNum(convertPrice(value), 2)}</div>
                    <div className={`text-xs font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        )}

        {/* MEV Protection Toggle */}
        <div className="mb-6">
          <MEVProtectionToggle enabled={mevProtection} onToggle={() => setMevProtection(!mevProtection)} />
        </div>

        {/* Data Sources, Chains, Whales, Agents, Telegram */}
        <div className="mb-6">
          <div className="flex gap-2 mb-4 p-1.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] w-fit overflow-x-auto">
            <button onClick={() => setActiveTab('sources')} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 whitespace-nowrap ${activeTab === 'sources' ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              📡 Sources ({ALL_SOURCES.length})
            </button>
            <button onClick={() => setActiveTab('chains')} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 whitespace-nowrap ${activeTab === 'chains' ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              🌐 Chains ({CHAINS.length})
            </button>
            <button onClick={() => setActiveTab('whales')} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 whitespace-nowrap ${activeTab === 'whales' ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              🐋 Whales
            </button>
            <button onClick={() => setActiveTab('agents')} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 whitespace-nowrap ${activeTab === 'agents' ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              🤖 AI Agents
            </button>
            <button onClick={() => setActiveTab('tg')} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 whitespace-nowrap ${activeTab === 'tg' ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              💬 TG Bots
            </button>
            <button onClick={() => setActiveTab('watch')} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all duration-300 whitespace-nowrap ${activeTab === 'watch' ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              👁️ Watch Wallets ({watchWallets.length})
            </button>
          </div>
          {activeTab === 'sources' && <DataSourcesPanel sources={ALL_SOURCES} />}
          {activeTab === 'chains' && <ChainsPanel />}
          {activeTab === 'whales' && <SmartMoneyPanel />}
          {activeTab === 'agents' && <AIAgentPanel />}
          {activeTab === 'tg' && <TelegramBotsPanel />}
          {activeTab === 'watch' && <WatchOnlyWallets wallets={watchWallets} onAdd={addWatchWallet} onRemove={removeWatchWallet} convertPrice={convertPrice} currencySymbol={currencySymbol} />}
        </div>

        {/* Bottom Research Ticker */}
        <BottomTicker coins={bottomTickerCoins} onBuy={handleBuy} researchingCoins={researchingCoins} />

        {/* Activity Log + Stats */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">📋</div>
                <div>
                  <h3 className="font-semibold text-white text-sm">Activity Log</h3>
                  <p className="text-xs text-gray-500">Real-time events from all sources</p>
                </div>
              </div>
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                <AnimatePresence>
                  {logs.map((log, i) => (
                    <motion.div key={`${log.time}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2 py-1.5 px-3 rounded-xl hover:bg-white/[0.02] transition">
                      <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap mt-0.5">{log.time}</span>
                      <span className={`text-xs ${log.type === 'ai' ? 'text-emerald-400/80' : log.type === 'trade' ? 'text-cyan-400/80' : log.type === 'wallet' ? 'text-violet-400/80' : log.type === 'data' ? 'text-amber-400/80' : 'text-gray-500'}`}>{log.msg}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </GlassCard>
          </div>
          <div className="lg:col-span-1">
            <GlassCard className="p-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-3 text-center">
                  <div className="text-lg font-bold text-white font-mono">{coins.length}</div>
                  <div className="text-[10px] text-gray-500">Total Tokens</div>
                </div>
                <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                  <div className="text-lg font-bold text-amber-400 font-mono">{researchingCoins}</div>
                  <div className="text-[10px] text-amber-400/70">Researching</div>
                </div>
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                  <div className="text-lg font-bold text-emerald-400 font-mono">{ALL_SOURCES.filter(s => s.status === 'live').length}</div>
                  <div className="text-[10px] text-emerald-400/70">Live Sources</div>
                </div>
                <div className="rounded-2xl bg-violet-500/10 border border-violet-500/20 p-3 text-center">
                  <div className="text-lg font-bold text-violet-400 font-mono">{CHAINS.length}</div>
                  <div className="text-[10px] text-violet-400/70">Chains</div>
                </div>
                <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/20 p-3 text-center">
                  <div className="text-lg font-bold text-cyan-400 font-mono">10</div>
                  <div className="text-[10px] text-cyan-400/70">Bluechips</div>
                </div>
                <div className="rounded-2xl bg-pink-500/10 border border-pink-500/20 p-3 text-center">
                  <div className="text-lg font-bold text-pink-400 font-mono">{watchWallets.length}</div>
                  <div className="text-[10px] text-pink-400/70">Watch Wallets</div>
                </div>
              </div>
            </GlassCard>
          </div>
        </div>

        {/* BIG DOWNLOAD BUTTON */}
        <div className="mb-8 p-6 rounded-3xl bg-gradient-to-r from-emerald-500/20 via-cyan-500/20 to-violet-500/20 border-2 border-emerald-500/40 text-center">
          <div className="text-3xl mb-2">📥</div>
          <h3 className="text-xl font-bold text-white mb-2">Download Sea Chef Labs</h3>
          <p className="text-sm text-gray-300 mb-4">Click the button below to download the app to your computer</p>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
              const encoded = encodeURIComponent(html);
              const dataUri = 'data:text/html;charset=utf-8,' + encoded;
              const a = document.createElement('a');
              a.href = dataUri;
              a.download = 'sea-chef-labs.html';
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => document.body.removeChild(a), 100);
              addLog('📥 Downloading sea-chef-labs.html...', 'system');
              showToast('✅ Check your Downloads folder!');
            }}
            className="inline-block px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white text-lg font-bold transition-all hover:shadow-2xl hover:shadow-emerald-500/50 active:scale-95 shadow-lg cursor-pointer"
          >
            📥 Download App Now
          </a>
          <p className="text-xs text-gray-500 mt-3">File saves to your Downloads folder • Double-click to open in Edge</p>
        </div>

        <footer className="mt-12 pt-6 border-t border-white/[0.04] text-center">
          <p className="text-xs text-gray-600 font-mono">
            Sea Chef Labs • {coins.length} Tokens • {ALL_SOURCES.length} Sources • {CHAINS.length} Chains • 👁️ Watch Wallets
          </p>
          <p className="text-[10px] text-gray-700 mt-1">
            💎 10 Bluechips • 🦄 Uniswap V4 • 🍌 Banana Gun • 🐋 Whale Alerts • 🤖 AI Agents • 🛡️ MEV Protected
          </p>
          <p className="text-[10px] text-gray-700 mt-1">⚠️ Demo mode — connect a real wallet for live trading</p>
        </footer>
      </div>
    </div>
  );
}
