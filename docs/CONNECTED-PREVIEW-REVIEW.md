# Connected read-only browser preview — 11 October 2026

This continuation is based on local `67a7ae35017462b75df16e5e638d256de477a084` and remote `29c959063d283f17f3807696953a106aef7afd73`. The owner authorized implementation and publication through a normal, non-forced push to only `neptune-2-clean-start`, including the existing automatic Vercel Preview builds. The exact published source SHA and GitHub deployment results are recorded in the delivery evidence. Main, archive and existing Pages source are not publication targets.

## Delivered behavior

- `public-preview.mjs` mounts the five existing white monospace sections with a read-only browser session. Opening the page starts one actual public observation; later reads require Refresh. No strategy, engine, account, journal, orders, background worker or fake heartbeat runs in the public page. WAIT and unknown account fields remain explicit.
- `src/market/public-session.mjs` uses the unchanged Coinbase adapter, restricted credential-free GETs, five-second endpoint deadlines, cancellation through both fetch and body reads, a five-MB decoded-body ceiling and latest-20 actual request events. A failed or canceled batch clears all observations, including a previously successful product in the same batch.
- Full refresh waits at least 60 seconds after completion/cancellation. Consecutive failures impose 60/120/240/480/600-second backoff; a readable longer Retry-After on 429/503 takes precedence. There are no automatic retries. The in-memory limiter is per page; reloads and multiple tabs are not a venue-wide rate limit.
- `src/market/public-view.mjs` projects validated observations without importing runtime/account modules. Ticker source, book source and receipt clocks remain distinct; all three must pass the ten-second freshness gate. Expired, future or missing timestamps hide current marks. History is an observed window with missing-bucket coverage, never an all-time-low claim.
- BTC-USD and ETH-USD are labelled initial integration test markets, not final coverage or picks. Broad-market discovery remains open.
- `loopback.mjs` retains local dashboard mounting and durable STOP behavior. The local server adds only that static entry route; its self-only CSP and write restrictions are unchanged. The static builder excludes the loopback entry and all engine/server/store/journal code. The shared renderer retains an inactive local dashboard function; the public entry never mounts it.
- `npm run build` produces exactly seven assets plus `build-manifest.json`. The manifest records source commit/dirty state, bytes and SHA-256 for every asset. Repository-local Vercel configuration selects this dependency-free static build and `dist` output without platform/account changes.

## Verification

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full suite: `node --test test/*.test.mjs` | 282 | 0 | 2 |
| Independent reviewer: public/UI/integration suites | 35 | 0 | 1 |
| Independent timestamp/error adversarial probes | 16 | 0 | 0 |

The full suite ran on Node 24.19.0 in 73.84 seconds. Its two retained skips are native browser/device/accessibility checks and installed persistent-service verification. Existing causal order, reservation, journal, accounting and STOP tests remain intact. Added loopback assertions verify the original page entry, JavaScript MIME, self-only connection policy and exclusion of the public entry from that server.

Focused public tests cover independent clock expiry, unknown history, concurrent-refresh prevention, credentials/method/redirect restrictions, 429/503 backoff, recovery, cancellation during fetch/body reads, late completion, hung/oversized/malformed responses, partial-product failure, destroy cleanup, UI aging without polling/logging, and static import/manifest closure. The builder's seven asset hashes are checked against the actual emitted bytes.

Independent review initially found that unvalidated source-time strings could forge log lines or retain oversized text. The fix permits only bounded valid UTC book/ticker timestamps and bounds/control-strips error messages. Regression tests and 16 independent probes cover newline injection, one-million-character strings, invalid calendar dates and Unicode line separators. The reviewer also verified simultaneous cancellation of four endpoint bodies without retained observations or a subsequent ETH request. Final disposition: PASS, no remaining must-fix findings. The review involved no source edits, network, browser or publication action.

The Coinbase adapter remains byte-identical to the foundation, SHA-256 `f4252e3849c0309d1a341ad2b7db75f45757040d674fb92a97c34de3525711b6`. Engine, runtime, store and journal implementations are unchanged.

## Bounded real-request evidence

At `2026-10-11T11:36:04.518Z`, the browser-safe session and projection ran once under Node with the environment's existing managed proxy. Product, level-2 book, ticker, stats and candles returned HTTP 200 for both products: ten GETs total. Both observations validated, account was null and executions were empty. This preceded the log-format hardening; the adapter/transport behavior was unchanged. It is module/source-compatibility evidence, not a browser-rendering or simulated-fill result.

| Product | Ticker source UTC | Book source UTC | Observation UTC |
| --- | --- | --- | --- |
| BTC-USD | 11:36:02.732522941 | 11:36:02.986855084 | 11:36:04.140 |
| ETH-USD | 11:36:01.745899148 | 11:36:02.386962843 | 11:36:04.477 |

All dates above are 11 October 2026. Endpoint-type CORS probes at 11:24 UTC returned `Access-Control-Allow-Origin: *`; Retry-After was not exposed. Raw observations and the actual request log remain outside source control at `/workspace/scratch/neptune-2-verification-evidence-20261011/connected-session-live-check.json`; the full test log is `connected-final-tests.tap` in that directory. Public quotes are not simulated fills or strategy performance.

## Remaining verification limits

The single permitted sandboxed Chromium launch failed because its sandbox helper is misconfigured. No unsandboxed retry, browser installation or permission change was made. Desktop rendering, keyboard/screen-reader behavior, mobile layout and native iOS remain unverified.

The executor may read GitHub-provided statuses and immutable preview URLs but does not open unapproved Vercel hosts. Green deployment records are not proof of served asset identity or working browser CORS requests. Compare the served `build-manifest.json` and seven asset hashes with the exact source commit, then check opening/Refresh, ten-second expiry, cancellation, cooldown and recovery in an authorized browser. No production/account setting or cost commitment is part of this release. Any public-price paper policy or autonomous service remains separate.
