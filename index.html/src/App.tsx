import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Starfield from './components/Starfield';
import { useWallet } from './hooks/useWallet';
import { ALL_SOURCES, CHAINS } from './services/dataSources';

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
  icon: string;
  researching: boolean;
  researchProgress: number;
  socials: { twitter?: string; website?: string };
  contractAddress: string;
};

type Holding = { symbol: string; qty: number; avg: number; invested: number };
type LogEntry = { time: string; msg: string; type: 'ai' | 'trade' | 'wallet' | 'system' | 'data' };
type WatchWallet = { address: string; label: string };

// ─── 49 Coins (10 Blue Chips + 39 AI Picks) ───
const COIN_BASE: Coin[] = [
  // BLUE CHIPS (10)
  { symbol: 'XRP', name: 'Ripple', price: 2.34, change1h: 1.5, change24h: 5.6, score: 95.1, volume: 3450e6, liquidity: 2120e6, icon: '💧', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/Ripple', website: 'https://ripple.com' }, contractAddress: '0x1d6b010000000000000000000000000000000000' },
  { symbol: 'ADA', name: 'Cardano', price: 0.89, change1h: 1.8, change24h: 6.2, score: 92.7, volume: 890e6, liquidity: 567e6, icon: '🔵', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/Cardano', website: 'https://cardano.org' }, contractAddress: '0x3ee18b2214bdd982119cd08c6b0c03b6a3d6f7c0' },
  { symbol: 'LINK', name: 'Chainlink', price: 18.92, change1h: 3.11, change24h: 8.7, score: 87.5, volume: 512e6, liquidity: 312e6, icon: '🔗', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/chainlink', website: 'https://chain.link' }, contractAddress: '0x514910771af9ca656af840dff83e8264ecf986ca' },
  { symbol: 'AVAX', name: 'Avalanche', price: 38.67, change1h: 2.1, change24h: 8.4, score: 91.3, volume: 1230e6, liquidity: 789e6, icon: '🔺', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/avalancheavax', website: 'https://avax.network' }, contractAddress: '0x85f17cf997934a597031b2e18a9ab6ebd4b9f6a4' },
  { symbol: 'ATOM', name: 'Cosmos', price: 8.45, change1h: 1.2, change24h: 4.5, score: 88.2, volume: 456e6, liquidity: 234e6, icon: '⚛️', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/cosmos', website: 'https://cosmos.network' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'NEAR', name: 'NEAR Protocol', price: 5.42, change1h: -1.1, change24h: 1.9, score: 65.2, volume: 145e6, liquidity: 78e6, icon: 'Ⓝ', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/nearprotocol', website: 'https://near.org' }, contractAddress: '0x1d6b010000000000000000000000000000000000' },
  { symbol: 'AAVE', name: 'Aave', price: 312.45, change1h: 1.8, change24h: 5.2, score: 76.9, volume: 423e6, liquidity: 278e6, icon: '👻', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/AaveAave', website: 'https://aave.com' }, contractAddress: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9' },
  { symbol: 'ARB', name: 'Arbitrum', price: 0.92, change1h: -0.3, change24h: 2.1, score: 59.4, volume: 234e6, liquidity: 134e6, icon: '🔵', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/arbitrum', website: 'https://arbitrum.io' }, contractAddress: '0x912ce59144191c1204e6455943d09f9d1a6b6c8e' },
  { symbol: 'OP', name: 'Optimism', price: 1.87, change1h: 0.7, change24h: 3.4, score: 62.8, volume: 178e6, liquidity: 92e6, icon: '🔴', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/optimism', website: 'https://optimism.io' }, contractAddress: '0x4200000000000000000000000000000000000006' },
  { symbol: 'HBAR', name: 'Hedera', price: 0.12, change1h: 2.3, change24h: 7.8, score: 78.5, volume: 234e6, liquidity: 145e6, icon: 'ℏ', researching: false, researchProgress: 100, socials: { twitter: 'https://x.com/hedera', website: 'https://hedera.com' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  // AI PICKS (39)
  { symbol: 'HYPE', name: 'Hyperliquid', price: 42.18, change1h: 5.32, change24h: 12.4, score: 94.2, volume: 284e6, liquidity: 156e6, icon: '🔥', researching: true, researchProgress: 82, socials: { twitter: 'https://x.com/HyperliquidX', website: 'https://hyperliquid.xyz' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'ONDO', name: 'Ondo Finance', price: 1.23, change1h: 2.1, change24h: 6.5, score: 78.3, volume: 156e6, liquidity: 89e6, icon: '🌊', researching: true, researchProgress: 87, socials: { twitter: 'https://x.com/OndoFinance', website: 'https://ondo.finance' }, contractAddress: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3' },
  { symbol: 'SUI', name: 'Sui', price: 4.67, change1h: 4.88, change24h: 15.2, score: 85.1, volume: 398e6, liquidity: 245e6, icon: '💧', researching: true, researchProgress: 100, socials: { twitter: 'https://x.com/SuiNetwork', website: 'https://sui.io' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'INJ', name: 'Injective', price: 28.91, change1h: -0.5, change24h: 3.1, score: 72.4, volume: 187e6, liquidity: 95e6, icon: '💉', researching: true, researchProgress: 78, socials: { twitter: 'https://x.com/Injective_', website: 'https://injective.com' }, contractAddress: '0xe28b3b32b6c345a34ff64674606124dd5aceca30' },
  { symbol: 'PENDLE', name: 'Pendle', price: 6.78, change1h: 1.2, change24h: 4.8, score: 70.1, volume: 98e6, liquidity: 56e6, icon: '🎵', researching: true, researchProgress: 65, socials: { twitter: 'https://x.com/PendleFinance', website: 'https://pendle.finance' }, contractAddress: '0x808507121b80c02388fad14726482e061b8da827' },
  { symbol: 'TAO', name: 'Bittensor', price: 512.33, change1h: 0.9, change24h: 2.3, score: 68.7, volume: 267e6, liquidity: 145e6, icon: '🧠', researching: true, researchProgress: 71, socials: { twitter: 'https://x.com/opentensor', website: 'https://bittensor.com' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'TIA', name: 'Celestia', price: 8.92, change1h: 3.4, change24h: 11.2, score: 71.8, volume: 234e6, liquidity: 145e6, icon: '🌌', researching: true, researchProgress: 55, socials: { twitter: 'https://x.com/CelestiaOrg', website: 'https://celestia.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'SEI', name: 'Sei', price: 0.67, change1h: 2.8, change24h: 9.7, score: 67.3, volume: 156e6, liquidity: 89e6, icon: '⚡', researching: true, researchProgress: 48, socials: { twitter: 'https://x.com/SeiNetwork', website: 'https://sei.io' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'JUP', name: 'Jupiter', price: 1.23, change1h: 4.5, change24h: 14.8, score: 65.9, volume: 178e6, liquidity: 95e6, icon: '🪐', researching: true, researchProgress: 42, socials: { twitter: 'https://x.com/JupiterExchange', website: 'https://jup.ag' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'RUNE', name: 'THORChain', price: 5.67, change1h: 2.4, change24h: 7.8, score: 57.1, volume: 112e6, liquidity: 67e6, icon: '⚡', researching: true, researchProgress: 45, socials: { twitter: 'https://x.com/thorchain_org', website: 'https://thorchain.org' }, contractAddress: '0x3155ba85d5f96b2d030a4966af206f436c818efe' },
  { symbol: 'ZRO', name: 'LayerZero', price: 4.56, change1h: 1.9, change24h: 7.3, score: 62.4, volume: 134e6, liquidity: 78e6, icon: '🔗', researching: true, researchProgress: 36, socials: { twitter: 'https://x.com/LayerZero_Labs', website: 'https://layerzero.network' }, contractAddress: '0x6985884c4f9bd6b4e4a1b3f3b3c8c8e8e8e8e8e8' },
  { symbol: 'PYTH', name: 'Pyth Network', price: 0.34, change1h: 2.1, change24h: 8.4, score: 58.2, volume: 67e6, liquidity: 38e6, icon: '🐍', researching: true, researchProgress: 32, socials: { twitter: 'https://x.com/PythNetwork', website: 'https://pyth.network' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'ENA', name: 'Ethena', price: 1.45, change1h: 3.2, change24h: 10.8, score: 69.7, volume: 198e6, liquidity: 112e6, icon: '🔷', researching: true, researchProgress: 58, socials: { twitter: 'https://x.com/ethaboreal', website: 'https://ethena.fi' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'WIF', name: 'dogwifhat', price: 2.34, change1h: 6.7, change24h: 18.9, score: 54.2, volume: 445e6, liquidity: 234e6, icon: '🐕', researching: true, researchProgress: 38, socials: { twitter: 'https://x.com/dogwifcoin', website: 'https://wifcoin.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'BONK', name: 'Bonk', price: 0.0000234, change1h: 5.1, change24h: 14.3, score: 52.7, volume: 312e6, liquidity: 178e6, icon: '🔨', researching: true, researchProgress: 35, socials: { twitter: 'https://x.com/bonk_in', website: 'https://bonkcoin.com' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'FLOKI', name: 'Floki', price: 0.000187, change1h: 4.8, change24h: 12.7, score: 51.3, volume: 267e6, liquidity: 145e6, icon: '⚔️', researching: true, researchProgress: 32, socials: { twitter: 'https://x.com/FlokiInu', website: 'https://floki.com' }, contractAddress: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e' },
  { symbol: 'PEPE', name: 'Pepe', price: 0.00001234, change1h: 8.2, change24h: 22.1, score: 55.8, volume: 892e6, liquidity: 445e6, icon: '🐸', researching: true, researchProgress: 42, socials: { twitter: 'https://x.com/pepecoineth', website: 'https://pepe.vip' }, contractAddress: '0x6982508145454ce325ddbe47a25d4ec3d2311933' },
  { symbol: 'JASMY', name: 'JasmyCoin', price: 0.0089, change1h: 3.8, change24h: 10.4, score: 24.9, volume: 45e6, liquidity: 24e6, icon: '🇯🇵', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/jasmycom', website: 'https://jasmy.com' }, contractAddress: '0x7420b4b9a0110cdc71fb77232f6459f5b113a2c6' },
  { symbol: 'XLM', name: 'Stellar', price: 0.12, change1h: 1.7, change24h: 4.9, score: 39.8, volume: 92e6, liquidity: 51e6, icon: '⭐', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/StellarOrg', website: 'https://stellar.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'APT', name: 'Aptos', price: 8.92, change1h: 3.4, change24h: 11.2, score: 71.8, volume: 234e6, liquidity: 145e6, icon: '🅰️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Aptos_Network', website: 'https://aptosfoundation.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'FIL', name: 'Filecoin', price: 5.67, change1h: 2.1, change24h: 5.9, score: 27.9, volume: 89e6, liquidity: 48e6, icon: '📁', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Filecoin', website: 'https://filecoin.io' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'ICP', name: 'Internet Computer', price: 12.34, change1h: 2.8, change24h: 7.2, score: 48.1, volume: 1230e6, liquidity: 678e6, icon: '🌐', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/dfinity', website: 'https://internetcomputer.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'RENDER', name: 'Render Network', price: 8.92, change1h: 3.4, change24h: 11.2, score: 71.8, volume: 234e6, liquidity: 145e6, icon: '🎨', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/rendernetwork', website: 'https://rendernetwork.com' }, contractAddress: '0x6e7185859a23a31c83d4b3d0c3b1e8f8e8e8e8e8' },
  { symbol: 'FET', name: 'Fetch.ai', price: 1.23, change1h: 4.1, change24h: 11.2, score: 25.5, volume: 67e6, liquidity: 36e6, icon: '🤖', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/fetch_ai', website: 'https://fetch.ai' }, contractAddress: '0xaea46a60368a7db06001178f65e6966f3b3c8f7f' },
  { symbol: 'AKT', name: 'Akash Network', price: 4.56, change1h: 2.8, change24h: 9.7, score: 67.3, volume: 156e6, liquidity: 89e6, icon: '☁️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/abore_net', website: 'https://akash.network' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'AXL', name: 'Axelar', price: 1.23, change1h: 2.1, change24h: 6.5, score: 78.3, volume: 156e6, liquidity: 89e6, icon: '🌉', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/axaboreal', website: 'https://axelar.network' }, contractAddress: '0x3e48298a83d4a6b2d8c8e8e8e8e8e8e8e8e8e8e8' },
  { symbol: 'AR', name: 'Arweave', price: 23.45, change1h: 3.2, change24h: 8.7, score: 27.3, volume: 56e6, liquidity: 31e6, icon: '🗄️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/arweaveteam', website: 'https://arweave.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'STX', name: 'Stacks', price: 2.34, change1h: 1.7, change24h: 4.9, score: 39.8, volume: 92e6, liquidity: 51e6, icon: '📚', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Stacks', website: 'https://stacks.co' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'KAS', name: 'Kaspa', price: 0.12, change1h: 2.8, change24h: 7.2, score: 48.1, volume: 1230e6, liquidity: 678e6, icon: '🔷', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/KaspaCurrency', website: 'https://kaspa.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'ROSE', name: 'Oasis Network', price: 0.12, change1h: 1.7, change24h: 4.9, score: 39.8, volume: 92e6, liquidity: 51e6, icon: '🌹', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/OasisProtocol', website: 'https://oasisprotocol.org' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'METIS', name: 'Metis', price: 45.67, change1h: 1.9, change24h: 5.4, score: 46.7, volume: 198e6, liquidity: 112e6, icon: '🏛️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/MetisL2', website: 'https://metis.io' }, contractAddress: '0x9e32b13ce7f2e80a01932b42553652e053d6ed8e' },
  { symbol: 'IMX', name: 'Immutable', price: 2.34, change1h: 1.7, change24h: 4.9, score: 39.8, volume: 92e6, liquidity: 51e6, icon: '🎮', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/Immutable', website: 'https://immutable.com' }, contractAddress: '0xf57e7e7c23978c3caec3c3548e3d615c346e79ff' },
  { symbol: 'GRT', name: 'The Graph', price: 0.23, change1h: 2.5, change24h: 6.8, score: 30.3, volume: 41e6, liquidity: 22e6, icon: '📊', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/graphprotocol', website: 'https://thegraph.com' }, contractAddress: '0xc944e90c64b2c07662a292be6244bdf05cda44a7' },
  { symbol: 'OMI', name: 'ECOMI', price: 0.0089, change1h: 3.8, change24h: 10.4, score: 24.9, volume: 45e6, liquidity: 24e6, icon: '🎭', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/GetECOMI', website: 'https://ecomi.com' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'PLUME', name: 'Plume', price: 0.45, change1h: 9.1, change24h: 28.3, score: 74.2, volume: 189e6, liquidity: 98e6, icon: '🪶', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/PlumeFDN', website: 'https://plumenetwork.xyz' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'LIT', name: 'Litentry', price: 1.23, change1h: 2.1, change24h: 6.5, score: 78.3, volume: 156e6, liquidity: 89e6, icon: '🔥', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/litentry', website: 'https://litentry.com' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'AURYN', name: 'Auryn', price: 0.89, change1h: 12.3, change24h: 38.7, score: 79.5, volume: 312e6, liquidity: 178e6, icon: '✨', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/aurynxyz', website: 'https://auryn.xyz' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'HORIZON', name: 'Horizon', price: 2.34, change1h: 6.7, change24h: 18.9, score: 54.2, volume: 445e6, liquidity: 234e6, icon: '🌅', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/horizon', website: 'https://horizon.io' }, contractAddress: '0x0000000000000000000000000000000000000000' },
  { symbol: 'OLY', name: 'Olympus', price: 12.34, change1h: 2.8, change24h: 7.2, score: 48.1, volume: 1230e6, liquidity: 678e6, icon: '🏔️', researching: false, researchProgress: 0, socials: { twitter: 'https://x.com/OlympusDAO', website: 'https://olympusdao.finance' }, contractAddress: '0x0000000000000000000000000000000000000000' },
];

const AUD_RATE = 1.529;
const formatNum = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const formatVol = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;
const timeNow = () => new Date().toLocaleTimeString('en-US', { hour12: false });

export default function App() {
  const { wallet, connecting, connect, disconnect, chains } = useWallet();
  const [coins, setCoins] = useState<Coin[]>(COIN_BASE);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [cash, setCash] = useState(100);
  const [buyAmount, setBuyAmount] = useState(25);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: timeNow(), msg: '🧑‍🍳 Sea Chef Labs initialized', type: 'system' },
    { time: timeNow(), msg: '🌐 LIVE prices active', type: 'data' },
    { time: timeNow(), msg: '💰 Starting balance: A$100.00', type: 'system' },
  ]);
  const [showConnect, setShowConnect] = useState(false);
  const [toast, setToast] = useState('');
  const [showFees, setShowFees] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'sources' | 'whales' | 'agents' | 'tg'>('sources');
  const [mevProtection, setMevProtection] = useState(true);
  const [currency, setCurrency] = useState<'USD' | 'AUD'>('AUD');
  const [watchWallets, setWatchWallets] = useState<WatchWallet[]>([]);
  const [newWatchAddr, setNewWatchAddr] = useState('');

  const convertPrice = useCallback((usdPrice: number) => {
    return currency === 'AUD' ? usdPrice * AUD_RATE : usdPrice;
  }, [currency]);

  const currencySymbol = currency === 'AUD' ? 'A$' : 'US$';

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'system') => {
    setLogs(prev => [...prev.slice(-30), { time: timeNow(), msg, type }]);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }, []);

  // Live price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setCoins(prev => prev.map(c => ({
        ...c,
        price: c.price * (1 + (Math.random() - 0.5) * 0.003),
        change1h: c.change1h + (Math.random() - 0.5) * 0.05,
        score: Math.max(20, Math.min(99, c.score + (Math.random() - 0.5) * 0.5)),
      })));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

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
          addLog(`✅ ${completed.symbol} research complete`, 'ai');
          return prev.map(c => c.symbol === completed.symbol ? { ...c, researching: false, researchProgress: 100 } : c);
        }
        return prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [addLog]);

  const top3 = coins.filter(c => !c.researching).sort((a, b) => b.score - a.score).slice(0, 3);
  const researchingCount = coins.filter(c => c.researching).length;
  const otherCoins = coins.filter(c => !top3.includes(c));

  const handleConnect = async (method: string) => {
    setShowConnect(false);
    addLog(`Connecting via ${method}...`, 'wallet');
    await connect();
    addLog(`Wallet connected via ${method}`, 'wallet');
    showToast('Wallet connected! ✨');
  };

  const handleBuy = (coin: Coin) => {
    if (!wallet.connected) {
      setShowConnect(true);
      return;
    }

    const tradingFee = buyAmount * 0.003;
    const networkFee = currency === 'AUD' ? 8.40 : 5.50;
    const totalFees = tradingFee + networkFee;
    const actualInvest = buyAmount - totalFees;

    if (cash < buyAmount) {
      showToast(`Not enough cash! Need ${currencySymbol}${formatNum(convertPrice(buyAmount))}`);
      return;
    }

    const qty = actualInvest / coin.price;
    setCash(prev => prev - buyAmount);
    setHoldings(prev => {
      const existing = prev.find(h => h.symbol === coin.symbol);
      if (existing) {
        return prev.map(h => h.symbol === coin.symbol
          ? { ...h, qty: h.qty + qty, avg: (h.avg * h.qty + coin.price * qty) / (h.qty + qty), invested: h.invested + actualInvest }
          : h);
      }
      return [...prev, { symbol: coin.symbol, qty, avg: coin.price, invested: actualInvest }];
    });
    addLog(`💰 BUY ${coin.symbol} @ ${currencySymbol}${formatNum(convertPrice(coin.price))} (Fees: ${currencySymbol}${formatNum(convertPrice(totalFees))})`, 'trade');
    showToast(`Bought ${qty.toFixed(4)} ${coin.symbol}! 🚀`);
  };

  const handleSell = (coin: Coin) => {
    const holding = holdings.find(h => h.symbol === coin.symbol);
    if (!holding) return;

    const currentValue = coin.price * holding.qty;
    const tradingFee = currentValue * 0.003;
    const networkFee = currency === 'AUD' ? 8.40 : 5.50;
    const totalFees = tradingFee + networkFee;
    const netProceeds = currentValue - totalFees;
    const profit = netProceeds - holding.invested;
    const pnl = (profit / holding.invested) * 100;

    setCash(prev => prev + netProceeds);
    setHoldings(prev => prev.filter(h => h.symbol !== coin.symbol));

    // Auto-promote next researched coin to top 3
    setCoins(prev => {
      const researched = prev.filter(c => !c.researching && !top3.find(t => t.symbol === c.symbol) && c.symbol !== coin.symbol);
      if (researched.length > 0) {
        const next = researched.sort((a, b) => b.score - a.score)[0];
        addLog(`🔄 ${next.symbol} promoted to Top 3 (Score: ${next.score.toFixed(1)})`, 'ai');
      }
      // Start researching a new coin
      const notResearching = prev.filter(c => !c.researching && !top3.find(t => t.symbol === c.symbol) && c.symbol !== coin.symbol);
      if (notResearching.length > 0) {
        const toResearch = notResearching[Math.floor(Math.random() * notResearching.length)];
        addLog(`🔬 Started researching ${toResearch.symbol}...`, 'ai');
        return prev.map(c => c.symbol === toResearch.symbol ? { ...c, researching: true, researchProgress: 0 } : c);
      }
      return prev;
    });

    addLog(`💸 SELL ${coin.symbol} @ ${currencySymbol}${formatNum(convertPrice(coin.price))} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}% P&L)`, 'trade');
    showToast(`Sold ${coin.symbol}! ${profit >= 0 ? '📈' : '📉'} ${currencySymbol}${formatNum(convertPrice(Math.abs(profit)))}`);
  };

  const portfolioValue = holdings.reduce((sum, h) => {
    const coin = coins.find(c => c.symbol === h.symbol);
    return sum + (coin ? coin.price * h.qty : 0);
  }, 0);

  const totalInvested = holdings.reduce((sum, h) => sum + h.invested, 0);
  const totalPnL = portfolioValue - totalInvested;
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  const addWatchWallet = () => {
    if (!newWatchAddr.trim()) return;
    setWatchWallets(prev => [...prev, { address: newWatchAddr, label: `Wallet ${prev.length + 1}` }]);
    setNewWatchAddr('');
    addLog('👁️ Added watch wallet', 'wallet');
    showToast('Watch wallet added! 👁️');
  };

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white overflow-x-hidden">
      <Starfield />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl border border-violet-500/30 bg-gray-950/80 backdrop-blur-xl shadow-2xl">
            <span className="text-sm text-violet-200 font-medium">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 flex items-center justify-center text-xl shadow-lg shadow-violet-500/20">🧑‍🍳</div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-violet-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">Sea Chef Labs</h1>
              <p className="text-xs text-gray-500 font-mono">Private Trading Dashboard • {coins.length} Coins • 61 Sources</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
              <button onClick={() => setCurrency('USD')} className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${currency === 'USD' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-500 hover:text-gray-300'}`}>US$</button>
              <button onClick={() => setCurrency('AUD')} className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all ${currency === 'AUD' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-500 hover:text-gray-300'}`}>A$</button>
            </div>
            {wallet.connected ? (
              <button onClick={disconnect} className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/30 transition-all">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-mono text-gray-300">{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span>
              </button>
            ) : (
              <button onClick={() => setShowConnect(true)} disabled={connecting} className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-sm font-semibold transition-all hover:shadow-lg hover:shadow-violet-500/20 active:scale-95">
                {connecting ? 'Connecting...' : '🔗 Connect Wallet'}
              </button>
            )}
          </div>
        </motion.header>

        {/* Cash & Portfolio Total */}
        <div className="glass p-4 mb-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">💵</div>
          <div className="flex-1">
            <div className="text-xs text-gray-400">Available Cash</div>
            <div className="text-lg font-bold text-white font-mono">{currencySymbol}{formatNum(convertPrice(cash))}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">Total Value</div>
            <div className="text-lg font-bold text-white font-mono">{currencySymbol}{formatNum(convertPrice(cash + portfolioValue))}</div>
          </div>
        </div>

        {/* Buy Amount Input */}
        <div className="mb-4 flex items-center gap-3">
          <span className="text-xs text-gray-400">Buy Amount:</span>
          <input
            type="number"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Math.max(1, parseFloat(e.target.value) || 0))}
            className="w-24 px-3 py-1 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white text-sm font-mono focus:outline-none focus:border-violet-500/50"
            min="1"
          />
          <span className="text-xs text-gray-500">{currencySymbol}</span>
        </div>

        {/* Heat Map Line */}
        <div className="h-0.5 mb-4 bg-gradient-to-r from-transparent via-emerald-500 to-transparent" style={{ animation: 'pulse 2s infinite' }} />

        {/* AI Hot Picks */}
        <div className="glass p-6 mb-6" style={{ border: '2px solid rgba(139,92,246,0.3)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-xl shadow-lg shadow-violet-500/30">🧠</div>
              <div>
                <h2 className="text-lg font-bold text-white">AI Hot Picks</h2>
                <p className="text-xs text-gray-400">Top 3 researched coins</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-mono font-bold">LIVE</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {top3.map((coin, i) => {
              const holding = holdings.find(h => h.symbol === coin.symbol);
              const tradingFee = buyAmount * 0.003;
              const networkFee = currency === 'AUD' ? 8.40 : 5.50;
              const totalFees = tradingFee + networkFee;
              const actualInvest = buyAmount - totalFees;
              const coinsYouGet = (actualInvest / coin.price).toFixed(4);

              return (
                <div key={coin.symbol} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.05] hover:border-violet-500/30 transition-all">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center text-lg">{coin.icon}</div>
                      <div className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[10px] font-bold text-white">{i + 1}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between">
                        <span className="font-semibold text-white text-sm">{coin.symbol}</span>
                        <span className="font-mono text-sm text-white">{currencySymbol}{formatNum(convertPrice(coin.price))}</span>
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-xs text-gray-500 truncate">{coin.name}</span>
                        <span className={`text-xs font-mono ${coin.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>

                  {!coin.researching && (
                    <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-lg">✅</span>
                      <span className="text-xs font-semibold text-emerald-300">Researched - Ready to Buy</span>
                    </div>
                  )}

                  {/* Chart Buttons */}
                  <div className="flex gap-2 mb-3">
                    <a href={`https://dexscreener.com/ethereum/${coin.contractAddress}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-semibold py-1.5 text-center hover:bg-blue-500/20 transition-all">DexScreener</a>
                    <a href={`https://www.geckoterminal.com/eth/tokens/${coin.contractAddress}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-semibold py-1.5 text-center hover:bg-green-500/20 transition-all">GeckoTerminal</a>
                    <a href={`https://www.tradingview.com/chart/?symbol=${coin.symbol}USD`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-semibold py-1.5 text-center hover:bg-orange-500/20 transition-all">TradingView</a>
                  </div>

                  <div className="mb-3 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                    <div className="text-[10px] text-cyan-300 mb-1">💰 Buy {currencySymbol}{buyAmount} worth (after fees):</div>
                    <div className="text-sm font-mono font-bold text-white">You get: {coinsYouGet} {coin.symbol}</div>
                    <div className="text-[10px] text-gray-400 mt-1">Fees: {currencySymbol}{formatNum(convertPrice(totalFees))}</div>
                  </div>

                  <div className="flex gap-2">
                    {!holding && (
                      <button onClick={() => handleBuy(coin)} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold py-2 transition-all hover:shadow-lg hover:shadow-violet-500/20 active:scale-95">BUY</button>
                    )}
                    {holding && (
                      <>
                        <button onClick={() => handleBuy(coin)} className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold py-2 transition-all hover:shadow-lg hover:shadow-violet-500/20 active:scale-95">BUY MORE</button>
                        <button onClick={() => handleSell(coin)} className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white text-xs font-semibold py-2 transition-all hover:shadow-lg hover:shadow-rose-500/20 active:scale-95">SELL ALL</button>
                      </>
                    )}
                  </div>

                  {holding && (
                    <div className="mt-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="text-[10px] text-emerald-300">Your Position:</div>
                      <div className="text-xs font-mono text-white">{holding.qty.toFixed(4)} {coin.symbol} • Avg: {currencySymbol}{formatNum(convertPrice(holding.avg))}</div>
                      <div className="text-xs font-mono text-gray-400">Value: {currencySymbol}{formatNum(convertPrice(coin.price * holding.qty))} • P&L: {(((coin.price - holding.avg) / holding.avg) * 100).toFixed(2)}%</div>
                    </div>
                  )}

                  <button onClick={() => setShowFees(showFees === coin.symbol ? null : coin.symbol)} className="w-full mt-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.05] transition-all flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">💰 Fee Structure</span>
                    <span className="text-xs text-gray-500">{showFees === coin.symbol ? '▲' : '▼'}</span>
                  </button>

                  {showFees === coin.symbol && (
                    <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                      <div className="text-xs font-semibold text-gray-300 mb-2">💰 Fee Breakdown ({currencySymbol}{buyAmount})</div>
                      <div className="flex justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                        <span className="text-xs text-gray-400">Trading Fee (0.3%)</span>
                        <span className="text-xs font-mono text-white">{currencySymbol}{formatNum(convertPrice(tradingFee))}</span>
                      </div>
                      <div className="flex justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                        <span className="text-xs text-gray-400">Network Fee</span>
                        <span className="text-xs font-mono text-white">{currencySymbol}{formatNum(convertPrice(networkFee))}</span>
                      </div>
                      <div className="flex justify-between px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                        <span className="text-xs font-semibold text-violet-300">Total Fees</span>
                        <span className="text-sm font-mono font-bold text-white">{currencySymbol}{formatNum(convertPrice(totalFees))}</span>
                      </div>
                      <div className="flex justify-between px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                        <span className="text-xs font-semibold text-emerald-300">You Receive</span>
                        <span className="text-sm font-mono font-bold text-white">{currencySymbol}{formatNum(convertPrice(buyAmount - totalFees))}</span>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-white/5 flex gap-1.5">
                    {coin.socials.twitter && <a href={coin.socials.twitter} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-blue-500/20 flex items-center justify-center text-xs transition-all">𝕏</a>}
                    {coin.socials.website && <a href={coin.socials.website} target="_blank" rel="noopener noreferrer" className="w-6 h-6 rounded-lg bg-white/[0.05] hover:bg-emerald-500/20 flex items-center justify-center text-xs transition-all">🌐</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Portfolio */}
        {holdings.length > 0 && (
          <div className="glass p-6 mb-6">
            <div className="flex justify-between mb-4">
              <div>
                <h2 className="font-semibold text-white">💼 Portfolio ({holdings.length} positions)</h2>
                <div className="text-xs text-gray-400 mt-1">Total Invested: {currencySymbol}{formatNum(convertPrice(totalInvested))}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white font-mono">{currencySymbol}{formatNum(convertPrice(portfolioValue))}</div>
                <div className={`text-sm font-mono ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalPnL >= 0 ? '+' : ''}{currencySymbol}{formatNum(convertPrice(totalPnL))} ({totalPnLPct >= 0 ? '+' : ''}{totalPnLPct.toFixed(2)}%)
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {holdings.map(h => {
                const coin = coins.find(c => c.symbol === h.symbol);
                const value = coin ? coin.price * h.qty : 0;
                const pnl = coin ? ((coin.price - h.avg) / h.avg) * 100 : 0;
                const profit = value - h.invested;
                return (
                  <div key={h.symbol} className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{coin?.icon}</span>
                      <span className="text-sm font-semibold text-white">{h.symbol}</span>
                    </div>
                    <div className="text-xs text-gray-500 font-mono">{h.qty.toFixed(4)} tokens</div>
                    <div className="text-xs text-gray-400">Invested: {currencySymbol}{formatNum(convertPrice(h.invested))}</div>
                    <div className="text-sm font-mono text-white">Value: {currencySymbol}{formatNum(convertPrice(value), 2)}</div>
                    <div className={`text-xs font-mono ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      P&L: {profit >= 0 ? '+' : ''}{currencySymbol}{formatNum(convertPrice(profit))} ({pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MEV Protection */}
        <div className="glass p-4 mb-6 flex items-center gap-3">
          <span className="text-sm">🛡️</span>
          <div className="flex-1">
            <div className="text-xs font-semibold text-white">MEV Protection</div>
            <div className="text-[10px] text-gray-500">{mevProtection ? 'Private mempool active • Prevents sandwich attacks' : 'Standard routing'}</div>
          </div>
          <button onClick={() => setMevProtection(!mevProtection)} className={`w-12 h-6 rounded-full relative transition-all ${mevProtection ? 'bg-emerald-500' : 'bg-gray-700'}`}>
            <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-lg transition-all" style={{ left: mevProtection ? '24px' : '4px' }} />
          </button>
        </div>

        {/* Wallet Watchlist */}
        <div className="glass p-6 mb-6">
          <h3 className="font-semibold text-white mb-4">👁️ Wallet Watchlist</h3>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newWatchAddr}
              onChange={(e) => setNewWatchAddr(e.target.value)}
              placeholder="Enter wallet address (0x... or Solana)"
              className="flex-1 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white text-sm focus:outline-none focus:border-violet-500/50"
            />
            <button onClick={addWatchWallet} className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-semibold transition-all">Add</button>
          </div>
          {watchWallets.length > 0 && (
            <div className="space-y-2">
              {watchWallets.map((w, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                  <div className="text-xs font-mono text-gray-400">{w.label}</div>
                  <div className="text-xs font-mono text-white truncate">{w.address}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 p-1.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] w-fit overflow-x-auto">
          {[
            { id: 'sources' as const, label: '📡 Sources (61)' },
            { id: 'whales' as const, label: '🐋 Whales' },
            { id: 'agents' as const, label: '🤖 AI Agents' },
            { id: 'tg' as const, label: '💬 TG Bots' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${activeTab === tab.id ? 'bg-white/[0.08] text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'sources' && (
          <div className="glass p-6 mb-6">
            <h3 className="font-semibold text-white mb-4">📡 Live Data Sources (61 connected)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
              {['Hyperliquid 🔥', 'dYdX 📐', 'GMX 🎯', 'Drift 🌊', 'Jupiter 🪐', 'SushiSwap 🍣', 'Camelot 🐪', 'Trader Joe 🥜', 'Velodrome 🌀', 'Uniswap V4 🦄', 'PancakeSwap 🥞', 'Raydium 💎', 'Orca 🐋', 'Aerodrome ✈️', 'Curve 📈', 'Balancer ⚖️', 'CoW Swap 🐄', 'LI.FI 🔄', 'Banana Gun 🍌', 'Maestro 🎵', 'Unibot 🤖', 'BonkBot 🔨', 'Trojan 🐴', 'Binance 🟨', 'Coinbase 🔵', 'Kraken 🐙', 'OKX ⬛', 'Bybit 🟧', 'KuCoin 🟩', 'Gate.io 🟪', 'MEXC 🔷', 'Bitget 🟦', 'CoinSpot 🟠', 'Swyftx 🔵', 'Flashbots 🛡️'].map((source, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-xs text-white truncate">{source}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'whales' && (
          <div className="glass p-6 mb-6">
            <h3 className="font-semibold text-white mb-4">🐋 Smart Money & Whale Alerts</h3>
            <div className="space-y-2">
              {[
                { wallet: '0x7a25...f3d2', action: 'BUY', symbol: 'VIRTUAL', amount: `${currencySymbol}3,624`, pnl: '+34.2%' },
                { wallet: '0x3b91...a8c7', action: 'SELL', symbol: 'PEPE', amount: `${currencySymbol}1,358`, pnl: '+156.7%' },
                { wallet: '0xf2d4...1e9b', action: 'BUY', symbol: 'MON', amount: `${currencySymbol}2,747`, pnl: '+45.8%' },
                { wallet: '0x8c17...4d2a', action: 'BUY', symbol: 'RENDER', amount: `${currencySymbol}4,731`, pnl: '+11.2%' },
              ].map((alert, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${alert.action === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {alert.action === 'BUY' ? '↑' : '↓'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">{alert.wallet}</span>
                      <span className={`text-[10px] font-bold ${alert.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{alert.action}</span>
                      <span className="text-xs font-semibold text-white">{alert.symbol}</span>
                    </div>
                    <div className="text-[10px] text-gray-500">{alert.amount}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono text-emerald-400">{alert.pnl}</div>
                    <button className="text-[10px] text-violet-400 hover:text-violet-300 mt-0.5">Copy →</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="glass p-6 mb-6">
            <h3 className="font-semibold text-white mb-4">🤖 AI Trading Agents</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { name: 'Alpha Scanner', icon: '🔍', pnl: '+12.4%', desc: 'Scans momentum plays' },
                { name: 'DePIN Hunter', icon: '📡', pnl: '+8.7%', desc: 'Tracks DePIN tokens' },
                { name: 'Whale Follower', icon: '🐋', pnl: '+18.2%', desc: 'Copies top wallets' },
                { name: 'MEV Shield', icon: '🛡️', pnl: `Saved ${currencySymbol}520`, desc: 'Blocks sandwich attacks' },
                { name: 'Sniper Bot', icon: '🎯', pnl: '+42.1%', desc: 'New listing sniping' },
                { name: 'DCA Bot', icon: '📊', pnl: '+5.3%', desc: 'Dollar-cost averaging' },
              ].map((agent, i) => (
                <div key={i} className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{agent.icon}</span>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-white">{agent.name}</div>
                      <div className="text-[10px] text-gray-500">{agent.desc}</div>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="text-xs font-mono text-emerald-400">{agent.pnl}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'tg' && (
          <div className="glass p-6 mb-6">
            <h3 className="font-semibold text-white mb-4">💬 Telegram Trading Bots</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { name: 'Banana Gun', icon: '🍌', chains: 'ETH, SOL, BASE', speed: '5ms', fee: '1%' },
                { name: 'Maestro', icon: '🎵', chains: 'ETH, SOL, BASE, ARB', speed: '7ms', fee: '1%' },
                { name: 'Unibot', icon: '🤖', chains: 'ETH, ARB, BASE', speed: '8ms', fee: '1%' },
                { name: 'BonkBot', icon: '🔨', chains: 'Solana only', speed: '4ms', fee: '1%' },
                { name: 'Trojan', icon: '🐴', chains: 'Solana only', speed: '5ms', fee: '0.9%' },
                { name: 'OpenLiquid', icon: '💧', chains: 'ETH, SOL, BASE', speed: '6ms', fee: '0.8%' },
              ].map((bot, i) => (
                <div key={i} className="p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-cyan-500/30 hover:bg-white/[0.04] transition-all cursor-pointer">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{bot.icon}</span>
                    <span className="text-xs font-semibold text-white">{bot.name}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-gray-500">Chains: <span className="text-gray-300">{bot.chains}</span></div>
                    <div className="text-[10px] text-gray-500">Speed: <span className="text-emerald-400">{bot.speed}</span></div>
                    <div className="text-[10px] text-gray-500">Fee: <span className="text-amber-400">{bot.fee}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Research Queue */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3 px-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">🔬</span>
              <h3 className="text-sm font-semibold text-gray-300">Research Queue</h3>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] text-amber-400 font-mono">{researchingCount} ACTIVE</span>
              </div>
            </div>
            <span className="text-xs text-gray-500">{otherCoins.length} tokens</span>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {otherCoins.map(coin => (
                <div key={coin.symbol} className={`flex-shrink-0 w-48 rounded-2xl border p-3 transition-all ${coin.researching ? 'bg-amber-500/[0.03] border-amber-500/20 hover:border-amber-500/40' : 'bg-white/[0.02] border-white/[0.06] hover:border-violet-500/30'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{coin.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{coin.symbol}</div>
                      <div className="text-[10px] text-gray-500 truncate">{coin.name}</div>
                    </div>
                    {coin.researching && <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                  </div>
                  <div className="flex justify-between mb-2">
                    <span className="text-xs font-mono text-white">{currencySymbol}{formatNum(convertPrice(coin.price))}</span>
                    <span className={`text-[10px] font-mono ${coin.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(1)}%</span>
                  </div>
                  {coin.researching ? (
                    <div className="mb-2">
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-amber-400">Researching...</span>
                        <span className="text-[10px] font-mono text-amber-300">{coin.researchProgress.toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style={{ width: `${coin.researchProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="mb-2">
                      <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400" style={{ width: `${coin.score}%` }} />
                      </div>
                    </div>
                  )}
                  <button onClick={() => handleBuy(coin)} className={`w-full rounded-xl text-xs font-semibold py-1.5 transition-all active:scale-95 ${coin.researching ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20' : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white hover:shadow-lg hover:shadow-violet-500/20'}`}>
                    {coin.researching ? 'WATCH' : 'BUY'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity Log */}
        <div className="glass p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">📋</div>
            <div>
              <h3 className="font-semibold text-white text-sm">Activity Log</h3>
              <p className="text-xs text-gray-500">Real-time events from all sources</p>
            </div>
          </div>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            <AnimatePresence>
              {logs.map((log, i) => (
                <motion.div key={`${log.time}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2 py-1.5 px-3 rounded-xl hover:bg-white/[0.02] transition">
                  <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap mt-0.5">{log.time}</span>
                  <span className={`text-xs ${log.type === 'ai' ? 'text-emerald-400/80' : log.type === 'trade' ? 'text-cyan-400/80' : log.type === 'wallet' ? 'text-violet-400/80' : log.type === 'data' ? 'text-amber-400/80' : 'text-gray-500'}`}>{log.msg}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="glass p-3 text-center">
            <div className="text-lg font-bold text-white font-mono">{coins.length}</div>
            <div className="text-[10px] text-gray-500">Total Tokens</div>
          </div>
          <div className="glass p-3 text-center">
            <div className="text-lg font-bold text-amber-400 font-mono">{researchingCount}</div>
            <div className="text-[10px] text-amber-400/70">Researching</div>
          </div>
          <div className="glass p-3 text-center">
            <div className="text-lg font-bold text-emerald-400 font-mono">{ALL_SOURCES.filter(s => s.status === 'live').length}</div>
            <div className="text-[10px] text-emerald-400/70">Live Sources</div>
          </div>
          <div className="glass p-3 text-center">
            <div className="text-lg font-bold text-violet-400 font-mono">{CHAINS.length}</div>
            <div className="text-[10px] text-violet-400/70">Chains</div>
          </div>
        </div>

        <footer className="mt-12 pt-6 border-t border-white/[0.04] text-center">
          <p className="text-xs text-gray-600 font-mono">Sea Chef Labs • Private Use Only • {coins.length} Coins • 61 Sources • {CHAINS.length} Chains</p>
        </footer>
      </div>
    </div>
  );
}
