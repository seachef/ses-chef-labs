# Sea Chef Labs OKX execution boundary

The public GitHub Pages desk remains paper-only. The new local desktop service implements demo spot order preview, confirmation, balance reads, order tracking, and entry cancellation. Real trading is disabled.

See [OKX_DEMO_SETUP.md](OKX_DEMO_SETUP.md) for setup, limits, tests, and remaining connection work.

Exchange secrets stay in the desktop's local `.env` file and never go into browser code, JSON feeds, chat, or commits. Use a dedicated OKX Demo Trading API key with Read + Trade and no Withdraw permission. The service binds to localhost only; it must not be exposed to the internet.

Seven mocked tests passed. An actual OKX demo balance, buy, fill, attached exit and cancellation have not yet been verified. The journal preserves client order IDs and blocks automatic retries after an uncertain submission.
