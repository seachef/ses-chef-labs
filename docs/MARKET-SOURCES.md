# Market source and limits

This slice has one read-only adapter, for the explicitly allowed Coinbase Exchange products `BTC-USD` and `ETH-USD`. This allowlist is an intended scope, **not a claim of current coverage or successful connectivity**. Importing `src/market/coinbase.mjs` does nothing; callers must explicitly invoke `fetchObservation({ productId })` or `createCoinbaseObserver(options).observe(productId)`. Neither function places orders, writes a ledger, starts polling, or uses credentials. No external library is needed.

## Evidence and current verification

Official API documentation was read on 11 October 2026. A one-time, read-only Node request to each product endpoint returned `fetch failed` for BTC-USD and a 5-second timeout for ETH-USD. No successful public payload was obtained or used for a simulated trade. Live API conformance, network access, current product status and real response sizes remain **unverified in this environment**. Offline fixture tests establish validation behavior only. They do not verify that a venue is currently reachable or that any strategy is profitable.

Every successful future observation must first verify the exact product identifier, base currency, USD quote currency and online status against `GET /products/{product_id}`. Product post-only, limit-only, cancel-only and auction flags must all explicitly be false. A supplied `trading_disabled` flag must be false; absent optional metadata remains null. Base and quote increments are retained; the minimum market-funds value remains null when absent. Product status can change after this request, so this is evidence at receipt time, not a trading guarantee. [Official product schema](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-single-product).

## Source mapping

| Display / field | Source and meaning | Limitation |
| --- | --- | --- |
| Product identity and status | `GET /products/BTC-USD` or `ETH-USD`; exact id/base/quote/status | No symbol inference, USD/USDT substitution, other venue or broad-market claim |
| Last price, last-trade source time, ticker bid/ask and 24h base volume | `GET /products/{id}/ticker` | Last trade is not an executable fill, and last-trade time is not an order-book timestamp |
| Bid/ask depth and spread | `GET /products/{id}/book?level=2` | Aggregated book sizes are already summed; do not multiply by order count. Visible resting depth can change or disappear |
| 24h change | `GET /products/{id}/stats`; `(last / open - 1) * 100` | Stats have no source timestamp and are separate from ticker; no atomic-snapshot claim |
| Distance from observed low | Minimum low among returned, valid, in-window closed hourly candles | Up to 168 hours, gaps explicit, never an all-time low |

The ticker endpoint documents a last trade, bid/ask and 24-hour volume; it does not supply a 24-hour open. [Official ticker schema](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker). The statistics endpoint supplies open/last and declares volume in base units and prices in quote units. It is deliberately not relabelled as executable liquidity. [Official statistics schema](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-stats).

Level 2 is an aggregated book. Indicative auction data is rejected, as are locked/crossed books, empty sides, unsorted or duplicated price levels, nonpositive sizes, malformed decimal values, unsafe sequences and invalid order counts. Snapshots do not guarantee execution, depth persistence or fill latency. [Official order-book schema](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-book).

CoinGecko aggregate prices/volume are not used by this adapter. A future CoinGecko adapter may provide discovery evidence, but cannot supply venue-specific executable bid/ask depth or replace product identity verification.

## Time, coverage and duplicates

All normalized timestamps are epoch milliseconds. `sourceAt` is the exchange ticker last-trade time. `observedAt` is local assembly time. `bookSourceAt` uses the book's supplied exchange time; if absent, it is null. Local book receipt time is recorded separately and never substituted for an unknown source time. Stats source time is explicitly null. The snapshot records `atomic: false` because these are distinct REST requests.

The default adapter rejects ticker and known book source times older than 30 seconds, or more than 1 second in the future. It also rejects local clock regression and observations whose request span exceeds 30 seconds. These thresholds are configurable and recorded where relevant; clock accuracy itself is not independently verified. Unknown book source freshness is retained only as a read-only observation. Both endpoints can look recently received while containing older upstream data; no freshness or execution guarantee is inferred from receipt alone.

History requests cover the preceding 168 **closed** hourly buckets, ending at the current hour boundary. Only buckets within that interval contribute to the low. Earlier venue-returned buckets and the current partial bucket are excluded and counted. Future buckets, duplicate timestamps, nonhourly times and inconsistent OHLC values fail validation. Coverage records observed first/last bucket boundaries, requested boundaries, sample count, missing-bucket count and excluded-bucket count. An empty valid history returns `low/from/to: null`. `complete` is always false because the exchange cautions that history may be incomplete, including intervals with no ticks. No gap is silently filled. [Official candle schema and caveats](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).

The event identifier contains venue, exact product, book sequence and ticker trade id, not local receipt time. Repeated retrieval of the same book/trade therefore has the same id. The adapter does not keep state or claim cross-call ordering/deduplication; the consumer must preserve ordering and idempotency durably. Changed stats/history alone do not create a new book/trade event.

## Execution boundary and operational limits

Every normalized observation carries `provenance: 'public'` and `evidence.executable: false`. **The first slice's engine must reject public observations for simulated fills.** Its trade tests use explicitly synthetic fixtures only. Missing book timestamps and non-atomic REST observations require further source/risk design before any later public-price paper-trading release. No source provides account-specific fees here; hypothetical fees, slippage and latency belong to explicit execution assumptions, never source facts.

Each observation makes one product request, then four bounded requests for book, ticker, stats and candles. Requests are HTTPS GETs to the fixed official origin, reject redirects, have a 5-second default deadline covering fetch and JSON parsing, and do not retry or retain a previous successful observation after failure. A caller receives an error and must expose unknown/error status. This is an explicit single observation interface, **not a production polling schedule**: repeatedly fetching history or full books at a high rate is not appropriate. History caching with explicit freshness, rate-limit handling and a measured observation schedule are future work.

Unverified: real API payload compatibility and availability; broad-market coverage; WebSocket continuity and gap recovery; trading eligibility by geography/account; browser connectivity; hosted service deployment and uptime; any paper strategy's performance. No worker is running merely because this source file exists.

Offline validation: `node --test test/market.test.mjs`. Tests inject fabricated API payloads and perform no network requests or public-price simulated trades.
