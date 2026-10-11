# NEPTUNE 2.0 — local causal synthetic slice

Clean-room implementation based on `neptune-2-clean-start` at `1009d02b1b74f6d600c4afad9a9d6679f920b4c8`. The starting tree had only this README, the dark market prototype, and `AUTOMATION-SPEC.md`. No NEPTUNE 1 code, accounts, wallets, agents, research, backend, schedules, or parent implementation were imported. The original specification remains the target contract.

**Delivered: bounded foreground synthetic replay, a durable input/decision/control journal, causal pending orders on explicit later books, local accounting, a read-only public-data adapter, and a white five-section dashboard. Not delivered: a deployed autonomous service or an enabled public-price paper-trading system.** No worker continues after the replay process exits. The dashboard server serves state; it does not trade. A browser tab is not a worker. The reviewed 110-pass and 169-pass checkpoints remain preserved. See the [current manifest](docs/LATENCY-CHANGE-MANIFEST.md), [causal contract](docs/LATENCY-CONTRACT.md), and [independent latency review](docs/LATENCY-REVIEW.md); earlier journal documentation remains historical evidence.

## Reproduce offline

Node 22 or newer; tested on Node 24.19.0. There are no dependencies to install, credentials, exchange-order APIs, wallets, or database connections.

```sh
cd /workspace/neptune-2-clean-start
node --test test/*.test.mjs
```

Create a separate disposable directory for explicitly synthetic replay:

```sh
fixture_dir=$(mktemp -d /tmp/neptune2-fixture.XXXXXX)
node src/cli.mjs replay --input fixtures/synthetic-market.json --data "$fixture_dir" --arm-fixture
node src/cli.mjs replay --input fixtures/synthetic-market.json --data "$fixture_dir"
node src/cli.mjs journal-audit --data "$fixture_dir"
node src/cli.mjs stop --data "$fixture_dir"
node src/cli.mjs serve --data "$fixture_dir" --port 8787
```

The second replay is an idempotency/restart check: it must not create new fills or reset cash. The supplied hand-authored fixture buys, then takes a losing protective exit: final synthetic cash **9997.48376 USD**, realized/net **−2.51624 USD**, two fills, no position. These are arithmetic fixtures, not market performance. `--arm-fixture` initializes only a new, unstopped store; it never resumes a stopped existing engine. An operator STOP issued before initialization prevents that directory from being armed.

Open `http://127.0.0.1:8787` while the foreground preview process is running. Ctrl-C stops that preview process. For the clean empty page, use a new directory and run only `serve`; account and market fields remain unknown. Nothing starts on import or installation. Native iPhone/iPad/desktop rendering still requires a supported browser/owner check.

For the new causal model, use a separate new directory and `fixtures/synthetic-causal-market.json` with `--latency-ms 250 --order-lifetime-ms 2000`. See the [complete reproduction commands and timing rules](docs/LATENCY-CONTRACT.md). Pending intents and reserved cash are visible without being displayed as fills. An orderly replay end cancels pending orders; a crash preserves committed pending state for recovery.

## Runtime responsibilities

| Responsibility | Code | Runtime role |
| --- | --- | --- |
| Market data | `src/market/coinbase.mjs`, engine `market.mjs` | Explicit read-only collection; validation of identity, currency, source time and depth |
| Asset screening | engine `market.mjs` | Two exact spot products; spread and observed-depth checks |
| Deterministic strategy | engine `strategy.mjs` | Versioned observed-window-low entry rule and protective bid-based exits; no individual selection |
| Risk | engine `risk.mjs` | Rechecked by execution against current state; rejects unsafe entries independently |
| Paper execution | engine `execution.mjs`, `causal*.mjs`, `index.mjs`, `src/book-identity.mjs` | Synthetic immediate or causal later-book execution, reservations and consumed-depth identity; no exchange order submission code |
| Accounting audit | engine `audit.mjs` | Separately replays financial ledger and verifies conservation before state commits |
| Persistence / local runner | `src/store.mjs`, `journal.mjs`, `runtime.mjs`, `cli.mjs` | Journaled typed commands, atomic committed head, archive replay/duplicate checks; bounded foreground replay or one observation |
| Operator view | `src/server.mjs`, `view.mjs`, page assets | Loopback state/stop API, coherent revision, explicit stale/unknown fields |

Implementation agents and the separate adversarial reviewer were **design-time collaborators**. They are not installed runtime workers. The [first review](docs/INDEPENDENT-REVIEW.md) and [journal review](docs/JOURNAL-REVIEW.md) cover preserved checkpoints; the [latency review](docs/LATENCY-REVIEW.md) covers this continuation.

## Market support and truthfulness

