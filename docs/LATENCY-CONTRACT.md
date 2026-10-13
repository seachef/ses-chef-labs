# Causal synthetic execution contract

This is a bounded, foreground synthetic model. It sends no exchange orders and cannot execute public-price observations. Explicit source identifiers in hand-authored fixtures are assumptions, not proof of current venue provenance, replenished liquidity, measured latency or fill availability.

The preserved journal-stage tree is `6fe1eef92073280b78eb123304c192492a042824`. Its schema-2 zero-latency path remains available for old fixtures and command replay. A **new** store initialized with positive `latencyMs` uses schema 3 and this contract. Existing stores cannot silently change configuration or convert their execution model on restart. `CAUSAL-LATENCY-NEXT.md` is the historical design assessment; this file describes the implemented continuation.

## Reproduce without external data

Node 22 or newer; tested with 24.19.0. No packages to install.

```sh
fixture_dir=$(mktemp -d /tmp/neptune2-causal.XXXXXX)
node src/cli.mjs replay --input fixtures/synthetic-causal-market.json --data "$fixture_dir" --arm-fixture --latency-ms 250 --order-lifetime-ms 2000
node src/cli.mjs journal-audit --data "$fixture_dir"
node src/cli.mjs replay --input fixtures/synthetic-causal-market.json --data "$fixture_dir"
node src/cli.mjs journal-audit --data "$fixture_dir"
```

Latency is a nonnegative integer; positive latency must be below the fixed order lifetime (`maxSignalAgeMs`, default 2000 ms). The CLI options configure a new synthetic account only. Default latency remains zero for compatibility. The causal fixture deliberately includes a late receipt of an old book and a losing delayed gap-stop exit. It is arithmetic evidence, not performance research. An orderly replay end cancels all pending orders and releases reservations; it does not liquidate held positions. A crashed process preserves committed pending orders for recovery.

## Separate identities and clocks

| Evidence | Meaning |
| --- | --- |
| `eventId` | Delivery/decision input identity. Every committed duplicate attempt remains in the journal and cannot execute twice. |
| `tradeId` | Optional genuine-source trade identity, scoped by source/product/currency. Distinct IDs may share a timestamp. Numeric `7` and string `"7"` are one ID. A repeated trade ID does not create new liquidity or prevent a genuinely new book update. |
| `bookSequence`, `bookId` | Executable-depth identity, separate from delivery/trade IDs. Positive latency requires an explicit monotonic integer sequence; the optional book ID must remain immutable. Retagging the same sequence or changing its depth/source time is a conflict. Historical book-ID reuse is checked against the committed archive. |
| `bookSourceAt` | Required independent source time of the depth. Receipt/ticker time cannot substitute for it. A cached book cannot become fresh because another trade or HTTP response arrives. |
| `decisionAt`, `eligibleAt`, `expiresAt` | Explicit synthetic processing time, decision time plus assumed latency, and fixed original deadline. Neither retries nor old books extend them. |
| `executedAt`, `simulatedFillAt` | Actual synthetic processing time of the qualifying later book. Never backdated to planned arrival eligibility. |

Book keys are scoped by source, provenance, product, base and quote. Delivery IDs, trade IDs, receipt times and ticker times are excluded. Same-time distinct trades are recorded independently, while shared cached depth remains unavailable for another attempt. Regressed book sequence/source time is rejected. A larger genuine sequence can have the same source timestamp; a later-book fill still needs a source time at or after the order's eligibility. Synthetic fixtures declare genuine sequence progression; a future public adapter must independently establish that provenance.

The compatibility schema-2 path retains its previous single-event/source-time semantics and is not a substitute for this explicit book-identity model. Public-price execution remains blocked in both paths.

## Order lifecycle and shared depth

Admission creates a durable `PENDING` order and reserves its maximum permitted buy notional plus fees, or its held sell quantity. Ledger cash and P/L do not change at admission. Available cash is ledger cash minus owned buy reservations. There is at most one pending order per product and one pending buy globally; the supported product set bounds active orders to two.

A pending order can attempt execution only on a distinct later book, after receipt, with `bookSourceAt >= eligibleAt`, fresh valid times, and processing time strictly before expiry. The decision book and late receipts of books sourced before eligibility cannot fill. Existing pending orders are processed before new proposals. The first eligible book receives one immediate-or-cancel attempt; the model cannot skip an unfavorable eligible book to select a later favorable one.

Every eligible terminal attempt consumes that product/book identity, including a risk rejection or no acceptable depth. Each level is walked once; any unfilled remainder is canceled. Another order, trade ID, delivery ID or restart cannot replenish that book. This conservative one-attempt rule can discard unused depth; it does not claim queue priority or replenishment. Multiple orders sharing a remaining-depth ledger are outside this slice.

Terminal states are `FILLED`, `PARTIAL_AND_CANCELED`, `CANCELED` and `EXPIRED`. Reservations release with the terminal transition exactly once. Entry caps, quantity, stop/target geometry, order generation and source identity stay bound to the original intent. Arrival risk independently checks the actual book and current account; it does not trust a caller-supplied book identity or admission-time approval.

## STOP, expiry and protective exits

STOP is an entry pause. It cancels pending buys and releases their reservations in the same durable command, and invalidates the old entry generation. Resume cannot revive a canceled order. Fresh eligible protective sells survive an entry STOP under their exit-policy and position generations, unless they expire. There is no STOP ALL state or guaranteed liquidation.

A triggered protective stop latches to the held position. It submits a delayed sell, cannot fill on its trigger book, and remains due after a rebound. Its later IOC uses actual arrival bids, with a depth/slippage limit relative to the arrival bid. A gap is not filled at the stop threshold. A partial or unsuccessful exit leaves the residual holding and protective obligation exposed. A later retry needs another source observation and another latency interval. Take-profit orders retain their minimum target-price condition.

Expiry can be driven without inventing data by a journaled clock command:

```sh
node src/cli.mjs advance-fixture --data "$fixture_dir" --now 103000
```

That command is for schema-3 stores and uses an explicit synthetic timestamp. Operator wall time remains separate. Ticker freshness cannot rehabilitate an old held-position book mark; stale marks make aggregate valuation unknown and block entries.

## Durable accounting and review limits

Pending intent, reservations, position generations, exit latches, consumed book identities and source high-water marks are part of state and checkpoints. Exact commands and before/after states are journaled before the authoritative head commits. Crash recovery follows the committed head; unreferenced prepared records cannot invent an order or fill. Archive lookups preserve identity across count and byte rollover.

Fees use actual fill notional. Decision-to-arrival drift, arrival depth impact and the explicit adverse-slippage assumption are recorded separately and reconcile to execution versus the decision benchmark. Favorable drift may be negative. Quantity, cash, fee, cost-basis and P/L reconciliation remain independently audited. Floating point tolerance is unchanged.

This implementation does not establish continuous-operation timing, finite disk usage, real power-loss behavior, market impact, exchange increments, queue position, venue availability or native browser accessibility. Journal scans grow with history and complete replay can be quadratic. Disk failure, corruption, slow scans or absent fresh books can prevent an exit or a durable STOP acknowledgment. Source/provenance verification and supervised runtime gates still precede any public-price paper run.
