# Causal nonzero latency: next-step assessment

Status: **design assessment only**. This document adds no execution capability. Keep `latencyMs !== 0` rejected in `src/engine/config.mjs`; retain the public-observation execution block. Scope of the next model would be bounded, foreground **synthetic fixture replay** only. A configured delay would be an explicit simulation assumption, not measured exchange/network latency.

The smallest useful next change is a durable pending-order state machine plus a two-book synthetic acceptance fixture. Do that after the journal/checkpoint work passes independent review. Do not enable a positive latency merely by changing configuration validation or writing a later timestamp onto a fill made from the decision book.

## Current behavior and journal dependency

`strategy.mjs` makes a proposal from one observation. `risk.mjs` binds its event ID, source time and expected price to that same observation. `execution.mjs` immediately walks that observation's depth; `simulatedFillAt = now + latencyMs` is honest only because nonzero latency is rejected. `index.mjs` commits the fill and consumes the event in the same step. There is no durable pending order, reserved balance, later-book selection or cancellation lifecycle.

The journal/retention plan supplied for this assessment uses an atomic `state.json` head containing sequence/hash, immutable per-revision records in 128-record segment directories, typed commands, bounded before/after states, hash linkage, and full input/decision evidence written before the state-pointer commit. Audit walks the committed chain and replays commands; duplicate lookup can consult committed historical records. Audited checkpoints retain cash, positions and basis, fees, realized P/L, equity peak, controls, risk state, source high-water marks and lifetime counts while bounding active ledger/recent-event state. Historical records remain on disk; there is no deletion policy. Storage failure prevents fills. This is an integration dependency, not independent certification of the evolving journal implementation.

Latency adds pending orders, reservations, exit latches, expiry clocks and consumed-book identities to those checkpoint invariants. Rollover must not cancel them, release reservations, forget STOP generations or make old depth reusable. A prepared record that is not referenced by the committed head is not an acknowledged order or fill; recovery must follow the journal's documented committed-head rule, never adopt an orphan because it looks newer.

## Causal clock and book rules

Use the explicit, nondecreasing synthetic replay clock for trading events. Keep operator wall time and worker heartbeat separate; a wall-clock STOP command must not move a historical simulation into the present.

| Field | Meaning and rule |
| --- | --- |
| `decisionAt = t0` | Time the strategy processed its available decision observation. The journal records the exact decision input, version, reason and immutable intent. |
| `eligibleAt = t0 + latencyMs` | Earliest possible simulated order arrival. This is not automatically its fill time. |
| `expiresAt` | Fixed deadline established at proposal creation. Start with a bounded lifetime and `0 < latencyMs < lifetime`; never extend it on retry or receipt of an old book. |
| `bookSourceAt` | Source time of the executable-side book. Required independently of ticker/trade `sourceAt`; unknown book time cannot be replaced by receipt time or a trade timestamp. |
| `observedAt` | Time this later observation became available to replay. A book cannot be used before receipt. |
| `executedAt` | Processing time of the first eligible later book, at or after its receipt and `eligibleAt`, and before `expiresAt`. Store this actual simulated time separately from planned arrival. |

An execution book must have the same exact venue/product/base/quote identity and synthetic provenance, a distinct later book identity/sequence, and **`bookSourceAt >= eligibleAt`**. Its source/receipt times must be valid, nonfuture and within the configured freshness limits at execution. A new event ID or a new ticker attached to the old book does not qualify. Neither the decision book, a book received after arrival but sourced before it, nor a book already consumed for execution may fill the order.

Process already pending orders against a newly validated book before making any new proposal from that book. Any new proposal can only execute on a subsequent qualifying book. Journal order resolves equal-time events deterministically; do not sort a completed fixture by price or select a favorable future book. The first eligible later book gets one IOC attempt. Risk rejection or insufficient bounded depth ends that order; the engine cannot search later books for a better fill.

Example: a decision at 1,000 ms with 250 ms latency becomes eligible at 1,250 ms. A book sourced at 1,100 ms and received at 1,300 ms is ineligible. A different book sourced at 1,260 ms and received/processed at 1,280 ms can support a fill at **1,280 ms**, never a backdated fill at 1,250 ms. No eligible book before expiry means cancellation with no invented fill.

