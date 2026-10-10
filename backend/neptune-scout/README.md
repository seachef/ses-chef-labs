# NEPTUNE public research scout

This is a bounded, public-data-only deterministic collector. It discovers and checks Kraken USD and Hyperliquid USDC spot identities. It does not run AI reviewers, qualify buys, place paper/live orders, change entry/exit logic, access account balances/wallets, write the trading database or alter existing research/alert schedules.

The new workflow runs at UTC minutes 07,22,37,52. GitHub scheduling is best-effort, can be delayed, and may disable inactive public-repository schedules. The frontend must show original evidence time and stale/unavailable state, never imply continuous live quotes between scans.

## Permissions and publication

- Source lives on main, all new files under backend/neptune-scout plus .github/workflows/neptune-public-scout.yml.
- Read job: contents:read. Public providers receive no credentials. A separate child strips GitHub token environment variables before collection.
- Publish job: contents:write, which is repository-wide permission. This code fixes the sole write to seachef/ses-chef-labs, branch neptune-research-data, public/research-feed.json. It uses the observed file blob SHA with GitHub Contents API compare-and-swap. It cannot create a branch, force-push, delete files, merge main or change repository settings.
- Only base64+SHA256 sanitized JSON crosses jobs, at most65,536bytes. No actions artifacts or caches are uploaded. Raw captures/logs stay on the temporary hosted runner.
- New output must pass strict schema, exact source-commit/run binding, five-minute run span, and ten-minute publication freshness. No automatic retry after a conflict or uncertain write. It verifies the returned content blob SHA and then reads the exact published file back.
- The data branch must be created separately from an explicitly reviewed public commit before first dispatch. The first genuine run may create the missing feed file. Never seed a fabricated successful scan.

## Bounds and failure behavior

Public collector limits: two concurrent HTTP requests;12Kraken and12Hyperliquid requests per run;160Hyperliquid weighted units;2MiB per response read (one sentinel byte);8MiB accepted aggregate raw payload;2,048normalized identities;four deeper leads (two highest-volume coarse passes per venue);512KiB private runner snapshot;64KiB public output. Rejects redirects, duplicate JSON keys, implausible numbers and unsafe decimal exponents, stale/future evidence, wrong venues/quotes/tokens and owner-excluded assets. Shared-IP capacity is unknown; these are local budgets. The8MiB accepted-payload bound is not a claimed whole-process memory ceiling; concurrent/failed reads and JSON/Decimal overhead exist.

The parent kills its collector process group after180seconds, including slow-trickle reads; then writes a failed/unknown-coverage report using already atomically recorded provider state. Every new401/402/403/418/451 refusal is permanent pending reviewed intervention.429 respects Retry-After and at least15minutes; malformed Retry-After fails closed. A newly blocked provider is rechecked after reserved wait, before HTTP send. Already in-flight requests can finish. Successful runs do not silently clear a permanent refusal.

Before market requests, a fixed unauthenticated public GitHub workflow-runs read verifies the immediately preceding run completed successfully and is represented by the persisted feed. Missing/gapped/failed/unknown history produces a recovery_needed feed and makes no market calls. That latch persists across successful status publications. Recovery requires workflow_dispatch with recovery_from_run_id equal to the exact recorded blocked run, after the operator has investigated that outcome/provider state. This input never clears provider cooldowns. It is not an automatic retry or state reset.

GitHub hard termination or publication failure can lose the current local refusal file, but the next scheduled run is quarantined by the predecessor check. Public-history/API failure itself also fails closed. A hard failure in the very first run requires explicit reviewed recovery. No root/OS credential is created.

## Storage and independence

Database growth attributable to this workflow is zero: no SQL or database client exists here. Git history is not bounded by the latest-file size: up to96real updated snapshots/day create data-branch history. Identical or older output and any second payload for the same numeric workflow run ID are not committed. Publisher pauses before repository reported size reaches128MiB (observed baseline~32,028KiB). GitHub's size counter is approximate; this is a conservative pre-write guard, not a hard storage quota. No deletion/history rewriting is built in. Standard Ubuntu public-repository compute is free under current GitHub terms; this workflow uses no paid runner, artifact storage, new secret or OIDC.

Protective exits retain their existing independent database runtime. This does not fix or bypass the existing paper database's32/40MiB capacity guards.

## Tests

python3 -m unittest -v test_scout.py test_publish_feed.py test_scheduled_scout.py test_integration.py test_admission.py

The106tests cover original56collector cases plus publication attacks, persistent refusals, queued-refusal races, decimal exponent exhaustion, killable child deadline, refusal surviving a later collector failure, failed-run strict projection and verified one-file publication, predecessor gaps and exact manual recovery. All network/mutation calls in tests are mocked. The lead-contract worker separately tests the JavaScript schema/projector/assessment modules.

## Activation and rollback

1. Review the exact frozen source manifest and preserve all existing repository files/workflows.
2. Publish these new source/workflow files normally on main, without force.
3. Create neptune-research-data from the reviewed public commit. Do not change default branch or Pages settings.
4. Dispatch the workflow once without recovery input; inspect both jobs and genuine feed evidence.
5. Verify source commit/run ID, nonfuture original capture times, output SHA256/Git blob SHA, fixed public URL and schema. Confirm next natural scheduled run succeeds and respects previous state.
6. If uncertain, inspect exact run before using recovery_from_run_id. Do not replay archived captures as current or resubmit a PUT blindly.
7. To roll back, disable only this new workflow or remove only its scheduled trigger in a normal reviewed source commit. Preserve the data branch/feed so the app can honestly display expired research and cooldown state. Do not delete history, alter other automations, or change database permissions/guards.
