# Argus Financial Partners Backend — Conventions

These rules are enforced across the codebase. Read before contributing.

## Money

- **All money is integer minor units represented as `bigint`.** Never `number`/float for money — anywhere.
- USD → integer cents. Tokens → smallest unit (USDC has 6 decimals → micro-USDC).
- DB columns are `*_minor` (INTEGER/BIGINT) paired with a `currency` column.
- Read money out of the DB through `Money.fromDb(raw, currency)`. pg returns BIGINT as a string, SQLite returns
  INTEGER as a number; `BigInt()` handles both exactly.
- Serialize money as `{ amount: string, currency, decimals }` — the amount is a decimal string, never a JS number.
- Use `Money` (src/db/money.ts) for all arithmetic. It throws on cross-currency operations.

## Errors

- Throw `AppError` with a stable `ErrorCode` (src/errors.ts). The error middleware turns it into the standard
  envelope `{ error: { code, message, retryable } }` with the right HTTP status.
- Clients branch on `error.code`, never on human-readable message text.

## Idempotency

- Every money-mutating endpoint requires an `Idempotency-Key` header and mounts the `idempotency()` middleware
  (src/middleware/idempotency.ts). Replays return the stored response; key reuse with a different body → 409.

## Database

- One async interface (`Db`, src/db/index.ts) over Postgres (prod) and SQLite (dev).
- Write SQL with `?` placeholders; the Postgres adapter rewrites to `$n`.
- `audit_logs`, `ledger_entries`, `ledger_journals`, `mcp_audit_logs`, `fraud_decisions`, `fills` are
  **append-only** (DB triggers block UPDATE/DELETE). Never attempt to mutate them.
- Balances are derived from the double-entry ledger (Phase 4). Do not mutate balance columns directly once the
  ledger lands; `accounts.balance_minor` becomes a cached projection.

## Time & IDs

- All timestamps are UTC ISO-8601 strings.
- IDs are UUIDs (v4 today; move to v7 time-ordered when convenient).

## Auth & tokens

- **Session tokens**: HS256 with `JWT_SECRET` (src/middleware/auth.ts). Verified by `requireAuth`.
- **Scoped/exchange tokens** (agent access): RS256 via `tokenFactory` (src/utils/tokenFactory.ts), verifiable via
  JWKS at `/api/.well-known/jwks.json`. These are short-lived (90s scoped).
- Passkeys (WebAuthn) are the primary auth in Phase 3. Password auth exists only behind `ALLOW_PASSWORD_AUTH` and is
  rejected in production by `config.ts`.

## Logging

- Use the `logger` (src/observability/logger.ts). Never log secrets, full tokens, VC/VP contents, passwords, or raw
  PII — the redaction list is a safety net, not an excuse.

## Config

- All env access goes through `config` (src/config.ts). Never read `process.env` elsewhere. Production boots fail fast
  on insecure config (dev JWT secret, password auth enabled, Hedera enabled without operator keys).