The adapter's intended scope is Coinbase Exchange `BTC-USD` and `ETH-USD`, long-only spot, USD accounting. It verifies product id/base/quote/status and restrictions on each observation. Official Coinbase documentation is the source of the adapter contract. Direct product probes in this environment failed/timed out, so **current connectivity, current venue availability, and real response compatibility remain unverified**. There is no current verified-market coverage claim. See [source evidence and limitations](docs/MARKET-SOURCES.md).

Public observation is a separate explicit action, for a fresh data directory:

```sh
node src/cli.mjs observe --data /tmp/neptune2-observe
node src/cli.mjs serve --data /tmp/neptune2-observe --port 8787
```

Those commands fetch read-only data; they never send observations to paper execution. Development tests inject synthetic data and never call public APIs. Fixture and observation stores cannot be mixed. Failed observations clear earlier observations. No stale fallback is relabelled as live. CoinGecko aggregate price/volume is not execution evidence and is not used here.

Price is the source's last trade when available, otherwise the synthetic book midpoint; simulated buys use asks and sells use bids. Liquidity is notional in the supplied book levels, not venue-wide liquidity or 24h volume. Distances are from the explicitly reported observed history window, never an all-time-low claim. Source, book and receipt times are distinct. Unknown book source time remains unknown. The display uses a conservative 10-second receipt/source/book freshness gate; the adapter's separate collection gate is 30 seconds and the synthetic engine's gate is 15 seconds. An HTTP refresh cannot refresh an old source timestamp.

## Execution and risk assumptions

The deterministic version is recorded in state along with complete configuration. Default synthetic starting cash is USD 10000. Default maximum order notional is USD 100; maximum position notional USD 250; gross exposure limit 10% of equity; maximum drawdown 5%; maximum net loss USD 100. Loss halts latch and are not cleared by resume. Missing held-product marks make total equity, unrealized P/L, drawdown and net return unknown and block entries.

Default assumed fee is 20 basis points per side, **not a verified Coinbase/account fee**. Fills walk observable asks/bids within a 30-basis-point total adverse-slippage cap; extra assumed `slippageBps` defaults to zero and can be configured in isolated engine fixtures. Slippage is embedded once in fill price, fees are charged on fill notional. Unfilled quantities are canceled; no standing order or pending exchange request exists. Each event can commit one fill, so retries cannot consume the same event's depth again. A gapped stop uses current eligible bids; if depth is absent or outside the cap, no fill is invented.

Default **zero-latency immediate-or-cancel simulation** remains for schema-2 compatibility. A new store may explicitly choose positive integer latency below its fixed order lifetime, which enables schema 3: durable pending intents and reservations, followed by the first qualifying distinct later book. `bookSequence` and `bookSourceAt` are mandatory and distinct from ticker/trade/delivery identities. A fresh trade or receipt cannot replenish cached depth or refresh its mark. Distinct genuine trade IDs at one timestamp are recorded separately. Each book receives at most one execution attempt across orders, retries and restart; unused depth may be discarded conservatively. See the [causal contract](docs/LATENCY-CONTRACT.md).

The delay is a synthetic assumption, not measured venue latency. There is no queue-position, future-liquidity, market-impact, venue-increment or exchange-fill guarantee. Float accounting has an explicit relative tolerance of `1e-8`; it is a paper model, not a custody ledger. Fees paid are included in realized/unrealized returns; prospective exit fees are not deducted from bid marks.

## Emergency stop and recovery

`EMERGENCY STOP` is explicitly an **entry pause**, not STOP ALL: it durably blocks new buys and invalidates older proposals. Fresh synthetic reduce-only protective exits remain allowed. It does not force liquidation; stale/invalid data leaves a position unresolved and its valuation unknown. There is no separate STOP ALL state in this slice. Closing the dashboard is not a stop. The UI acknowledges STOP only after the local transaction commits; failure remains visibly unconfirmed.

```sh
node src/cli.mjs stop --data "$fixture_dir"
node src/cli.mjs resume-fixture --data "$fixture_dir"
```

Resume is explicit, fixture-only, and does not clear a persistent risk halt. In causal mode, STOP cancels pending buys and releases their reservations; eligible pending protective sells retain their separate policy and position generations until fill, cancellation or expiry. Resume never revives a canceled buy. Operator wall-clock time is recorded separately from the synthetic replay clock. STOP is idempotent and survives process restart. The API accepts no trade, symbol-selection or configuration orders.

Each committed typed command records its exact input and clocks, before/after state, decision and execution in immutable hash-linked journal files. This includes accepted market events, rejected market inputs and duplicate attempts, STOP/resume, initialization and worker status. Malformed/oversized commands rejected before commit and failed disk writes have no guaranteed journal record or acknowledgment. Engine changes cannot use the generic system-document transaction API.

