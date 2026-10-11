# NEPTUNE 1 retirement / NEPTUNE 2 preparation

Status: retirement preparation only. No runtime deletion or deployment approved by this document.

## Recovery

Full repository pre-cleanup snapshot: `archive/neptune-1-pre-2-cleanup-2026-10-11` at `b7e04ae43e2979c618296728ccc02de862b3b63a`.

## Preserve

- `preview/neptune-2/` and `.github/workflows/neptune2-tests.yml`.
- Existing portfolio, SMSF/personal wallet display, Supabase integrations and price collection.
- Research desk, watchlists, launch/news research, data ledgers, public research publication and Pages routing.
- Shared `backend/neptune-paper/` and `backend/neptune-scout/` until dependency and safety audits identify exact consumers.
- Existing safety locks: do not enable paper Start, real orders, or live trading as part of cleanup.

## Cleanup gates

1. Inventory the old NEPTUNE 1 UI/assets/workflows and map imports, routes, tests, data producers, and consumers.
2. Prove every proposed deletion is unused by the preserved systems and by Neptune 2.
3. Remove only proven obsolete files in a reviewed diff; run relevant tests and Pages checks.
4. Merge only after reviewing the exact deletion list and successful regression checks.

No deletion is safe merely because a filename contains `neptune` or `paper`.
