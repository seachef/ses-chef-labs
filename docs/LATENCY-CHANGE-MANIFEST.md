# Causal latency continuation — reviewed local patch proposal

Clean branch base: `1009d02b1b74f6d600c4afad9a9d6679f920b4c8`.

Preserved journal-stage tree: `6fe1eef92073280b78eb123304c192492a042824` (169 passed, 0 failed, 2 skipped). The first-slice tree `cc02395ed39579b4530c8e5622ae3000f13cf1ea` and both earlier artifact sets remain unchanged.

Proposed continuation subject: **Model causal synthetic pending orders with durable reservations and shared-book protection**. No commit, push, merge or deployment has been performed in this stage. Source changes remain locally reviewable on `neptune-2-clean-start`.

## Exact changed files since the journal checkpoint

| Files | Result |
| --- | --- |
| `src/book-identity.mjs` (new) | Separate scoped book, trade and delivery identities; explicit sequence/source-time progression; immutable book-content evidence and duplicate/conflict checks |
| `src/engine/causal.mjs`, `causal-state.mjs`, `causal-risk.mjs`, `causal-execution.mjs`, `causal-audit.mjs` (new) | Schema-3 pending-order lifecycle, reservations, first eligible later-book IOC execution, latched protective exits, STOP cancellation, expiry, independent admission/arrival risk and accounting/identity reconciliation |
| `src/engine/{index,config,checkpoint,audit,market}.mjs` | Opt-in positive latency for new synthetic stores; causal state/checkpoints, independent book-age marks, compatibility with schema-2 replay and existing zero-latency defaults |
| `src/{runtime,journal,store}.mjs` | Typed clock/end-of-input commands; committed-history lookup for trade identity, attempted book capacity and historical book-ID reuse; deterministic replay through the same captured evidence |
| `src/cli.mjs` | Explicit `--latency-ms`, `--order-lifetime-ms`, `advance-fixture --now`; orderly EOF cancellation; existing-store configuration remains fixed |
| `src/view.mjs`, `ui.mjs` | Display pending eligibility/expiry, lifecycle reason, reserved and available cash; causal book freshness cannot be refreshed by ticker receipt; preserve the white five-section layout |
| `fixtures/synthetic-causal-market.json` (new) | Invented old-book late receipt, eligible later entry and losing delayed gap-stop exit |
| `test/{book-identity,latency-engine,latency-runtime,latency-adversarial}.test.mjs` (new) | Identity, causal timing, restart, expiry, CLI/UI projection, depth conservation, STOP, crash recovery and independently computed accounting regressions |
| `test/engine.test.mjs` | One intentional configuration assertion update: positive latency is now allowed; at-lifetime and fractional latency remain invalid |
| `README.md`, `docs/LATENCY-CONTRACT.md`, `docs/LATENCY-REVIEW.md`, `docs/OPERATOR-INTEGRATION.md`, this file | Current contract, independent evidence, reproduction, operator activity direction and release limits |

The public Coinbase adapter, original fixture, HTML/CSS, original specification and earlier review documents are unchanged. No external project code, new dependency, exchange-order API, credentials, legacy backend, schedule or hidden worker was introduced. The original checkout and main/archive refs remain untouched.

## Evidence

The exact preserved journal tree was re-run before changes: **171 total, 169 passed, 0 failed, 2 skipped**. The final suite on Node v24.19.0 completed with exit 0: **265 total, 263 passed, 0 failed, 2 skipped, 0 cancelled**. The independent causal suite contributes **38 passed, 0 failed, 0 skipped**, including ten abrupt-crash cases split across order admission and fill publication. The full run took about 19.4 seconds; this is fixture-test timing, not a continuous-operation benchmark.

```sh
node --test test/*.test.mjs
node --test test/latency-adversarial.test.mjs
git diff --check
```

Independently implemented regressions prove that one shallow cached book cannot replenish its consumed quantity through new delivery/trade IDs, STOP or compaction, and separately reject archived book-ID reuse after restart. Another regression records distinct genuine trade IDs at the same timestamp without granting either new book depth. A new qualifying source book can execute while carrying an unchanged cached trade ID; trade and book identity are not conflated.

The review also checks first-eligible-book timing, expiry, immutable entry geometry, STOP generation, pending protective exits, proportional cost basis, signed drift/depth/slippage costs, current mark age, forged normalized-book input, corrupted reservations and intent, and crash recovery with exactly one order/fill effect. Exact golden command hashes from the preserved schema-2 implementation verify compatibility for its original fixture and STOP sequence.

The two skips still cover native browser/accessibility/layout verification and an installed persistent-service observation. Neither was inferred from Node tests. The [independent review](LATENCY-REVIEW.md) records the actual fault boundaries and resolved findings.

## Transfer and publication evidence

The supported Library batch flow was attempted for the preserved 169-pass source archive, full patch, incremental patch and receipt. It failed before upload preparation with `hosted apps tools/list request failed: network`. No Library IDs, upload sessions or successful create operations were returned. No HTTP denial status or approval-review rejection was supplied. Valid local files and hashes remain preserved, with an explicit failure receipt outside source at `/workspace/neptune-deliverables/library-transfer/journal-library-transfer-receipt.json`. No direct-write fallback or restriction bypass was attempted.

The separately authorized ordinary Git read succeeded through the existing `origin` remote. `git ls-remote --heads origin refs/heads/neptune-2-clean-start` returned `1009d02b1b74f6d600c4afad9a9d6679f920b4c8`. Read access is verified; push access is not. A proposal was returned to publish only the already accepted journal-stage tree in an isolated checkout, rechecking the head before a normal branch-only push and stopping on concurrent change. That proposal excludes this later causal work until separately coordinated. No commit or remote write followed the assessment.

## Limits and smallest next launch step

Positive latency is an explicit synthetic assumption, with at most one attempt per product/book. Fixture sequence progression is declared evidence and does not authenticate a live source or prove replenishment. Legacy schema-2 inputs retain their earlier semantics; new book guarantees apply to causal schema 3. Public-price execution remains blocked in both models.

Pending intent/reservations are bounded and survive checkpoints, but historical disk use is unbounded; reads/identity scans grow with history and complete replay can be quadratic. Storage errors, corruption, slow scans and missing fresh books can prevent exits or STOP acknowledgment. Tests inject software failures and kill processes; they do not establish hardware power-loss safety, filesystem portability, real impact/queue behavior, profitability or autonomous readiness.

A separate task reported successful public endpoint reads in the republished environment. That evidence does not verify this adapter's compatibility or constitute deployment of the new page. The next launch step is supported transfer of the reviewed source, followed by actual adapter/read-only UI verification there, native preview review and supervised runtime/storage/STOP checks. Craig's terminal-style activity clarification preserves the white design and requires real timestamped records and genuine heartbeat evidence; fuller activity integration remains a later step.
