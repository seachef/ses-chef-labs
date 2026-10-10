// Test-only historical fixture policy. Never included in production SQL or migration.
// Keeps Binance accounting/risk/reader regressions active after owner-disabled release.
export const historicalAllVenuePolicy = `create or replace function neptune_v2_private.native_activation_policy() returns jsonb language sql immutable security invoker set search_path='' as $$select '{"native_entry_venues":["binance","hyperliquid"],"native_collection_venues":["binance","hyperliquid","USDT","USDC"],"excluded_venues":{}}'::jsonb$$;`;
