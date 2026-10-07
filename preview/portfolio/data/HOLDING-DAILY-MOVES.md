# Per-holding 24-hour market movement

The app shows per-coin 24h market movement inside each holding row and coin details. Saved values and portfolio totals are unchanged. This is a comparison of two completed hourly public pool prices applied to the currently selected saved quantity, not actual portfolio P&L.

## Files and verification

- `holding-day-change.mjs`: public quote adapter, pure response parser and local calculation
- `exact-decimal.mjs`: bounded BigInt decimal arithmetic and lossless JSON-number parsing
- `scripts/holding-day-change.test.mjs`: synthetic unit, transport, identity, timing, privacy and currency tests
- Captured live public fixtures are kept in local QA artifacts and are not a current data feed
- `portfolio/holding-daily-view.mjs`: bounded public controller and exact signed display

Run `node --test holding-day-change.test.mjs` and `node verify-live-public.mjs` from this folder. The live fixture is evidence from its capture time; it is not a current quote or a synthetic unit fixture.

## Integration contract

Import `createHoldingDayChangeSource`, `calculateHoldingDayChange`, and optionally `holdingDayChangeTarget` from `holding-day-change.mjs`. Both `.mjs` modules must be copied into the same destination folder.

`createHoldingDayChangeSource({fetchImpl = fetch, now = Date.now, timeoutMs = 8000, cacheTtlMs = 60000, maxEntries = 32})` returns:

- `get({chainId, assetId, poolAddress?}, {signal?})`: asynchronous public-only comparison
- `clear()`: clears the public cache

Always construct the three public fields explicitly. Never send the holding/model object, a wallet address, quantity, account/owner identity, balance or FX through a public-source abstraction. The implementation rebuilds inputs internally, sends only public contract/pool addresses, omits credentials and referrers, and does not keep extra input properties.

`chainId` must be numeric `1`. `assetId` is the exact Ethereum ERC-20 contract or `native`. Built-in defaults exist for native ETH/WETH, HEX, HDRN, DRAGONX and ICSA. Generic ERC-20s require the selected saved quote's exact `poolAddress`; metadata must prove association with that contract. SHOGUN remains unavailable because the existing valuation model treats it as unreliable. Native ETH always uses the configured WETH/USDC pool with an explicit proxy note. Symbols are never identity evidence.

For discovered ERC-20 support, `groupHoldings` should expose `pricePairAddress: quote?.price_pair_address ?? null`. It currently does not preserve that field. Do not guess a pool by symbol or use generic `h24` percentage fields.

Each successful uncached lookup makes two sequential public GETs: pool metadata followed by exact-token USD hourly OHLCV. Each request has an 8-second maximum deadline and 512 KiB maximum streamed body. There are no redirects or retries. Failed responses, including HTTP 429, use the same short cache cooldown. An aborted request is not cached.

Caller responsibilities:

- Deduplicate identical pending lookups and bound request concurrency/count for a render or refresh. The source cache deduplicates completed results, not in-flight calls
- Preserve the owner/account/wallet render generation; discard async results after account or view changes
- Abort outgoing work when its UI is no longer relevant
- Keep quantities/calculated dollars in private UI state and clear them on sign-out/account switches; only public price pairs may be shared across owners
- Requery/reassess during the existing authorized refresh flow, and pass the current scoped quantity into the pure calculation
- Recalculate or neutralize the displayed result when its 90-minute endpoint expiry passes, including after tab visibility resumes. The pure calculation reassesses freshness each time it is called; an already-rendered string cannot update itself
- Do not sum these figures into actual portfolio P&L or an across-assets 24h total: different pools can have different ending hours

## Public comparison result

`status` is `ready`, `stale`, or `unavailable`.

Ready/stale results include:

- `currentPriceUsd`, `baselinePriceUsd`: exact positive decimal strings from the same token/pool/USD series
- `endpointAt`, `baselineAt`: ISO candle closing boundaries, exactly 86,400 seconds apart
- `endpointCandleStartAt`, `baselineCandleStartAt`: original candle opening timestamps
- `spanSeconds: 86400`, `intervalSeconds: 3600`, `quoteCurrency: 'USD'`
- `endpointAgeMs`, `retrievedAt`, `identityVerified: true`, `method: 'completed_hourly_close'`
- `target`: normalized public identity with proxy fields
- `source`, `sourceUrl`, `metadataSourceUrl`, `sourceNote`, `proxyNote`
- `reason`: null for ready; `stale_endpoint` for stale

The newest forming hourly candle is excluded. A 90-second grace after its boundary prevents a public response cached before the hour from being accepted immediately afterward. The newest observed completed candle is selected, then its exact prior-day candle is required. Missing hours are never copied, filled, interpolated or substituted. The endpoint is stale if its derived closing boundary is more than 90 minutes old. Retrieval does not make an old endpoint fresh. Identical close values at a selected duplicate timestamp are accepted even when other valid OHLC values differ. Conflicting selected close values fail closed.

Unavailable results have null prices, times and span, with a neutral reason code. They must not appear as zero movement. Use a neutral label for loading, missing, identity/source errors and missing FX. `stale` may be shown only as a dated historical comparison with its actual ending time; it must not be presented as current movement.

