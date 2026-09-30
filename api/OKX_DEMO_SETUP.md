# Craig’s OKX demo desk

Prepared: 30 September 2026. Live trading is disabled in this build.

## What is ready

- Local desktop service for OKX demo balances, spot limit buys, attached stop/first-target exits, order tracking and cancellation of pending entries.
- An amount → preview → explicit confirmation flow in the existing glass desk.
- Exchange tick/lot/minimum checks, a fresh price within 2% of the sourced entry, a 30-second preview, and server-enforced limits.
- A persistent client-order journal. An uncertain exchange response is checked by its original order ID; it is never automatically sent again, including after restarting.

Seven tests pass using mocked exchange responses. No actual OKX account or demo exchange order has been tested yet. Attached exits must be verified on your demo account, including partial fills and cancellation behaviour, before considering live trading. Only the first supplied target is used, for the full order quantity.

## Desktop setup

1. Download or pull the current `seachef/ses-chef-labs` repository on your desktop. Use Node.js 22 or newer. No npm packages are required by this service.
2. In OKX, open Demo Trading and create a **demo** API key with Read and Trade permissions. Do not enable Withdraw. Official instructions: https://www.okx.com/docs-v5/en/#overview-demo-trading
3. Copy `.env.example` to `.env` locally. Enter the demo API key, secret and passphrase in this local file. Do not paste them into ChatGPT, webpage inputs, screenshots or GitHub. Keep `.env` out of cloud-synced folders.
4. Keep `SCL_OKX_DEMO=true` and `SCL_EXECUTION_ENABLED=false`. Default demo limits are 100 USDT per order and 300 USDT per UTC day, including uncertain submissions. These are USDT limits, not AUD.
5. From the repository folder, run:

```sh
node --env-file=.env api/okx-server.mjs
```

6. Open http://127.0.0.1:8787 on that desktop. Press **Check connection** in the OKX demo panel. Current verified Bacon setups show **OKX demo buy** alongside the existing Paper buy button once the demo balance connection succeeds.
7. Enter an amount, preview the entry/stop/target, then press **Confirm demo buy**. Use **Check connection** to refresh demo balances and exchange order states. An accepted order is not necessarily filled; its exchange state and filled quantity are shown.

If there is no complete, current sourced setup in `data/bacon-intelligence.json`, no demo buy is offered. Do not invent a setup to make the button appear. Pull updated repository data before starting the local service.

## Boundaries

The public GitHub Pages desk remains paper-only. It cannot store exchange secrets or run this service. The demo controls are visible only when the desk is served locally on localhost/127.0.0.1. This service binds to loopback, verifies Host and POST Origin, exposes no cross-origin access, and never returns credentials. It is not a remotely accessible deployment; do not expose its port to the internet.

The journal `.okx-demo-orders.json` must be preserved. Do not delete it to retry a timed-out order. Credentials, authentication, secure hosting, exchange demo end-to-end checks and filled-position exit reconciliation still need completion before phone-accessible execution or any real trading.

To run the tests:

```sh
node --test api/okx-demo.test.mjs
```

The older `submitOkxApprovedOrder` entry point also refuses live submission. The dedicated demo client always sends `x-simulated-trading: 1` and rejects live mode and arbitrary API hosts.
