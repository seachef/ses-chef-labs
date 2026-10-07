# Public news and entry-watch data

These two files contain public research and historical market observations only. Never add budgets, allocations, holdings, wallets, account identifiers or private user information. Source selection and updates use public data and require no credentials. The UI must render text safely with `textContent` or escaped text and links only after validation.

`portfolio/news-data.mjs` is the authoritative validator. The accompanying JSON Schemas describe structure and basic constraints; they cannot establish primary-source provenance, support for prose, actual source availability, dynamic dates, safe DNS destinations, cross-record relationships or immutable history. A valid record is not proof that the source is authentic or the content is correct. Verify each claim against its linked primary source before writing it.

## Validation

Run from the repository root:

```sh
node scripts/validate-news-data.mjs
node --test scripts/news-data.test.mjs
```

The validator defaults to `data/news-desk.json` and `data/entry-watch.json`. Optional flags are `--news path`, `--watch path`, `--previous path`, `--previous-news path`, and `--now UTC_ISO`. File paths supplied as flags resolve from the current working directory. `--previous` verifies that the earlier watch ledger is an unchanged prefix of the new ledger, comparing JSON values regardless of object key order. Use the actual previous published ledger from the trusted base revision; a newly generated or edited baseline does not establish immutability. Do not skip this check when updating history. `--now` exists for repeatable tests and replays; production validation uses the real current time.

All object keys are exact and required. All arrays are dense and bounded. Text is trimmed and excludes markup, control characters and obvious promises of investment safety or returns. URLs must use public HTTPS DNS hosts, with no IP address, local hostname, user credentials or credential query parameters. This is a syntax check, not a DNS resolution or source-authenticity check. UTC timestamps end in `Z`, include seconds, may have 1–3 fractional digits and must represent real dates. Observations cannot be more than five minutes ahead of validation time.

## News feed

The root has exactly `schema_version: 2`, `checked_at`, and `items`. There are 0–5 items. `checked_at` is the actual time the researcher finished checking the feed; it may be null only for an empty initial feed. An empty checked feed means no material verified items were selected. Do not fabricate a check timestamp.

Every item has exactly:

- `id`: unique lowercase hyphenated identifier, at most 64 characters
- `first_displayed_at`: immutable UTC time this story first appeared in an app edition
- `coins`: 1–5 unique uppercase alphanumeric tickers, 2–12 characters each
- `headline`: plain text, at most 140 characters
- `what_happened`, `why_it_matters`, `risk`: each plain text at most 360 characters; keep each to one or two short sentences
- `source`: exactly `name` (at most 100 characters), `url`, `published_at`, `published_date`, `retrieved_at`

Use a primary source, such as the project's own announcement, an exchange announcement, a regulatory publication or the original study. `published_date` is the real source publication date (`YYYY-MM-DD`). `published_at` is a verified precise UTC timestamp, or null when the source gives only a date. Never invent midnight. If a precise timestamp is present, its UTC date must match `published_date`. Publication must not be after retrieval, and retrieval must not be after the feed check. Render the publication date separately from the check timestamp; rechecking an older article does not make it today's news. When displaying non-UTC source dates without precise times, preserve the stated calendar date and leave the timestamp null.

`newsFreshness(data, now)` returns `{ status, checkedAt, ageMs }`. The status is `never` for an initial unchecked feed, `fresh` through 36 hours after the oldest timestamp among `checked_at` and every source's `retrieved_at`, and `stale` once that oldest check exceeds 36 hours. `checkedAt` remains the report's check timestamp; `ageMs` measures the oldest check and is clamped to zero within permitted clock skew. Publication dates do not drive freshness. This reports evidence-check freshness, not article recency or guaranteed continued availability. Writers must actually recheck retained sources before advancing their retrieval timestamps; changing only the report's `checked_at` cannot conceal stale source checks. Never label an unverified or stale report current. A stale feed remains valid so the UI can show its warning honestly.

A story is visible from `first_displayed_at` until exactly 24 hours later. Rechecking sources, correcting copy, reloading the app, or updating `checked_at` must never reset that time. Keep the same stable story ID for the same event. Pass the trusted prior feed with `--previous-news` to enforce retained-story timestamps. New IDs are reserved for genuinely new developments, not a way to recycle expired headlines. The initial three stories were first published at the verified release commit time, 2026-10-07T11:39:07Z. The UI removes expired stories on a timer and on return to the tab. News expiry does not remove entry history or the launch ledger.

Promising launch leads and verified launch-date changes remain in `launch-research-ledger.json`; preserve its immutable prefix. Every meaningful event note must retain the actual reported launch date or an explicit unconfirmed-date statement, with its official source URL. Do not invent a date. The current lead summaries and full revision ledger remain accessible under the compact Saved launch leads disclosure. New material launch developments can appear among the same maximum five News items; do not recreate a separate large opportunities panel.

## Entry-watch ledger

The root has exactly `schema_version: 1`, `assets: ["RENDER", "POL", "TAO", "APT", "AKT"]` in that order, and `records` with 0–5,000 append-only entries. Empty history means no verified observations yet; do not seed invented market samples. A missing venue instrument or failed public feed lookup must be recorded as unavailable, not converted into a zero or an invented price.

