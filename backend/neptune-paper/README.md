# NEPTUNE deterministic paper runtime

Experimental virtual accounting only. No real orders, signing, wallets or credentials.

Run `npm ci && npm test` with Node 22. PGlite is pinned to 0.3.14. Tests use synthetic public-market fixtures and isolated in-memory PostgreSQL. They never connect to production or send market orders.

The existing shared AUD 10,000 account is divided into five virtual specialist accounts. Kraken USD spot remains the legacy path. Native Binance SOL/USDT and Hyperliquid HYPE/USDC simulations retain distinct quote currencies, received-asset modeled fees, exact dust, and deferred quote conversions. Public base-tier fee assumptions and adverse allowances are declared in native-config.json. Synthetic cross-venue AUD accounting excludes actual transfers and wallet funding.

Unknown native conversion or ordinary inventory valuation blocks new entries; protective quote-denominated exits may retain typed proceeds. Canonical asset exposure and cooldown apply across venues. Entry routing currently uses deterministic fixed priority and does not claim to select the cheapest venue.

Schema installation and the guarded production upgrade are separate operations. Never execute schema.sql against an existing account. No migration resets the ledger or virtual balances. Deployment requires reviewed source checks, stopped/flat allocation state, unchanged owner-control permissions, and independent regression approval.
