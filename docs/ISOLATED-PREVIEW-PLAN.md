# Connected read-only browser preview — existing clean branch

Owner authorization covers implementation and a working preview. The parent approved publication through a normal, non-forced, expected-head push to **only `neptune-2-clean-start`**. The expected remote base is `29c959063d283f17f3807696953a106aef7afd73`; `67a7ae35017462b75df16e5e638d256de477a084` adds the reviewed source-time/spread/request-log fixes. No new repository or service is proposed. Main, archive, existing Pages source and existing site files remain unchanged.

## Connected artifact

`npm run build` (or `node scripts/build-public-preview.mjs`) produces `dist/`: `index.html`, `style.css`, `ui.mjs`, `public-preview.mjs`, the unchanged `src/market/coinbase.mjs` validator, `public-session.mjs`, `public-view.mjs`, and `build-manifest.json`. The manifest records the source commit/dirty status and exact byte counts/SHA-256 digests of all seven assets. The output allowlist/import-closure tests exclude engine, server, account-store, journal, fixture, credential and loopback entry modules. The shared renderer contains the inactive local dashboard function, but only the public entry is mounted; it sends no local API or POST requests.

The white compact monospace page keeps MARKET, DECISION, EXECUTION, ACCOUNT and ENGINE. It fetches actual credential-free Coinbase public observations once on opening and subsequently only after an explicit Refresh. The browser displays source ticker/book clocks separately from observation time. Quotes expire after 10 seconds; stale/future/unknown marks are hidden. The latest-20 activity log contains only actual request starts, responses, failures and cancellation events. No timer creates network activity, typing or heartbeat records.

BTC-USD and ETH-USD are **initial integration test markets only**, not final coverage, recommendations or picks. The owner's broad-market goal remains open and requires a separately validated discovery/universe layer; the page explicitly labels that limitation. DECISION remains WAIT, EXECUTION has no fills, ACCOUNT remains unknown/uninitialized, and ENGINE explicitly describes browser-only collection. STOP is disabled because there is no execution engine; Cancel aborts in-flight data requests. Closing the page creates no background runtime.

## Bounded requests and failure policy

A batch collects the two products sequentially. Each makes one product request, then four concurrent book/ticker/stats/candle requests, with the adapter's existing five-second per-request fetch/body deadline and 30-second collection gate. The browser wrapper additionally limits each decoded body to 5 MB, restricts origin/path/method, omits credentials, rejects redirects and connects cancellation to fetch and body reads. A failed/canceled batch clears all marks, including a product already collected earlier in that batch; there is no fallback labelled live.

Full refresh is manual and allowed at least 60 seconds after completion/cancellation. Consecutive failures back off 60/120/240/480/600 seconds, capped at ten minutes; a readable longer `Retry-After` on HTTP 429/503 takes precedence. Cross-origin header visibility can hide `Retry-After`, in which case conservative local backoff applies. There are no automatic retries, polling, service workers, history-cache time substitutions or scheduled jobs. The limiter is per open page, not a venue-wide or multi-tab guarantee. Reloading resets this in-memory state.

## Existing preview publication route

Repository-local `vercel.json` selects the dependency-free static build and `dist` output; it adds no functions, backend, proxy, access setting, security header or credentials. Existing GitHub/Vercel integration already created four non-production Preview deployment records for the builder's earlier push. Those records and exact URLs are historical evidence in `VERCEL-PREVIEW-EVIDENCE.md`, not proof of a served app. Parent web fetch of the earlier `ses-chef-labs-kqqlrbtb2-seachef.vercel.app` target was inaccessible.

1. Finish focused/full tests and independent review; fix findings. Commit the exact tested source locally. Build again at that exact commit and retain the manifest with `sourceDirty: false`.
2. Read the remote `neptune-2-clean-start` head again. Proceed only if it matches the expected base; otherwise fetch/reconcile/retest without overwriting another writer. Use a normal explicit `HEAD:refs/heads/neptune-2-clean-start` push, never force. No other remote ref is a publication target.
3. Confirm the remote SHA exactly. Read GitHub commit statuses, check runs and deployment/status records for that SHA. Existing Vercel Preview builds are authorized expected effects of this push. No platform-account changes, paid service, new credentials or cost commitment are authorized; stop that portion if needed.
4. Return GitHub-supplied preview URLs and static-build hashes. Executor access remains confined to approved hosts. Do not open unapproved Vercel hosts or disable browser sandboxing. Parent/browser verification should request the page and `build-manifest.json`, compare the exact revision/hashes, observe successful public GETs, manual refresh cooldown, stale-price expiry, failures and recovery. An HTTP 200 page or green build alone is insufficient.
5. Preserve the existing main/site. Any later rollback should be a reviewed normal revert on this preview branch, never a force push or a main/site replacement.

The existing loopback mode remains explicit: `node src/cli.mjs serve` serves the original local dashboard through `loopback.mjs`, including its durable local STOP behavior. Its server CSP remains self-only. The connected public build is separate and does not loosen the local server's security policy.

## Verification and remaining limits

Prior verification: unchanged adapter accepted both actual products through the existing managed proxy, ten HTTP 200 responses; CORS GETs for all five endpoint types returned `Access-Control-Allow-Origin: *` at 11:24 UTC on 11 October 2026. This is source compatibility evidence, not a browser-rendering guarantee. Current focused tests cover refresh, cancellation during fetch/body reads, deadlines/body bounds, rate limits/backoff, failure/recovery, expiry, pure projection, actual request logs, import closure and manifest integrity; full causal/loopback tests are retained. Final exact counts and independent review are recorded with the release evidence.

The one permitted sandboxed Chromium launch failed because its sandbox helper is misconfigured. No unsandboxed launch or permission change was attempted. Screenshots, mobile layout, keyboard/screen-reader behavior and real iOS hardware remain unverified. Broad coverage, sustained venue load, regional/browser access, and served-content proof remain separate from CI success. Public-price execution stays disabled. A browser-only data page makes no claim of an autonomous service, strategy performance or simulated public fills.

Reference for repository-local build settings: https://vercel.com/docs/project-configuration/vercel-json (official documentation checked 11 October 2026). No platform settings were accessed or changed.
