# Read-only feed and UI integration review — 11 October 2026

Final foundation: `29c959063d283f17f3807696953a106aef7afd73`, tree `ee87aeef3ee6efed503313ba0dc771d9da5f5e8f`. The earlier `c4a707f` checkout, test results, raw public observations and original UI patch are preserved separately. Changes were reconciled on a new isolated local branch, `verification/coinbase-ui-20261011`, without changing the causal engine, pending/reservation rendering, source adapter, runtime, persistence, CLI or server.

## What changed

- Display ticker source time, book source time and local observation time separately. Previously the page displayed only observation time despite saying that source times were shown.
- Preserve up to six decimal places in basis-point spreads. The captured BTC spread is about 0.001206 bps and previously displayed as zero.
- Add a latest-20 actual page-request log inside ENGINE. Entries are timestamped only on requests, responses, failures and confirmed local STOP acknowledgments. Aging old data does not create logs, polling or heartbeats. This is page activity, not a journal-backed history terminal or proof of a background worker.
- Document the measured public observations, existing managed proxy requirement, browser blocker, existing automatic Vercel preview records, and an isolated static publication proposal.

No old application code was imported. The five white monospace sections and the new foundation's causal pending-order/reservation UI remain intact.

## Actual validation

| Check | Passed | Failed | Skipped | Meaning |
| --- | --- | --- | --- | --- |
| Original c4a707f baseline | 169 | 0 | 2 | Reproduced supplied baseline |
| c4a707f plus small UI fixes | 172 | 0 | 2 | Preserved before reconciliation |
| New 29c9590 baseline | 263 | 0 | 2 | Reproduced before integration |
| Final reconciled full suite | 266 | 0 | 2 | Three additional focused UI tests; causal tests preserved |
| Archived real payload checks on reconciled source | 9 | 0 | 0 | Hashes, real shapes, stale/mismatched rejection, no public-price replay, expiry |
| Independent Python Decimal checks | 2 | 0 | 0 | Raw level sorting, identities, exact spread/depth arithmetic |

Full-suite skips remain native device/browser/accessibility verification and installed persistent-service verification. One permitted sandboxed Chromium launch was attempted and failed because its sandbox helper is misconfigured; no retry or permission change was made. No screenshots or mobile viewport claim is available. Real iOS hardware testing remains a separate gate.

Four local GET routes (`/`, `/style.css`, `/ui.mjs`, `/api/state`) returned 200 with expected content types. The state API showed two expired recorded public observations, no account, no pending orders, no fills, and stopped entries. The saved state file was unchanged and the temporary server was closed. Static artifact checks confirmed five sections, two disabled controls, no scripts/external URLs, monochrome compact monospace CSS and no animation. These are HTTP/source checks, not rendered-layout tests.

## Transport and market evidence

Default Node fetch failed before HTTP for BTC-USD and timed out for ETH-USD. Node 24.19.0 supports `--use-env-proxy`; using it honored the environment's already configured proxy without changing network policy, credentials or TLS checks. The unchanged adapter then received ten HTTP 200 responses and accepted both products at 11:08 UTC. No denial was routed around. The adapter SHA-256 is `f4252e3849c0309d1a341ad2b7db75f45757040d674fb92a97c34de3525711b6` in both foundation commits and this continuation.

Exact decoded response bodies, hashes, endpoint URLs, HTTP status, receipt and nanosecond source-time strings are in the evidence directory's `managed-proxy/raw-public/` and `managed-proxy/public-adapter-verification.json`. Normalized adapter timestamps are milliseconds, as designed. Decimal arithmetic uses raw price times aggregate quantity, without multiplying by order counts. The observation store audit passes with one committed record; `engine: null`, zero fills and stopped entries establish the collection/execution boundary. Read-only public quotes do not establish simulated fills or strategy performance.

Evidence root: `/workspace/scratch/neptune-2-verification-evidence-20261011`. It contains baseline/final logs, the default-transport failure, managed-proxy success, independent checks, the single browser failure, loopback/static checks and raw GitHub check/deployment records. Public captures remain outside source control.

## Review gates

See [the isolated publication proposal](ISOLATED-PREVIEW-PLAN.md) and [Vercel evidence](VERCEL-PREVIEW-EVIDENCE.md). Existing GitHub records tie four successful Preview deployments to 29c9590, but their five target URLs were not opened because they are outside the approved executor hosts. Served commit identity and remote backend presence/absence remain unverified. No branch was pushed, main merged, project changed, credential accessed, real/demo order sent, paid service provisioned or deployment requested by this task.

The current main/setup checkout remains clean at `b7e04ae43e2979c618296728ccc02de862b3b63a`. Persistent runtime supervision, outage/rate-limit recovery, storage sizing, real power-loss evidence, native review and public-price paper policy remain separate gates. A foreground observation or preview process is not an autonomous service.
