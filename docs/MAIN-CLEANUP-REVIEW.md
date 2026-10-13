# Main cleanup review — 13 October 2026

## Candidate basis and scope

Single ordinary commit with parent `7df880e027d8569e3d8142adfaa223a40d6ea07d`.
Adopts clean-start source `c3caf8994f60d9a5418bf47ef1c0a14ad84e407f`
(tree `2de2648e680d130231a3a601aff789e05f79a513`), with the hosting protections below.
Prepared in an isolated worktree; original checkout and other branches untouched.
No engine changes or import of unpublished `ea2c0c5`; its known protective-exit
problem remains unresolved by this cleanup.

Legacy Sea Chef, NEPTUNE, Portfolio and research-desk sources are removed from
the candidate. Their source history stays reachable through the commit parent.
Obsolete legacy workflows are removed, including the explicitly approved
`neptune-public-scout.yml` and `overnight-research.yml`. The replacement root
`neptune2-tests.yml` runs `npm test` and the public build with read-only repository
permissions. The separate `neptune-research-data` branch remains intact at
`91a9236e2000e438106bb96d29f73bc840fa07b5` at inspection time.

No ChatGPT automations, PEPE alert, databases, deployed Supabase data or services
are changed. Parent confirmed the legacy morning writer paused at
2026-10-13T04:46:54Z; this task did not change it.

## Hosting protections

- All five old main Vercel security headers preserved exactly.
- All old main `.gitignore` patterns retained, including `.env`, `.env.*`, the
  `.env.example` exception and `.okx-demo-orders.json*`; new local state rules kept.
- Root `index.html` is a script-free meta-refresh and fallback link to
  `https://ses-chef-labs-git-neptune-2-clean-start-seachef.vercel.app/`.
- Original loopback document preserved byte-for-byte as `operator.html`.
  Server `/` and `/index.html` serve it under unchanged CSP and API rules.
  Static local layout builder reads the same operator document.
- `scripts/build-public-preview.mjs` is unchanged: exactly 12 public assets plus
  manifest, excluding server/store/journal/engine/loopback. It still uses
  `public.html` for Vercel root, preserving origin-root research fetches.
- The canonical destination is a branch alias. Publishing main does not update
  that alias; successful deployment metadata is not served-content proof.

## Verification completed

Node v24.19.0, `npm test`: **330 tests, 328 passed, 2 pre-existing skips,
0 failed**. Four new hosting tests cover Pages routing markup, actual loopback
HTTP/CSP/assets/state/durable stop and hostile-origin rejection, local layout
builder and exact Vercel headers. `npm run build` succeeds; existing tests verify
asset hashes and import closure. `git diff --check` passes.

Separate `npm start -- --data <temporary-directory> --port <free-loopback-port>`
smoke passed: root operator page, GET state, POST durable stop. Process stopped
and disposable test data removed; no persistent runtime activated.

Independent read-only reviewer found no blocking source defects. Independently
ran 4 hosting tests (4 passed) and a separate 40-test subset (39 passed, 1 existing
skip), compared source/security protections, and verified clean original checkout
and remote branch heads.

No GitHub Actions runs were queued or in progress at initial inspection.
GitHub reports all four Vercel statuses successful for clean source c3caf899;
canonical-project deployment 7023426213 reports success, created
2026-10-12T20:34:40Z. This is metadata only.

## Disclosed hosted verification limitations

1. GET of canonical alias `/build-manifest.json` fails before HTTP origin access:
   managed proxy returns `Tunnel connection failed: 403 Forbidden`.
   Served manifest/version and all 12 served asset hashes cannot be checked.
2. Playwright bundled browser is missing. Installed `/usr/bin/chromium`, launched
   with sandbox enabled, aborts: SUID sandbox helper is not configured correctly
   (requires root ownership and mode 4755). No sandbox bypass or permission change
   attempted. Actual browser navigation from repository-subpath Pages remains
   unverified; local markup/HTTP tests passed.

## Publication assessment and plan

Parent clarified that the existing canonical URL had been successfully used by
Craig and its deployment receipt verified. The unchanged proxy/browser restriction
is a disclosed verification limitation, not a new candidate failure. GitHub
project/revision receipts and unchanged clean branch head support the intended
c3caf899 destination; they do not independently prove the current alias mapping
or served bytes. No unknown new destination is introduced.

Additional local static HTTP checks passed for `/ses-chef-labs/` and
`/ses-chef-labs/index.html`: HTTP 200, exact source bytes, parsed absolute refresh
and fallback link to the canonical destination, no scripts/iframes/local API or
legacy dependency references. Independent reviewer reassessed the clarified
scope and found publication justified, with the served-content limitation stated.

1. Publish the locally verified candidate under the clarified authorization.
   Fresh served manifest/hash and native-browser checks remain unperformed until
   ordinary access and a supported sandboxed browser are available.
2. Recheck remote main is exactly the expected parent; recheck clean branch head,
   research-data branch and active publisher runs immediately before publication.
   If main moved, stop and reconcile concurrent changes in a new tested candidate.
3. Push only the candidate to main with an ordinary non-forced fast-forward push.
   Never force, reset remote history, delete branches or import unrelated work.
4. Verify exact remote main SHA, Pages build and Vercel deployments for that SHA,
   then served Pages redirect and canonical manifest/assets. Report the precise
   failure if any deployment or served-content check fails.

This review records the pre-publication assessment; the final task receipt records
the exact published SHA and subsequent CI/deployment outcomes.
