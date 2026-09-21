// Bridge & Fee Structure for Cross-Chain Trading

export type BridgeProtocol = {
  id: string;
  name: string;
  icon: string;
  safety: 'excellent' | 'good' | 'moderate';
  speed: 'fast' | 'medium' | 'slow';
  fee: number; // percentage
  supportedChains: string[];
  tvl: number; // Total Value Locked in USD
  audits: number;
  exploitHistory: boolean; // true = has been exploited
};

export type FeeBreakdown = {
  tradingFee: number; // percentage
  tradingFeeUSD: number;
  networkFee: number; // USD (gas)
  bridgeFee: number; // percentage (0 if same chain)
  bridgeFeeUSD: number;
  totalFee: number; // USD
  totalFeePercent: number;
  recommendedBridge: BridgeProtocol | null;
  alternativeBridges: BridgeProtocol[];
  estimatedTime: string;
  warnings: string[];
};

export const BRIDGES: BridgeProtocol[] = [
  {
    id: 'stargate',
    name: 'Stargate',
    icon: '⭐',
    safety: 'excellent',
    speed: 'fast',
    fee: 0.06,
    supportedChains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Base'],
    tvl: 450_000_000,
    audits: 5,
    exploitHistory: false,
  },
  {
    id: 'across',
    name: 'Across',
    icon: '🌉',
    safety: 'excellent',
    speed: 'fast',
    fee: 0.05,
    supportedChains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Base', 'Linea', 'zkSync'],
    tvl: 180_000_000,
    audits: 4,
    exploitHistory: false,
  },
  {
    id: 'hop',
    name: 'Hop Protocol',
    icon: '🐰',
    safety: 'good',
    speed: 'medium',
    fee: 0.04,
    supportedChains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Gnosis'],
    tvl: 120_000_000,
    audits: 3,
    exploitHistory: false,
  },
  {
    id: 'synapse',
    name: 'Synapse',
    icon: '🔷',
    safety: 'good',
    speed: 'medium',
    fee: 0.08,
    supportedChains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Fantom'],
    tvl: 95_000_000,
    audits: 4,
    exploitHistory: false,
  },
  {
    id: 'wormhole',
    name: 'Wormhole',
    icon: '🕳️',
    safety: 'moderate',
    speed: 'fast',
    fee: 0.10,
    supportedChains: ['Ethereum', 'Solana', 'Polygon', 'BNB Chain', 'Avalanche', 'Optimism', 'Arbitrum'],
    tvl: 320_000_000,
    audits: 6,
    exploitHistory: true, // Had $320M exploit in 2022
  },
  {
    id: 'multichain',
    name: 'Multichain',
    icon: '🔗',
    safety: 'moderate',
    speed: 'medium',
    fee: 0.12,
    supportedChains: ['Ethereum', 'BSC', 'Polygon', 'Avalanche', 'Fantom', 'Arbitrum'],
    tvl: 85_000_000,
    audits: 3,
    exploitHistory: true, // Had issues in 2023
  },
  {
    id: 'orbiter',
    name: 'Orbiter Finance',
    icon: '🛸',
    safety: 'good',
    speed: 'fast',
    fee: 0.07,
    supportedChains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync', 'Base', 'Linea'],
    tvl: 65_000_000,
    audits: 2,
    exploitHistory: false,
  },
  {
    id: 'celer',
    name: 'Celer cBridge',
    icon: '⚡',
    safety: 'good',
    speed: 'fast',
    fee: 0.09,
    supportedChains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche'],
    tvl: 110_000_000,
    audits: 4,
    exploitHistory: false,
  },
  {
    id: 'allbridge',
    name: 'Allbridge',
    icon: '🌊',
    safety: 'good',
    speed: 'medium',
    fee: 0.10,
    supportedChains: ['Ethereum', 'Solana', 'Polygon', 'BNB Chain', 'Avalanche', 'Arbitrum'],
    tvl: 45_000_000,
    audits: 3,
    exploitHistory: false,
  },
  {
    id: 'portal',
    name: 'Portal (Wormhole)',
    icon: '🚪',
    safety: 'excellent',
    speed: 'fast',
    fee: 0.10,
    supportedChains: ['Ethereum', 'Solana', 'Polygon', 'BNB Chain', 'Avalanche', 'Optimism', 'Arbitrum', 'Base'],
    tvl: 280_000_000,
    audits: 7,
    exploitHistory: false, // Rebuilt after Wormhole exploit
  },
];

