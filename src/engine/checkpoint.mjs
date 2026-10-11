import { createHash } from 'node:crypto';
import { causalAnchor, initializeCausal } from './causal-state.mjs';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// This is accidental-corruption detection, not a signature. The durable input
// journal and its independent replay establish the checkpoint's provenance.
export function checkpointDigest(checkpoint) {
  const { digest, ...body } = checkpoint;
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export function makeCheckpoint(state, kind = 'durable-archive') {
  const a = state.account;
  const checkpoint = {
    schemaVersion: 1, kind, asOf: state.asOf, initialCash: a.initialCash,
    cash: a.cash, positions: structuredClone(a.positions), realizedPnl: a.realizedPnl,
    feesPaid: a.feesPaid, peakEquity: a.peakEquity,
    totalFillCount: state.totalFillCount, totalEventCount: state.totalEventCount,
    lastFill: structuredClone(state.lastFill),
    lastSourceAtByProduct: structuredClone(state.lastSourceAtByProduct),
    controlVersion: state.control.version, riskHalt: structuredClone(state.riskHalt),
  };
  if (state.schemaVersion === 3) checkpoint.causal = causalAnchor(state);
  checkpoint.digest = checkpointDigest(checkpoint);
  return checkpoint;
}

export function genesisCheckpoint(state) {
  const cash = state.account.initialCash;
  const genesis = { ...state, asOf: state.createdAt,
    account: { initialCash: cash, cash, positions: {}, realizedPnl: 0, feesPaid: 0, peakEquity: cash },
    totalFillCount: 0, totalEventCount: 0, lastFill: null, lastSourceAtByProduct: {},
    control: { version: 0 }, riskHalt: { active: false, reasons: [] },
  };
  if (state.schemaVersion === 3) initializeCausal(genesis);
  return makeCheckpoint(genesis, 'genesis');
}
