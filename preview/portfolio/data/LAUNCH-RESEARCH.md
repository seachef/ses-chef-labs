# Public launch research

The Launch research section reads `data/launch-research.json`. Public candidate revision
history lives in `data/launch-research-ledger.json`. These files contain public
research only: never include account or wallet data, addresses, balances,
credentials, private notification history, private source content, or paid data.

## Daily writer rules

- Read the latest repository revision and preserve unrelated and concurrent work.
  Update only the two research data files during a daily data run.
- Verify the project identity and each claim against official public project or
  venue sources. Open and read the cited page; search snippets and third-party
  predictions alone are not listing evidence. A syntactically valid URL does not
  prove that a site is official, that a page is accessible, or that its contents
  support the prose. The validator cannot establish any of those facts.
- Publish zero to three candidates. An empty list is valid and preferable to
  filler, guessed launches, inferred listings, or unverified availability.
- Keep closed or finished sales out of the current opportunity shortlist; retain their revisions in the ledger. A watch candidate is not an open purchase opportunity. Do not pad the list.
- Keep a stable lowercase hyphenated candidate ID (maximum 64 characters).
  Never recycle one project's ID for another project with a similar ticker.
- Record the actual UTC observation time. Do not refresh timestamps without
  rechecking the source. All source and venue timestamps must be no later than
  the report timestamp. The validator allows at most five minutes of clock skew.
- Keep unavailable dates and times null. A known date requires a cited official
  source; a known time requires a date. A source may support only a launch window,
  with the precise date and time both null. Never turn a window into a guessed day.
- An announced, available or closed venue requires the real official public
  venue URL, a supporting source URL, and that exact source URL in `sources`.
  Unconfirmed venues have a null venue URL. Do not fabricate a market pair URL.
  A candidate marked `available` needs at least one venue marked `available`.
- All non-null launch and venue source URLs must exactly match a source citation.
  Keep distinct sources unique. Use public HTTPS links without credentials,
  localhost, private/reserved IP literals or local network names. The validator
  does not resolve DNS or inspect redirects, so verify final destinations too.
- `australia_eligibility` is always `unverified`. Public regional restrictions can
  be summarized in risks, but a public listing does not establish account access,
  residency eligibility, suitability, or investment safety. Do not promise
  guaranteed outcomes, assured returns, or risk-free investment.
- Use bounded plain text without HTML, Markdown, control characters, or hidden
  direction markers. The prose guard rejects common assurance phrases
  conservatively; it is not a complete claims classifier. Review the actual text.
- Validate both files before committing them together. Never force-push or silently
  discard ledger entries. Verify the deployed JSON and visible report after an
  authorized publication. A successful commit alone does not prove publication.

## Exact data contracts

Every listed property is required, and unknown properties are rejected at every
level. `schema_version` is the number `1`. UTC timestamps are `YYYY-MM-DDTHH:mm:ssZ`
with an optional one to three fractional-second digits before `Z`. Dates and times
must be real. All strings are trimmed; URL length is at most 2,048 characters.

Report: `{schema_version, checked_at, candidates}`.

Each candidate has:

- `id`: lowercase letters/digits separated by single hyphens, maximum 64; unique
  within the report
- `name`: 1–100 characters; `symbol`: 1–20 uppercase ticker characters using
  A–Z, 0–9, dot, underscore and hyphen, beginning with a letter or digit
- `status`: `prelaunch`, `closed`, `watch`, or `available`
- `summary`: 1–600 characters; `risks`: one to three strings of 1–240 characters
- `official_url`: verified official project HTTPS URL
- `launch`: `{date, time_utc, source_url}`, each nullable; non-null `date` is
  `YYYY-MM-DD`, and non-null `time_utc` is `HH:mm:ss` UTC
- `venues`: zero to three `{name, status, url, source_url, checked_at}` objects;
  name is 1–80 characters; status is `unconfirmed`, `announced`, `available`, or
  `closed`; URL and source URL are nullable as described above
- `sources`: one to six `{label, url, checked_at}` objects; label is 1–120
  characters; URL is non-null
- `australia_eligibility`: the literal string `unverified`

Ledger: `{schema_version, entries}`. Each of at most 1,000 entries is exactly
`{candidate_id, checked_at, event, fingerprint, note}`. Candidate ID follows the
same rule as above; event is `added`, `updated`, `closed`, or `removed`; fingerprint
is a 64-character lowercase SHA-256 hex digest; note is 1–600 characters of public
plain text. Entries are ordered by observation time, with no duplicate candidate
ID at the same instant, even if the timestamp uses different fractional notation.
Removed candidates may remain in the ledger. Do not require ledger IDs to be
present in the latest shortlist. Stop and report when the ledger reaches its
limit; do not silently truncate history.

After validating the report, hash the UTF-8 string returned by
`candidateFingerprintInput(candidate)` using SHA-256. It recursively omits
`checked_at`, sorts object keys, and preserves array order. Compare against the
candidate's latest revision so ordinary source rechecks do not create revisions
or repeat notifications. A return to an earlier content state at a later instant
may legitimately repeat a fingerprint. Append at most one final event per
candidate per run. For removals, reuse the last candidate content fingerprint and
write the removal event with a new observation time. Notification deduplication
stays outside these public files.

## Validation and freshness

```sh
node --test scripts/launch-research.test.mjs
node scripts/validate-launch-research.mjs
# Optional explicit paths, relative to the current working directory:
node scripts/validate-launch-research.mjs path/to/research.json path/to/ledger.json
```

The CLI validates both files and exits nonzero on invalid input. Default paths
are resolved from the repository, independent of the current working directory.
The structural contracts are `launch-research.schema.json` and
`launch-research-ledger.schema.json`; the runtime validator in
`portfolio/launch-research-data.mjs` is authoritative for cross-record citations,
identity, host restrictions, real dates, time bounds and prose safeguards.

`validateLaunchResearch` and `validateLaunchLedger` return the unchanged validated
object and throw a path-specific error for invalid input. `researchFreshness`
returns `current` until the oldest report, source or venue observation is more
than 36 hours old, then returns `stale`. Old but valid research remains visible
with a stale label; wrapping old evidence in a new report timestamp does not make
it current. Freshness is not a verification of truth or continuing venue access.