## Durable order, reservation and control lifecycle

Use an order ID derived from the journaled decision identity, product and generation. Keep decision-input identity distinct from arrival-book identity; the current single `eventId` relationship is insufficient. Retrying a command must find its existing transition, not create a second order.

The minimal lifecycle is `PENDING -> FILLED | PARTIAL_AND_CANCELED | CANCELED | EXPIRED`. Record exact reasons for every terminal state, including STOP, risk change, stale/invalid arrival input, gap outside entry limit, replay end and missing eligible data. Only a terminal fill transition affects balances. Each transition must atomically commit its typed command/evidence, order state, reservation change, consumed-book marker, ledger/accounting change and control state through the journal. Do not acknowledge persistence before the state head commits.

At creation, reserve each buy's maximum permitted notional plus fees under its fixed adverse-price cap. Reservations do not reduce ledger cash or create P/L: `availableCash = ledgerCash - reservedBuyCash`. Risk includes pending buy exposure alongside held exposure. Reserve sell quantity against the held position; never reserve or sell the same units twice. On a partial fill, charge only filled notional/fees, cancel the remainder and release the unused reservation in the same transaction. Every reservation is released exactly once. No arrival-time resize may exceed the original intent or reservation.

Keep at most one pending order per supported product and at most one pending buy globally; with the existing two-product allowlist this bounds active pending state at two. Protective exits for held products have priority over new entries. This bound permits an exit for one held product while an unrelated entry is pending. Exceeding the bound rejects new entries, without suppressing STOP or already admissible exits.

STOP must atomically persist the entry pause, advance the entry generation, cancel all pending buys and release their reservations. An entry admitted under an earlier generation can never fill after STOP/resume. Repeated STOP is idempotent. Resume never revives a canceled order; it requires a new decision and later arrival book.

For protective sells, use a separately versioned exit policy plus the held position's generation/quantity reservation. An entry STOP does not invalidate an already pending protective exit. This requires an explicit separation from today's generic `proposal.controlVersion` equality check, not bypassing it opportunistically. Changes to exit policy or held-position generation cancel/revalidate affected orders with journal evidence. The current policy remains: fresh synthetic protective exits are eligible while entries are paused; there is no guaranteed liquidation.

At execution, independently recheck provenance, identity, clock bounds, later-book identity, order deadline, STOP/policy/position generation, persistent risk halts, reservation ownership, cash, position quantity, aggregate exposure, order/position limits and current portfolio valuation. Never trust admission-time approval. Preserve original entry price cap, quantity, stop and target; cancel a buy if arrival pricing breaks its limits or protective geometry. Do not rewrite the original proposal's expected price to make the existing same-book risk check pass. Use explicit admission and arrival checks linked to the immutable order.

At arrival, age the original intent from `decisionAt` and age the arrival data from its actual source times against `executedAt`. Do not carry over the current `now - timestamp + latencyMs` expression unchanged: elapsed latency is already included at arrival, so adding it again would count the delay twice. A pre-eligible or already-seen book cannot execute a pending order; it also cannot extend that order's deadline.

## Stops, price gaps, depth and accounting

A protective stop first observed at `t0` becomes a latched exit obligation for the existing position. It cannot fill at the stop threshold or at the trigger book. Submit its delayed IOC attempt, then use the first eligible later **bid** book. A gap below the trigger is a real simulated loss relative to the earlier observation. If that book rebounds, the latched protective exit remains an exit; do not silently cancel it because the trigger is no longer present. A take-profit intent is different: preserve its explicit minimum-price condition at arrival and cancel when that condition fails.

For a stop exit, cap modeled depth impact/adverse slippage relative to the **arrival** best bid, so a gap does not masquerade as an exact stop-price guarantee. If acceptable depth is absent or partial, cancel the unfilled order remainder, retain the position's exit obligation and expose the unsold quantity. A subsequent attempt needs a new valid observation, a new order and its own latency; it must not reuse the consumed book. Stale or missing arrival data leaves the position exposed and is reported, not marked as sold.

Separate decision-to-arrival price drift from arrival depth impact and the configured adverse-slippage assumption. Their signed costs must reconcile to execution versus the decision benchmark; fees use actual simulated filled notional. Preserve cash conservation, proportional cost-basis removal, realized/unrealized P/L and unknown valuation behavior. Timing delay itself does not create an extra arbitrary cash charge.

