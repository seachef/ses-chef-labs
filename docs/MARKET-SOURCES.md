# Market source and limits

This slice has one read-only adapter, for the explicitly allowed Coinbase Exchange products `BTC-USD` and `ETH-USD`. A successful bounded observation of both products was recorded at 11:08 UTC on 11 October 2026; this is not ongoing coverage. Importing `src/market/coinbase.mjs` does nothing; callers must explicitly invoke `fetchObservation({ productId })` or `createCoinbaseObserver(options).observe(productId)`. Neither function places orders, writes a ledger, starts polling, or uses credentials. No external library is needed.

## Evidence and current verification

Official API documentation was read during foundation development on 11 October 2026. In the fresh environment, default Node transport again returned `fetch failed` for BTC-USD and a 5-second timeout for ETH-USD before HTTP. The environment already had HTTP(S) proxy configuration, which Node 24.19.0 did not use by default. Its documented `--use-env-proxy` option enabled the existing managed route with no proxy, credential, TLS or permission changes. The unchanged adapter then accepted both real observations, with all ten product/book/ticker/stats/candle GETs returning HTTP 200. This is one captured observation per product, not a polling or rate-limit test.

Raw decoded HTTP response bodies, exact URLs, status, source/receipt times, byte counts and SHA-256 digests are retained outside the source checkout at `/workspace/scratch/neptune-2-verification-evidence-20261011/managed-proxy/`. The transport wrapper recorded payloads unchanged with a 5 MB per-response bound; the adapter retained its default 5-second deadlines and 30-second collection freshness gate. No public observation was sent to execution. The persisted observation document has no engine, no account, zero fills, stopped entries, and a passing one-record journal audit.

| Product | Observed UTC, 2026-10-11 | Best book bid / ask USD | Spread bps | Bid / ask levels | Book / ticker source age at assembly |
| --- | --- | --- | --- | --- | --- |
| BTC-USD | 11:08:11.793 | 82949.64 / 82949.65 | 0.001205550668 | 21265 / 19518 | 2209 / 1558 ms |
| ETH-USD | 11:08:12.078 | 2500.08 / 2500.09 | 0.039998640047 | 7379 / 12520 | 1690 / 1313 ms |

Both products were `online`, correctly identified in USD, with required restrictions false. Each history response provided 168 requested closed hourly buckets and one excluded current bucket. History still has `complete: false`; no all-time coverage is claimed. BTC book body was 1,067,083 decoded bytes; ETH was 495,476 bytes. All returned depth is counted, including levels far from the best prices; it is not immediately executable liquidity. REST responses are non-atomic. These recorded prices expire under the UI's 10-second source/receipt freshness rule.

The verification also exposed display-only issues now corrected: source ticker/book clocks are shown separately from observation time, and spread precision no longer rounds the captured nonzero BTC spread to zero. ENGINE records only actual page request starts, responses, failures and stop acknowledgments, capped at 20 entries. Its aging timer does not manufacture terminal activity or a worker heartbeat.

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

Unverified: continued source availability and rate-limit/outage recovery; broad-market coverage; WebSocket continuity and gap recovery; trading eligibility by geography/account; browser connectivity; hosted service deployment and uptime; any paper strategy's performance. One sandboxed Chromium launch on 11 October 2026 failed because the sandbox helper was misconfigured; no unsandboxed browser was launched. Screenshots, mobile viewport behavior and real iOS hardware review remain open. No worker is running merely because this source file exists.

Offline validation: `node --test test/market.test.mjs`. Tests inject fabricated API payloads and perform no network requests or public-price simulated trades.
