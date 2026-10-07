# Optional public entry setups

`data/entry-setups.json` is an optional public research feed for a future
**Review entry** state. The initial live file contains no setups and no fabricated
prices:

```json
{"schema_version":1,"checked_at":null,"setups":[]}
```

An absent, invalid, or empty file must not create a green state. There is no
automatic purchase, order creation, execution, wallet access, background task, or
schedule in this contract. **Review entry** only opens research for inspection.

## Research and publication rules

- Future qualifiers must come from actual independent research and a genuine
  current public quote for the same market. Never derive an entry setup solely
  from a lower low, a historical observation, a price trend, or a boolean flag.
  Never invent levels, quotes, citations, checks or timestamps to fill the UI.
- Keep all data public: no private funds, budgets, ownership, positions, balances,
  addresses, account details, credentials, or private-source content. This file
  describes market research and does not establish the user's suitability.
- Verify the asset identity, venue, instrument and currency against the official
  public sources. `RENDER` is required; a similarly named or legacy ticker is not
  interchangeable. USD, USDT and USDC are distinct quote currencies.
- Open and check the actual official public source URLs and final destinations.
  URL syntax alone cannot establish provenance, accessibility, support for price
  levels, absence of malicious content, or investment safety. The validator does
  not resolve DNS, fetch pages, follow redirects or inspect source content.
- `source_security_checked: true` means only that a researcher checked the
  official source URLs and their final destinations. It is not a contract audit,
  a wallet or protocol safety check, or an assurance about investment returns.
  `review_status: "reviewed"` means the independent research was reviewed; the
  validator cannot perform or verify that research itself.
- Use real UTC check and quote observation times. Refreshing a quote may update
  `quote.observed_at` and the root `checked_at`; it must not reset the research
  `checked_at`, extend its expiry, or mark a pending review as reviewed.
- Keep zero to five setups, at most one per permitted asset. Empty is preferable
  to unsupported research. A missing setup remains Watch, subject to the separate
  observation UI's availability/staleness rules.
- Validate before any authorized publication and preserve unrelated work.
  This contract does not itself authorize publication or a recurring writer.

## Exact contract

Every property below is required. Unknown properties are rejected at every level.
The root is exactly `{schema_version, checked_at, setups}`. `schema_version` is
the number `1`; `setups` is an array of zero to five objects. Root `checked_at`
may be null only when the list is empty. A non-null root timestamp must be at
least every setup check and every quote observation, even when a quote is newer
than its research check. The root timestamp does not refresh old evidence.

Each setup is exactly:

```text
{asset, venue, pair, quote_currency, entry_min, entry_max, stop, targets,
 checked_at, expires_at, review_status, source_security_checked, source_urls, quote}
```

- `asset`: one of `RENDER`, `POL`, `TAO`, `APT`, `AKT`, unique in the feed
- `venue`: trimmed plain text, 1–80 characters, without HTML, Markdown, control,
  format or surrogate characters
- `pair`: exact asset followed by the exact quote currency, with an optional
  single `/`, `-` or `_` separator; for example the identifier shape `RENDER/USDT`
  is allowed, while prefixes, suffixes, wrong tickers and derivative identifiers
  are rejected
- `quote_currency`: exactly `USD`, `USDT` or `USDC`
- `entry_min`, `entry_max`, `stop`: positive exact decimal strings of at most
  64 characters, with no signs, exponents, spaces or leading zeroes
- `targets`: one to three positive decimal strings in strictly increasing order
- `checked_at`: actual independent-research check time
- `expires_at`: exclusive deadline strictly after `checked_at` and no more than
  24 hours later; a deadline is exempt from the observation clock-skew limit
