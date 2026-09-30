# Overnight Bacon paper research

The published desk reads `data/bacon-shortlist.json` every five minutes while open,
on return to the tab, and when **Check Bacon** is pressed. It does not route these
items to paper-order or exchange controls. The existing HBAR position is unchanged.

## Ownership and schedule

- The existing hourly public-Telegram collector owns `bacon-intelligence.json` and
  `bacon-history.json`. Its :23 schedule is unchanged.
- The existing overnight market screen owns `daily-snapshot.json` and
  `research-state.json`. Its schedule is unchanged.
- The daily research publisher owns only `bacon-shortlist.json` and
  `bacon-research-log.json`. Its 05:00 Australia/Perth run targets a report by 06:00.
  Scheduled execution may be delayed; `checkedAt` is the actual research time.
- Before publication, read the latest main revision, merge new observations into
  the ledger, validate both files, and commit them together without force-pushing.
  Preserve concurrent edits. Do not change code or these schedules during a data run.
- These are public market-source records. Never include personal data, credentials,
  paid/private source content, or user portfolio details in them.

## Shortlist contract (schema 1)

Required root fields: `schema: 1`, `paperOnly: true`, `date` (YYYY-MM-DD in Perth),
`checkedAt` and `deadlineAt` (ISO timestamps), `summary`, `status` (`ready`,
`nothing-to-report`, `partial`, or `unavailable`), `sourceChecks`, `items`,
`watchlist`, and `ledgerUrl: "data/bacon-research-log.json"`.

A source check has `name`, `url`, `status` (`checked`, `partial`, `unavailable`, or
`excluded`), actual `checkedAt`, and a short `detail` describing exactly what was
accessible. An announcement, caption, transcript, and watched video are distinct.

A complete item has stable `id`, `symbol`, `pair`, `currency`, `side` (`buy` or
`sell`), numeric `entry` (one price or `[low, high]`), numeric `stop`, nonempty
numeric `targets`, `publishedAt`, `expiresAt`, `sourceUrl`, `sourceName`,
`rationale`, and `levelBasis` (`source-explicit` or `research-derived`). All levels
must be finite and positive, with stop and targets on the correct side of the
entire entry range. Explicitly label research-derived levels and give their
method/evidence; never attribute them to Bacon. Never invent missing levels,
convert a weekly thesis invalidation to an executable stop, or combine unrelated
calls. Current-source and current-market checks are required before promotion.

Incomplete research goes only in `watchlist`: stable `id`, `symbol`, `sourceUrl`,
`sourceName`, `publishedAt`, `note`, and `missing` (entry, stop and/or targets).
Without a meaningful change, use exactly `Nothing to report.` in `summary`.
A failed source check must remain visible, not be reported as no new calls.
The UI labels research over 26 hours old as stale and withholds expired items.

## Dated ledger contract (schema 1)

Root fields: `schema: 1`, `updatedAt`, `records`, and `runs`.
Each record has stable `id`, `canonicalUrl`, `sourceName`, `publishedAt`,
`firstSeenAt`, `lastSeenAt`, `contentHash`, `summary`, `symbols`, `classification`
(`setup`, `watchlist`, `commentary`, or `security`), integer `revision`, and
`revisions` of `{observedAt, contentHash, summary}`. For transcript extracts, hash
normalized assessed text; for public post observations, hash normalized source
text. Preserve prior revisions. Canonicalize source URLs and deduplicate repeated
posts and equivalent cross-posts before recording a new call. Cross-post evidence
can be retained as additional source metadata; it is not a separate new call.

Each run records `checkedAt`, Perth `date`, `status`, `summary`, `sourceChecks`,
`newIds`, and `revisedIds`. Preserve dated runs and observations across updates.

## Checks

```sh
python -m unittest discover -s scripts -p 'test_*.py'
node --test scripts/bacon-shortlist.test.cjs
node scripts/validate-bacon-shortlist.cjs
```

The hourly feed publication copies the module and all JSON data, so a later feed
refresh cannot drop the shortlist. Verify the published JSON and visible UI after
publication; a green workflow alone is not evidence that the display is current.
