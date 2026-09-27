# Sea Chef Labs phone alerts — 27 September 2026

Status: notification groundwork, NOT an active alert service.

## What changed
- Existing dashboard design and data logic retained. The full bottom watchlist has its own **All coins** disclosure, closed by default.
- **Phone alerts · setup** appears inside Menu.
- Home Screen manifest, dedicated permission/subscription page and push-only service worker. No app or price caching added.
- Separate Node 24 notification service with private pairing, origin restriction, validated vendor endpoints, private SQLite subscriptions, explicit test notifications, and device removal.
- Persistent per-device event deduplication survives restart. A delivery timeout is recorded as unknown and is not automatically resent. This prefers missing an uncertain delivery over duplicating it; it is not an exactly-once delivery guarantee.
- All missing or expired qualification evidence blocks qualification. The dispatcher is blocked by default and no public endpoint can supply qualification events.

## What is not built or enabled
- No hosted server, real phone subscription or delivered iOS push has been verified.
- No running server-side market collector or completed qualification algorithm exists in this change. `qualification.mjs` checks the completeness/freshness of a future trusted collector's output; PASS claims alone do not prove the underlying market facts.
- Current browser gauges and scores never generate a qualification alert. We have not promoted two rising samples into an approved buy.
- No automatic trading, wallet secret access, live orders or exchange account access.

## Qualification work needed before coin alerts
The future collector must independently establish every check, identify the exact chain/token/pool, retain its source evidence, and create a stable episode ID only when a setup transitions into qualification. A new poll timestamp is NOT a new episode. Unknown/stale evidence must not reset an active episode. A further alert requires a genuinely new setup after an evidenced failure/rearm and a defined cooldown.

Required checks: identity; at least seven days of sourced trading history (not local first-seen or newest-pool age); fresh rolling 24H decline of at least 10%; recovery based on completed candles and a defined base/higher-low rule; executable buy AND sell liquidity at the chosen size; token/security restrictions; material supply/unlocks/concentration; and fee/slippage/FX evidence for the planned amount. These checks have not been quantitatively calibrated or validated as predictive. A price decline or rising gauge alone never satisfies them. Unknown evidence stays unknown. “All checks passed” never means certain profit.

## Hosting setup (not performed)
Use a private persistent Node 24 service behind HTTPS. GitHub Pages only hosts the static app; it does not run this service. Do not commit private notification keys, pairing codes, subscriptions, database files or environment files.

From `server`, run `npm ci --ignore-scripts`. Generate a VAPID key pair locally using the installed web-push library; keep its private half in the hosting provider's secret settings. Generate a separate random pairing token (at least 32 characters). Neither is a wallet/exchange key. Configure:
- SCL_APP_ORIGIN: exact HTTPS origin of the deployed app (origin only).
- SCL_PAIRING_TOKEN: private random token, entered on Craig's own phone for registration.
- SCL_VAPID_PUBLIC_KEY / SCL_VAPID_PRIVATE_KEY: generated notification key pair.
- SCL_VAPID_SUBJECT: operator HTTPS contact URL or mailto contact.
- SCL_DATA_DIR: private persistent disk outside the publicly served directory.
- PORT: assigned server port; HOST defaults to loopback for an HTTPS reverse proxy. Set HOST=0.0.0.0 only on a managed service whose edge provides TLS.

Run `npm start`. Proxy only this service behind HTTPS with request/rate limits. Set the public `alerts-config.json` server field to that service's HTTPS origin. The default null is deliberate. Deploy the static files at the same app path, including alerts.html, alerts-client.js, alerts-sw.js, alerts-config.json and manifest.webmanifest. This cannot be installed by pasting index.html alone.

On iPhone, add the app to Home Screen, open it there, open Menu → Phone alerts, enter the notification pairing code, connect, enable and approve permission. Send one clearly marked test. Close the app and confirm the test reaches the lock screen. Test notification-off/revoke too. Existing iOS installs may require reopening or re-adding after a manifest change. Real device acceptance is pending.

Keep qualification disabled until the collector and independent evidence tests are complete. The service currently exposes test delivery only. No recurring market work is silently started.

## Validation performed
- 34 Node tests passed, zero failed/skipped: HTTP auth/origin/subscription lifecycle, endpoint validation, missing/stale/future evidence, persistent event deduplication, unknown delivery, expired subscriptions and safe notification handling.
- npm audit, production dependencies: zero known vulnerabilities at this check. This is not a full security certification.
- Local HTTP tests used generated test-only push keys and synthetic subscription endpoints; no push was sent to a real device.
- iPhone notification delivery, Safari gestures/rendering and deployed HTTPS are not yet tested.

## Sources
- Apple/WebKit Home Screen permission requirements: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Apple Web Push guide: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- Maintained sender library: https://github.com/web-push-libs/web-push (pinned web-push 3.6.7 with lockfile)
