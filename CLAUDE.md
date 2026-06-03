# CLAUDE.md — BankAI

Guidance for Claude Code (claude.ai/code) when working in this repository. Read this fully before making changes.

## What this is

BankAI is a tokenization-first neobank being rebuilt from a prototype toward the architecture in the PRD: Hedera settlement, a native (non-custodial) wallet, a double-entry ledger, decentralized-identity-gated agent access (W3C Verifiable Credentials + OID4VP), and an MCP server that lets external AI agents operate on a user's behalf under tightly scoped, user-granted permissions.

The build proceeds **phase by phase**. The full plan is in `docs/BANKAI-PLAN.md` (the single authoritative plan, all phases 0–15). The product requirements are in `docs/bankai_prdv1/` (start at `docs/bankai_prdv1/README.md`).

## Monorepo layout

| Path | What | Status |
|---|---|---|
| `backend/` | Node + Express + TypeScript API | Phase 0 + 1 implemented |
| `frontend/` | React + Vite customer portal | Phase 9 (Quiet Premium) implemented |
| `bankai-agent/` | External agent web app (OID4VP + MCP) | Phase 11 implemented + verified |
| `BankAIWallet/` | iOS SwiftUI wallet (Secure Enclave keys, VC holder) | Phase 10 source (unverified — needs Xcode) |
| `docs/BANKAI-PLAN.md` | **The single authoritative implementation plan** (all phases 0–15, one block per phase) | reference |
| `docs/bankai_prdv1/` | Product requirements (13 linked modules) | reference |

## Build status

