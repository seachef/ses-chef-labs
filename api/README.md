# Sea Chef Labs execution API foundation

The Bacon Fast Trade Desk is currently a **staging and owner-approval** interface. This folder is the boundary for a later authenticated exchange API.

## Security rules

- Exchange secrets stay server-side. Never put API keys, secrets, passphrases, seed phrases or private keys in `index.html`, browser JavaScript, JSON data files, commits, issues, or chat.
- Use a dedicated exchange API key with **withdrawals disabled** and only the minimum trading permissions needed.
- Live execution remains disabled until a specific supported exchange is selected, its official API is implemented, server-side authentication is configured, and an end-to-end paper/test environment passes.
- Owner approval and exchange submission are separate events. A staged approval must not silently become a live order.
- Server-side order caps must be configured before enabling submission.

`.env.example` documents variable names only; real values belong in encrypted deployment secrets.

Current state: **execution disabled; no order submission implementation**.
