# Market conditions

This public meter is independent of portfolio holdings and entry qualification.
It describes past prices using a transparent, unvalidated rule. It is not a
forecast, probability, sentiment measure or instruction to trade.

The compact tile shows Market plus Bear, Neutral, Bull or Unknown. Tap for the
method, input values, timestamps and sources. On opening the app, tapping the
meter or returning to the visible app, bounded public reads refresh the values.
Attempts are at least one minute apart, with no background polling, credentials,
account requests or scheduled job. Each refresh uses two HTTPS GETs to the
official Binance public-data host: BTCUSDT completed UTC daily klines and rolling
24h tickers for the fixed basket. Responses are capped at 256 KiB each and the
combined request has a ten-second timeout. A still-valid checked snapshot may
remain visible after a failed refresh; it becomes Unknown at expiry.

## Method

- Latest completed BTC/USDT daily close versus its 50-day and 200-day averages:
  each contributes +1 above, 0 equal or -1 below
- Fraction of advancing members in the fixed 115-asset Binance screen: +1 at
  60% or more, -1 at 40% or less, otherwise 0; unchanged members count in the denominator
- Total +2/+3 is Bull, -2/-3 is Bear, otherwise Neutral

The basket was selected on 7 October 2026 from active Binance USDT spot assets
with reported rolling turnover of at least 3 million USDT, excluding BTC,
identified stablecoins, fiat, gold tokens, tokenized securities and obvious
wrapped/staked duplicates. The exact reviewed list is in market-universe.mjs.
Its original selection time remains provenance: fresh readings do not pretend
that all members requalified under the liquidity screen today. This is current
breadth of that fixed screen, not all cryptoassets or independent economic
exposures. Reported turnover is not executable depth; USDT is not USD or AUD.

The adapter requires full unique ticker coverage, coherent rolling 24h windows,
provider timestamps no older than 60 minutes and no more than one minute into
the future, plus 200 consecutive BTC daily closes through yesterday UTC.
Missing, invalid, duplicated or stale evidence yields Unknown, never Neutral.
The client rechecks on interaction, visibility changes and an expiry timeout.

## Static fallback contract

data/market-conditions.json contains schema_version:1, observed_at, universe,
btcDailyBars and breadthTickers. Universe has the exact fixed id, mode
fixed_basket, original selectedAt and ordered symbols. btcDailyBars contains
200 Binance 12-field daily kline rows; breadthTickers contains only symbol,
priceChange, lastPrice, openTime and closeTime. Prices remain provider decimal
strings. The client derives conditions itself; no condition flag is trusted.

Any future fallback refresh must preserve the basket identity and selection
date, use the actual public responses and observation time, and validate with
checkedMarketPayload and computeMarketCondition using the real current time.
Never reset timestamps to keep old evidence current. Keep budgets, allocations,
wallets and personal data out of this file. No automatic writer is added here.

Official documentation: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints
