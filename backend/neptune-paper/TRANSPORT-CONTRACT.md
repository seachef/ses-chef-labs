# pg_net observation-bound contract

## Upstream evidence

For pg_net v0.20.4, the worker starts a transaction before its curl loop, and inserts responses before committing. The response insert omits created, whose table default is now() (transaction start). It cannot be treated as exact HTTP arrival.

- [Worker transaction and request loop](https://github.com/supabase/pg_net/blob/v0.20.4/src/worker.c)
- [Response insertion](https://github.com/supabase/pg_net/blob/v0.20.4/src/core.c)
- [Response-table created default](https://github.com/supabase/pg_net/blob/v0.20.4/sql/pg_net.sql)
- [Supabase pg_net transport documentation](https://supabase.com/docs/guides/database/extensions/pg_net)

Public GET response metadata observed during review included a genuine source event about 70 ms after batch start. Two bounded public POST probes to the existing Hyperliquid info endpoint separately confirmed HTTP 200 JSON spotMeta and l2Book schemas and the expected @107 HYPE/USDC identities. Probe quotes were stale by inspection and were never execution evidence. Private transport metadata and request identifiers are excluded from this source bundle. Neither a probe nor synthetic tests establish continuous feed availability.

## Invariants

1. Only an existing owned legacy/native request may be observed. Bind origin, request ID, epoch, sent_at, response created, and SHA256 digests of both complete rows.
2. Read the response row first. Then capture clock_timestamp and append one immutable journal row. Never use function-entry time or a readiness count as the upper bound.
3. Persist every currently visible pending response before either collector returns early for an incomplete batch. Repeated collection preserves the original upper bound. Changed request/response identity fails closed. Null or future created timestamps are journaled as rejected observations too; they cannot acquire a later bound after the clock catches up.
4. Lower bound = max(sent_at, created). Require lower <= first_observed <= current parse cutoff. Refresh the current cutoff after journal capture, never clamp captured bounds backwards.
5. Source events and metadata dates must be <= first_observed. Any existing HTTP Date clock-skew allowance is measured from that same immutable upper bound, never delayed collection time.
6. Freshness uses current time minus conservative lower. The downstream received_at alias keeps that lower bound and explicitly labels its basis. Candle start causality uses upper; inclusion/completion and rolling volume window use lower. Waiting cannot admit a previously future event or completed candle.
7. Keep provider-source times, request binding, timeout flags, 5-second HTTP request timeout, queue-start delay, backoff and denial handling. Unknown exact wire arrival stays null.
8. Journal rows contain only bound times and hashes, not bodies. They are private, RLS-enabled, immutable and inaccessible to client roles; storage guards include their retained footprint.

## Boundaries

The interval is deliberately conservative: a delayed first database observation is not exact network arrival. Lower-bound age checks reject stale samples even if the upper bound is recent. A response first appearing after the captured collection cutoff can be skipped safely rather than relabelled. Transaction rollback can roll back newly recorded journal rows together with the rest of that transaction; committed pending-batch observations remain fixed. No external response table, extension configuration or scheduler is changed.

Local regression coverage includes +70 ms source events, future events/metadata, old lower bounds with fresh upper bounds, changed request/response digests, pending and partial-batch retries, FX midnight, HTTP Date delayed retries, boundary candles, actual collector envelope provenance and client ACL denial. Synthetic fixtures are not represented as production transport proof.