- [x] **Phase 0** — Conventions: money (integer minor units), errors, config, idempotency
- [x] **Phase 1** — Backend foundation: dual Postgres/SQLite DB, full schema + migrations, append-only triggers, session auth, rate limiting/lockout, RS256 token factory, audit service, logging, metrics
- [x] **Phase 2** — DID & Verifiable Credentials: persisted RS256 keypair, key rotation, W3C VC JWT issuance, BitstringStatusList revocation, credentials routes
- [x] **Phase 3** — Auth (WebAuthn passkeys), tiered identity ladder, internal agents
- [x] **Phase 4** — Double-entry ledger (the single source of truth for balances)
- [x] **Phase 5** — Hedera integration (on-chain USDC, paymaster, ledger mirroring)
- [x] **Phase 5A** — Agentic account opening: risk-adaptive onboarding (signal scoring → dynamic sub-agents), simulated identities, RBAC-gated admin console (backend API + minimal React UI). Pulls the Phase 12 RBAC core forward.
- [x] **Phase 6** — SmartChat (RFC 8693 token exchange): NL intent classification (simulated/anthropic), 90s RS256 operation tokens, MFA gate above $500, transfers via ledgerService keyed idempotently on the token id
- [x] **Phase 7** — MCP server & external agents: `did:key` P-256 resolver, VP signature verification (ES256) before any access, single-use nonce + VP-hash replay prevention, holder binding (wallet `did:key` bound to the VC), no-bypass user grant check, 4-factor scope intersection (VC ∩ client ∩ requested ∩ grant), 90s scoped token, MCP tool execution (transfers in minor units ≤ client/grant ceiling, idempotent on token jti + call id), append-only `mcp_audit_logs`
- [x] **Phase 8** — Tokenized RWA & Marketplace (backend): assets as ledger-derived holdings (each asset its own ledger currency code), HTS + ERC-3643 issuance, in-app Compliance Module (tier/jurisdiction/holder-cap), primary issuance via escrow (subscribe→close/refund), secondary buy/sell as one atomic cash+asset+fee journal, compliance-gated transfers (`COMPLIANCE_BLOCKED`), pricing with source/as-of/staleness, versioned insert-only listings + RBAC admin lifecycle, demo seed (`npm run seed:marketplace`). **Frontend Invest/Collect tabs land in Phase 9.** Production items (deployed ERC-3643 + audit, real HTS create/mint, broker-dealer/ATS resale) remain out of scope — see `docs/BANKAI-PLAN.md` Phase 8 "Legal posture & demo asset".
- [x] **Phase 9** — React customer portal (Quiet Premium design system): monochrome surfaces + single jade accent, type-led hierarchy, dark default + light mode (`data-theme`); flat nav (Home · Invest · Collect · Agent) with a profile menu for secondary pages and a mobile bottom bar; passkey-first auth (`@simplewebauthn/browser`, password form only when `ALLOW_PASSWORD_AUTH`); quiet gamification (tier ladder dots + "N to go", streak dot, progress ring); money rendered only from integer minor units via shared `formatMoney`/`formatUnits`; Idempotency-Key auto-attached to money POSTs; Dashboard, Invest/Collect + AssetDetail (quote→confirm TradeSheet), Agent/SmartChat (90s token countdown + MFA gate), Onboarding tier ladder, Credentials, Internal agents, Connected agents (grants), Activity (composed from transactions + operation tokens), conditional on-chain Wallet (Receive QR + Send). Admin console preserved. The marketplace **frontend** (Invest/Collect tabs) now lands here.
- [~] **Phase 10** — iOS wallet (`BankAIWallet/`): SwiftUI source written — **reviewed-but-unverified** (authored without macOS/Xcode, not compiled). Secure-Enclave P-256 VP-signing key (CryptoKit, Face ID gated), VC JWT in Keychain (not UserDefaults), `did:key` encoder matching the backend resolver, VP JWT signer, Ed25519 Hedera key, OID4VP consent + OID4VCI deep links, TabView (Setup·Credential·Wallet·Activity), Hedera provision/balance/Receive-QR/Send. Known gaps documented in `BankAIWallet/README.md` (Hedera build/sign/submit endpoints + OID4VP token relay pending; SE can't hold the Hedera key).
- [x] **Phase 11** — External agent app (`bankai-agent/`, React+Vite :5174): embedded simulated wallet bridge (jose ES256 = Secure-Enclave stand-in) drives the real OID4VP path — one-time account linking (issue VC + bind wallet did:key + grant), then per-message `detectIntent` → `present/challenge` → wallet-signed VP → 90s scoped token → `mcp/call`, with a live token countdown + step trace. **Verified end-to-end against the backend**: scoped-token mint, `SCOPE_DENIED` gate, a transfer posting a balanced journal, and `REPLAY_DETECTED`. CLIENT_DID `did:simulator:agent-app`. (The v1 "poll token-status/pending_tokens" flow predates this synchronous backend — see the embedded-wallet note.)
- [x] **Phase 12** — Hardening: RBAC, rate limiting, observability, tests. RBAC `requireRole("compliance","admin")` already applied across admin + marketplaceAdmin sensitive surfaces (review decisions, MCP-client suspend, listing lifecycle); no open-in-dev bypass. Rate limiting: authLimiter (5 fails/30min lockout) + apiLimiter (Phase 1) + **new per-agent-DID limiter** on `/mcp/call` (`agentRateLimit`). Observability: pino + request-id + secret/token/VC/VP redaction (Phase 1) plus the five prom-client counters now **incremented** (`ledger_post_total`, `vp_verify_total{result}`, `mcp_call_total{tool,result}`, `hedera_tx_total{result}`, `http_request_duration`) and verified live at `/metrics`. Tests: `test/invariants.test.ts` (money no-float column scan + exactness, balanced-journal enforcement, idempotent-replay, per-agent limiter, counter increment); full suite 127 pass / 3 todo.
- [~] **Phase 13** — Integration & first-run setup: **backend wiring done** — `.env` complete; `npm run setup` (idempotent) runs migrations, seeds the RBAC admin (`admin@bankai.com`/`Admin1234!`), registers the simulator MCP client (`did:simulator:agent-app`, $500 ceiling — `allowedFunctions` are **scopes** `[balance:read, statement:read, profile:read, transfer:low]`, since presentationService intersects them as scopes; the plan's tool-name example was inconsistent), and seeds 5 demo users (`*@demo.com`/`Demo1234!`) at varying tiers/balances with doc-numbers 1/2/3 pre-assigned for rejection demos (`npm run seed:users`); `npm test` green (121 pass). Remaining steps depend on the native apps (iOS wallet passkey e2e, Phase 10/11).
- [ ] **Phase 14** — Final polish & security-invariant tests
- [ ] **Phase 15** — Internal Agent Operations: governance/security/compliance via agents + MCP skills. **Design only** — see `docs/BANKAI-PLAN.md` Phase 15.
- [ ] **Phase 16** — Comprehensive end-to-end validation: journey × channel matrix, hybrid agent/MCP + deterministic backbone. Runbook in `docs/E2E-VALIDATION.md`; skills `e2e-validator` + `bankai-mcp-test-harness`; deterministic floor `backend/test/e2e.test.ts`.

## Commands (run inside `backend/`)

```bash
npm install            # install dependencies
npm run dev            # start dev server on :3001 (runs migrations automatically in dev)
npm run migrate        # apply DB migrations explicitly
npm run setup          # first-run wiring: migrate + seed admin + register simulator MCP client + demo users (idempotent)
npm run seed:users     # demo users only (alex/blair/casey/drew/erin @demo.com, password Demo1234!)
npm run seed:marketplace  # demo Invest/Collect assets
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

1. Open `docs/BANKAI-PLAN.md`.
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

The tokenized RWA/collectibles marketplace **backend** (Phase 8) is built; its **frontend** (Invest/Collect tabs, Phase 9) and internal agent operations (Phase 15) are not. Marketplace production items remain out of scope: deployed/audited ERC-3643 contracts, real HTS token create/mint, and a broker-dealer/ATS for securities resale (the prototype models the on-chain transfer rules in-app). Temporal/Conductor, partner-bank fiat rails, and production custody hardening (HSM paymaster, multi-sig treasury) are also out of scope for the current phases — see the end of `docs/BANKAI-PLAN.md`.
