# Daily ECB reference cache compatibility fix (build 7)

## Scope and cause

The existing legacy collector used one-hour HTTP cache limits for both metadata and daily ECB reference FX. A valid cached daily response can exceed one hour even while its reference date is within the existing four-day accounting policy. Rejected refreshes eventually leave the previously retrieved FX unusable and prevent current paper valuation.

The endpoint is unchanged: https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=AUD . No new provider, credentials or subscription is introduced.

## Explicit policy

Only legacy Frankfurter FX HTTP Age and HTTP Date age limits become 345600 seconds (96 hours). The independent body reference-date limit stays 96 hours. Future dates, wrong pairs, malformed payloads and out-of-range rates still fail closed. This is a bounded daily reference policy, not a claim of latest or live FX.

The actual conservative receipt lower bound remains at most 30 seconds old. fetched_at remains that receipt bound, not the rate publication date or a fabricated time. The engine still requires local retrieval within one hour, and normal refresh requests remain at 15-minute cadence. Rejected replacements cannot update retained fetched_at.

Unchanged HTTP cache caps: metadata 3600 seconds, candles 60 seconds, live quotes/trades 5 seconds. Native USDC/USD market conversion also retains its separate 5-second cap. Provider quarantines, owner control, receipt immutability, fees, execution, risk and storage limits are unchanged.

## Source basis

Frankfurter documents daily rates and recommends the ECB-specific route: https://frankfurter.dev/ . Its daily reference endpoint advertises a cache lifetime longer than one hour. RFC 9111 distinguishes cached-response Age from freshness lifetime and the underlying representation: https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.3 . The selected application limit follows the already-reviewed reference-date horizon; it does not substitute HTTP timestamps for the rate date.

## Staged release and installation

MANIFEST.json and ATOMIC-NATIVE-UPGRADE.sql remain historical build 6, byte-for-byte. FX-CACHE-MANIFEST.json hashes those exact source inputs plus the explicit fx-cache-age.sql overlay as build 7. build-fx-cache-release.py reproduces the overlay manifest and guarded patch without rewriting historical installation pins.

UPGRADE-FX-CACHE.sql is the build-6-to-7 deployment artifact. It takes existing control then account locks, checks the exact predecessor build, config, feed_work body and security attributes, replaces only feed_work, and appends build 7 metadata. It does not call the collector, change owner state, alter permissions, reset caches or rewrite audit history. A running or stopped owner state is preserved. Reapplication or predecessor drift is rejected atomically.

After an authorized deployment, verify build 7 and the function hash, wait for the next normal collector batch, then verify a non-null FX reference and current valuation or inspect the separate market rejection reasons. Market-specific stale trade decisions can still make the global screen incomplete. No successful trade or return is promised.

Tests: npm test. The FX-specific regressions use generated synthetic public-market fixtures in isolated PGlite and make no network calls.

Validation scope: the public suite includes the 36-case synthetic collector boundary regression alongside the unchanged existing tests. Four additional migration, preservation and provenance tests were executed in private validation and are deliberately not included in the public package.