- `review_status`: exactly `pending` or `reviewed`
- `source_security_checked`: a boolean with the limited meaning described above
- `source_urls`: one to five unique public HTTPS source URL strings
- `quote`: exactly `{venue, pair, quote_currency, price, observed_at, source_url}`;
  venue, pair and currency must equal the setup values exactly; price is a positive
  decimal string; `observed_at` is the actual quote observation time; `source_url`
  must match one of `source_urls` exactly

The validator uses fixed-point integer comparisons to enforce:

```text
0 < stop < entry_min <= entry_max < targets[0] < each subsequent target
```

It never uses floating-point price comparisons. Decimal trailing zeroes are
accepted and compare by value. URLs are at most 2,048 characters and must use a
public DNS hostname without credentials, IP literals, local hostnames, control
characters, whitespace, backslashes, or credential query parameters. These checks
do not detect every possible secret in a URL; producers must supply public URLs.

All timestamps are real `YYYY-MM-DDTHH:mm:ssZ` UTC values with optional one to
three fractional-second digits. Root/setup check and quote observation timestamps
may be at most five minutes ahead of the validator clock. Tolerated future setup
checks or quote observations remain Watch until their time arrives. Offsets, missing timezones,
impossible dates and leap-second strings are rejected.

## Evaluation and UI integration

`validateEntrySetups(raw, {now})` returns the original object without mutation or
throws a path-specific error. `now` is an optional finite timestamp in milliseconds,
defaulting to `Date.now()`.

`evaluateEntrySetup(setup, now)` validates a single setup with the same rules and
returns exactly `{status, reason}`. Invalid data throws; callers must catch it and
retain a neutral Watch state. Validate the entire feed before selecting a setup,
so duplicate assets, unsupported root fields and bad root chronology cannot be
bypassed by evaluating a single row.

`status: "review"` and `reason: "review_ready"` require all of:

- An independently reviewed setup and checked source URLs
- Research and quote observation times at or before now
- Now strictly before the setup expiry
- Research age no greater than 24 hours and quote age no greater than 15 minutes
- A quote within the inclusive entry range and strictly above the stop

The Watch reasons are evaluated in this fixed order:

1. `review_pending`: the research has not been reviewed
2. `sources_unchecked`: the official source URLs have not been checked
3. `awaiting_observation`: a tolerated observation time is still in the future
4. `expired`: now is at or after the expiry
5. `research_stale`: research age exceeds 24 hours; with the enforced validity
   bound, expiry normally catches this first
6. `quote_stale`: quote age exceeds 15 minutes
7. `quote_at_or_below_stop`: quote is at or below the stop
8. `outside_entry_range`: quote is below entry_min or above entry_max

The exported constants `ENTRY_SETUP_MAX_AGE_MS` (24 hours),
`ENTRY_QUOTE_MAX_AGE_MS` (15 minutes) and `ENTRY_SETUP_FUTURE_TOLERANCE_MS`
(five minutes) are technical freshness/clock limits, not a trading strategy or
predictions. `ENTRY_SETUP_ASSETS` is the frozen list of supported tickers.

Only an otherwise fresh Watch observation should be promoted to Review entry;
missing or stale observation evidence stays neutral. Re-evaluate on interaction,
visibility changes, quote updates and the earliest expiry/staleness boundary so a
previously green display cannot keep implying current research. Expiry turns
Watch at the deadline; quote age remains acceptable at exactly 15 minutes and
becomes stale one millisecond later. Do not use this UI to execute orders.

## Validation

```sh
node --test scripts/entry-setups.test.mjs
node scripts/validate-entry-setups.mjs
node scripts/validate-entry-setups.mjs path/to/entry-setups.json
```

The CLI's default file is resolved from the repository, independent of its current
working directory. A supplied path is relative to the current working directory.
Invalid input or a missing file produces a nonzero exit status. It reports valid
setup and review counts without placing orders or altering the data. The JSON
schema documents structural rules; runtime validation is authoritative for exact
prices, identity, public-host restrictions, chronology and freshness. Test prices
are explicitly synthetic fixtures and never populate the live file.
