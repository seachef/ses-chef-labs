# Independent causal-latency review

Status: the independent synthetic latency suite and the final aggregate suite pass, and no remaining must-fix correctness issue has been identified in the reviewed local pending-order path. This is not approval for public-price execution, deployment or autonomous operation.

The comparison baseline is reviewed tree `6fe1eef92073280b78eb123304c192492a042824`: 171 tests, 169 passed, 0 failed and 2 explicitly skipped. This stage concerns the foreground synthetic pending-order model, its durable journal and its explicit market-book identity. Public-price execution remains outside the scope.

The independent reviewer owns only `test/latency-adversarial.test.mjs` and this report. Engine, source-identity, runtime and persistence changes are authored by other agents. All new inputs are invented synthetic values, and persistence tests use temporary directories. No network call, browser launch, credential, external order, installed service or remote-ref change is part of this review.

## Actual results and reproducibility

The independent run completed with **38 tests, 38 passed, 0 failed, 0 skipped and 0 canceled**, exit code 0. The output is saved at `/workspace/neptune-deliverables/latency-stage/independent-test-results.txt`. This is an actual executable result, not a count of planned checks. The 38 includes ten crash-boundary subtests. An earlier targeted regression run found one admission-boundary failure; it was fixed by the engine author and the final run verifies the fix.

Reproduce from the checkout:

```sh
node --test test/latency-adversarial.test.mjs
```

The baseline aggregate was 171 total, 169 passed, 0 failed and 2 skipped. The final aggregate is **265 total, 263 passed, 0 failed, 2 skipped and 0 canceled**, exit code 0, approximately 19.36 seconds. The parent ran it after source stabilization; the reviewer read and verified its saved summary at `/workspace/neptune-deliverables/latency-stage/test-results.txt` without launching a duplicate run. The two explicit native-browser/service verification skips remain; the independent new suite has no skipped cases. `git diff --check` and the new test file's Node syntax check also pass.

## Reviewed behavior

The independent suite verifies admission and arrival separately: cash is reserved without a fill; a late receipt of a pre-arrival book cannot execute; actual processing time is recorded; the original deadline is not refreshed; the first eligible adverse book cannot be skipped; and elapsed latency is counted once. Unknown, future or relabelled book evidence cannot fill. A favorable price below the immutable stop cancels the buy instead of changing its protection. Exact-deadline, explicit-clock and orderly-end cancellation release reservations without creating fills.

Event/trade identity and depth identity are separate. Two distinct trade IDs at the same source timestamp are consumed independently while sharing one unrenewed book. A new qualifying book can execute while carrying a cached trade ID and trade timestamp. A consumed shallow book cannot sell its displayed quantity repeatedly through new event/trade IDs, STOP or compaction. The durable path rejects an old book ID relabelled with a larger sequence after intervening books, compaction and restart.

Control tests verify cancellation and reservation release under repeated STOP/resume, retained protective exits during an entry pause, stop exits after a rebound, target-price conditions, a new portfolio risk halt and stale other-product valuation at arrival. With an ETH buy and BTC protective sell both pending, STOP cancels and releases only the entry reservation; the existing protective intent can still execute. STOP at the sell's exact expiry releases its quantity reservation while preserving the unsold position and protective obligation.

Independent arithmetic uses one invented unit purchased across asks `100.1 × 0.4` and `100.2 × 0.6`, a 10-basis-point adverse price assumption and a 10-basis-point fee. Buy notional is `100.26016`, fee `0.10026016` and cash `899.63957984` from a starting `1000`. A later gap-stop sells only half the holding at bids `97 × 0.25` and `96.8 × 0.25`, with the same assumptions: proceeds before fee `48.40155`, fee `0.04840155`, final cash `947.99272829`, realized P/L `-1.82706163`, and remaining basis `50.18021008`. The unsold half remains exposed. Decision-to-arrival drift, depth impact and assumed slippage are independently checked as separate signed costs; they reconcile to fill versus decision price without an extra latency cash charge.

Direct execution tests require current clock checks, matching normalized book identity, valid reservation ownership, current other-product mark age and synthetic provenance. Mutated quantities, deadlines, decision-book fields, reservation totals and available cash fail audit and cannot execute. Book-source age makes valuation unknown even in the short interval where the attached trade timestamp is still fresh.

## Crash evidence

Each boundary below terminates a real isolated Node process and is exercised once for order admission and once for fill: ten crash cases. Every injection asserts that its specified boundary was reached. No process returns a success acknowledgment after the injected exit.

| Crash point | Authoritative head after reopening |
| --- | --- |
| Before journal preparation writes | Previous committed state |
| During partial journal preparation | Previous committed state |
| After immutable journal-record publication | Previous committed state; published orphan does not become an order/fill |
| Before state-pointer rename | Previous committed state |
| After state-pointer rename, before acknowledgment | New coherent committed state |

Recovery requires the explicit dead-process lock-recovery operation and retains the interrupted lock evidence. Retrying admission yields one pending intent; retrying or completing arrival yields one fill and one reservation release. Reopening and semantic journal replay both pass. This stage's new crash tests complement the preceding journal suite's injected ENOSPC, fsync and rename failures; they do not replace that regression suite.

## Findings resolved during review

- Direct arrival risk initially trusted caller-supplied normalized book metadata. It now recomputes and compares identity against the actual arrival input, preventing old depth from being paired with a claimed later book.
- Direct arrival risk initially aged held marks against cached `state.asOf`. It now uses the execution clock, so bypassing the runner's marking step cannot approve an entry using stale holdings. Execution also rejects fractional or regressed clocks.
- Independent admission initially approved an already-consumed proposal after STOP/resume at the same simulated time. The runner already rejected it, but the exported admission function lacked its own control-generation and duplicate checks. The independently reproduced failure is fixed and now has a regression test.
- STOP at a pending sell's expiry initially left an expired reservation and failed the state audit. Expiry now runs before entry cancellation. STOP's causal status text also no longer claims there are no outstanding orders while a protective sell remains pending. The parent independently found this same boundary; this suite verifies the correction.

No implementation code was changed by the reviewer. Fixes were made by the implementation owners and then exercised independently. Passing their own implementation tests was not treated as sufficient evidence for this report.

## Review boundary

Software-boundary crash and write-fault tests cannot establish real power-loss, filesystem-controller or distributed-filesystem behavior. The journal remains unbounded on disk, archive scans remain a throughput limit, and a storage failure can prevent a durable STOP acknowledgment or a protective exit. Configured latency is a synthetic assumption, not a measurement of exchange latency, queue priority or future liquidity.

Positive latency is isolated to the new schema-3 synthetic path. The historical schema-2 zero-latency model keeps its previous economics and replay semantics; this report does not extend the new source-book guarantees to legacy inputs that lack independent book evidence. There is at most one execution attempt per product/book identity. Replenishment from a genuinely new supplied source sequence is a model assumption; the fixture does not authenticate a live source. Checksum and intent digests detect accidental corruption, not wholesale malicious replacement of local history.

Native browser layout/accessibility, live-feed compatibility and unattended persistent-service operation remain separate unverified gates. Passing synthetic tests cannot establish profitability or launch readiness.
