# Argus Financial Partners — Master Plan (consolidated, Hedera-aligned, production-hardened)

> **This is the single authoritative implementation plan.** It consolidates the former
> `REBUILD-PLAN-v2.md` (the core phases) and the `docs/agent-ops/` blueprint (now **Phase 15 —
> Internal Agent Operations**, folded in below) and adds the new **Phase 8 — Tokenized RWA &
> Marketplace** track (pulled forward to demo the wedge product sooner). The old `docs/agent-ops/`
> files have been removed (fully merged here); the root `REBUILD-PLAN-v2.md` is now a one-line stub
> pointing here.
>
> It keeps every capability from the original v1 prototype (DID/VC issuance, OID4VCI, OID4VP presentation, the 4-factor scope intersection, 90-second scoped tokens, MCP server, the iOS wallet, the external agent app, the admin console) and adds: integer-money correctness, a real double-entry ledger, VP signature verification, WebAuthn passkeys, the tiered identity ladder, a Hedera integration track, vendor adapter patterns, rate limiting, RBAC, observability, tests, an internal agent-operations layer, and a tokenized-asset marketplace.
>
> Each phase is a self-contained block you can hand to Claude Code. Phases are ordered so each builds on the last. **Phase 0 must be read before any code is written** — it defines conventions every later phase depends on.
>
> **Strategic context:** this evolves the Argus Financial Partners prototype toward the architecture in the Argus Financial Partners PRD (Hedera settlement, native wallet, double-entry ledger). The credential + agent-authorization layer is the foundation and is kept intact; the simulated-banking core is replaced with a correct ledger and a Hedera integration seam.

---

## Build status

- [x] **Phase 0** — Conventions: money (integer minor units), errors, config, idempotency
- [x] **Phase 1** — Backend foundation: dual Postgres/SQLite DB, schema + migrations, append-only triggers, session auth, rate limiting/lockout, RS256 token factory, audit, logging, metrics
- [x] **Phase 2** — DID & Verifiable Credentials: persisted RS256 keypair, key rotation, W3C VC JWT, BitstringStatusList revocation
- [x] **Phase 3** — Auth (WebAuthn passkeys), tiered identity ladder, internal agents
- [x] **Phase 4** — Double-entry ledger (the single source of truth for balances)
- [x] **Phase 5** — Hedera integration (on-chain USDC, paymaster, ledger mirroring)
- [x] **Phase 5A** — Agentic account opening (risk-adaptive onboarding, simulated identities, RBAC admin console)
- [x] **Phase 6** — SmartChat (RFC 8693 token exchange): operation tokens, MFA above $500, transfers via the ledger
- [x] **Phase 7** — MCP server & external agents: VP signature verification (ES256 over `did:key`), single-use nonce + replay prevention, holder binding, no-bypass grant check, 4-factor scope intersection, 90s scoped token, MCP tool execution + append-only audit
- [x] **Phase 8** — Tokenized RWA & Marketplace (backend): ledger-derived asset holdings, HTS + ERC-3643 issuance, in-app Compliance Module (tier/jurisdiction/holder-cap), escrow subscriptions, atomic secondary trades + fees, compliance-gated transfers, versioned listings + RBAC lifecycle, demo seed. Frontend tabs in Phase 9; production ERC-3643/ATS/HTS-create remain out of scope
- [ ] **Phase 9** — React frontend (customer portal; adds Invest/Collect marketplace tabs)
- [ ] **Phase 10** — iOS wallet (Secure Enclave keys, VC holder, Hedera signing, asset display)
- [ ] **Phase 11** — External agent web app
- [ ] **Phase 12** — Hardening: RBAC, rate limiting, observability, tests
- [ ] **Phase 13** — Integration & first-run setup
- [ ] **Phase 14** — Final polish & security-invariant tests
- [ ] **Phase 15** — Internal Agent Operations (governance/security/compliance via agents + MCP) — **designed only**
- [ ] **Phase 16** — Comprehensive end-to-end validation (journey × channel matrix; hybrid agent/MCP + deterministic backbone) — **design + scaffolding; runbook in `docs/E2E-VALIDATION.md`**

**Long-term roadmap (toward the full vision — gated on regulated partners/licensing, none built):**
- [~] **Phase 17** — Trading & brokerage (equities, options, crypto spot; market data; order routing) → **Corp C** (broker-dealer/clearing partner). **Design: `docs/PHASE-17-TRADING-BROKERAGE.md`** — SLA-isolation architecture (trading bulkheaded; settles into the ledger async + idempotently; shed-able to protect money-critical SLOs). **Stage-1 simulated seam BUILT** (`tradingService`/`tradingBroker`, migration 008, `TRADING_ENABLED` kill-switch; `trading.test.ts` 8 incl. SLA-isolation under broker stall/failure). Real broker/market-data/ATS remain Corp C.
- [ ] **Phase 18** — Tokenization production (real-estate + securities for real money; audited ERC-3643, real HTS, transfer agent, **ATS** resale) → **Corp B/C**
- [ ] **Phase 19** — Full-bank rails (fiat on/off-ramp, FBO accounts, ACH/wire, cards, statements, partner-bank deposits) → **Corp B** (BaaS partner + FinCEN MSB)
- [~] **Phase 20** — Production hardening & scale (KMS/HSM custody, ledger⇄chain reconciliation, fraud Stages 2–4, Temporal/Conductor orchestration, data warehouse) → **Corp B/C**. **Reconciliation BUILT** (closes Phase-14 invariant *n*): `reconciliationService` compares the ledger USDC projection vs on-chain balances (Hedera Mirror Node provider, injectable for tests) per-user plus an escrow-custodian coverage check; drift → append-only `reconciliation_runs`/`reconciliation_findings` (migration 011) and **gates on-chain settlement** (`RECONCILIATION_HOLD` in `hederaService`); daily loop + RBAC admin surface (`/api/admin/reconciliation`); `reconciliation.test.ts` (6). **Fraud Stages 2–4 BUILT** as a standalone add-on (`fraud-engine/`, Node/TS :4500 — imports nothing from `backend/`): full FraudEngine.md architecture at prototype scale (event backbone + schema registry, feature store, `rules-v1`+`seq-v0` models, registry/serving + shadow/canary routing, case queue, async remediation, retrain loop). Hybrid HTTP integration: in-Argus triage routes blocking vs fire-and-forget; severe async decisions call back to `/api/internal/remediation` to freeze (`ACCOUNT_FROZEN`, append-only `account_holds`, migration 012) or flag. **KMS custody BUILT** (closes invariant *m* / audit C-1): `keyVaultService` wraps at-rest secrets — per-user Hedera keys (`hedera_accounts.private_key_enc`, migration 013) + the issuer JWK (`did_keys.private_jwk`) — via a pluggable provider (local AES-256-GCM dev stand-in; AWS/GCP KMS stubs for prod), AAD-bound to the row id, plaintext nulled with lazy migration of legacy rows; `npm run encrypt-keys` backfills; the operator key is vault-aware too (`HEDERA_OPERATOR_KEY` raw in dev or `gcm.v1.`-wrapped, `npm run wrap-secret`); `KMS_PROVIDER=local` and a raw operator key are prod-fatal; `kms.test.ts` (12). HSM/on-device signing + orchestration remain.
- [~] **Phase 21** — "Argus Pay": native stablecoin-settled, agent-native payment rail (`docs/business/PAYMENT-NETWORK-STRATEGY.md` §4/§8) → **Corp B/C** (money transmission + stablecoin regime). **Stage-1 prototype BUILT**: merchants + payment intents (migration 010), every payment **escrow-protected** (hold→capture/refund/dispute via the escrow layer — the chargeback substitute; USDC settles on Hedera through the same primitives), zero rail fee (no interchange), `pay_merchant` MCP tool under scope `pay:merchant` with client+grant ceilings (agent-to-merchant commerce), `ARGUS_PAY_ENABLED` kill-switch (off by default, prod-fatal; held funds always resolvable when shed), `/api/pay` surface, `payments.test.ts` (7). Real merchant acquiring/licensing remains Corp B/C.

---

## What changed from v1 (read first)

| Area | v1 | v2 | Why |
|---|---|---|---|
| Money storage | `REAL` (float) | Integer minor units (`INTEGER` cents) everywhere | Floats cannot represent money exactly; this is non-negotiable in financial software |
| Balances | Mutated in place | Derived from append-only double-entry ledger | Auditability, reconciliation, correctness |
| VP verification | Signature not checked ("simulator") | ES256 signature verified against `did:key` | The entire agent-access security model depends on this |
| Auth | Email + password (bcrypt) | WebAuthn passkeys primary; password fallback for dev only | PRD is passkey-first; phishing-resistant |
| Identity | Binary pending/verified | Tiered ladder (Tier 0-4) | Matches PRD; enables progressive onboarding |
| Settlement | Simulated SQLite balances | Ledger + Hedera integration seam (USDC on testnet) | Matches PRD's Hedera commitment |
| Database | SQLite | Postgres for prod; SQLite allowed for local dev | Serializable isolation for the ledger |
| IDV / sanctions | Hardcoded simulation | Adapter interface; simulation is one implementation | Drop-in Persona/Onfido/TRM later |
| Revocation | Stubbed status list | Real BitstringStatusList VC | Scales to many credentials |
| Admin | "open in dev" allowed | RBAC, no open path | Security |
| Rate limiting | None | Per-user + per-IP limits, lockout | PRD requirement |
| Money ops | No idempotency | Idempotency keys required | Prevent double-spend on retry |
| Observability | None | Structured logs, metrics, traces | Operability |
| Tests | None | Unit + integration + security-invariant tests | Production readiness |

---

## Prerequisites (updated)

```bash
# Required (same as v1)
node >= 20
npm >= 10
git
xcode-cli           # macOS only — xcode-select --install

# New for v2
docker              # Postgres + local services
go >= 1.22          # OPTIONAL — only if implementing the ledger service in Go (recommended for prod;
                    # TypeScript ledger is acceptable for the prototype if the team is JS-only)
# A Hedera testnet account: create at https://portal.hedera.com (free testnet HBAR)
#   You will need: HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY for the paymaster/treasury account

# Verify
node --version
docker --version
```

Get your Anthropic API key from https://console.anthropic.com.

---

## Project Structure (updated)

Additions to v1 are marked `# NEW` or `# CHANGED`.

