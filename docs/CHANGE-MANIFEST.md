# Local patch / commit proposal

Base: `1009d02b1b74f6d600c4afad9a9d6679f920b4c8` on `neptune-2-clean-start`.

Proposed commit subject: **Build reviewed offline NEPTUNE 2 paper-engine slice and white operator sheet**.

No commit, push, merge, deployment, remote-ref write, backend/schedule edit, library installation, credential use, legacy import, or public-price simulated trade was performed. Implementation lives in a separate worktree; the original checkout is preserved. Main and archive were read-only verified at `b7e04ae43e2979c618296728ccc02de862b3b63a`; clean remote head remains the base above. Other branches were not edited.

## Changes

| Files | Change |
| --- | --- |
| `index.html`, `style.css`, `ui.mjs` | Replace the earlier dark market prototype with the white borderless five-section operator sheet, responsive column rules, unknown/stale behavior and confirmed persistent entry pause |
| `src/engine/{config,market,strategy,risk,execution,index,audit}.mjs` | Fresh synthetic-only strategy/risk/fill/accounting pipeline and independent financial reconciliation; explicit deterministic versions and assumptions |
| `src/market/coinbase.mjs` | Strict read-only BTC-USD/ETH-USD adapter; public data cannot execute; documented support and timestamp limits |
| `src/{store,cli,server,view}.mjs` | Durable serialized local state, bounded replay, one-shot observation, recovery guard, loopback state/stop API and coherent display projection |
| `fixtures/synthetic-market.json` | Explicitly hand-authored synthetic input, including a losing protective exit; no historical/public-price trading data |
| `test/{engine,market,integration,ui,adversarial}.test.mjs` | Offline module, application and independently authored adversarial coverage |
| `scripts/build-preview.mjs` | Generate a standalone white layout preview from production HTML/CSS, with unknown fields, disabled controls and no runtime/network script |
| `package.json`, `.gitignore` | Node built-in-only commands; isolated runtime data ignored |
| `README.md`, `docs/MARKET-SOURCES.md`, `docs/INDEPENDENT-REVIEW.md`, this manifest | Reproduction, operating assumptions, official source evidence, review outcomes and remaining release gates |

`AUTOMATION-SPEC.md` is unchanged. No other original tracked source was removed.

## Evidence

`npm test` on Node v24.19.0: **112 total, 110 pass, 0 fail, 2 explicit skips, 0 cancelled**. Independent adversarial tests: **28 pass, 0 fail, 1 skip**. `git diff --check` passes. Test log is supplied beside the exact patch artifact.

The skips cover native browser/accessibility/layout checks and an installed persistent-service observation. No prohibited Chromium launch or GitHub Pages endpoint retry occurred. Public Coinbase product probes failed/timed out; current venue support and live payload compatibility remain unverified. Official source URLs are listed in `MARKET-SOURCES.md`.

The standalone preview is a source-derived layout handoff, not a screenshot or evidence of native rendering. Rebuild with `node scripts/build-preview.mjs /tmp/neptune-2-preview.html`.

## Review boundary

A separate reviewer authored adversarial tests and reviewed implementation written by others. Corrected findings include synthetic-clock STOP/resume, accounting/position projection, aged UI source timestamps, fill-leg audit validation, and recovery races. No remaining identified must-fix defect exists within the bounded offline scope. This is not autonomous-release approval.

Remaining work: supported native preview/controls review; one successful read-only venue observation; full durable historical decision/input journal; capacity and rollover policy; nonzero latency/arrival-book modelling; measured source continuity/rate limits; supervised persistent service, recovery and STOP observations before public-price paper execution. The 10000-event cap currently halts all processing, including exits; zero-latency IOC is the only fill timing model. These limitations must not be obscured by passing tests.

Publication proposal: first review/apply this exact patch on the same clean base, review the white preview in a supported environment, then coordinate publication separately. Keep public execution disabled during the next read-only verification step.