Keep the conservative rule of one execution attempt per product/book identity, across all retries and order IDs. Walk each level once and cancel any remainder; no second order may claim the same displayed quantity. Carry the consumed-book high-water mark/identity through checkpoints and use the committed journal for historical duplicate checks. Do not infer replenishment merely because a new ticker arrived or the same depth was fetched again. Supporting multiple orders against shared depth later would require a per-book remaining-capacity ledger; it is outside this smallest slice.

## Bounded expiry, recovery and retention

Bound order lifetime and active bytes as well as count. Journal an explicit simulation-clock advance to expire orders without fabricating a market event. In a finite replay, orderly end-of-input cancels pending orders and releases reservations; preserve any held protective-exit obligation. A crash is different: recover committed pending state without changing `createdAt`, `eligibleAt`, expiry or generation, then process recorded/new subsequent synthetic inputs in causal order. Restart time cannot manufacture a fill or silently restart the latency timer.

Replay must reproduce pending states, cancellation reasons, reservation totals, consumed depth and fills, not only final cash. Checkpoint anchors include those states and all IDs needed to connect active orders to archived evidence. Segment rollover must preserve exits and pending deadlines. Full historical evidence grows on disk under the current retention plan; bounding RAM is not a claim of bounded storage. Low-space policy and durable-write failure must block new admissions and prevent any unjournaled fill. Storage failure may also prevent exits or a durable STOP acknowledgment; expose that limitation without claiming a guaranteed reserve of disk capacity.

## Acceptance tests before enabling any positive latency

All tests below use invented synthetic books and explicit clocks; no public-price simulated trades are needed.

| Case | Required evidence |
| --- | --- |
| Two-book causality | No same-step fill at `t0`; earliest qualifying later book fills at its processing time, never backdated arrival time. |
| Old or unknown book time | A late receipt of an old book, a missing book time, a future time and a new event ID carrying the old sequence all produce no fill. Include the 1,000/1,250/1,280 ms example. |
| First arrival and expiry | First eligible adverse book cannot be skipped for a favorable later book. Exact expiry boundary, no further data and end-of-input cancel without invented fills. |
| Concurrent reservations | Pending buys cannot overspend cash/exposure. A pending sell cannot oversell. Terminal rejection, partial fill, expiry and cancellation release reservations once. |
| STOP ordering | STOP before fill cancels entries atomically; a late fill command and resume cannot revive them. A fill committed before STOP remains in the ledger. Pending protective exits remain eligible under their separate policy generation. |
| Arrival risk | Loss/drawdown halt, stale held-product mark, identity change, invalid protection geometry and insufficient reserve veto buys even after admission. |
| Gap and rebound exits | Gap-stop fill uses later available bids, not stop price. Rebound does not erase a latched stop. Unfilled remainder stays exposed; a retry waits for a new later book. Take-profit price condition remains explicit. |
| Partial/shared depth | Multiple levels reconcile by independent arithmetic; duplicate/relabelled book and second-order attempts cannot reuse capacity. No fill exceeds reserved/held quantity. |
| Crash boundaries | Kill before/after order preparation, head commit, fill preparation and fill-head commit. Reopen/replay yields one committed transition and no duplicate cash, fill or reservation release. Orphan records never become acknowledged activity. |
| Rollover and corruption | Pending buy/sell, reservations, STOP generations, exit latches, deadlines and consumed-book IDs survive checkpoint rollover. Missing/corrupt evidence fails closed rather than resetting state. |
| Deterministic audit | Replay compares decision input, order and arrival IDs, times, lifecycle, reasons, depth legs and independent cash/basis/fee arithmetic—not just a final balance or the implementation's own serializer. |
| Existing gates | Zero-latency regression suite stays green; public observations still cannot execute; unknown book timestamps remain ineligible; no autonomous worker claim follows from passing fixture tests. |

The next smallest implementation step is the synthetic two-book pending-order path with atomic reservations and cancellation, independently challenged at STOP/crash boundaries. Keep positive latency disabled until those invariants and the journal replay path are complete. Native UI verification, public book time/source continuity and persistent service operation remain separate gates; this assessment clears none of them.