```
argus/
├── backend/
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts                    # NEW — typed env config, fail-fast on missing secrets
│   │   ├── db/
│   │   │   ├── index.ts                  # CHANGED — Postgres (pg) for prod, better-sqlite3 for dev
│   │   │   ├── migrations/               # NEW — versioned SQL migrations (node-pg-migrate or drizzle)
│   │   │   └── money.ts                  # NEW — Money type + helpers (integer minor units only)
│   │   ├── middleware/
│   │   │   ├── auth.ts
│   │   │   ├── identityGuard.ts
│   │   │   ├── rateLimit.ts              # NEW — per-user + per-IP limits, lockout
│   │   │   ├── rbac.ts                   # NEW — role-based access for admin
│   │   │   └── idempotency.ts            # NEW — idempotency-key handling for money ops
│   │   ├── routes/
│   │   │   ├── auth.ts                    # CHANGED — WebAuthn passkey routes
│   │   │   ├── accounts.ts
│   │   │   ├── agents.ts
│   │   │   ├── audit.ts
│   │   │   ├── credentials.ts
│   │   │   ├── identity.ts                # CHANGED — tiered ladder
│   │   │   ├── admin.ts                   # CHANGED — RBAC
│   │   │   ├── mcp.ts
│   │   │   ├── myAgents.ts
│   │   │   ├── present.ts                 # CHANGED — VP signature verification
│   │   │   ├── ledger.ts                  # NEW — internal ledger query/admin
│   │   │   ├── hedera.ts                  # NEW — account, balance, transfer via Hedera
│   │   │   └── smartchat.ts
│   │   ├── services/
│   │   │   ├── agentService.ts
│   │   │   ├── auditService.ts
│   │   │   ├── didService.ts              # CHANGED — key rotation, DID doc versioning
│   │   │   ├── identityService.ts         # CHANGED — tiered ladder
│   │   │   ├── ledgerService.ts           # NEW — double-entry journal
│   │   │   ├── hederaService.ts           # NEW — Hedera SDK integration
│   │   │   ├── webauthnService.ts         # NEW — passkey registration/auth
│   │   │   ├── idv/                        # CHANGED — adapter pattern
│   │   │   │   ├── IdvProvider.ts          #   interface
│   │   │   │   ├── SimulatedIdvProvider.ts  #   dev default
│   │   │   │   └── PersonaIdvProvider.ts    #   stub for real provider
│   │   │   ├── sanctions/                   # NEW — adapter pattern
│   │   │   │   ├── SanctionsProvider.ts
│   │   │   │   ├── SimulatedSanctions.ts
│   │   │   │   └── TrmSanctions.ts          #   stub
│   │   │   ├── mcpClientRegistry.ts
│   │   │   ├── presentationService.ts      # CHANGED — verify VP signature
│   │   │   ├── smartChatService.ts
│   │   │   ├── statusListService.ts        # NEW — real BitstringStatusList
│   │   │   ├── userAgentGrantService.ts
│   │   │   └── vcService.ts
│   │   ├── observability/                  # NEW
│   │   │   ├── logger.ts                    #   structured JSON logging (pino)
│   │   │   └── metrics.ts                   #   prom-client counters/histograms
│   │   └── utils/
│   │       ├── tokenFactory.ts
│   │       └── didKey.ts                    # NEW — did:key resolution (P-256 → public key)
│   ├── test/                                # NEW
│   │   ├── ledger.test.ts
│   │   ├── presentation.test.ts             #   VP forgery rejection, scope intersection
│   │   └── invariants.test.ts               #   security invariants from Phase 14
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                                # (structure unchanged from v1, pages updated)
│   └── ...                                   #   + Passkey enrollment UI, Tier badges
│
├── argus-agent/                            # (unchanged from v1)
│   └── ...
│
└── ArgusWallet/
    └── ArgusWallet/
        ├── ArgusWalletApp.swift
        ├── ContentView.swift
        ├── Views/
        │   ├── SetupView.swift
        │   ├── CredentialView.swift
        │   ├── ConsentView.swift
        │   └── WalletView.swift             # NEW — Hedera account: balance, receive, send
        └── Services/
            ├── KeyService.swift             # CHANGED — Secure Enclave for BOTH VP key and Hedera key
            ├── DIDService.swift
            ├── CredentialService.swift      # CHANGED — store VC in Keychain, not UserDefaults
            ├── HederaService.swift          # NEW — Hedera account create/sign/submit
            └── PresentationService.swift
```

---

## Phase 0 — Conventions & Foundations (NEW — read before coding)

**Prompt for Claude Code:**

```
Establish the cross-cutting conventions for the Argus Financial Partners rebuild. These rules apply to every later phase.

1. MONEY HANDLING (non-negotiable):
   - All monetary amounts are stored and computed as integer minor units. USD is stored as integer cents.
     Token amounts are stored as integer in the token's smallest unit (e.g., USDC has 6 decimals → store micro-USDC).
   - NEVER use float/double/REAL for money anywhere — not in the DB, not in TypeScript, not in Swift.
   - Create /backend/src/db/money.ts:
     - type Money = { amount: bigint; currency: string; decimals: number }
     - usd(cents: bigint): Money
     - format(m: Money): string  // for display only
     - add(a, b), sub(a, b)  // throw on currency mismatch
     - Never expose a Money as a JS number; serialize as string in JSON.
   - DB columns: use INTEGER (or BIGINT) named *_minor (e.g., balance_minor, amount_minor) with a currency column alongside.

2. IDEMPOTENCY:
   - Every state-changing money operation accepts an Idempotency-Key header.
   - Create /backend/src/middleware/idempotency.ts: store (idempotency_key, user_id, request_hash, response) in an
     idempotency_keys table; on repeat key return the stored response; on key reuse with different body return 409.

3. ERROR TAXONOMY:
   - Standard error envelope: { error: { code: string, message: string, retryable: boolean } }
   - Codes are stable machine-readable strings (e.g., INSUFFICIENT_FUNDS, SCOPE_DENIED, RATE_LIMITED, VP_INVALID).

4. CONFIG:
   - Create /backend/src/config.ts: load + validate all env vars at boot with zod. Fail fast (process.exit(1)) if a
     required secret is missing in production (NODE_ENV=production). JWT_SECRET must not equal the known dev default
     in production.

5. IDS & TIME:
   - All IDs are UUIDv7 (time-ordered) where available, else UUIDv4.
   - All timestamps are stored as UTC ISO-8601 / timestamptz. No local time anywhere.

Output: money.ts, config.ts, idempotency.ts, an errors.ts with the envelope + code enum, and a short CONVENTIONS.md
in /backend documenting these rules for future contributors.
```

---

## Phase 1 — Backend Foundation (CHANGED)

**Prompt for Claude Code:**

```
Create a Node.js + Express + TypeScript backend for Argus Financial Partners.

Setup:
- Init npm project in /backend
- Install: express, cors, dotenv, zod, pg, better-sqlite3, bcryptjs, jsonwebtoken, jose, uuid,
  @anthropic-ai/sdk, @simplewebauthn/server, pino, prom-client
- Install dev: typescript, tsx, vitest, @types/* as needed, node-pg-migrate
- tsconfig.json: target ES2022, module commonjs (or NodeNext), strict true, outDir dist

DATABASE — support both Postgres (prod) and SQLite (dev) behind one interface:
- Create /backend/src/db/index.ts:
  - getDb() returns a thin query wrapper. If DATABASE_URL is set → Postgres (pg Pool). Else → better-sqlite3 at
    ./data/argus.db with WAL + foreign_keys ON.
  - All money columns are INTEGER minor units with a sibling currency column. NO REAL columns anywhere.
- Use versioned migrations (node-pg-migrate for Postgres; for SQLite dev, run the same SQL via a simple runner).

SCHEMA — same entities as v1 with these CHANGES (apply throughout):
- Replace every REAL money column with *_minor INTEGER + currency TEXT. Specifically:
  accounts.balance → balance_minor INTEGER NOT NULL DEFAULT 1000000, currency TEXT DEFAULT 'USD'   (i.e., $10,000.00)
  savings_accounts.balance → balance_minor INTEGER DEFAULT 500000, interest_rate_bps INTEGER DEFAULT 250  (2.50% as basis points)
  transactions.amount → amount_minor INTEGER NOT NULL, currency TEXT DEFAULT 'USD'
  agents.transfer_limit → transfer_limit_minor INTEGER DEFAULT 50000   ($500.00)
  operation_tokens, mcp_clients.max_transfer_usd → *_minor INTEGER
  user_agent_grants.max_transfer_usd → max_transfer_minor INTEGER DEFAULT 50000
- Keep all v1 tables: users, accounts, savings_accounts, transactions, agents, agent_messages, mfa_challenges,
  operation_tokens, audit_logs, identity_profiles, document_verifications, kyc_records, id_events, credentials,
  credential_status_lists, mcp_clients, presentation_nonces, vp_presentations, pending_tokens, user_agent_grants,
  mcp_audit_logs.
- ADD new tables:
  idempotency_keys (key TEXT, user_id TEXT, request_hash TEXT, response TEXT, created_at, PK(key, user_id))
  passkeys (id TEXT PK, user_id FK, credential_id TEXT UNIQUE, public_key TEXT, counter INTEGER DEFAULT 0,
            transports TEXT, device_name TEXT, created_at, last_used_at)
  webauthn_challenges (id TEXT PK, user_id TEXT, challenge TEXT, purpose TEXT, expires_at, created_at)
  ledger_accounts (id TEXT PK, user_id TEXT, kind TEXT, currency TEXT, created_at)  -- see Phase 4
  ledger_entries (id TEXT PK, journal_id TEXT, ledger_account_id FK, direction TEXT CHECK(direction IN ('debit','credit')),
                  amount_minor INTEGER NOT NULL, currency TEXT, created_at)  -- append-only
  ledger_journals (id TEXT PK, idempotency_key TEXT, description TEXT, external_ref TEXT, created_at)
  hedera_accounts (id TEXT PK, user_id FK UNIQUE, hedera_account_id TEXT UNIQUE, evm_address TEXT,
                   public_key TEXT, created_at)  -- see Phase 5
  auth_failures (id TEXT PK, identifier TEXT, ip TEXT, created_at)  -- for lockout
- Add UPDATE/DELETE-blocking triggers on audit_logs, ledger_entries, ledger_journals (append-only).
- Add generateAccountNumber() helper.

Create /backend/src/middleware/auth.ts (same as v1: AuthRequest, requireAuth, getClientIp).

Create /backend/src/middleware/rateLimit.ts:
- perUser and perIp limiters backed by the DB (or Redis if REDIS_URL set).
- authLimiter: after 5 failed auth attempts for an identifier OR ip within 30 min → block for 30 min (429 RATE_LIMITED).
- Generic apiLimiter: sane default (e.g., 100 req/min/user).

Create /backend/src/utils/tokenFactory.ts (uses jose) — same as v1:
- initTokenFactory(): RS256 keypair (2048, extractable) in module scope
- mintExchangeToken(...), mintScopedToken(...), verifyToken(token)

Create /backend/src/services/auditService.ts — same as v1 (logAudit, getAuditLogs).

Create /backend/src/observability/logger.ts (pino, structured JSON) and metrics.ts (prom-client; expose /metrics).

Create /backend/.env (see Phase 13 for full list). Add scripts: dev, build, start, migrate, test.
```

---

## Phase 2 — DID & Verifiable Credentials (CHANGED)

**Prompt for Claude Code:**