The store writes and fsyncs journal evidence before atomically publishing the checksum-verified `state.json` head, then fsyncs the directory before acknowledgment. A unique prepared file prevents partial writes from poisoning an exact retry; complete records are published without overwriting existing evidence. The authoritative head selects the committed chain. Prepared files and orphan records remain evidence and are never automatically adopted merely because they are newer. A failed commit may leave old or new state; reopen and replay event IDs rather than assuming a retry is new. Corruption or missing committed evidence fails closed, with no reset or older-backup fallback. SHA-256 detects corruption, not malicious local modification.

The durable runtime checkpoints active history at the configured event-count limit (default 10000) or a 2 MiB active-engine byte budget. It preserves cash, positions and cost basis, realized P/L, fees, equity peak, source high-water marks, STOP generation, risk halts, lifetime counts and the last fill. Protective exits remain eligible across these rollovers. Full historical input and accounting evidence remains in the journal: no history is silently deleted. The pure engine API without durable archive acknowledgment still rejects at capacity. Any single retained state that cannot fit the byte budget fails before commit; invalid or oversized inputs cannot imply a guaranteed exit.

Duplicate checks scan all committed snapshot attempts, including rejected ones. An event ID is immutable: resubmitting a corrected payload under a previously committed rejected ID is rejected too. Legacy schema 2 rejects repeated source timestamps. Causal schema 3 accepts distinct genuine trade IDs at equal timestamps and orders executable depth by its independent book sequence/source time; trade or receipt changes never renew cached depth. `journal-audit` verifies the complete hash/state chain and deterministically replays each command, including its decision and accounting result. Use the matching source revision for replay.

Journal directories span 128 sequence positions each. Active state and individual record sizes are bounded; total disk history grows without pruning. Reads and duplicate lookups scan history linearly; full replay audit can be quadratic. The local file implementation is not sized for continuous high-volume operation. Document and command limits are 16 MiB, and the record limit is 96 MiB. Storage exhaustion, corruption, slow scans or unavailable fresh data can still prevent processing, protective exits and durable STOP acknowledgment. There is no guaranteed liquidation or reserved disk space for exits.

Version-1 snapshots remain readable, but writes require explicit migration in the same isolated data directory:

```sh
node src/cli.mjs migrate-state --data "$fixture_dir"
node src/cli.mjs journal-audit --data "$fixture_dir"
```

Migration stores the exact old envelope and checksum, upgrades the audited accounting state, and labels history `complete: false` with its legacy revision. Earlier decision inputs are unreconstructible; they are never invented. Fresh version-2 stores report complete committed-command history. No existing backend or user data is migrated by installation or tests.

A crashed writer may leave `transaction.lock`. Stop relevant processes and inspect the saved state/lock, then use:

```sh
node src/cli.mjs recover-lock --data "$fixture_dir"
```

Recovery checks that the recorded owner is on this host and its process no longer exists, verifies the state, and retains the old lock as evidence. It refuses live, malformed, uncertain or foreign-host locks. A separate exclusive `recovery.lock` prevents simultaneous recoverers from clearing a new writer's lock. A crash during recovery can leave that guard; this requires manual owner inspection with processes stopped, not automatic lock deletion. Local single-machine filesystem only; distributed/NFS safety is not claimed.

## Remaining release gates

- Supported native browser review at iPhone, iPad and desktop sizes; keyboard, screen reader, actual layout and stop interaction verification.
- Successful read-only source observations with current venue support, real source timestamps, payload compatibility, rate limits and outage/recovery evidence.
- Current source provenance and runtime gates before any public-price paper policy. Causal execution is implemented only for explicitly synthetic fixtures; sequence progression there is declared input evidence, not authenticated venue replenishment.
- Operational sizing and storage policy: full evidence grows on disk, scans slow with history, and disk failure can block exits. Count and byte rollover are implemented; continuous-operation capacity is not established.
- Real filesystem/power-loss behavior, supervised service lifecycle, heartbeats, restart/STOP observations and an approved isolated paper run. Injected write failures and killed child processes do not establish hardware power-loss durability. No process is installed, scheduled, deployed or claimed to run continuously.

The next smallest launch step is to transfer the reviewed source through a supported route, then verify the actual adapter and read-only UI in the republished environment where a separate task reported successful endpoint access. That report does not establish this adapter's compatibility or deploy this page. Native preview review, storage/runtime sizing and a supervised lifecycle/STOP check remain gates. The owner's dense terminal-style activity direction is recorded in [operator integration](docs/OPERATOR-INTEGRATION.md). Publication and an isolated public-price paper run require separate coordination; tests alone do not establish readiness or profitability.
