# Manual exchange navigation

The public frontend offers an explicit exchange and spot-pair selector within the existing compact EXECUTION row. It does not connect an account. Buy and Sell remain disabled with WAIT because this frontend has no supported reviewed-setup contract. A separate `Open … spot page` link is ordinary external navigation for manual review. The owner selects the side, checks the details and confirms any order on the exchange itself.

## Destinations and identity

`exchange-handoff.mjs` contains ten exact, frozen allowlist entries. OKX supports the verified ordinary HTTPS spot pages for BTC/AUD, ETH/AUD, SOL/AUD, BTC/USDT, ETH/USDT and SOL/USDT. CoinSpot supports its verified AUD Markets pages for BTC, ETH, SOL and USDT. These are navigation choices, not qualified candidates. No arbitrary symbol interpolation is allowed; unlisted symbols and venue/pair combinations fail closed.

Changing venue clears the selected pair and removes the previous link. Both disabled side labels follow the explicit selection. A sale must be reviewed on the venue where the owner actually holds the asset; the application does not know or infer that holding, and performs no transfer. Click/auxclick validation checks the exact selected venue, pair and allowlisted URL, including displayed selection consistency. Mismatched or tampered links are prevented. Side-selection query parameters, order prefill and native app links are not supported. Both sides use the same verified spot page.

Links use a new tab with `noopener noreferrer` and `no-referrer`. Repeated navigation has no order/fill callback or account mutation. The module has no network, persistence, credential, signing, portfolio or wallet API. Selection is memory-only and resets on reload. There is no private account data or trade-state storage on the public page.

## WAIT and costs

There is no fresh independently reviewed actionable setup. Fresh browser quotes, expired quotes, historical reports, arbitrary setup-like objects, unknown costs and mismatched identities cannot enable Buy or Sell. The release deliberately has no setup ingestion or approval override. No removed candidate or invented entry, stop or target is introduced. A future actionable setup contract would require separate reviewed implementation and verified venue-specific evidence.

Cost copy uses the supplied official research checked on 12 October 2026: CoinSpot Markets buy/sell is 0.1% per side, while instant and conditional stop/target products are 1%; users must not treat those products as interchangeable. OKX personal pair-specific maker/taker fees remain unknown, so no personal rate or cheapest-venue claim is shown. These public facts do not prove account/product eligibility or actual execution costs. The UI does not calculate a trade quote or net outcome from them.

The existing Coinbase observation contract is unchanged. Those integration markets and quotes do not establish OKX/CoinSpot executable prices or qualify a trade. The included historical paper report remains byte-for-byte unchanged and explicitly ended/stale. A page visit or return from an exchange cannot update holdings, fill status, protection or that report. The paper STOP and public-data Cancel controls do not cancel exchange orders.

## Verification and limits

Focused offline tests cover exact destinations, hostile URLs, unsupported symbols, missing/stale/unreviewed/mismatched setup-like data, venue changes, stale DOM selection, duplicate clicks, cost copy, no economic handlers, teardown and static responsive/accessibility structure. Existing refresh/failure/expiry tests verify that actions stay disabled and the historical report and unknown account remain unchanged. The build includes only public browser assets.

Native/mobile rendering and exchange app handoff behavior have not been verified in this environment. The existing Chromium sandbox helper is unusable; no unsandboxed browser or sandbox modification is permitted. DOM and responsive-CSS checks are not a substitute for native-device verification. This release adds no continuous research workers, Railway service or automated trading.