```
Add DID and Verifiable Credential services. Keep v1 behavior; add key rotation and a real status list.

Create /backend/src/services/didService.ts (as v1) WITH these additions:
- Support multiple keys: store key history as argus_keys.json (array of {kid, privateJwk, publicJwk, createdAt, retiredAt?}).
- getActiveKey() returns the current signing key; getDidDocument() lists ALL non-retired keys in verificationMethod,
  with the active one referenced by assertionMethod. This allows rotation without invalidating recently-issued VCs.
- rotateKey(): generate new key, mark previous retiredAt (kept for verification of old VCs until they expire).
- getJWKS(): include all non-retired public keys with distinct kids.

Create /backend/src/services/statusListService.ts (NEW — replaces v1's stub):
- Implement W3C BitstringStatusList:
  - A status list is a gzip-compressed bitstring (default 131072 bits) where bit[i]=1 means revoked.
  - getOrCreateList(year): row in credential_status_lists with the bitstring (store base64).
  - allocateIndex(year): returns next free index, increments next_index.
  - setRevoked(year, index): set bit and persist.
  - buildStatusListCredential(year): return a signed VC of type BitstringStatusListCredential whose
    credentialSubject.encodedList is the base64url(gzip(bitstring)). Sign with didService active key.

Create /backend/src/services/vcService.ts (as v1) WITH these changes:
- issueCredential(...) allocates its status index via statusListService.allocateIndex(year) and embeds the proper
  BitstringStatusListEntry (statusListIndex, statusListCredential URL).
- ADD credentialSubject.tier (the user's identity tier at issuance) and credentialSubject.hederaAccountId (if present).
- revokeCredential(userId, reason): set revoked flag in credentials AND statusListService.setRevoked(year, index).
- verifyCredential(vcJwt): jwtVerify against ANY non-retired bank key (try active first, then history);
  check the credentials.revoked flag AND the bitstring bit; throw on revoked or expired.
- getStatusListVC(): return statusListService.buildStatusListCredential(currentYear).
```

---

## Phase 3 — Auth (Passkeys), Tiered Identity & Agents (CHANGED)

**Prompt for Claude Code:**

```
Build auth (WebAuthn passkeys), the tiered identity ladder, and internal agent routes.

WEBAUTHN PASSKEYS (new primary auth):
Create /backend/src/services/webauthnService.ts using @simplewebauthn/server:
- generateRegistration(userId): create options, store challenge in webauthn_challenges, return options
- verifyRegistration(userId, response): verify, persist credential to passkeys table
- generateAuthentication(identifier): allow usernameless; store challenge; return options
- verifyAuthentication(response): verify against stored passkey, bump counter, return userId
Create /backend/src/routes/auth.ts:
- POST /register: create user (NO password required if passkey path) → returns registration options
- POST /register/verify: verifyRegistration → create accounts → initiateOnboarding (Tier 0) → return JWT
- POST /login/options: generateAuthentication
- POST /login/verify: verifyAuthentication → return JWT, logAudit
- POST /logout: terminateAllAgents, logAudit
- GET /me: user info + current tier
- KEEP a password fallback (bcrypt) BEHIND an ALLOW_PASSWORD_AUTH=true flag for local dev only; it must be impossible
  to enable in production (config.ts rejects it when NODE_ENV=production).
- Wrap login routes with authLimiter (Phase 1).

TIERED IDENTITY LADDER (replaces binary verified/pending):
Define tiers: TIER_0 (anonymous: passkey only), TIER_1 (phone+email), TIER_2 (KYC verified),
TIER_3 (accredited), TIER_4 (lending — out of scope, stub).
- identity_profiles gains: tier INTEGER DEFAULT 0.
- Capability gating is by tier, enforced at the transaction layer (not just UI):
  TIER_0: view, receive; TIER_1: P2P up to a cap; TIER_2: full banking/transfers, fiat; etc.

Create /backend/src/services/idv/IdvProvider.ts (interface):
  extractDocumentData(docType, docNumber?): Promise<DocResult>
  runLivenessCheck(): Promise<LivenessResult>
  runBiometricMatch(doc): Promise<BiometricResult>
- SimulatedIdvProvider.ts: the v1 behavior (docNumber 1/2/3 → rejection variants; else approved 0.96).
- PersonaIdvProvider.ts: stub that throws "not configured" unless PERSONA_API_KEY set.
- Select provider via IDV_PROVIDER env (default 'simulated').

Create /backend/src/services/sanctions/SanctionsProvider.ts (interface) + SimulatedSanctions.ts (clear) +
  TrmSanctions.ts (stub). Select via SANCTIONS_PROVIDER env.

Create /backend/src/services/identityService.ts (as v1 flow) WITH tier transitions:
- initiateOnboarding → Tier 0 profile.
- processDocumentCapture → uses selected IdvProvider.
- processLiveness, processKycScreening → uses selected SanctionsProvider; on success set tier=2, identity_status='verified'.
- On KYC success auto-issue VC (vcService.issueCredential) embedding tier and (if present) hederaAccountId.
- Keep id_events + logAudit at each step.

Create /backend/src/middleware/identityGuard.ts:
- requireTier(minTier): middleware enforcing identity_profiles.tier >= minTier (else 403 TIER_REQUIRED).
- Keep requireVerifiedIdentity as an alias for requireTier(2).

Create /backend/src/services/agentService.ts (as v1) WITH:
- All transfer checks use integer minor units and go through ledgerService (Phase 4) — NOT in-place balance updates.
- executeTool transfer path: enforce amount_minor <= agent.transfer_limit_minor AND (mfa_verified OR amount_minor <= 50000).

Create routes: auth.ts, accounts.ts (requireTier(2)), agents.ts, identity.ts, audit.ts — same surface as v1,
adjusted for tiers and integer money. accounts/summary returns balances as integer minor + formatted string.
```

---

## Phase 4 — Double-Entry Ledger (NEW)

**Prompt for Claude Code:**

```
Implement a double-entry ledger as the single source of truth for balances. No service may mutate a balance directly.

Create /backend/src/services/ledgerService.ts:
- Concepts: a ledger_account is one balance bucket (kind ∈ {user_cash, user_savings, bank_settlement, fee, escrow,
  external_clearing}). A journal is one atomic financial event made of >=2 entries that MUST sum to zero per currency.
- ensureUserLedgerAccounts(userId): create user_cash and user_savings ledger_accounts if absent.
- postJournal({ description, externalRef, idempotencyKey, entries: [{ledgerAccountId, direction, amountMinor, currency}] }):
  - Validate: entries balance to zero per currency (sum debits == sum credits).
  - Run in a serializable transaction. Insert ledger_journals + ledger_entries (append-only).
  - Idempotent on idempotencyKey (return existing journal if replayed).
- balanceOf(ledgerAccountId): derived = SUM(credits) - SUM(debits) (or per account-kind sign convention); cache in Redis
  with invalidation on post. NEVER store a mutable balance column as the source of truth.
- transfer(userId, fromAccountId, toAccountId|toExternal, amountMinor, currency, idempotencyKey, agentId?):
  - Build a balanced journal (debit source, credit destination; for external, credit external_clearing).
  - Enforce sufficient funds (balanceOf(source) >= amount) inside the serializable txn.
  - Insert a row in the transactions table for the user-facing history (denormalized view), referencing journal_id.
  - logAudit.

Refactor all earlier money paths (agentService, smartChatService, mcp executeMcpTool transfer) to call
ledgerService.transfer instead of UPDATE ... SET balance. The accounts.balance_minor column becomes a cached
projection updated from the ledger (or dropped entirely in favor of balanceOf()).

Write /backend/test/ledger.test.ts: balanced journals succeed; unbalanced throw; insufficient funds throw;
idempotent replay returns same journal; concurrent transfers don't double-spend (serializable).
```

---

## Phase 5 — Hedera Integration (NEW — the bridge to the PRD)

**Prompt for Claude Code:**

```
Add a Hedera integration seam so Argus Financial Partners accounts map to real Hedera testnet accounts and USDC. This is the foundation
for the PRD's native-wallet architecture. Keep it behind a HEDERA_ENABLED flag so the simulated path still works.

Install: @hashgraph/sdk

Create /backend/src/services/hederaService.ts:
- init(): construct a Client for testnet using HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY (this is the paymaster/treasury).
- createAccountForUser(userId, publicKey): create a Hedera account whose key is the user's wallet public key
  (from the iOS wallet — the server NEVER holds the user's private key). Sponsor the creation fee from the operator.
  Auto-associate the testnet USDC token. Persist to hedera_accounts (hedera_account_id, evm_address via HIP-583 alias).
- getUsdcBalance(hederaAccountId): query balance (read via mirror node REST or SDK).
- buildTransferTx(fromAccountId, toAccountId, amountMicroUsdc): construct an unsigned transfer the WALLET will sign;
  the operator co-signs only as fee payer (paymaster). Return tx bytes for the client to sign.
- submitSignedTx(signedBytes): submit and return the receipt/consensus status.
- IMPORTANT: the server constructs and fee-pays transactions but the USER'S signature comes from the device. The
  operator key is ONLY the paymaster + token treasury, never a custodian of user funds.

Create /backend/src/routes/hedera.ts (requireTier(1)+):
- POST /account: body { publicKey } → createAccountForUser → return { hederaAccountId, evmAddress }
- GET /balance: return on-chain USDC balance for the user's hedera account
- POST /transfer/build: body { toAccountId, amountMinor, idempotencyKey } → return unsigned tx bytes + a ledger
  pre-authorization (escrow hold in the ledger)
- POST /transfer/submit: body { signedTxBytes, idempotencyKey } → submitSignedTx → on success post the settling
  ledger journal → return receipt

Reconciliation: add a job that compares hedera on-chain USDC balances vs the ledger's user_cash projection daily and
emits a metric + alert on drift. (For the prototype, run it on demand via an admin route.)

Note for the team: in the prototype, "USD cash" can remain ledger-only (simulated bank). "USDC" is the real on-chain
asset on Hedera testnet. This mirrors the PRD: fiat is partner-bank-custodied (here, simulated), crypto is
self-custodial on Hedera.
```

---

## Phase 5A — Agentic Account Opening (Risk-Adaptive Identity) (NEW)

**Status: implemented.** Slots between Phase 5 and Phase 6 (no renumbering). Adds an AI-driven,
risk-adaptive onboarding flow on top of the Phase 3 identity ladder, plus an RBAC-gated admin console.
Pulls the Phase 12 RBAC core forward (see the note in Phase 12).

**Prompt for Claude Code:**

