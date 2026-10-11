export const DEFAULT_CONFIG = Object.freeze({
  maxOrderNotional: 100, maxPositionNotional: 250, maxExposurePct: 10,
  maxDrawdownPct: 5, maxLossUsd: 100, feeBps: 20, slippageBps: 0, maxSlippageBps: 30,
  maxSpreadBps: 25, minDepthNotional: 100, maxSnapshotAgeMs: 15000,
  maxSignalAgeMs: 2000, latencyMs: 0, minHistorySamples: 5,
  minHistoryWindowMs: 60000, buyDistanceFromLowPct: 1,
  stopLossPct: 1, takeProfitPct: 2, maxEvents: 10000,
});

export function configuration(overrides = {}) {
  for (const key of Object.keys(overrides)) if (!(key in DEFAULT_CONFIG)) throw new Error(`Unknown configuration: ${key}`);
  const config = { ...DEFAULT_CONFIG, ...overrides };
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || (['latencyMs', 'slippageBps'].includes(key) ? value < 0 : value <= 0)) throw new Error(`Invalid configuration: ${key}`);
  }
  if (config.maxExposurePct > 100 || config.maxDrawdownPct > 100 || config.stopLossPct >= 100 ||
      config.feeBps >= 10000 || config.maxSlippageBps >= 10000 || config.slippageBps > config.maxSlippageBps ||
      !Number.isSafeInteger(config.maxEvents) || !Number.isSafeInteger(config.minHistorySamples)) throw new Error('Configuration outside supported bounds');
  if (!Number.isSafeInteger(config.latencyMs) || config.latencyMs > 0 && (!Number.isSafeInteger(config.maxSignalAgeMs) || config.latencyMs >= config.maxSignalAgeMs)) throw new Error('Latency must be an integer below the fixed order lifetime');
  return config;
}

export const EPSILON = 1e-8;
export const SUPPORTED_PRODUCTS = Object.freeze({ 'BTC-USD': 'BTC', 'ETH-USD': 'ETH' });
export const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
