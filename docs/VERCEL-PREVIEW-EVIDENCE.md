# Existing Vercel integration evidence — read-only inspection

GitHub API observations at 11:13–11:14 UTC on 11 October 2026 associate four non-production Preview deployment records with exact commit `29c959063d283f17f3807696953a106aef7afd73`, tree `ee87aeef3ee6efed503313ba0dc771d9da5f5e8f`. No deployment was requested by this verification task. The records are consistent with the repository's existing automatic integration having deployed the builder's push. A successful record does not prove served bytes, functioning UI, live market data or a backend.

## Exact checks

The [combined commit status](https://api.github.com/repos/seachef/ses-chef-labs/commits/29c959063d283f17f3807696953a106aef7afd73/status) contains four successful Vercel statuses, each saying “Deployment has completed”:

| Context | Created UTC | Dashboard target recorded by GitHub |
| --- | --- | --- |
| Vercel – ses-chef-labs-a6wx | 11:07:09 | https://vercel.com/seachef/ses-chef-labs-a6wx/6DozBy2JCUGRL5EaLwEe63rw98ff |
| Vercel – index.html | 11:07:13 | https://vercel.com/seachef/index.html/9Tj2dsVs9KQJGDrYW4Lr1YcfYbMj |
| Vercel – ses-chef-labs | 11:07:16 | https://vercel.com/seachef/ses-chef-labs/BwxjSxsy1K4ziX6uax2ezLjD3X3r |
| Vercel – index.html-ui5h | 11:07:19 | https://vercel.com/seachef/index.html-ui5h/y9qcKVqfCvXXGHeYefiXBHJUCEGn |

The [check-runs endpoint](https://api.github.com/repos/seachef/ses-chef-labs/commits/29c959063d283f17f3807696953a106aef7afd73/check-runs?per_page=100) separately contains one successful `Vercel Preview Comments` check, ID `114455207852`, started/completed 11:07:19 UTC. Its result is “No unresolved feedback”; this is not an application or engine test. The feedback link names a branch alias, not an immutable content fingerprint.

## Preview URLs for parent verification

These are exact `environment_url` values from GitHub deployment statuses, not guessed aliases. Each parent deployment has the exact SHA above and `production_environment: false`. The executor did not open these URLs, because their hosts are outside the approved allowlist.

| GitHub deployment | Environment | Status UTC | Recorded preview URL |
| --- | --- | --- | --- |
| [6994635411](https://api.github.com/repos/seachef/ses-chef-labs/deployments/6994635411/statuses) | Preview – index.html-ui5h | success 11:07:19 | https://indexhtml-ui5h-7rhgkdt13-seachef.vercel.app |
| [6994634329](https://api.github.com/repos/seachef/ses-chef-labs/deployments/6994634329/statuses) | Preview – index.html | success 11:07:13 | https://indexhtml-hf8itld1g-seachef.vercel.app |
| [6994633893](https://api.github.com/repos/seachef/ses-chef-labs/deployments/6994633893/statuses) | Preview – ses-chef-labs | success 11:07:16 | https://ses-chef-labs-kqqlrbtb2-seachef.vercel.app |
| [6994633893](https://api.github.com/repos/seachef/ses-chef-labs/deployments/6994633893/statuses) | Preview – ses-chef-labs, earlier status | success 11:07:10 | https://ses-chef-labs-fy89gb0nh-sea-chef-labs.vercel.app |
| [6994633745](https://api.github.com/repos/seachef/ses-chef-labs/deployments/6994633745/statuses) | Preview – ses-chef-labs-a6wx | success 11:07:09 | https://ses-chef-labs-a6wx-e1qgc3u12-seachef.vercel.app |

The `ses-chef-labs` deployment has two successful status records naming different URLs; both are preserved. No claim is made that either currently serves the commit. Raw API responses are saved under `/workspace/scratch/neptune-2-verification-evidence-20261011/github-*.json`.

## Backend and exact-content limits

At `29c9590`, the repository has no `vercel.json`, serverless `api/` directory, or deployment workflow. Its Node server is explicitly launched by the CLI, binds to `127.0.0.1`, and serves `/api/state` only while that foreground process runs. There is no installed/supervised runtime in this task. This source evidence provides no basis for claiming that Vercel installed or runs the backend. Vercel project settings were not accessed. **Remote backend presence or absence remains unverified.** A static page can return HTTP 200 while every state request fails.

For an independently authorized parent read-only check, retrieve `/`, `/ui.mjs`, `/style.css`, and `/api/state` on a recorded URL. Record status, redirects, MIME, bytes and receipt time. Do not send a STOP or other POST. A 200 HTML fallback from `/api/state` is not a functioning API; require valid JSON with the expected mode, worker, stopped and state fields. Fresh source timestamps and an independently supervised worker still require separate evidence.

Compare served assets with the `29c9590` SHA-256 hashes below. Exact equality supports byte identity; deployment metadata alone does not. Transforms require content comparison and documented explanation. The small reconciled local UI fixes are **not** part of that remote commit.

| Source path at 29c9590 | Bytes | SHA-256 |
| --- | --- | --- |
| index.html | 4709 | `077b7f44ca4adea0935fb3a72a07a0cfc808884ede76dc05e23eeac92ef99cce` |
| ui.mjs | 15716 | `444f6b57f25459b5df6359ceb9b6bece3f17cd337fa43607ff5dc134f1e0d7a9` |
| style.css | 3555 | `477b8de3c15b212048562093d63420b3a102c542a17c17ac794f8f62dc09a60d` |

Do not push the reconciled local branch merely to share it: these existing integrations may automatically create deployments. Keep the review patch/bundle local until publication side effects are explicitly approved. No remote ref, project settings, credentials, security configuration or existing site was changed by this verification task.
