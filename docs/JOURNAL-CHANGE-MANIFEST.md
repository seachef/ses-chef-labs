# Durable journal continuation — reviewable patch proposal

Clean branch base: `1009d02b1b74f6d600c4afad9a9d6679f920b4c8`.

Preserved first-slice tree: `cc02395ed39579b4530c8e5622ae3000f13cf1ea`. Its original patch, source archive, preview, review and test log remain unchanged. The older `CHANGE-MANIFEST.md` and `INDEPENDENT-REVIEW.md` describe that historical checkpoint, including limitations resolved here.

Proposed continuation commit subject: **Journal NEPTUNE 2 commands and preserve protective exits across bounded-state rollover**. This is a local patch proposal; no commit, push, merge or deployment has been performed.

## Changed files since the preserved checkpoint

| Files | Result |
| --- | --- |
| `src/journal.mjs` (new), `src/store.mjs` | Immutable hash-linked command records, bounded record reads, prepared-file publication, authoritative state head, archive-wide duplicate lookup, explicit legacy migration and deterministic replay audit |
| `src/runtime.mjs` (new) | Deterministic typed commands with explicit clocks; synthetic initialization/snapshots, STOP/resume, worker state and read-only observations; 2 MiB active-engine compaction budget |
| `src/engine/checkpoint.mjs` (new), `src/engine/{index,audit,config,risk,execution,market}.mjs` | Version-2 accounting checkpoints, lifetime counts and latest fill; durable count rollover; preservation/audit of positions, cost basis, controls, risk and source high-water marks; bounded canonical market retention |
| `src/cli.mjs`, `src/server.mjs`, `src/view.mjs` | Route engine/control changes through journaled commands; expose journal audit and explicit migration; retain latest-fill display after active-ledger rollover |
| `test/engine-retention.test.mjs`, `test/journal.test.mjs`, `test/runtime.test.mjs` (new) | Checkpoint accounting, source/event identity, migration, byte/count bounds, crash-safe publication and cross-product economic equivalence |
| `test/journal-adversarial.test.mjs` (new) | Independently authored fault, crash, duplicate, replay, rollover, protective-exit and migration challenges |
| `README.md`, `docs/JOURNAL-REVIEW.md` (new), this file | Current contract, reproduction, independent outcomes and operational limits |
| `docs/CAUSAL-LATENCY-NEXT.md` (new) | Design-only assessment of the next causal two-book synthetic execution model; positive latency remains disabled |

The page HTML/CSS/UI, public market adapter, fixture, original tests, original specification and earlier review files are unchanged in this continuation. No new dependency or hidden/background worker was added. Main, the archive branch, original checkout, backend, schedules and access settings remain untouched.

## Commit and replay contract

Every acknowledged typed command has its exact JSON input, clocks, before/after state, decision and execution in the committed journal. Invalid market snapshots and duplicate snapshot attempts that reach a committed REJECT are included. Malformed/oversized commands rejected before commit and filesystem failures cannot promise evidence or acknowledgment. Original JSON values are preserved, not original fixture-file whitespace.

The record is durable before its head is published in `state.json`. Incomplete prepared files and unreferenced complete records are retained; the committed head alone selects history. A failure after publication can mean a committed operation with lost acknowledgment. Reopen and check/replay immutable event IDs; never infer that a thrown error means the fill did not commit. Explicit lock recovery retains its old evidence and refuses uncertain/live owners.

Active ledger/event arrays roll over at the event-count limit. The runtime also compacts above 2 MiB of serialized engine state. Checkpoints retain financial state, positions/basis, fees, equity peak, risk, STOP generation, source clocks, latest fill and lifetime counts. Exact inputs and previous accounting records remain on disk. Canonical active snapshots omit unrelated extra metadata; the raw command retains it. A rejected ID remains consumed for duplicate detection even if a corrected payload arrives later. Protective exits are tested across capacity boundaries while entries are paused.

Fresh stores have a complete committed-command history. Explicit migration retains exact legacy envelope bytes and labels unavailable earlier inputs; it cannot reconstruct old decisions. Corrupt or missing committed evidence fails closed. Checksums are corruption detection, not authentication against a local attacker.

## Reproduction and evidence

Node v24.19.0; no install step and no external services required:

```sh
node --test test/*.test.mjs
node --test test/journal-adversarial.test.mjs
git diff --check
```

The first-slice baseline was re-run from its exact preserved tree: **112 tests, 110 passed, 0 failed, 2 skipped**. The final continuation run returned exit 0: **171 tests, 169 passed, 0 failed, 2 skipped, 0 cancelled**. The new independent journal suite accounts for **29 passed, 0 failed, 0 skipped**. The complete run took about 19.3 seconds in this environment; this is a fixture-test duration, not an operational throughput benchmark. Artifact hashes are recorded in the accompanying receipt.

Synthetic CLI smoke check, with no persistent worker:

```sh
fixture_dir=$(mktemp -d /tmp/neptune2-journal.XXXXXX)
node src/cli.mjs replay --input fixtures/synthetic-market.json --data "$fixture_dir" --arm-fixture
node src/cli.mjs replay --input fixtures/synthetic-market.json --data "$fixture_dir"
node src/cli.mjs journal-audit --data "$fixture_dir"
node src/cli.mjs stop --data "$fixture_dir"
node src/cli.mjs journal-audit --data "$fixture_dir"
```

The fixture remains a losing arithmetic example: two fills, final cash 9997.48376 USD, realized/net loss 2.51624 USD, no open position. It is not a profitability result. The repeated replay adds input/rejection evidence without adding fills or resetting cash.

## Remaining limits and next step

History grows indefinitely on disk. Each read/duplicate lookup is linear in committed history; full command replay can be quadratic. Segment directories span 128 sequence positions; this is organization, not a deletion policy. Documents/commands are capped at 16 MiB and records at 96 MiB. Active engine state is bounded, but disk capacity, total historical storage and continuous-operation timing are not established. Storage failure, damaged evidence, slow scans and missing fresh data can still block protective exits and durable STOP acknowledgment. No guaranteed liquidation is claimed.

Injected ENOSPC/EIO and abrupt child-process exits exercise software ordering. Actual power-loss durability, filesystem portability, native browser/layout/accessibility, public venue connectivity/payloads, service installation/heartbeats and an unattended run remain unverified. The two explicit baseline skips remain visible. No forbidden browser or denied endpoint was retried.

Public market support is still the documented read-only Coinbase Exchange BTC-USD/ETH-USD adapter contract, with current connectivity and real payload compatibility unverified; see `MARKET-SOURCES.md`. No public-price simulated trades occurred. The white preview already delivered to Craig remains a layout handoff, not native-rendering proof; its generated illustration is labeled as an illustration.

The smallest next coding step is a durable pending order with reservations, explicit entry-STOP cancellation and a distinct later synthetic book whose source time is at or after arrival eligibility. Independently challenge causal timing, gaps, expiry, rollover and crash recovery before enabling positive latency. Native preview review and one successful read-only venue observation are separate launch gates. Publication remains separately coordinated.