```
Build a risk-adaptive account-opening flow that scores onboarding signals to decide what verification
is needed, dynamically spawns specialized sub-agents when confidence is low, supports simulated demo
identities, and exposes all identities in an admin console. Conventions as everywhere: AppError/
ErrorCode, config-only env, append-only audit via logAudit, dual SQLite/Postgres with ? placeholders.
Scores are REAL in [0,1] (NOT money).

Config (config.ts): ONBOARDING_ORCHESTRATOR ("simulated"|"anthropic", default simulated),
ANTHROPIC_MODEL, ONBOARDING_CONFIDENCE_THRESHOLD (0.8), ONBOARDING_REVIEW_FLOOR (0.5),
ADMIN_JWT_SECRET. Prod gates: anthropic orchestrator requires ANTHROPIC_API_KEY; ADMIN_JWT_SECRET
must be set and distinct from JWT_SECRET in prod.

Migration 004_agentic_onboarding.sql: onboarding_sessions and onboarding_agent_runs (MUTABLE state
machines — NOT append-only; the immutable trail is audit_logs); ALTER users ADD is_simulated;
ALTER identity_profiles ADD onboarding_session_id; onboarding_sessions also stores device_fingerprint.
Reuse the existing kyc_records and document_verifications tables for sub-agent outputs.

Orchestrator model (utils/orchestratorModel.ts): assessRisk(SignalSummary) → { pii_confidence,
required_steps[], recommended_risk_tier, rationale }. "anthropic" uses @anthropic-ai/sdk structured
tool-use (submit_risk_assessment); "simulated" is deterministic weighted fusion. The summary is
PII-FREE (scores + categorical flags only) — never raw email/IP/document. Anthropic failures fall back
to simulated.

Services:
- signalService.assessSignals — the ONLY place that sees raw email/IP/fingerprint; emits PII-free
  scores + flags + device-reuse detection.
- riskOrchestratorService — startOnboarding → assess → finalizeDecision; submitDocument/submitPossession
  re-aggregate and re-decide; finalizeDecision is the PURE, deterministic policy and the ONLY authorizer
  of a tier grant (the model is advisory: a single very-weak signal, a failed verification, or a
  sanctions hit blocks straight-through approval regardless of model confidence).
- onboardingAgents — runDocumentValidationAgent (reuses document_verifications + sim doc-number
  outcomes 1/2/3=fail), runPossessionCheckAgent ("000000"=fail). Each records an onboarding_agent_runs
  row + audit.
- identityService.completeKycDecision — shared tier-grant core (updates identity_profiles + kyc_records,
  issues the VC via issueCredential); completeSimulatedKyc now delegates to it.
- adminService — seed/login, listIdentities, getIdentityDetail, listReviewQueue, decideReview
  (compliance/admin), createSimulatedIdentities (sim/profiles.ts; flagged is_simulated=1).

RBAC (middleware/rbac.ts): requireAdmin + requireRole over the existing admins table; admin JWT signed
with ADMIN_JWT_SECRET and a kind:"admin" claim so it is not interchangeable with a user session token.

Routes: /api/onboarding (start, document, possession, status — behind requireAuth);
/api/admin (seed, login, identities, identities/:userId, onboarding/sessions, sessions/:id/decision,
simulations). Mount both in index.ts.

Frontend (frontend/): minimal Vite+React scaffold (AdminLogin, AdminConsole) — Phase 8 expands it.

Tests (test/phase5a.test.ts): guardrail beats model confidence; sanctions hard-reject; clean signals
auto-approve with no sub-agents; bot-like timing spawns possession then approves; tampered doc → review;
PII summary has no raw email/IP; simulated identities hit each decision and don't touch real users; RBAC
rejects missing/user tokens and enforces requireRole.
```

---

## Phase 6 — SmartChat (RFC 8693 Token Exchange) (CHANGED)

**Prompt for Claude Code:**

```
Build SmartChat as in v1 (classifyIntent → issueOperationToken → executeOperationToken → generateResponse, plus the
MFA path), WITH these changes:
- All amounts are integer minor units; requiresMFA when transfer amount_minor > 50000 ($500).
- executeOperationToken transfer path calls ledgerService.transfer (Phase 4), never in-place balance updates.
- Pass an Idempotency-Key derived from the operation_token id so retries can't double-execute.
- Keep operation_tokens lifetime at 90s; validate exp on execute.
Routes unchanged from v1 (POST /, POST /tokens/:id/mfa, GET /tokens, GET /tokens/:id), behind requireTier(2).

Wire up /backend/src/index.ts (as v1) plus: /api/ledger, /api/hedera, /metrics, and apply apiLimiter globally and
authLimiter on auth routes. Well-known endpoints unchanged (/.well-known/did.json, /api/.well-known/jwks.json,
/credentials/status/:year now returns the real BitstringStatusListCredential).
```

---

## Phase 7 — MCP Server & External Agent System (CHANGED — security-critical)

**Prompt for Claude Code:**

```
Build the MCP server + presentation system as in v1, WITH these MANDATORY security changes:

Create /backend/src/utils/didKey.ts:
- resolveDidKeyToPublicKey(did): parse a did:key:z... → extract the multicodec-prefixed public key → return a
  CryptoKey / JWK for P-256 (ES256). This is required to verify wallet VP signatures.

Create /backend/src/services/presentationService.ts (as v1) WITH this CRITICAL change to verifyPresentation:
- After extracting the VP JWT, VERIFY ITS SIGNATURE:
  - Resolve vpPayload.iss (the wallet did:key) to a public key via resolveDidKeyToPublicKey.
  - jwtVerify the VP JWT against that key (ES256). Throw VP_INVALID on failure.
  - ONLY THEN proceed with the holder-binding, nonce, aud, grant, and 4-factor scope-intersection checks from v1.
- Keep everything else from v1: single-use nonce (mark used before continuing), VP-hash replay prevention,
  client active check, user_agent_grants check (NO bypass), effective scope = VC ∩ client ∩ requested ∩ grant,
  90s scoped token, audit log.

Keep v1's mcpClientRegistry.ts, userAgentGrantService.ts, credentials.ts, present.ts, mcp.ts, myAgents.ts, admin.ts
surfaces. CHANGES:
- credentials.ts /token: issue a SIGNED, short-lived (5 min) pre-authorized access token (jose JWT), not base64url(JSON).
- mcp.ts executeMcpTool transfer_funds: amount in integer minor units, enforce <= client.max_transfer_minor,
  execute via ledgerService.transfer with an idempotency key = token jti + tool call id.
- admin.ts: gate all admin routes behind rbac middleware (Phase 12). Remove any "open in dev" auth path.

Write /backend/test/presentation.test.ts:
- A VP signed by the WRONG key is REJECTED (VP_INVALID).
- A replayed VP (same hash) is REJECTED.
- A reused nonce is REJECTED.
- Scope intersection correctly drops scopes not in all four sets.
- An agent the user never granted is REJECTED even with a valid VP.
```

---

## Phase 8 — Tokenized RWA & Marketplace (BACKEND BUILT)

**Status: backend built (frontend is Phase 9).** Implemented per the sub-phases below:
migration `006_marketplace.sql`; assets as ledger-derived holdings (each asset is its own
ledger currency code so trades balance per-currency AND per-asset); `tokenizationService`
(HTS + ERC-3643 issuance/mint), `complianceService` (in-app Identity Registry + Compliance
Module), `pricingService` (source/as-of/staleness), `marketplaceService` (quote, escrow
subscribe/close/refund, atomic secondary buy/sell + fees, compliance-gated transfer),
`listingService` (versioned insert-only lifecycle); customer routes `/api/marketplace/*`
and RBAC admin routes; `backend/test/phase8.test.ts` (10 tests); demo seed
`npm run seed:marketplace`. The original design notes are retained below for reference.

Build the PRD's wedge product — a marketplace to **create, buy,
sell, and transfer** tokenized real-world assets — scoped to be **prototype-buildable on the current
stack** (TS/Node, SQLite/Postgres, Hedera testnet HTS, the double-entry ledger). Pulled forward to
Phase 8 (ahead of the frontend) to demo the marketplace capability sooner; the backend + API depend
only on Phase 4 (ledger ✓), Phase 5 (Hedera ✓), and the identity tiers ✓ — not on the MCP server or
the UI. Two surfaces under one tab: **Invest** (securities-style RWAs — tokenized treasuries,
real-estate fractions, private credit; ERC-3643 model; Tier 2+) and **Collect** (collectibles + Web3
gaming items; HTS native; mostly Tier 0/1). See PRD [05 — Tokenization & Marketplace] for the product
spec (`REQ-MK-*`).
**Prerequisites:** Phase 4 (ledger ✓), Phase 5 (Hedera ✓), identity tiers ✓. The listing lifecycle
(8.8) starts as a **manual RBAC-gated admin/compliance flow**; the Phase 15 Marketplace-DD agent
automates the due-diligence draft later. Frontend surface lands with Phase 9; iOS asset display with
Phase 10.

### Legal posture & demo asset (read before listing anything real)

> **Not legal advice.** This records the build/launch posture so the engineering scope and the
> regulatory reality don't drift apart. Counsel reviews before any real-money RWA listing.

- **Collectibles first for the real launch.** The **Collect** surface (graded cards, memorabilia,
  sanctioned game items) uses **HTS-native** tokens and is *mostly not securities*, so it carries far
  less regulatory load. It is the intended first real-money surface and the priority for production
  hardening. Keep the existing v1 exclusion: do not list any asset whose publisher/rights-holder has
  not sanctioned third-party tokenization.
- **Single-building real estate is the Phase 8 DEMO, not a launch asset.** "Form an LLC → buy a
  building → tokenize membership interests → list / buy / sell / transfer" is built end-to-end on
  **Hedera testnet with simulated identities and no real money**, gated to Tier 2. It is a compelling
  capability demo and needs no partner firms — but it stays a demo until the posture below is met.
- **Why real RWA isn't a DIY quick win.** Fractional interests in a building-owning LLC are almost
  certainly **securities** (Howey). The *token* is the easy part; the law is the gate:
  - **Primary issuance is DIY-able** under **Reg D 506(c)** — accredited investors only, accreditation
    verified, general solicitation allowed. (Reg A+ opens non-accredited but is ~$100K+ and months.)
  - **Secondary trading is the trap.** A platform facilitating *resale* of securities generally must be
    or partner with a registered **broker-dealer / ATS** (e.g. Securitize Markets, tZERO). So we may
    DIY issuance but **not** the resale market — that's a partner/ATS dependency (a production/v2 item).
  - Holding others' funds/assets raises **money-transmission + custody** questions on top.
- **What the prototype already encodes for this.** The ERC-3643 model in 8.1/8.5 (Identity Registry +
  Compliance Module) enforces **transfer restrictions, tier/jurisdiction gating, and holder-count caps**
  on-chain — the exact controls Reg D / §12(g) require — so the securities posture is representable in
  the demo and ready to back a real flow once counsel + an ATS partner are in place.
