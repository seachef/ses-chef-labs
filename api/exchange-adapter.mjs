/**
 * Sea Chef Labs exchange execution boundary.
 * This file deliberately contains NO exchange credentials and NO live order implementation.
 * Browser code must never receive exchange API secrets.
 */
export const EXECUTION_VERSION = 1;

export function normaliseStagedOrder(input = {}) {
  const side = String(input.side || '').toUpperCase();
  const pair = String(input.pair || '').trim().toUpperCase();
  const entry = Number(input.entry);
  const stop = Number(input.stop);
  const capitalAud = Number(input.capitalAud);
  const riskPct = Number(input.riskPct);
  const leverage = Number(input.leverage || 1);
  const targets = Array.isArray(input.targets) ? input.targets.map(Number).filter(Number.isFinite) :
    String(input.targets || '').split(',').map(v => Number(v.trim())).filter(Number.isFinite);
  if (!pair || !['LONG','SHORT'].includes(side)) throw new Error('Invalid pair or side');
  if (!(entry > 0) || !(stop > 0) || !(capitalAud > 0) || !(riskPct > 0 && riskPct <= 100) || !(leverage >= 1)) throw new Error('Invalid staged order values');
  if (side === 'LONG' ? stop >= entry : stop <= entry) throw new Error('Stop is on the wrong side of entry');
  const stopFraction = Math.abs(entry - stop) / entry;
  const maxRiskAud = capitalAud * riskPct / 100;
  const notionalAud = maxRiskAud / stopFraction;
  return Object.freeze({pair,side,entry,stop,targets,capitalAud,riskPct,leverage,maxRiskAud,notionalAud,estimatedMarginAud:notionalAud/leverage});
}

export function executionStatus(env = process.env) {
  const enabled = env.SCL_EXECUTION_ENABLED === 'true';
  const exchange = String(env.SCL_EXCHANGE || 'unconfigured');
  const configured = Boolean(env.SCL_EXCHANGE_API_KEY && env.SCL_EXCHANGE_API_SECRET);
  return {version:EXECUTION_VERSION,enabled,exchange,configured,canSubmit:enabled && configured};
}

export async function submitApprovedOrder() {
  throw new Error('LIVE_EXECUTION_NOT_IMPLEMENTED');
}
