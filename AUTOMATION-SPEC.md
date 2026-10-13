# NEPTUNE 2.0 — autonomous paper trading specification

Status: DESIGN ONLY. No trading engine, scheduler, agent runtime or exchange connection is deployed by this document.

## Product
One white, borderless, compact monospace data sheet. Small type, responsive mobile/desktop. Market / Decision (with WHY) / Execution / Account / Engine. Net P/L after fees and slippage prominently displayed. No wallets or legacy imports.

## Agent responsibilities
- Data: ingest, timestamp, validate, deduplicate quotes and order books; fail closed on stale or missing data.
- Universe: screen assets by verified venue support, liquidity and spread.
- Strategy: produce deterministic, versioned paper trade proposals with a rationale; no untested self-modifying logic.
- Risk: independently enforce exposure, loss, position size and maximum drawdown rules; veto any unsafe proposal.
- Execution: simulated fills using observable bid/ask, fees, slippage, partial fills and latency assumptions.
- Auditor: replay all decisions, reconcile balances and test that risk vetoes cannot be bypassed.

## Automation requirements
A persistent service or scheduled runner must execute independently of an open ChatGPT session. No agent or service may claim to run until deployed and observed. Begin with read-only data and offline deterministic replay, then isolated paper trading. Live trading is out of scope.

## Non-negotiable tests
Data freshness and API failure; order size and exposure limits; fees and slippage; double execution / retries; stale signals; stop/kill switch; ledger reconciliation; reboot and recovery; loss-limit enforcement; reproducible strategy performance.

## Release gates
1. Verified market data with source and timestamp.
2. Tested deterministic decision engine and WHY field.
3. Paper ledger reconciles and survives restart.
4. Independent risk and audit tests pass.
5. Operator sees PAPER / STOP status clearly and can stop safely.

No invented prices, fabricated trades, or performance claims.
