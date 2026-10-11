# Isolated standalone preview — review plan, not deployment

Foundation: `29c959063d283f17f3807696953a106aef7afd73`, tree `ee87aeef3ee6efed503313ba0dc771d9da5f5e8f`. The isolated checkout is `/workspace/scratch/neptune-2-29c9590-reconciled-20261011`. Earlier adapter evidence and UI changes from `c4a707f42d5eef86c3f775214301085c08205c10` were preserved, then reconciled without replacing the new causal execution work. The adapter is byte-for-byte unchanged between these foundations. The original setup/main checkout was not edited. This continuation changes only UI source-time/spread display, actual request activity, related tests and verification documentation; the feed adapter and execution engine are unchanged.

## Prepared artifact and acceptance criteria

Build with `node scripts/build-preview.mjs /workspace/scratch/neptune-2-verification-evidence-20261011/standalone-preview/index.html`. This uses the current page and inlines its CSS. It removes the UI script and disables controls, so opening it cannot fetch market/account data, submit a stop, or run any engine. The artifact truthfully identifies itself as a static layout preview, with unknown state and no request activity. It contains the five sections MARKET, DECISION, EXECUTION, ACCOUNT, ENGINE, compact monochrome monospace styling, a white background, and no cards or decorative borders. CSS inspection is not visual browser verification.

The dynamic loopback page remains separately available through the documented `serve` command. An observation-store page shows genuine recorded source/receipt clocks and stale marks once expired. Its bounded terminal log shows actual state requests; it is neither a fabricated heartbeat nor an autonomous service. Do not label the static artifact as a connected dashboard. GitHub Pages cannot run this Node server or a persistent engine.

## Proposed publication isolation

Existing Vercel integrations have already recorded previews for the builder's `29c9590` push; see [the exact GitHub evidence and URLs](VERCEL-PREVIEW-EVIDENCE.md). Their served content and backend remain unverified. The reconciled continuation stays local: pushing to the current origin can itself trigger deployments. The separate-site plan below is a proposal, not permission to push or deploy.

1. Review the exact local revision, static artifact, evidence manifest and passing tests. Complete supported sandboxed desktop/mobile viewport review and actual iPhone/iPad review before claiming those experiences are verified. The single browser probe here failed; do not change sandbox permissions or retry without sandboxing.
2. After explicit publication approval, use a **separate repository and Pages site**, proposed name `seachef/neptune-2-preview` (availability not checked, repository not created). Confirm ownership, approved public visibility and existing no-charge Pages eligibility at that time. No paid service is selected or provisioned.
3. Publish only the reviewed generated `index.html` and artifact checksum manifest to that dedicated repository's publication branch. Do not copy journals, captured public feeds, fixture state, credentials, a `.git` directory or source-workspace files. Do not merge into `ses-chef-labs/main`, switch the existing Pages source, change a domain, or overwrite `/ses-chef-labs/preview/research-desk/`.
4. The proposed new URL would be `https://seachef.github.io/neptune-2-preview/`; it is a proposed destination, not an existing or deployed page. Verify the new response, artifact hash, five-section page, disabled controls, and absence of network/execution behavior after any future authorized publish. Recheck the existing site URL to confirm it is unchanged.
5. Rollback only the new preview site's artifact commit or disable its Pages publication after authorization. The current site/source remains untouched throughout.

No publish command, workflow, repository creation, account access, permissions change, paid service, credential operation, main merge or deployment was executed in this task. This document is the reviewable proposal; publication is a separate future approval gate.

## Remaining gates beyond static publication

- Sandboxed browser screenshots, small/mobile/tablet layout and overflow, keyboard focus, screen-reader behavior; actual iOS hardware testing remains distinct from viewport emulation.
- Runtime-specific proxy configuration: the managed environment's default Node fetch failed; Node 24.19.0 `--use-env-proxy` succeeded using existing proxy settings. The flag must be supported and appropriate in any later runtime.
- Repeated read-only observations, rate-limit behavior and controlled outage/recovery; the successful capture is a point-in-time compatibility check only. Full level-2 book sizes and 168 hourly history buckets should not be polled at an unmeasured rate.
- Public-price paper execution remains disabled. Any later release needs a separate policy decision, current public-source provenance and independent execution validation. The new foundation already implements synthetic causal latency/arrival-book modelling; those tests do not authorize or validate public-price execution. Public quotes are never simulated fills.
- Persistence capacity, bounded operational scans, hardware/power-loss behavior, supervision, restarts, STOP observations and any approved isolated paper run. Foreground `serve` or `observe` processes establish no browser-independent autonomous service.