`endpointAt` is a derived candle boundary, not the exact timestamp of its last trade. REST docs describe Unix OHLCV timestamps; the provider's related on-chain websocket documentation explicitly calls the timestamp the candle interval's opening time.

## Local holding calculation

`calculateHoldingDayChange({quantity, comparison, currency = 'USD', fx = null, nowMs = Date.now()})` never performs a request. It reassesses endpoint freshness at calculation time, so a retained formerly-ready comparison cannot stay ready after 90 minutes.

`quantity` must be the current exact nonnegative decimal string from the existing scoped holding model. Existing `groupHoldings` already includes eligible locked principal once. Do not add it again. Reward estimates are not included.

For AUD, pass `fx: {rate, date, source, verified: true}` only after verifying the saved rate/provenance. `rate` is an exact positive USD-to-AUD decimal string; `date` is its valid `YYYY-MM-DD` reference date. The model helpers `verifiedFx(snapshot)` and `fxReferenceDate(snapshot)` are the existing integration points. Missing or unverified FX yields AUD unavailable, never USD relabeled as AUD.

Ready/stale outputs include:

- `usdChange`: exact signed decimal string for `quantity × (endpoint USD price − baseline USD price)`
- `selectedCurrencyChange`: exact signed decimal string in `currency`
- `percent`: signed price-change percentage, rounded to 18 decimal places only if needed
- `percentExact`: exact reduced numerator/denominator plus decimal rendering, precision, rounding and approximation flag
- `direction`: `up`, `down`, or `flat`, based on the dollar movement
- Endpoint/baseline times, USD prices, source, proxy note, FX provenance and `calculationNote`

Positive results have a leading `+`; negative results have `-`; zero is `0`. Do not pass these signed outputs into existing formatters that only accept nonnegative strings. Format their absolute magnitude, then restore the sign, or add a signed-decimal formatter. Do not turn a small nonzero amount into a misleading displayed zero; use a directional `<0.01` display when appropriate.

AUD applies one current verified saved USD/AUD rate to both terms, so the percent remains the USD token-price percent and FX movement is excluded. This is market movement on current quantity, not actual portfolio P&L: it excludes flows, rewards, fees, taxes, gas and slippage.

## Captured public smoke check

At `2026-10-07T13:06:18.601Z`, actual unauthenticated WETH hourly data yielded:

- Endpoint candle boundary `2026-10-07T13:00:00.000Z`, USD close `2568.86`
- Baseline candle boundary `2026-10-06T13:00:00.000Z`, USD close `2715.16`
- Exact span: 86,400 seconds
- For a synthetic quantity of one token: USD movement `-146.3`; percentage `-5.38826441167371352`
- The `2026-10-07T13:00:00Z` opening bucket was forming and correctly excluded

The captured metadata used the provider's equivalent single-pool endpoint. The pure parser accepts that verified endpoint URL explicitly; ordinary source requests use the multi-pool endpoint for one exact pool. Both verify the same pool address, Ethereum-qualified IDs and token relationships. The multi-pool route was independently verified earlier by the source investigation. Local 8-second direct fetch attempts timed out; the successful metadata capture needed about 8.8 seconds with a 20-second research timeout. Production still strictly enforces 8 seconds and returns a neutral gap on a slow response. The subsequent historical request took about 0.5 seconds.

Official provider references:

- https://docs.coingecko.com/reference/pool-ohlcv-contract-address
- https://docs.coingecko.com/websocket/wssonchainohlcv

These document the provider's authenticated sibling API/schema. The saved raw public responses establish that the tested GeckoTerminal public endpoints work without credentials and returned `Access-Control-Allow-Origin: *`.


## App controls and limits

The app checks visible eligible holdings after a saved account or wallet scope loads. Only chain, exact token contract and selected public pool are sent to GeckoTerminal; account IDs, wallet addresses, balances, quantities and dollar values are not sent. Calculated movement stays in this tab and is cleared with the private scope. Public comparisons may be reused for one minute across scopes, with each scope’s quantity calculated independently.

Requests are serial and limited to 12 uncached lookup reservations, at most two public GETs each. Each reservation lasts until 60 seconds after completion, including cancelled scope work, enforcing the 24-request rolling-minute ceiling. No retries, timer polling or background service is added. Work pauses when the tab is hidden. Returning to a visible tab may recheck within the same budget; Refresh balances also loads the new saved scope. If the public limit is reached, a row says it has not been checked. Missing, stale, unsupported or unverified history is unavailable, never zero.

Ready comparisons expire 90 minutes after the derived hourly closing boundary, including while the page remains open. Dollar and percent signs use exact arithmetic and preserve tiny nonzero moves. AUD additionally requires a saved verified provider reference date no older than seven days, with no future retrieval. A retrieval timestamp alone cannot stand in for the reference date. The same FX rate is applied at both endpoints, so displayed percentages describe USD token-price movement and exclude FX movement. Coin details show the rate date, boundaries, retrieval time, public source and native ETH/WETH proxy caveat. The eye hides all daily values and their details.
