# NEPTUNE 1 retirement / NEPTUNE 2 preparation

Status: cleanup preparation; no runtime deletion or deployment yet.

## Recovery
Full pre-cleanup repository snapshot: `archive/neptune-1-pre-2-cleanup-2026-10-11` at `b7e04ae43e2979c618296728ccc02de862b3b63a`.

## Neptune 2 scope
- Remove all SMSF and personal wallet portfolio interfaces, wallet lists, balances, holdings, wallet-specific price tracking and connection controls from Neptune 2.
- Do not import SMSF or personal wallet data into the new Neptune 2 app.
- Preserve research, watchlists and market data not dependent on user wallets.
- Preserve `preview/neptune-2/`, paper trading and safety locks. Do not enable Start or live orders.
- Preserve historical records in the archive. Do not revoke external wallets, delete Supabase records, or erase secrets without a separate verified inventory and explicit scope.

## Cleanup gates
1. Inventory old UI, wallet/portfolio paths, backend services, routes, tests and workflows; trace all consumers.
2. Separate wallet-specific modules from shared authentication, market data, research and paper-trading dependencies.
3. Remove only verified obsolete files and references in a reviewed diff.
4. Run regression tests and Pages checks before merging.

No deletion is safe merely because a filename contains `neptune`, `wallet`, or `paper`.