- **Token form (NFT vs fungible) & what actually moves the custody line.** A recurring question is
  whether holding the asset as an **NFT with smart contracts handling value/ownership** changes Argus Financial Partners's
  exposure as a holder of user money. The short answer: it changes the *mechanics*, not the
  *characterization* — custody turns on **who controls the keys and the funds**, not on the token standard.
  - **The token standard is cosmetic to the regulator.** A fractional interest in income-producing real
    estate is a **security** (Howey) whether it's wrapped as an NFT or a fungible token. NFT-with-smart-
    contracts is not a path around securities law.
  - **Why this plan uses ERC-3643 fungible, not a bare NFT, for the real-estate demo.** An HTS NFT /
    ERC-721 has **no built-in compliance layer**; ERC-3643's Identity Registry + Compliance Module enforce
    KYC / holder-cap / jurisdiction on-chain (see the bullet above). Switching the real-estate fraction to
    a plain NFT would *lose* exactly those controls.
  - **Two NFT flavors.** (a) **Whole-building NFT** = one token = whole title; it can't be fractionalized
    directly, so you wrap it in an SPV/LLC and issue fungible fractions — back to a security, with the NFT
    sitting underneath only as the **title/deed record**. (b) **NFT + fractionalization/escrow contract**
    is closer to "the contract handles ownership," but see custody below.
  - **"Smart contract handles the value" is a misnomer.** A contract can *store* a price and *enforce*
    ownership transfers, but it **cannot determine a building's value on-chain** — that comes from an
    off-chain appraisal / NAV delivered by an oracle. This is exactly what `pricingService.ts` (8.6) models
    (NAV-driven, every price stamped with source + as_of).
  - **Custody turns on key/fund control — three separate things:**
    - *Security status* — unchanged by NFT/contract form.
    - *Asset/token custody* — reduced **only** by the locked **non-custodial** model (keys in the Secure
      Enclave, server never holds the private key). If the user holds the token, Argus Financial Partners isn't the asset
      custodian; if Argus Financial Partners holds the keys, it is — NFT or not.
    - *Cash / USDC leg* — the **escrow window** (8.3/8.4) transiently holds user funds, raising
      money-transmission + custody questions. Atomic settlement (see invariants below) minimizes the window
      but doesn't remove it; an NFT wrapper doesn't avoid this leg.
  - **The real lever, and its catch.** A **trust-minimized contract** holding the deed-NFT + escrow, where
    Argus Financial Partners holds **no admin/upgrade/freeze keys**, supports a "the protocol is the custodian" argument.
    **But** regulators **look through to control**: the prototype's 8.1 holds the HTS **KYC/Freeze/Wipe
    keys** as a compliance stand-in — that *is* control, which *is* custody. You can't hold the freeze keys
    and disclaim custody. And the **fiat off-ramp + the LLC/SPV legal layer** always sit with a real entity.
  - *(Not legal advice — same posture as above: counsel reviews before any real-money RWA listing.)*

### Marketplace invariants (Phase-14-style — encode as `backend/test/phase8.test.ts`)

- **Asset quantity is integer base units (`bigint`)** — never float — the same discipline as money.
- **Holdings derive from the double-entry ledger.** Asset journals balance per asset exactly as cash
  journals balance per currency. No mutable holding column. (Reuse `ledgerService.getBalance`.)
- **Atomic settlement.** A trade's USDC leg and asset leg post in **one journal** (debits==credits
  per currency *and* per asset) or both revert. Failed trades refund within the SLA (5 min same-chain).
- **Compliance-on-transfer.** An ERC-3643 (securities) transfer is rejected unless the recipient is
  on the Identity Registry and passes the Compliance Module rules (tier, jurisdiction, holder-count
  caps), with a clear reason (`REQ-MK-TOK-003`).
- **Listing records are versioned and append-only;** pause/delist preserves holdings (`REQ-MK-LIFE-*`).
- **Money-mutating endpoints require `Idempotency-Key`;** orders execute via the ledger, never in-place.

### Sub-phases

```
8.0   Asset & listing data model
      Migration 005_marketplace.sql: assets (id, kind security|collectible|gaming, token_standard
      erc3643|hts, hedera_token_id, issuer, metadata JSON, custody_attestation_uri, min_tier,
      jurisdiction_flags JSON, status), listings (versioned: asset_id, version, price_minor, currency,
      price_source, price_as_of, dd_outcome, reviewer, status staging|soft|public|paused|delisted),
      orders. Holdings are DERIVED from the ledger (no table). New ledger account kinds: user_asset
      (per asset), asset_treasury (system, per asset), escrow (system). Extend
      ledgerService.getOrCreateUserAccount with an assetId discriminator.

8.1   Token issuance abstraction (tokenizationService.ts)
      HTS assets: mint/create via hederaService (HTS native; KYC/Freeze/Wipe keys held by the operator
      as the prototype's compliance-multisig stand-in). ERC-3643 securities: an in-app Compliance
      Module + Identity Registry service modeling the on-chain transfer rules (a deployed audited
      contract is the production item — out of scope). Mint → issuance journal asset_treasury → supply;
      a user must be associated before holding.

8.2   Holdings & portfolio
      getAssetBalance(userId, assetId) derived from ledger_entries (mirrors getBalance). getPortfolio
      aggregates cash + on-chain USDC (Phase 5) + asset holdings marked at current price (8.6).
      Route: GET /api/marketplace/portfolio.

8.3   Primary issuance / subscription (escrow)
      POST /api/marketplace/assets/:id/subscribe (Idempotency-Key, tier-gated): USDC user_cash → escrow;
      at close distribute asset_treasury → user_asset and release escrow → issuer; if cancelled/under-
      subscribed, refund escrow → user_cash. All via postJournal; idempotent; audited (REQ-MK-EXEC-003/4).

8.4   Secondary trading (buy / sell)
      Order book for market-priced collectibles/gaming; NAV-driven fill for treasuries/gold (price 8.6).
      POST /api/marketplace/orders (buy/sell, Idempotency-Key, tier+jurisdiction+compliance gate). A
      matched trade posts ONE atomic journal: USDC buyer→seller AND asset seller→buyer AND fee leg
      (8.7). On-chain HTS settlement (where enabled) mirrors the ledger via hederaService, reconciled
      by the Phase 15.3 daily job. Partial fills supported (REQ-MK-EXEC-002); failed trades refund per SLA.

8.5   Direct asset transfer (user-to-user)
      POST /api/marketplace/assets/:id/transfer (Idempotency-Key): asset-only journal user_asset →
      user_asset. Securities path runs the 8.1 Compliance Module first and rejects with a new
      COMPLIANCE_BLOCKED ErrorCode + clear reason if the recipient isn't registered or a rule fails.
      Non-securities transfer freely between Argus Financial Partners users. Reuses the transferService shape
      (recipient-exists check, in-transaction balance check, audit).

8.6   Pricing & discovery (pricingService.ts)
      NAV-driven (issuer-published, simulated feed), spot (Chainlink-shaped simulated), order-book floor
      (lowest ask). Every price carries source + as_of; staleness warnings per PRD thresholds
      (REQ-MK-PRICE-001/002); basic wash-trade detection on market-priced listings (REQ-MK-PRICE-003).
      GET /api/marketplace/listings (surface filter Invest/Collect; eligibility-filtered by tier/jurisdiction).

8.7   Fees
      Spread/markup on primary issuance + trading fee on secondary, posted to the existing fee ledger
      account as part of the same atomic trade journal. Full disclosure in the order-confirmation
      response BEFORE execution (REQ-MK-FEE-001); uniform per asset class; no hidden/post-trade fees.

8.8   Listing lifecycle & admin
      POST /api/admin/listings etc., RBAC-gated requireRole("compliance","admin"). Flow: a human
      compliance reviewer creates/approves the listing record → staging → soft (≤1% users) → public;
      pause/delist preserves holdings and blocks new orders (REQ-MK-LIFE-002/003). Proof-of-reserve /
      rescreen monitoring hooks. Append-only versioned records (REQ-MK-LIFE-001). Later, the Phase 15
      Marketplace-DD agent drafts the due-diligence record for that human gate.

8.9   Marketplace API surface + frontend/wallet
      Mount /api/marketplace (tier-gated per route). The Phase 9 frontend adds Invest and Collect tabs
      (listing grid; detail with price source/as-of; buy/sell/subscribe/transfer; portfolio) and the
      Phase 10 iOS wallet holds/shows purchased HTS assets. Money + asset quantities formatted from
      integer base units via shared formatMoney/formatUnits — never parse floats.

8.10  Marketplace security-invariant tests (backend/test/phase8.test.ts)
      Atomic settlement (USDC+asset+fee balance in one journal), no-float asset quantity, compliance-on-
      transfer rejection for securities, escrow refund on cancel, idempotent orders, tier/jurisdiction
      gating, append-only listing records.

8.11  Demo seed (seed-marketplace-demo.ts) — two ready-to-show flows on Hedera testnet, no real money:
      (a) COLLECT: a few HTS-native graded-collectible listings (e.g. PSA-graded cards) a Tier-0/1 demo
          user can buy, sell, and transfer — the intended first real-money surface.
      (b) INVEST DEMO: one single-building real-estate asset — a simulated property LLC tokenized as an
          ERC-3643 security (Identity Registry + Compliance Module), Tier-2/accredited-gated, showing
          subscribe (escrow) → hold → compliance-gated transfer with a rejection example for an
          unregistered recipient. Clearly flagged as a demo asset (see "Legal posture & demo asset").

8.12  Phase 8 E2E validation gate
      Run the `through-phase-8` scope of docs/E2E-VALIDATION.md via the `e2e-validator` skill: all
      Phase 0–8 user journeys (onboarding/tiers, DID/VC, cash+USDC, SmartChat, marketplace subscribe/
      trade/transfer) plus the cross-cutting invariants must pass before the marketplace is considered
      demo-ready. Deterministic floor = backend/test/e2e.test.ts (vitest+supertest); NL/SmartChat and
      external-agent paths driven via the argus-mcp-test-harness skill.
```

**Out of scope (PRD-05/10 production/v2 items, noted not built):** first-party Argus Financial Partners token issuance;
deployed ERC-3643 contracts + Tokeny audit; cross-chain bridging / CCTP; AMM; auctions / curated
drops; real partner integrations (Securitize, Courtyard, Centrifuge, Paxos).

---

## Phase 9 — React Frontend (Customer Portal) (CHANGED)

**Prompt for Claude Code:**

```
Build the frontend as in v1 (Login, Register, Dashboard, SmartChat, Agents, AgentChat, AuditLog, Onboarding,
Credentials, AgentPermissions, AdminConsole, AdminLogin) WITH:
- Passkey enrollment + login UI (use @simplewebauthn/browser). Password form only shows if ALLOW_PASSWORD_AUTH.
- Display money from integer minor units via a shared formatMoney(minor, currency) util — never parse floats.
- Onboarding shows the tier ladder with the current tier badge and what each tier unlocks.
- Dashboard shows BOTH simulated USD cash (ledger) and, if Hedera is enabled, on-chain USDC balance with a "Receive"
  (show Hedera account id / EVM alias + QR) and "Send" flow that builds → signs (via wallet) → submits.
- Apply the "Quiet Premium" design system below (replaces the bare v1 dark theme). Keep the Layout
  sidebar and all v1 pages/behaviors; restyle to the system. Primary nav is flat: Home · Invest · Collect · Agent.
- api/client.ts: add an Idempotency-Key header generator for money-mutating POSTs.
```

### Design system — "Quiet Premium" (canonical)

Targets the under-30 crowd first, but reads as a **serious money app**, game second. Chosen over the
"Bold Play" alternative (recorded at the end of this section).

- **Visual language** — minimalist, generous whitespace, a monochrome surface + **one accent color**.
  **Type-led hierarchy**: weight/size carries structure, not color or emoji. Card-based content. Dark
  theme is one mode, not the identity.
- **Navigation** — flat, **≤4 primary destinations** (Home · Invest · Collect · Agent), no nested menus;
  **one primary action per screen**. Simple enough to narrate, which is what makes it work headless.
- **Gamification = quiet / earned** — the tier ladder with dots + "1 to go", a small **streak dot** by the
  logo, a subtle **progress ring**. **No** confetti, XP bars, or badge pop-ups. Engagement comes from
  progress being *legible*, not loud.
- **Multi-channel / channel-adaptive rendering** — because hierarchy is type-driven, **one information
  architecture renders per channel**: responsive web, mobile (Phase 10 wallet), **agentic CLI/headless**
  (text rendering of the same IA — also the **glasses / minimal-HUD** target until a device exists). Rule:
  *one IA, rendered per channel; no channel-specific information model.*
