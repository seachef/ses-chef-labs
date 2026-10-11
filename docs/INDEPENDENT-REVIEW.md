# Independent review of the local first slice

Reviewed 11 October 2026 against clean base `1009d02b1b74f6d600c4afad9a9d6679f920b4c8`, Node `v24.19.0`. Conclusion: the bounded local offline slice has no remaining identified must-fix defect within the reviewed scope. **This is not approval for autonomous operation or public-price paper trading.**

The independent reviewer authored `test/adversarial.test.mjs` and this report, and did not author or edit the implementation under review. Implementation owners corrected findings; the reviewer then exercised the corrections. Design-time agents are reviewers/developers, not deployed trading workers. Runtime responsibilities are ordinary deterministic modules.

## Reproducible evidence

From this checkout:

```sh
node --test test/adversarial.test.mjs
npm test
git diff --check
```

Final reviewed offline run: **112 tests, 110 passed, 0 failed, 2 skipped, 0 cancelled**. The independent file contributes **29 tests: 28 passed, 0 failed, 1 skipped**. `git diff --check` passed. Test counts include nested market-validation cases.

All automated market inputs are invented fixtures; fetch calls are intercepted. Tests create and clean isolated temporary state directories. They use real child processes for writer exclusion and abrupt writer termination, and a loopback HTTP server for application integration. No test sends public-price simulated orders or accesses an exchange. No browser was launched.

The independent arithmetic reference was reproduced: starting cash USD 1,000; buy 2 at ask 100 with 1% adverse slippage and 0.1% fee debits 202.202; sell 2 at bid 99 with the same assumptions credits 195.82398; final cash **993.62198**, realized net P/L **−6.37802**. A separate multi-level depth-walk example reconciles fees, slippage, cost basis and conservation. These are accounting examples, not performance results.

## Findings corrected before handoff

| Finding | Consequence | Reviewed correction/evidence |
| --- | --- | --- |
| Operator STOP/resume used wall time inside a historical fixture clock | Later protective exits could fail clock checks | Operator wall timestamp is separate; persisted STOP followed by a later historical protective exit passes |
| Dashboard treated a risk-halt object as an active halt, subtracted from null equity, and lost product keys | Incorrect HALTED labels, false loss or unknown valuation | Explicit active flag, null-preserving net P/L and normalized product-keyed positions; projection regressions pass |
| Browser freshness aged receipt time only | A source could expire while still displayed FRESH | Every render ages receipt, trade source and book source; independent oldest-source expiry regression passes |
| Ledger audit accepted impossible negative depth legs if totals matched | Arithmetic-only audit could accept malformed fill evidence | Positive finite legs, price assumptions, timestamps, quantities and status checks; mutation regression passes |
| Two manual lock recoverers could race | A late recoverer could rename a newly acquired writer lock | Exclusive recovery guard; writers and other recoverers fail closed while it exists |

Reviewed safety behavior includes identity/currency rejection, stale/future source rejection, malformed/crossed/duplicate books, excluded partial/future/out-of-window candles, explicit unknown history, public-provenance execution rejection, fresh-data risk rechecks, duplicate/source-order blocking, partial remainder cancellation, cash/exposure/loss/drawdown limits, missing-mark valuation becoming null, persistent STOP and stale-proposal invalidation, protective exits remaining eligible while paused, and risk halts surviving resume.

Persistence checks cover reopen, aborted/async transactions, second-process writer exclusion, abrupt process exit before commit, explicit recovery retaining evidence, live-owner recovery denial, checksum corruption, recovery-guard exclusion and unavailable destination failures. The checksum detects accidental corruption; it is not cryptographic authentication against a person able to rewrite the whole state envelope.

## Limits that remain release gates

- **Execution mode:** finite foreground synthetic replay, or a one-shot read-only observation, plus a foreground loopback preview. No installed persistent service or unattended operation has been demonstrated.
- **Market support:** the adapter targets Coinbase Exchange BTC-USD and ETH-USD and verifies exact product metadata on a successful observation. Current connectivity and live payload compatibility remain unverified; the implementation owner's documented public probes failed/timed out. See `MARKET-SOURCES.md`. CoinGecko aggregate prices are not execution evidence. Public observations cannot enter this ledger.
- **Execution realism:** long-only spot, USD quote, bounded allowlist, one position per product, immediate-or-cancel simulation, explicit fee/adverse-slippage assumptions, and zero latency. Nonzero latency is rejected. Queue position, later books, cancellations and future fill capacity are not modeled.
- **Audit completeness:** fills, consumed event IDs, current snapshots and state are durable. There is no complete historical decision/input journal. Reproducible fixture replay is not a complete autonomous decision-history audit.
- **Capacity:** the bounded event cap stops processing at capacity, including protective exits. Storage/lock failures and stale/missing exit data also prevent fills. No claim of guaranteed liquidation is made; an operational rollover/journal design is required before unattended use.
- **Recovery:** local filesystem, single-machine assumptions only. Dead same-host writer recovery is explicit and preserves lock evidence. A crashed recovery guard requires operator inspection. Tests do not establish power-loss durability on every filesystem or distributed locking safety; destination-unavailable testing is not an ENOSPC/fsync/power-cut fault-injection campaign.
- **Native verification:** iPhone/iPad/desktop layout, native keyboard/screen-reader behavior, browser integration and hosted deployment remain untested. The two skips explicitly record native-browser and persistent-service limitations. Static/DOM tests do not certify visual correctness.
- **Strategy:** no predictive edge, profitability, broad coverage or production risk adequacy has been established. Synthetic profits or losses must remain labeled as fixtures.

The next smallest launch step is a supported native review of the loopback preview and an explicitly read-only venue observation, while retaining the public-data execution block. Deployment and any later public-price paper execution require separate evidence for service lifetime, source continuity, durable decision history, recovery and operator STOP. No push, merge or deployment is part of this review.