// Network gas fees (average in USD)
export const NETWORK_FEES: Record<string, number> = {
  'Ethereum': 5.50,
  'Arbitrum': 0.15,
  'Optimism': 0.12,
  'Polygon': 0.08,
  'BNB Chain': 0.35,
  'Avalanche': 0.45,
  'Base': 0.10,
  'Solana': 0.02,
  'Hyperliquid L1': 0.05,
  'PulseChain': 0.03,
  'dYdX Chain': 0.08,
  'Thorchain': 0.25,
  'Cronos': 0.15,
  'zkSync': 0.18,
  'Linea': 0.14,
  'Aptos': 0.04,
  'Gnosis': 0.06,
  'EOS': 0.01,
};

// Trading fees by venue type
export const TRADING_FEES: Record<string, number> = {
  'dex': 0.30, // 0.3% average for DEXes
  'cex': 0.10, // 0.1% average for CEXes
  'aggregator': 0.25, // 0.25% average for aggregators
};

// Find best bridge for cross-chain transfer
export function findBestBridge(
  fromChain: string,
  toChain: string,
  amount: number
): { recommended: BridgeProtocol | null; alternatives: BridgeProtocol[] } {
  if (fromChain === toChain) {
    return { recommended: null, alternatives: [] };
  }

  const available = BRIDGES.filter(
    b => b.supportedChains.includes(fromChain) && b.supportedChains.includes(toChain)
  );

  if (available.length === 0) {
    return { recommended: null, alternatives: [] };
  }

  // Score bridges by safety, speed, and cost
  const scored = available.map(bridge => {
    let score = 0;
    
    // Safety (50% weight)
    if (bridge.safety === 'excellent') score += 50;
    else if (bridge.safety === 'good') score += 35;
    else score += 20;
    
    // Penalize if has exploit history
    if (bridge.exploitHistory) score -= 30;
    
    // TVL (20% weight) - higher TVL = more secure
    score += Math.min(20, (bridge.tvl / 1e9) * 20);
    
    // Audits (15% weight)
    score += Math.min(15, bridge.audits * 3);
    
    // Speed (10% weight)
    if (bridge.speed === 'fast') score += 10;
    else if (bridge.speed === 'medium') score += 6;
    else score += 3;
    
    // Fee (5% weight) - lower is better
    score += (1 - bridge.fee) * 5;
    
    return { bridge, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    recommended: scored[0]?.bridge || null,
    alternatives: scored.slice(1, 4).map(s => s.bridge),
  };
}

// Calculate complete fee breakdown
export function calculateFeeBreakdown(
  amount: number,
  fromChain: string,
  toChain: string,
  venueType: 'dex' | 'cex' | 'aggregator'
): FeeBreakdown {
  const tradingFeePercent = TRADING_FEES[venueType];
  const tradingFeeUSD = amount * (tradingFeePercent / 100);
  const networkFee = NETWORK_FEES[fromChain] || 2.0;
  
  const { recommended: bridge, alternatives } = findBestBridge(fromChain, toChain, amount);
  
  const bridgeFeePercent = bridge ? bridge.fee : 0;
  const bridgeFeeUSD = amount * (bridgeFeePercent / 100);
  
  const totalFee = tradingFeeUSD + networkFee + bridgeFeeUSD;
  const totalFeePercent = (totalFee / amount) * 100;
  
  // Estimate time
  let estimatedTime = 'Instant';
  if (fromChain !== toChain && bridge) {
    if (bridge.speed === 'fast') estimatedTime = '1-3 minutes';
    else if (bridge.speed === 'medium') estimatedTime = '5-15 minutes';
    else estimatedTime = '15-30 minutes';
  }
  
  // Warnings
  const warnings: string[] = [];
  if (totalFeePercent > 2) {
    warnings.push('High fees - consider larger trade size');
  }
  if (fromChain !== toChain && !bridge) {
    warnings.push('No direct bridge available - may require multiple hops');
  }
  if (bridge?.exploitHistory) {
    warnings.push('Recommended bridge has exploit history - use with caution');
  }
  if (networkFee > 5) {
    warnings.push('High gas fees on source chain');
  }
  
  return {
    tradingFee: tradingFeePercent,
    tradingFeeUSD,
    networkFee,
    bridgeFee: bridgeFeePercent,
    bridgeFeeUSD,
    totalFee,
    totalFeePercent,
    recommendedBridge: bridge,
    alternativeBridges: alternatives,
    estimatedTime,
    warnings,
  };
}

// Get safety badge color
export function getSafetyColor(safety: BridgeProtocol['safety']): string {
  switch (safety) {
    case 'excellent': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'good': return 'text-green-400 bg-green-500/10 border-green-500/20';
    case 'moderate': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  }
}
