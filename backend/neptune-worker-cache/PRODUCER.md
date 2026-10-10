# Producer and installation proposal

## Truth boundary

The cache reports an authenticated parent's observations of actual work. It does not launch models, run code, verify a test execution, authenticate worker identities independently, or maintain an always-on workforce. A worker heartbeat requires a new observation specific to that worker. Publisher activity cannot substitute for that observation. Completed test/review outcomes require the exact candidate/artifact digests and approved classifications; the producer must establish those facts before submission. A valid digest alone is no proof of execution.

## Publication protocol

1. Read the private publisher and selected worker slot fences with the already-authorized management role. Never add a browser/service key or grant a client role access.
2. Open a new publisher session only for a genuinely new verified producer after the previous session closed or expired. Use a new UUID and expected prior generation. Do not invent a continuation.
3. Assign each actual worker to one of six permanent slots. A new real task starts a new run with expected prior slot run generation. Existing nonterminal work can be newly observed after its display lease expired: use the same run generation and expected revision with a strictly newer fresh observed_at. A terminal run cannot resume.
4. Send the complete narrow envelope. Worker session_seq is 0; run_seq is the intended revision. Source/candidate fields have no inheritance. Keep worker-specific observed_at truthful, including when the producer was waiting on a long task without a new observation.
5. Batch the six independent changes and a publisher heartbeat if available, then call publish once. No schedule is installed by this component. Publishing or polling without new evidence cannot freshen timestamps.
6. An uncertain last operation can be resolved by reading last_id/last_hash and generation/revision in the relevant private fence row. Retry that exact envelope and original expected fence once if still appropriate. Identical latest retry acknowledges without writes. If superseded, do not replay old work. Read the current state and reconcile.
7. Cache capacity, lock timeout, missing status or projection failure is dispensable. Roll back that activity transaction, keep paper processing untouched, and let the old display expire. Do not bypass safety gates or edit financial/audit history to recover telemetry.

## Storage and operator limits

Logical state is exactly16 precreated cache rows: one publisher, six worker fences, eight overwriteable recent slots and one snapshot. Display expiry hides payloads without deleting fences. The ring is incomplete recent operational activity, not an audit ledger.

Two admission limits apply to new cache evidence/publish: allocated cache relations below512KiB and all current engine/cache/status/history/control/sequence relations below30MiB. These are fail-closed admission thresholds, not hard filesystem ceilings; a rolled-back operation can still allocate physical pages. The old engine does not count the new cache schema, so the independent cache reserve is essential. The final candidate uses existing default storage/autovacuum options. No table/global maintenance setting or schedule is changed.

A periodic local VACUUM in PGlite is an experiment, not proof of production autovacuum. The production resource budget, intended maintenance behavior, real PostgreSQL multi-session Stop/Resume/collector/activity contention, crash/WAL recovery, exact installed privileges and actual public GET must be checked before claiming a production-capable continuously updated feed.

## Deployment boundary

Install the independently approved native027544 release first, preserving the exact existing research projection. This cache accepts only the verified native-plus-research catalog ebb947a07dd579e567cdf84b97b2b3ae and runtime027544eb165e7b705302b4a48ad6fdc7d58602bb6ff3852829ad57f9982501be. It refuses build5, an existing cache/legacy bridge/column, changed research code, unexpected triggers, ACL drift or any other catalog mismatch. There is no destructive conversion/reinstall path.

ATOMIC-WORKER-CACHE.sql requires explicit release approval in its transaction. For a management DDL tool such as Supabase apply_migration, use the complete byte-exact INSTALL-APPROVED.sql as query, with migration name neptune_worker_cache_column_v2. This reviewed self-contained entrypoint owns BEGIN/COMMIT and sets the custom approval latch locally inside that transaction; it requires no earlier SET call or persistent configuration. Execute only after the owner-authorized release approval. Never edit the file, bypass a guard, or substitute a catalog hash at cutover.

The only existing-schema addition is public.neptune_paper_v2_status.team_work, nullable JSONB/defaultNULL. It contains the same narrow public-safe worker projection already specified in this contract, for the existing SELECT audience. No grant, policy, role, endpoint, credential, table/global storage option, financial function, immutable row, balance, account setting or schedule changes. Cache publication updates only this column; market payload, existing research content/timestamps and updated_at are preserved. There is no cache overlay trigger and ordinary engine writes never execute cache code.

Review the exact MANIFEST/PUBLICATION-MANIFEST identities and the operator’s separately retained read-only checks before applying. After authorized installation, compare installed function bodies/permissions with MANIFEST, verify original research trigger/functions and financial catalog/rows remain unchanged except the new column, test the same public GET with id,payload,team_work, and verify actual producer observations/expiry. Source publication alone is not activation. Real independent-session contention/crash recovery and future maintenance timing remain operational validation limits, not claims made by local PGlite tests.

## Verification coverage

The full 19-group cache diagnostic harness is retained privately and is not included in this public source package or public CI. It checks catalog and row preservation, installation guards, existing access boundaries, lifecycle ordering, expiry and bounded storage using isolated local fixtures. Its complete private checks remain required before installation. Public CI covers the existing frontend and native backend suites; it does not run or claim the cache diagnostic suite. The full local frontend candidate also retains one private-only full-row integration case.