- **Shared formatting** — money/quantities always from integer minor units via the shared
  `formatMoney`/`formatUnits` utils — never parse floats (consistent with the prompt above).
- **Reference mockups** — the Dashboard + Collect ASCII mockups from the design-direction decision are the
  canonical "Quiet Premium" reference for layout and gamification density.

**Alternative considered (recorded, not adopted) — "Bold Play":** vibrant, high-contrast, big rounded
type, prominent **XP bar / levels / streak flames / badges / quest prompts** (Cash App / Robinhood /
Duolingo energy). Higher raw engagement for under-30, but needs heavier "professional" guardrails and an
explicit quiet-mode for CLI/glasses/headless. Revisit if engagement metrics later warrant a louder system.

---

## Phase 10 — iOS Wallet App (CHANGED — now holds Hedera key too)

**Prompt for Claude Code:**

```
Build the iOS Wallet as in v1 (Setup, Credential, Consent, deep links, OID4VCI receive, OID4VP present) WITH:

KeyService.swift (CHANGED):
- Store keys in the Secure Enclave (SecKeyCreateRandomKey with kSecAttrTokenIDSecureEnclave) where available, not raw
  Keychain Data. Keep a software fallback for the simulator with a clear flag.
- Manage TWO keys:
  1) VP signing key (P-256 / ES256) — used to sign Verifiable Presentations (as v1).
  2) Hedera account key — the key that controls the user's Hedera account. (P-256 maps to Hedera ECDSA; or use
     ed25519 via CryptoKit Curve25519 if preferring native Hedera keys — pick one and document it.)
- Signing operations require LocalAuthentication (Face ID / Touch ID) before the Secure Enclave will sign.

CredentialService.swift (CHANGED):
- Store the VC JWT in the Keychain (kSecClassGenericPassword), NOT UserDefaults. UserDefaults is not secure storage.

HederaService.swift (NEW):
- On first setup, after generating the Hedera key, call backend POST /api/hedera/account with the public key to
  provision the on-chain account (server pays the fee).
- showBalance(): GET /api/hedera/balance.
- send(toAccountId, amountMinor): POST /api/hedera/transfer/build → sign the returned tx bytes in the Secure Enclave
  (with Face ID) → POST /api/hedera/transfer/submit.

WalletView.swift (NEW): a tab showing Hedera account id / EVM alias, USDC balance, Receive (QR), and Send.

ArgusWalletApp.swift: TabView with Setup, Credential, Wallet, Activity. Keep onOpenURL for argus-wallet:// (consent)
and openid-credential-offer:// (VCI). Consent flow unchanged from v1 but the VP is now signed by the Secure-Enclave key.
```

---

## Phase 11 — External Agent Web App (mostly UNCHANGED)

**Prompt for Claude Code:**

```
Build argus-agent exactly as in v1 (intentDetector, mcpClient, walletBridge, MessageBubble, TokenIndicator,
ToolCallLog, ChatPage). One change:
- The agent's MCP transfer calls send integer minor-unit amounts and surface the formatted amount in the UI.
Everything else (challenge → trigger-wallet → poll token-status, immediate denial handling, 90s token countdown)
is unchanged. CLIENT_DID = 'did:simulator:agent-app'.
```

---

## Phase 12 — Hardening: RBAC, Rate Limiting, Observability, Tests (NEW)

**Prompt for Claude Code:**

```
Add production-hardening cross-cuts.

RBAC (/backend/src/middleware/rbac.ts):
- NOTE: the RBAC core (rbac.ts with requireAdmin/requireRole over the admins table, admin JWT with a
  kind:"admin" claim, /api/admin/seed + /api/admin/login) already landed in Phase 5A. This phase EXTENDS
  it: apply requireRole to the remaining admin surfaces (credential revoke, client suspend, agent
  terminate from Phase 7), and remove any other "open in dev" admin bypasses.
- roles: 'user', 'support', 'compliance', 'admin'. Store role on an admins table (seeded admin = 'admin').
- requireRole(...roles) middleware for admin routes. Remove all "open in dev" admin bypasses.
- Sensitive admin actions (revoke credential, suspend client, terminate agent) require role 'compliance' or 'admin'
  and are written to audit_logs with the actor admin id.

RATE LIMITING: ensure authLimiter (5 fails/30min lockout) and apiLimiter are applied (Phase 1). Add a per-agent-DID
limiter on the MCP endpoint.

OBSERVABILITY:
- pino structured logs with a request id on every request; never log secrets, tokens, full PII, or VC/VP contents.
- prom-client metrics: http_request_duration, ledger_post_total, vp_verify_total{result}, mcp_call_total{tool,result},
  hedera_tx_total{result}. Expose /metrics.

TESTS (vitest):
- /backend/test/invariants.test.ts encoding the Phase 14 invariants as executable tests.
- Money: assert no float anywhere (a lint rule or test scanning for ': number' on amount fields is a bonus).
- Run: cd backend && npx vitest run.
```

---

## Phase 13 — Integration & First-Run Setup (CHANGED)

**Prompt for Claude Code:**

```
Wire up the system and create first-run setup.

1. /backend/.env:
ANTHROPIC_API_KEY=<from user>
JWT_SECRET=<generate a strong random value — must NOT be the dev default in production>
DATABASE_URL=postgres://...        # omit to use local SQLite for dev
REDIS_URL=                          # optional
PORT=3001
BASE_URL=http://localhost:3001
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
ALLOW_PASSWORD_AUTH=true            # dev only; rejected in production
ADMIN_EMAILS=
IDV_PROVIDER=simulated
SANCTIONS_PROVIDER=simulated
HEDERA_ENABLED=false                # set true to exercise the Hedera track
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=
HEDERA_OPERATOR_KEY=
HEDERA_USDC_TOKEN_ID=               # testnet USDC token id

2. Run migrations: cd backend && npm run migrate

3. Start services: backend (npm run dev), frontend (5173), argus-agent (5174),
   iOS Wallet (Xcode, iPhone 15 sim).

4. Seed admin (RBAC): POST /api/admin/seed → admin@argusfinancial.com / Admin1234! with role 'admin'.

5. Register simulator agent as MCP client (admin JWT):
POST /api/admin/mcp-clients
{ "client_did":"did:simulator:agent-app", "display_name":"Argus Financial Partners Simulator Agent",
  "allowed_functions":["get_balance","get_transactions","get_statement","transfer_funds","get_profile"],
  "max_transfer_minor":50000, "require_user_approval":true }

6. End-to-end test (same as v1) PLUS:
   - Register with a passkey (not password).
   - Onboarding advances the tier (0 → 2).
   - If HEDERA_ENABLED: wallet provisions a Hedera account; Dashboard shows on-chain USDC; a send is signed on-device.
   - A transfer posts a balanced ledger journal (verify via /api/ledger).

7. /backend/seed-demo-users.js: 5 demo users, integer-minor balances, identity_profiles at varying tiers,
   doc numbers 1/2/3 pre-assigned for rejection demos.

8. Verify TypeScript compiles in all projects and vitest passes.
```

---

## Phase 14 — Final Polish & Security Invariants (CHANGED)

**Prompt for Claude Code:**

```
Final verification. Encode each invariant below as an automated test where possible (test/invariants.test.ts).

MONEY:
a. No REAL/float money column exists; every amount is integer minor units.
b. Every balance is derived from the double-entry ledger; debits == credits in every journal.
c. Money mutations require an Idempotency-Key; replay returns the original result, never double-posts.

CREDENTIAL / PRESENTATION (the core security model):
d. A VP with an invalid or wrong-key signature is REJECTED (VP_INVALID) — verified against the wallet did:key.
e. External agent CANNOT access user data without an active user_agent_grant (checked in BOTH verifyPresentation
   AND the MCP endpoint; no bypass).
f. Scoped token is 90s and single-use intent; MCP validates exp.
g. VP nonces are single-use (marked used before verification continues); VP hash stored to prevent replay.
h. VC revocation is immediate: verifyCredential checks the revoked flag AND the bitstring status bit on every VP.
i. User denial unblocks the agent immediately (pending_tokens __DENIED__ path), not on the 2-min timeout.

AUTH / ACCESS:
j. Passkey auth works; password auth is impossible when NODE_ENV=production.
k. 5 failed auth attempts trigger a 30-min lockout.
l. Admin routes require a role; there is no open-in-dev admin path.

HEDERA (if enabled):
m. The server never holds a user's Hedera private key; user transactions are signed on-device.
n. Daily reconciliation compares on-chain USDC vs ledger projection and flags drift.

iOS:
o. VC stored in Keychain (not UserDefaults); signing keys in Secure Enclave; Face ID gates signing.
p. argus-wallet:// and openid-credential-offer:// deep links work; Info.plist only via INFOPLIST_FILE.

Fix anything failing. Final git commit summarizing the v2 build.
```

---

## Phase 15 — Internal Agent Operations (15.0 + 15.1 + 15.4 seam BUILT)

**Status: 15.0 (runner) + 15.1 (KYC Review skill) + 15.4 (Temporal engine seam) BUILT; 15.2–15.3 remain.**
The runner executes behind a swappable `WorkflowEngine` (in-process default; optional Temporal adapter
under `src/operations/temporal/`, lazy-loaded `@temporalio/*`, `TEMPORAL_ENABLED`, degrades to in-process;
`npm run temporal:worker`). Money/state stays in the existing idempotency-keyed services inside activities —
Temporal orchestrates, never a second ledger. A live server run + Conductor (agent durable exec) remain. See
`docs/PHASE-15-INTERNAL-AGENT-OPS.md` and the Phase 15 entry in `CLAUDE.md` for the built surface
(`src/operations/*`, migration 014, `/api/admin/agent-ops`, `operations.test.ts`). The text below is
the original design. This phase runs the bank's *back office* — support, KYC review,
fraud/AML triage, marketplace due-diligence, marketing, SRE, compliance drafting — through AI agents
fronted by internal MCP "skill" servers, with the governance, security controls, and compliance
automation that make that safe. **Prerequisite: Phase 7 (MCP) + Phase 12 (RBAC/observability).**
(This section is the full design; it was formerly the `docs/agent-ops/` blueprint set, now folded in.)

### The one invariant everything hangs on

> **Agents decide; deterministic code executes; humans gate anything material.** An agent never moves
> money, mutates account / identity / credential state, or files with a regulator. It emits a
> **structured recommendation + reasoning trace**; a deterministic, RBAC-checked, audited **policy
> gate** is the only thing that acts. This generalizes Phase 5A's `riskOrchestratorService.finalizeDecision`
> ("the ONLY place a tier grant is authorized — the model is advisory") to every back-office workflow.

### Operating model — the canonical workflow

Every workflow has the same five-step shape; the agent context is discarded when it completes:

```
gather context (deterministic) → invoke agent (scoped MCP toolset) → policy gate (deterministic, RBAC)
                               → execute (deterministic) → audit (append-only)
```

