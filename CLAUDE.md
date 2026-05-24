# CLAUDE.md — BankAI

Guidance for Claude Code (claude.ai/code) when working in this repository. Read this fully before making changes.

## What this is

BankAI is a tokenization-first neobank being rebuilt from a prototype toward the architecture in the PRD: Hedera settlement, a native (non-custodial) wallet, a double-entry ledger, decentralized-identity-gated agent access (W3C Verifiable Credentials + OID4VP), and an MCP server that lets external AI agents operate on a user's behalf under tightly scoped, user-granted permissions.

The build proceeds **phase by phase**. The full plan is in `docs/REBUILD-PLAN-v2.md`. The product requirements are in `docs/prd/` (start at `docs/prd/README.md`).

## Monorepo layout

| Path | What | Status |
|---|---|---|
| `backend/` | Node + Express + TypeScript API | Phase 0 + 1 implemented |
| `frontend/` | React + Vite customer portal | not started |
| `bankai-agent/` | External agent web app (OID4VP + MCP) | not started |
| `BankAIWallet/` | iOS SwiftUI wallet (Secure Enclave keys, VC holder) | not started |
| `docs/REBUILD-PLAN-v2.md` | The implementation plan, one block per phase | reference |
| `docs/prd/` | Product requirements (13 linked modules) | reference |

## Build status

- [x] **Phase 0** — Conventions: money (integer minor units), errors, config, idempotency
- [x] **Phase 1** — Backend foundation: dual Postgres/SQLite DB, full schema + migrations, append-only triggers, session auth, rate limiting/lockout, RS256 token factory, audit service, logging, metrics
- [x] **Phase 2** — DID & Verifiable Credentials: persisted RS256 keypair, key rotation, W3C VC JWT issuance, BitstringStatusList revocation, credentials routes
- [x] **Phase 3** — Auth (WebAuthn passkeys), tiered identity ladder, internal agents
- [x] **Phase 4** — Double-entry ledger (the single source of truth for balances)
- [ ] **Phase 5** — Hedera integration (on-chain USDC, paymaster, on-device signing)
- [ ] **Phase 6** — SmartChat (RFC 8693 token exchange)
- [ ] **Phase 7** — MCP server & external agents (VP signature verification — security-critical)
- [ ] **Phase 8** — React frontend
- [ ] **Phase 9** — iOS wallet
- [ ] **Phase 10** — External agent app
- [ ] **Phase 11** — Hardening: RBAC, rate limiting, observability, tests
- [ ] **Phase 12** — Integration & first-run setup
- [ ] **Phase 13** — Final polish & security-invariant tests

## Commands (run inside `backend/`)

```bash
npm install            # install dependencies
npm run dev            # start dev server on :3001 (runs migrations automatically in dev)
npm run migrate        # apply DB migrations explicitly
npm run typecheck      # tsc --noEmit (run after every change)
npm test               # vitest — runs the foundation/security invariants
npm run build          # compile to dist/ (copies SQL migrations)
npm start              # run compiled dist/
```

Health check once running: `curl localhost:3001/api/health`

## NON-NEGOTIABLE conventions

These are enforced; do not relax them. Full detail in `backend/CONVENTIONS.md`.

- **Money is integer minor units as `bigint`.** Never float/number for money, anywhere (DB, TS, Swift). Use the `Money` type in `backend/src/db/money.ts`. USD → cents; USDC → micro-units (6 dp).
- **Balances are derived from the double-entry ledger** (once Phase 4 lands). Do not mutate balance columns directly.
- **`audit_logs`, `ledger_entries`, `ledger_journals`, `mcp_audit_logs` are append-only** (DB triggers block UPDATE/DELETE).
- **Money-mutating endpoints require an `Idempotency-Key`** and the `idempotency()` middleware.
- **Verifiable Presentations must have their signature verified** against the wallet `did:key` before any access is granted (Phase 7). No exceptions.
- **Errors** use `AppError` + a stable `ErrorCode`; clients branch on `error.code`.
- **Config** is read only through `backend/src/config.ts`; production fails fast on insecure config.

## How to work through phases

1. Open `docs/REBUILD-PLAN-v2.md`.
2. Find the next unchecked phase. Each phase is a self-contained instruction block.
3. Implement it. Keep to the conventions above and the file layout the plan describes.
4. Run `npm run typecheck && npm test` before considering the phase done.
5. Update the Build status checklist in this file.

Recommended order note: the plan lists Phase 2 next, but **Phase 4 (double-entry ledger) can be done before Phase 2/3** if you want all monetary code built on correct primitives first. Either is valid.

## Locked architecture decisions

- Blockchain: **Hedera** (single chain for v1).
- Wallet: **native build** — keys in Secure Enclave / Android Keystore; server never holds a user's private key. (Vendor key-custody like Fireblocks Dynamic is a v2 review point.)
- Token standards: ERC-3643 (HSCS) for securities; HTS native for collectibles and stablecoin ops.
- Backend: **Go is the long-term target per the PRD**, but this prototype rebuild is **TypeScript/Node** for velocity. Treat the TS backend as the prototype; a Go reimplementation of money-critical services is a later decision.
- Orchestration target: Temporal (money) + Conductor OSS (agents) — not yet introduced; the prototype calls the Anthropic SDK directly for now.
- Auth: passkey-first (WebAuthn); password auth only behind `ALLOW_PASSWORD_AUTH`, rejected in production.
- DB: SQLite for local dev (zero-config), Postgres for production (set `DATABASE_URL`).

## What is intentionally NOT in this repo yet

The tokenized RWA/collectibles marketplace, Temporal/Conductor, partner-bank fiat rails, and production custody hardening (HSM paymaster, multi-sig treasury) are out of scope for the current phases — see the end of `docs/REBUILD-PLAN-v2.md`.