Every record has exactly:

- `id`, `asset`, `status`, `venue`, `pair`, `quote_currency`, `interval`
- `candle_open_at`, `candle_close_at`, `low`, `close`, `volume`
- `observed_at`, `source_url`, `assessment`, `compared_with`, `supersedes`, `note`

IDs are unique lowercase hyphenated strings of at most 64 characters. `asset` is one of the five root assets. `status` is `observed` or `unavailable`. `venue` is a stable plain-text venue identifier (at most 80 characters), and `pair` is its uppercase instrument identifier (at most 40 characters, with optional slash, dot, colon, underscore or hyphen separators). `quote_currency` is explicitly `USD`, `USDT` or `USDC`; no dollar/stablecoin equivalence or peg is assumed. `interval` is exactly `1d`. `note` is nonempty plain text at most 600 characters. All records are ordered by nondecreasing `observed_at`; equal observation times are allowed for one batch.

An `observed` record contains one completed UTC daily candle. Open is 00:00:00Z, and close is the exclusive next midnight, exactly 86,400,000 ms later and no later than `observed_at`. Convert a provider's inclusive final millisecond to its exclusive boundary only when its documented semantics support that conversion. `low` and `close` are positive decimal strings, with `low <= close`. `volume` is a nonnegative decimal string in the source's documented base-asset volume units. Strings are limited to 64 characters; signs, exponent notation, leading zeroes and numeric JSON values are rejected. Trailing fractional zeroes are permitted. Comparisons use exact integer arithmetic, not floating-point rounding. `source_url` must cite the public source and preserve the venue/pair/timeframe context needed to reproduce the observation.

An `unavailable` record has null candle times, low, close, volume, `compared_with` and `supersedes`; its `assessment` is `unknown`. It still identifies the intended venue, pair, quote and interval. Its `source_url` may be a relevant public error/status endpoint or null, and its note states the actual limitation. Unavailable records never imply market-wide unavailability, never enter low comparisons and never erase prior observations.

## Low comparisons and revisions

A series is the exact combination of asset, venue, pair, quote currency and interval. The first observed candle in each series has `assessment: "baseline"` and `compared_with: null`. Later candles compare only with the latest effective preceding observed candle in that identical series, using its record ID in `compared_with`. `lower_low` means the new low is strictly below that preceding candle's low; equality or a higher low is `not_lower_low`. The comparison may cross a missing day, so dates must be visible and the UI must not imply consecutive-day coverage when there is a gap. These labels describe historical data only; they do not forecast a bottom, identify a support level or instruct an automatic buy.

New candles append in increasing candle order within a series. Corrections append a new ID with `supersedes` referencing the latest revision of the exact same candle and series. A correction must compare with the latest effective earlier candle available when the correction is written. Earlier records remain intact, including their original assessments and citations; a corrected preceding candle does not silently rewrite later historical assessments. If a later assessment also needs correction, append a revision of that candle. The UI selects the newest candle, rather than blindly selecting the last appended correction, and shows “Comparison needs recheck” when its comparison record has since been superseded. A first-candle correction remains a baseline. Do not reuse IDs, splice history, change venue identities to force comparisons, or modify timestamps to hide a failed retrieval.

The current ledger alone cannot prove append-only history. Runtime cross-record checks plus `--previous` enforce the contract against a trusted previous ledger. The 5,000-entry bound is a guardrail, not permission to discard history; plan a separately reviewed archival/schema migration before the bound is reached.

## Module API

- `ENTRY_WATCH_ASSETS`: frozen array of the five supported assets
- `NEWS_STALE_AFTER_MS`: 36 hours in milliseconds
- `validateNewsDesk(value, { now = Date.now(), previous } = {})`: returns the original object or throws a path-specific error
- `newsFreshness(value, now = Date.now())`: validates and returns the check-freshness object
- `validateEntryWatch(value, { now = Date.now(), previous } = {})`: returns the original object or throws; with `previous`, also validates the immutable prefix

The validators never mutate their inputs, contact the network, place orders or schedule work. All fixtures in automated tests are synthetic and stay outside the live feeds.

## Compact top shortlist

The top strip shows only a coin and its status. Fresh observed records display
`Lower low` when the latest exact completed-candle comparison verifies it, otherwise `Watch`; old observations display `Stale`; missing or invalid data displays
`No data`. Each coin opens its existing research history. This public strip
contains no portfolio allocation or account information.

An independent, optional `data/entry-setups.json` feed can mark a coin green as
`Review entry` only when its complete research setup passes the separate entry
setup validator and its supporting history is current. The amber Lower low label never qualifies an entry by itself. Corrections to its comparison remove the label until rechecked. No “Basing”, “Crowd interest” or all-time-low claim is generated from daily low data. Those need separate verified research evidence. Empty, invalid, stale, unchecked or mismatched
setup data cannot create a green status. The initial setup feed is empty, so
all five coins remain Watch. See `ENTRY-SETUPS.md` for the contract and freshness
limits. Green still requires the user to review current execution prices, fees,
exit rules and risks; it does not place an order or guarantee safety.