This already exists in code: Phase 5A onboarding *is* this workflow — `signalService.assessSignals`
(gather) → `orchestratorModel.assessRisk` + `onboardingAgents` sub-agents (invoke) →
`finalizeDecision` (gate) → `identityService.completeKycDecision` (execute) → `auditService.logAudit`
+ `onboarding_agent_runs` (audit). Phase 6 SmartChat reinforces it (advisory `classifyIntent` →
operation-token + MFA gate → `ledgerService.transfer`).

**Supervision tiers** (set per *workflow*, not per skill): auto-approve · auto-approve+audit ·
human-required · human-led. In v1, every user-impacting or money-moving decision is at least
human-required, and money movement / state mutation is simply not an exposed agent capability.
Independent of tier, the workflow auto-escalates to a human on: confidence below floor (mirrors
`ONBOARDING_REVIEW_FLOOR`/`GRANT_GUARDRAIL_FLOOR`), threshold exceeded, hallucination (output
references a nonexistent record → block + log), explicit user request, or repeated escalations.

### Skills catalog (internal MCP servers)

Each skill exposes a versioned, scoped tool set for one domain. Every tool is **read / recommend /
draft** — none execute. "Backing service" = existing code a tool reads through; **(gap)** = to build.

| Skill | Representative tools | Posture | Backing / human gate |
|---|---|---|---|
| **Customer Support** | get_user_account, get_user_transactions, get_user_kyc_status, search_knowledge_base, draft_response, escalate_to_human | read/draft | `ledgerService.getUserBalances`, `transferService.getTransactionHistory`, `identityService`; refunds + regulatory complaints → human |
| **KYC Review** | get_kyc_submission, get_user_history, query_sanctions_databases, recommend_decision, request_additional_info | read/recommend | `identityService.screenSanctions`; gate → `completeKycDecision`; **human decides always** |
| **Fraud & AML** | get_transaction_context, query_blockchain_analytics, query_sanctions_databases, draft_sar_narrative, recommend_disposition, freeze_account | read/recommend/**restricted** | `ledgerService`/`transferService`; freeze + SAR need `requireRole("compliance","admin")` |
| **Marketplace DD** | fetch_issuer_documents, validate_smart_contract, verify_proof_of_reserve, draft_listing_record | read/draft | feeds Phase 8.8 listing lifecycle; compliance approves |
| **Marketing Ops** | query_user_segments (aggregate only — no PII), draft_notification/email, submit_for_approval | read/draft | send by notification service, not agent; ≥1K or claims → human/legal |
| **SRE / On-Call** | query_logs, query_metrics, query_traces, correlate_with_deploys, draft_incident_summary, page_humans | read/draft | pino logs + `prom-client`; **no deploy/restart**; humans remediate |
| **Compliance Drafting** | fetch_regulatory_templates, fetch_user_evidence, draft_regulatory_filing, schedule_filing | read/draft | `auditService` evidence; **humans file every filing**; `schedule_filing` queues only |

**No skill ever gets a tool that** moves money / posts to the ledger, mutates tier / credential /
account state, submits to a regulator, reads raw PII beyond what the supervising human may see, or
touches infrastructure. Those live only in deterministic gate/activity code.

### Security controls

- **No-execute boundary** (the hard control) — architectural, above.
- **Per-skill tool scoping** — model on Phase 7 `mcp_clients.allowed_functions` ∩ the `tokenFactory`
  exchange-token `scope`; effective scope = requested ∩ client-allowed (the Phase 7 intersection).
- **Delegation tokens** — short-lived signed tokens via `tokenFactory` (`mintExchangeToken` /
  `mintScopedToken`); action tokens ≤ 90s with `exp` validated at execute. Tokens never logged.
- **RBAC on every human gate** — `rbac.ts` `requireRole(...)`: compliance/admin for freezes, SAR,
  OFAC reports, listing approvals; support for support sends; admin for ≥1K marketing. Sensitive
  actions logged with the **actor admin id**.
- **Audit & reasoning traces** — every invocation → append-only `audit_logs`/`mcp_audit_logs` + a
  generic `agent_runs` store (generalize `onboarding_agent_runs`): skill+version, tool calls,
  structured output, gate decision, outcome. **Never log secrets/tokens/full PII/VC-VP** (Phase 12).
- **Containment** — per-skill kill-switch + circuit breaker (degrade to human-only, reusing the
  `assessRisk`→deterministic fallback), per-agent-DID rate limit (Phase 12), hallucination guard,
  structured-output validation (sanitize/clamp before the gate).
- **Pre-deploy eval gates** — functional ≥95% (auto-approve) / ≥90% (human-required); **safety/
  adversarial eval 100%** required for any production deploy.

### Compliance automation (each: trigger → skill → gate → human role → deadline → audit)

- **Sanctions screening** at the PRD-09 cadence (signup IP/geo, Tier-1 phone, Tier-2 full,
  daily Tier-2 rescreen, on-chain/fiat counterparties, marketplace both sides). Confirmed match →
  auto-freeze + OFAC blocking report (**10 days**); fuzzy → `pending_review` + agent context +
  **compliance decision ≤ 24h**.
- **Transaction monitoring** (velocity, structuring, pass-through, mule, geo-anomaly) → Fraud/AML
  triage → compliance disposition (clear / RFI / freeze / SAR).
- **Regulatory reporting** — SAR (**30d**), OFAC blocking (**10d**), CTR (v2 card), state MTL, 1099,
  FATCA/CRS — all **agent-drafted, human-filed**.
- **Daily reconciliation** — ledger projection vs Hedera Mirror Node / partner bank; drift → incident
  (Phase 14 invariant *n*).
- **Jurisdiction availability matrix** — first-class data, enforced at the API gateway by verified
  jurisdiction (also gates Phase 8 marketplace eligibility). Agents read it; only `admin` edits it.

### Orchestration — prototype now, Conductor/Temporal target

The workflow contract is substrate-agnostic: `gather`, `gate`, `execute` are pure deterministic
functions; `invoke` is the only LLM-touching step.

- **Now (prototype):** a thin in-process `operationsWorkflow` runner using the existing
  direct-Anthropic-SDK + simulated-fallback pattern (`orchestratorModel`), the `finalizeDecision`
  gate pattern, existing services for execute, `auditService` + `agent_runs` for audit, and a
  DB-backed human-review queue in the admin console. Matches this plan's "prototype calls the
  Anthropic SDK directly" stance — no engine needed to prove the model.
- **Target (production):** **Conductor OSS** for agent workflows (durable execution, built-in
  human-task queues for the gates) + **Temporal** for money workflows (exactly-once at the ledger
  seam). Mapping: workflow→definition, gather/execute→worker/activity, invoke→agent-task worker
  calling the scoped MCP server, gate→decision/human task, audit→engine event history **plus** the
  retained append-only stores.
- **Migration seam:** because gather/gate/execute are pure functions, they become workers/activities
  unchanged — only the runner swaps. Money execution stays in `ledgerService`/`transferService` with
  idempotency keys; the engine orchestrates but never becomes a second ledger.

### Governance & lifecycle

Named **skill owner** per skill; tier *relaxations* need eval evidence + compliance sign-off.
Versioned skills with independent deploy; rollback = version pin. Production monitoring: reasoning-
trace capture, weekly sampled human review (PRD-09 cadence), drift detection, per-workflow token-cost
alerts (`agent_run_total{skill,result}`, `agent_tokens_total`, `agent_escalation_total`). Failure
handling: LLM/MCP down → human-only; low confidence → escalate; hallucination → block+incident;
kill-switch is an audited event. Human-in-the-loop SLAs (e.g. fuzzy sanctions hit ≤ 24h) raise alerts
on breach. Every incident adds to the eval set so it can't silently recur.

### Sub-phases

```
15.0  Policy-gate & run-ledger framework — reusable operationsWorkflow runner (gather→invoke→gate→
      execute→audit), generalize onboarding_agent_runs → agent_runs, SupervisionTier enum, human-review
      queue, per-skill kill-switch + per-DID rate limit. Reuses orchestratorModel + riskOrchestratorService.
15.1  First skill (KYC Review or Fraud/AML triage) — one MCP server (read/recommend/draft only),
      workflow + gate + admin review queue. Eval gate: functional ≥90%, safety/adversarial 100%.
15.2  Remaining read-only skills — Support, SRE, Marketing, Marketplace DD.
15.3  Compliance reporting workflows — sanctions rescreen cadence, txn-monitoring triage, SAR/OFAC/CTR
      drafting (agent-drafted, human-filed), daily reconciliation (Phase 14 invariant n).
15.4  Conductor/Temporal migration — lift durable/money workflows onto the production substrate.
```

**Out of scope (PRD-08 non-goals, encoded not omitted):** agents making user-impacting decisions
without human approval; real-time customer chat agents (v1 = drafted+approved); agents managing
investments or executing payments/transfers (**never, by policy**); agents deploying production code.

---

## Phase 16 — Comprehensive End-to-End Validation (NEW)

**Status: design + scaffolding now; fully exercisable as each phase lands.** The single, repeatable
validation that exercises whole **user journeys across every channel** — not per-phase unit invariants.
The authoritative runbook is `docs/E2E-VALIDATION.md`; this phase is its `full` scope and the home of the
validation tooling. Anchored in two places: a **gate after Phase 8** (sub-step 8.12, `through-phase-8`
scope) and this **comprehensive pass after the last phase** (`full` scope).

**Automation backbone — Hybrid (deterministic floor + agent/MCP coverage):**

```
16.1  Deterministic floor — backend/test/e2e.test.ts (vitest + supertest)
      HTTP flow scripts for every money-critical journey, asserting the cross-cutting invariants
      (integer-minor-unit money, balances derived from ledger, append-only tables, Idempotency-Key on
      money-mutating endpoints, VP signature verified before access). Extends the existing
      backend/test/phaseN.test.ts pattern. This runs first and must be green.

16.2  Agent/MCP-driven coverage — the journeys that are genuinely NL- or client-driven:
      SmartChat NL intent → 90s operation token → transfer (incl. the >$500 MFA gate), the external-agent
      OID4VP → VP-verify → MCP scoped-operation path (security-critical), and the full demo walkthrough.
      Driven via the argus-mcp-test-harness skill acting as a real client.

16.3  Skills (built under .claude/skills/):
      - e2e-validator — orchestrates a pass: runs 16.1, then drives 16.2, emits a pass/fail report mapped
        to docs/E2E-VALIDATION.md. Scope arg: `through-phase-8` | `full`.
      - argus-mcp-test-harness — thin MCP/HTTP client exercising SmartChat, the operation-token exchange,
        and the external-agent OID4VP+MCP path; asserts token TTL / MFA-gate / compliance behaviors.

16.4  Channel × journey matrix — Web (responsive), Mobile (iOS wallet), Agentic CLI/headless, and the
      Glasses/minimal-HUD target (validated as the CLI text path until a device exists). See the matrix
      in docs/E2E-VALIDATION.md. Includes the Phase 15.3 ledger⇄chain reconciliation check.
```

**Out of scope:** load/perf testing, chaos/fault injection, and real-device glasses validation — later
items once a device target and a staging environment exist.

---

# Long-term roadmap — Phases 17–20 (toward a full bank, trading & production tokenization)

> Phases 0–16 deliver the **Phase-A (non-custodial software) launchable** product. Phases 17–20 are the
> **roadmap to the full vision** — competing with the likes of JPMorgan Chase (full bank) and Robinhood
> (trading) — and are gated on regulated **partners/licensing**, not just engineering. Each maps to a
> corporate-ramp phase in `docs/business/CORPORATE-STRUCTURE.md` (**Corp A** = launch/non-custodial,
> **Corp B** = partnered + FinCEN MSB, **Corp C** = own licenses/charter). **None are built** — they are
> design/roadmap. The order is dependency-driven: do not start one before its corporate gate is cleared.
> The unifying rule from Phase 4 holds throughout: **the double-entry ledger stays the single source of
> truth for cash and positions; on-chain/partner systems mirror it, never replace it.**

## Phase 17 — Trading & brokerage (equities, options, crypto spot) → **Corp C**

> **Design delivered — `docs/PHASE-17-TRADING-BROKERAGE.md`.** Centerpiece: trading is a bulkheaded,
> separately-scaled domain that the core bank never blocks on; it touches the ledger **only at settlement**,
> async + idempotent via the `external_clearing` seam, and is kill-switchable/shed-able so it can never
> breach the money-critical (Class A) SLOs. Includes an isolated, simulated **Stage-1** slice buildable now.

Bring Robinhood-class trading to the same agent-operable surface. New `securities`/`positions`/`orders`
domain, **distinct from** the Phase-8 tokenized-RWA marketplace (that is issuance/holdings; this is
exchange-traded instruments).

- **Scope:** US equities + ETFs (17.1), listed options (17.2 — adds an options-approval tier + greeks/
  risk disclosure), crypto spot (17.3 — beyond the Hedera USDC wallet, to BTC/ETH/major pairs); real
  **market-data** feeds (level-1 quotes, last/NBBO) replacing the Phase-8 simulated pricing; **order
  routing/execution** (market/limit/stop), fills → ledger journals (cash ↔ position, both integer base
  units); margin/leverage deferred to 17.4.
- **Hard dependency (Corp C):** a registered **broker-dealer + clearing** relationship (introducing-broker
  via a partner like Apex/DriveWealth first; self-clearing only at scale). Options need OCC clearing.
  Crypto spot routes through a licensed venue/custodian. **No in-house trading book until licensed.**
- **Reuses:** ledger (positions as ledger currencies, like Phase-8 assets), idempotency on order ids,
  the operation-token + MFA gate for trade authorization, the MCP scope model (`trade:read`/`trade:execute`).
- **Compliance:** Reg BI / suitability, options-approval levels, best-execution, trade reporting (CAT).

## Phase 18 — Tokenization production (real-estate & securities for real money + ATS) → **Corp B/C**

Promote the Phase-8 marketplace from demo to real-money RWA issuance and secondary trading.

- **Scope:** deployed + **audited ERC-3643** security tokens (Tokeny) replacing the in-app model (18.1);
  **real HTS** token create/mint for collectibles (18.2); real-estate as tokenized LLC/SPV membership
  interests under a proper offering wrapper (18.3); a **transfer agent of record** (SEC Form TA-1) for the
  cap table (18.4); secondary resale via an **ATS** (18.5).
- **Hard dependency:** securities counsel-built offering wrapper (**Reg D 506(c)** accredited-only first,
  then Reg A+/CF) — the Phase-8 Compliance Module (tier/jurisdiction/holder-cap) already models the rules;
  the *legal* wrapper + an **ATS/broker-dealer partner** (Securitize, tZERO) are the gates. Custody of
  pooled/issued assets via a **qualified custodian** (Corp B).
- **Reuses:** Phase-8 `complianceService` (transfer restrictions), escrow subscribe→close, atomic
  cash+asset+fee journals, versioned listings + RBAC lifecycle, and the Phase-15 Marketplace-DD agent.

## Phase 19 — Full-bank rails (fiat, cards, deposits via partner) → **Corp B**

Add the "money app" rails that make Argus a daily-driver account — **without** becoming a bank: partner
in every regulated leg (the `CORPORATE-STRUCTURE.md` Phase-B thesis).

- **Scope:** fiat **on/off-ramp** (19.1), **FBO/escrow** accounts for held balances (19.2 — never the
  operating account; the commingling rule from CORPORATE-STRUCTURE §7), **ACH/wire** + **bill pay**
  (19.3), **debit cards** (19.4), **statements** export (19.5), partner-bank **deposits** (FDIC *via the
  partner*, never marketed as our own — see the "bank naming" rule the Argus rebrand serves).
- **Hard dependency (Corp B):** a **BaaS / partner bank** (Column, Lead Bank, Treasury Prime/Unit) that
  holds the banking license + moves the money; **FinCEN MSB registration**; an industrialized **KYC/AML
  vendor** (Persona/Alloy/Footprint) replacing the simulated providers; a written AML program + named
  compliance officer (CORPORATE-STRUCTURE §8).
- **Reuses:** the ledger's existing **`external_clearing`** account is the documented attach seam; the
  tiered identity ladder + DID/VC + append-only audit are ~70% of the AML evidence layer.

## Phase 20 — Production hardening & scale (custody, reconciliation, fraud platform, orchestration) → **Corp B/C**

The non-feature work that must land before real money flows at scale — the items the current plan defers.

- **Custody hardening:** move the Hedera operator/treasury key off `private_key_hex` to **cloud KMS/HSM
  with multi-party control / multisig** (closes Phase-14 invariant *m*; CORPORATE-STRUCTURE Phase-C SPDI
  is the deep custody option).
- **Reconciliation:** the **ledger⇄chain daily reconciliation** job (Phase-14 invariant *n* / Phase-15.3)
  — compare ledger projection vs Hedera Mirror Node and partner-bank balances; flag drift, gate settlement.
  **BUILT (chain leg):** `reconciliationService` (Mirror Node provider, injectable), per-user USDC + escrow-
  custodian coverage checks, append-only `reconciliation_runs`/`reconciliation_findings`, drift gates all
  on-chain settlement via `RECONCILIATION_HOLD`, daily loop + `/api/admin/reconciliation` (RBAC),
  `reconciliation.test.ts`. The partner-bank leg lands with Phase 19.
- **Fraud Stages 2–4:** **BUILT as a standalone add-on** (`fraud-engine/`, Node/TS :4500) that graduates
  the Stage-1 seam to the `docs/business/FraudEngine.md` architecture at prototype scale — event backbone +
  schema registry (`bus/`), per-user feature store + enrichment (`features/`), a `rules-v1` ensemble +
  `seq-v0` sequence model (Transformer stand-in), a model **registry + serving** layer with config-driven
  **routing + shadow/canary** (`models/`, `router/`), an append-only decision topic, an analyst **case
  queue** (`cases/`), an async **remediation** loop that calls Argus back to **freeze/flag** (`remediation/`),
  and a **label → retrain** loop (`learning/`). The service imports **nothing** from `backend/`. **Hybrid
  integration:** an in-Argus triage (`fraudService`) routes each money event blocking (sync `fraudClient`
  call → advisory merge → local deterministic gate) vs fire-and-forget; severe async decisions trigger a
  service-bearer callback to `/api/internal/remediation` that places an append-only `account_holds` row
  (`ACCOUNT_FROZEN` gate on transfers/pay), idempotent on `decisionId`, degrading open unless
  `FRAUD_REMOTE_REQUIRED`. Real Kafka/Flink/Triton/MLflow/lakehouse remain the production swap (each layer
  sits behind a 1:1 interface) — still a locked-architecture decision per `FraudEngine-GapAnalysis.md`.
- **Orchestration migration:** lift the gather→gate→execute→audit runner (Phase 15.4 seam) onto **Conductor
  OSS** (agent workflows + human-task queues) + **Temporal** (exactly-once money workflows), with the
  ledger/idempotency seam unchanged. Plus a **data warehouse/analytics** pipeline.
- **Build out Phase 15** internal agent operations (KYC review, Fraud/AML triage, support, compliance
  drafting) from design to runtime, on the orchestration substrate above.

---

## Quick Start (After Build)

```bash
# Terminal 1: Backend
cd argus/backend && npm run migrate && npm run dev
# Terminal 2: Frontend
cd argus/frontend && npm run dev
# Terminal 3: External Agent
cd argus/argus-agent && npm run dev
# Xcode: open ArgusWallet/ArgusWallet.xcodeproj, run on iPhone 15 simulator

# Seed admin
curl -X POST http://localhost:3001/api/admin/seed
```

### Ports

| Service | URL |
|---|---|
| Backend API | http://localhost:3001 |
| Frontend | http://localhost:5173 |
| External Agent | http://localhost:5174 |
| Metrics | http://localhost:3001/metrics |

### Test Credentials

| Role | Email | Password / Auth |
|---|---|---|
| Admin | admin@argusfinancial.com | Admin1234! (RBAC role: admin) |
| Demo User | register yourself | Passkey (or password if ALLOW_PASSWORD_AUTH) |
| Demo Users (seed) | david.chen@demo.com etc | Demo1234! |

### IDV Test Doc Numbers (Simulated provider)

| Number | Outcome |
|---|---|
| `1` | Expired → rejected |
| `2` | Tampered → rejected |
| `3` | Low quality → rejected |
| Any other | Approved |

---

## What this plan deliberately does NOT include (and why)

The items below are **out of scope for the launchable Phase-A build (Phases 0–16)**. Each now has a home
on the **Phase 17–20 long-term roadmap** above, gated on the corporate ramp in `CORPORATE-STRUCTURE.md`.

- **Trading: equities, options, crypto spot** (market data, order routing, brokerage/clearing, margin) —
  **not in the prototype at all.** Now **Phase 17**, gated on a broker-dealer/clearing partner (**Corp C**).
- **Production tokenized RWA / collectibles** — the prototype models the rules in-app (**Phase 8**). The
  production items (first-party issuance, deployed/audited ERC-3643, real HTS create/mint, transfer agent,
  bridging/CCTP, AMM, auctions, **ATS** secondary resale, real partner integrations) are now **Phase 18**
  (**Corp B/C**).
- **Partner-bank fiat rails, cards, deposits, international corridors** — out of scope for the prototype;
  the ledger's `external_clearing` account is the attach seam. Now **Phase 19**, gated on a BaaS partner +
  FinCEN MSB (**Corp B**).
- **Production custody hardening (KMS/HSM paymaster, multi-sig treasury), ledger⇄chain reconciliation,
  and the real-time fraud platform** (Kafka + Flink + Transformer serving + feature store + model registry
  + lakehouse — the `docs/business/FraudEngine.md` north-star). **Stage 1 (an in-process fraud seam) is
  built** — it screens the money path in `transferService` via `fraudService` (deterministic `rules-v0`
  scorer → append-only `fraud_decisions`; closes the "no transaction-time fraud check" gap). The rest is
  now **Phase 20** (**Corp B/C**); the fraud platform Stages 2–4 remain a locked-architecture decision —
  see `docs/business/FraudEngine-GapAnalysis.md`.
- **Temporal / Conductor orchestration** — the prototype calls the Anthropic SDK directly, which is fine at
  this scale. The internal agent-operations design + the prototype→Conductor/Temporal migration seam is
  **Phase 15** above; the engine migration + Phase-15 runtime build-out is folded into **Phase 20**.

