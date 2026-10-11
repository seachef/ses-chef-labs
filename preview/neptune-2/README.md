# NEPTUNE 2.0: simple paper page

A separate one-page view at `preview/neptune-2/`. The original application, routes, backend, account, history and authentication are unchanged. This is the same existing paper account, not a newly funded campaign. No real-money orders or wallet functionality.

## Run and test

From the repository root:

```sh
python -m http.server 8000
# Open http://localhost:8000/preview/neptune-2/
node --test preview/neptune-2/*.test.mjs
node --test preview/research-desk/*.test.mjs
node --check preview/neptune-2/app.mjs
node --check preview/neptune-2/model.mjs
```

No package installation or build step. The new workflow checks this page when it or its shared dependencies change.

## Safety and data contract

- Start is deliberately disabled in both UI and controller. `START_BLOCK` records the unresolved storage-capacity / protective-exit safety prerequisite. No query parameter, storage value, report flag or owner session can enable it. A reviewed backend repair and subsequent reviewed page release are required before implementing Start. This page alone cannot make trading operational.
- Stop uses the existing `createOwnerControl` adapter. It verifies the existing authenticated user and owner-only row, then rechecks authority and writes only `enabled:false` using the current epoch lease. Public viewers cannot write. Duplicate clicks are coalesced; uncertain writes are not automatically retried. A saved request is separate from a matching fresh server acknowledgement.
- Stop freezes open positions; it does not liquidate them. The page says so next to the controls.
- Owner access reuses the existing same-tab Portfolio session and public configuration. There is no new sign-in flow, redirect, credential, permission or owner identity. Sign in through the existing Portfolio link in the same tab and use Back / Refresh.
- Status and history use only existing public read projections with the existing public key, no cookies, no referrer and no cache. Status is checked every 10 seconds. All responses pass existing validators. No fixtures are loaded by the application.
- Current balances, current positions and profit are withheld when disconnected or when heartbeat age exceeds 90 seconds. Per-position bids and valuations have their own freshness checks. Missing amounts remain unavailable, never zero. Recorded legacy fills remain clearly labelled historical during an outage.
- Equity uses the existing portfolio valuation validator. Unrealised P&L uses existing receipt, cost-basis, FX and net-liquidation reconciliation. Realised P&L is the authoritative reported whole-account total, not the sum of truncated recent results. Incomplete conversions or fee evidence suppress profit. This is experimental modelled performance, not proof of an effective trading strategy.
- Legacy position entry needs its matching simulated fill receipt. Current price is the sampled USD bid, not entry or target. Native positions retain their venue/quote currency and explicitly show unavailable for entry/current/stop/target when the existing projection omits them. No USDT/USDC-to-USD parity is assumed.
- The recent list shows at most 30 supplied fills. The optional older history reader loads 100 audit records per click against a fixed verified watermark and renders at most 100 latest loaded fill/result records. It never claims complete history before reaching the watermark. Once complete, a newer verified report enables Load latest to explicitly start a new fixed snapshot.
- All rendered feed text uses text nodes. CSS is scoped to `.neptune2`; no old page imports this stylesheet. There are no animations, charts, scene assets or agent panels.

## Release boundary

The page can be published as a blocked, truthful paper-account view after independent review. Publishing it does not repair or resume the backend. Enabling Start requires separate evidence that backend capacity and protective exits are safe. Do not remove the release gate merely because a report says `running`.
