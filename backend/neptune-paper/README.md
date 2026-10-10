# NEPTUNE deterministic paper runtime

Experimental virtual accounting only. No real orders, signing, wallets or credentials.

Run `npm ci && npm test` with Node 22. PGlite is pinned to 0.3.14. Tests use synthetic public-market fixtures and isolated in-memory PostgreSQL. They never connect to production or send market orders.

The existing shared AUD 10,000 account is divided into five virtual specialist accounts. Kraken USD spot remains the legacy path. This release enables only native Hyperliquid HYPE/USDC simulation. Binance collection and entries are owner-disabled; its existing AUD allocation, instrument identities, ledger and history remain intact. Native simulations retain distinct quote currencies, received-asset modeled fees, exact dust, and deferred quote conversions. Public base-tier fee assumptions and adverse allowances are declared in native-config.json. Synthetic cross-venue AUD accounting excludes actual transfers and wallet funding.

Unknown native conversion or ordinary inventory valuation blocks new entries; protective quote-denominated exits may retain typed proceeds. Canonical asset exposure and cooldown apply across venues. Entry routing currently uses deterministic fixed priority and does not claim to select the cheapest venue.

Schema installation and the guarded production upgrade are separate operations. Never execute schema.sql against an existing account. No migration resets the ledger or virtual balances. Deployment requires reviewed source checks, stopped/flat allocation state, unchanged owner-control permissions, and independent regression approval.

Release policy tests run the unmodified Hyperliquid-only policy. Historical Binance lifecycle regressions explicitly install a test-only all-venue policy in isolated PGlite to preserve accounting, risk and reader coverage; this override is never part of the migration.

## Honest response-time bounds

pg_net 0.20.4 response `created` is worker-transaction start, not HTTP receipt. `transport-observation.sql` records each owned visible response after its SELECT, before any partial-batch wait. The immutable private journal binds request identity/epoch/sent time and request/response hashes. Retries never refresh first-observed time.

The conservative lower bound is max(request sent_at, pg_net created). The first database observation is an upper bound, not a precise wire-arrival timestamp; wire_received_at remains null. Source events and metadata must not exceed the fixed upper bound. Current age/freshness, downstream received_at compatibility, and completed-candle inclusion stay anchored to the lower bound. Thus a genuine event just after batch start is valid, but waiting for unrelated responses cannot mature a future event or an unfinished candle. Existing timeout, queue-start delay, replay, source-age, quarantine and capacity checks remain in place. See TRANSPORT-CONTRACT.md.

## Bounded future-write efficiency

Every immutable market observation is retained. Only repeated healthy, globally flat `no_new_completed_bar` holds with identical decision context can share a prior immutable decision anchor. First/changed states, health/eligibility/source transitions, any exposure/intent/proceeds, and every protective or economic decision retain their normal audit. No history is deleted and no limit is raised. Equal control acknowledgements/native enable/provider-block state avoid redundant row rewrites. The guarded installer explicitly installs the reviewed publish_control_ack body; original build5 predecessor hashes are unchanged.

The response journal also consumes retained space. The existing 32 MiB entry pause and 40 MiB terminal limits remain; synthetic efficiency tests are not a guarantee of 24/7 capacity. Check actual retained bytes and growth after activation. Retention/archiving or capacity changes need a separate reviewed design.

## Preliminary intent risk reporting

Pending buy decisions and orders report 0.25% of the lesser of root equity and the specialist's available entry budget (the lesser of opening cash and current cash). This is a preliminary allowance, not committed risk or a guaranteed maximum loss. At AUD 2,000 specialist cash it is AUD 5, and at AUD 1,000 it is AUD 2.50. Fill-time post-equity, costs, depth, capital, aggregate-risk, and position-count gates remain unchanged. Existing decisions and orders retain their original provenance and values. Exact-policy tests compare both reporting expressions and prove unchanged executable fill economics for Kraken Ethereum and native HYPE.
