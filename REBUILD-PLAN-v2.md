# BankAI — Rebuild Plan v2 (Hedera-aligned, production-hardened)

> This supersedes the original REBUILD-PLAN.md. It keeps every capability from v1 (DID/VC issuance, OID4VCI, OID4VP presentation, the 4-factor scope intersection, 90-second scoped tokens, MCP server, the iOS wallet, the external agent app, the admin console) and adds: integer-money correctness, a real double-entry ledger, VP signature verification, WebAuthn passkeys, the tiered identity ladder, a Hedera integration track, vendor adapter patterns, rate limiting, RBAC, observability, and tests.
>
> Like v1, each phase is a self-contained block you can hand to Claude Code. Phases are ordered so each builds on the last. **Phase 0 is new and must be read before any code is written** — it defines conventions that every later phase depends on.
>
> **Strategic context:** this rebuild evolves the BankAI prototype toward the architecture in the Bankai PRD (Hedera settlement, native wallet, double-entry ledger). The credential + agent-authorization layer is the foundation and is kept intact; the simulated-banking core is replaced with a correct ledger and a Hedera integration seam.

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
bankAI/
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
│   │   └── invariants.test.ts               #   security invariants from Phase 13
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                                # (structure unchanged from v1, pages updated)
│   └── ...                                   #   + Passkey enrollment UI, Tier badges
│
├── bankai-agent/                            # (unchanged from v1)
│   └── ...
│
└── BankAIWallet/
    └── BankAIWallet/
        ├── BankAIWalletApp.swift
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
Establish the cross-cutting conventions for the BankAI rebuild. These rules apply to every later phase.

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
Create a Node.js + Express + TypeScript backend for BankAI.

Setup:
- Init npm project in /backend
- Install: express, cors, dotenv, zod, pg, better-sqlite3, bcryptjs, jsonwebtoken, jose, uuid,
  @anthropic-ai/sdk, @simplewebauthn/server, pino, prom-client
- Install dev: typescript, tsx, vitest, @types/* as needed, node-pg-migrate
- tsconfig.json: target ES2022, module commonjs (or NodeNext), strict true, outDir dist

DATABASE — support both Postgres (prod) and SQLite (dev) behind one interface:
- Create /backend/src/db/index.ts:
  - getDb() returns a thin query wrapper. If DATABASE_URL is set → Postgres (pg Pool). Else → better-sqlite3 at
    ./data/bankai.db with WAL + foreign_keys ON.
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

Create /backend/.env (see Phase 12 for full list). Add scripts: dev, build, start, migrate, test.
```

---

## Phase 2 — DID & Verifiable Credentials (CHANGED)

**Prompt for Claude Code:**

```
Add DID and Verifiable Credential services. Keep v1 behavior; add key rotation and a real status list.

Create /backend/src/services/didService.ts (as v1) WITH these additions:
- Support multiple keys: store key history as bankai_keys.json (array of {kid, privateJwk, publicJwk, createdAt, retiredAt?}).
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
Add a Hedera integration seam so BankAI accounts map to real Hedera testnet accounts and USDC. This is the foundation
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
Pulls the Phase 11 RBAC core forward (see the note in Phase 11).

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
- admin.ts: gate all admin routes behind rbac middleware (Phase 11). Remove any "open in dev" auth path.

Write /backend/test/presentation.test.ts:
- A VP signed by the WRONG key is REJECTED (VP_INVALID).
- A replayed VP (same hash) is REJECTED.
- A reused nonce is REJECTED.
- Scope intersection correctly drops scopes not in all four sets.
- An agent the user never granted is REJECTED even with a valid VP.
```

---

## Phase 8 — React Frontend (Customer Portal) (CHANGED)

**Prompt for Claude Code:**

```
Build the frontend as in v1 (Login, Register, Dashboard, SmartChat, Agents, AgentChat, AuditLog, Onboarding,
Credentials, AgentPermissions, AdminConsole, AdminLogin) WITH:
- Passkey enrollment + login UI (use @simplewebauthn/browser). Password form only shows if ALLOW_PASSWORD_AUTH.
- Display money from integer minor units via a shared formatMoney(minor, currency) util — never parse floats.
- Onboarding shows the tier ladder with the current tier badge and what each tier unlocks.
- Dashboard shows BOTH simulated USD cash (ledger) and, if Hedera is enabled, on-chain USDC balance with a "Receive"
  (show Hedera account id / EVM alias + QR) and "Send" flow that builds → signs (via wallet) → submits.
- Keep the existing dark theme, Layout sidebar, and all v1 pages/behaviors.
- api/client.ts: add an Idempotency-Key header generator for money-mutating POSTs.
```

---

## Phase 9 — iOS Wallet App (CHANGED — now holds Hedera key too)

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

BankAIWalletApp.swift: TabView with Setup, Credential, Wallet, Activity. Keep onOpenURL for bankai-wallet:// (consent)
and openid-credential-offer:// (VCI). Consent flow unchanged from v1 but the VP is now signed by the Secure-Enclave key.
```

---

## Phase 10 — External Agent Web App (mostly UNCHANGED)

**Prompt for Claude Code:**

```
Build bankai-agent exactly as in v1 (intentDetector, mcpClient, walletBridge, MessageBubble, TokenIndicator,
ToolCallLog, ChatPage). One change:
- The agent's MCP transfer calls send integer minor-unit amounts and surface the formatted amount in the UI.
Everything else (challenge → trigger-wallet → poll token-status, immediate denial handling, 90s token countdown)
is unchanged. CLIENT_DID = 'did:simulator:agent-app'.
```

---

## Phase 11 — Hardening: RBAC, Rate Limiting, Observability, Tests (NEW)

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
- /backend/test/invariants.test.ts encoding the Phase 13 invariants as executable tests.
- Money: assert no float anywhere (a lint rule or test scanning for ': number' on amount fields is a bonus).
- Run: cd backend && npx vitest run.
```

---

## Phase 12 — Integration & First-Run Setup (CHANGED)

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

3. Start services: backend (npm run dev), frontend (5173), bankai-agent (5174),
   iOS Wallet (Xcode, iPhone 15 sim).

4. Seed admin (RBAC): POST /api/admin/seed → admin@bankai.com / Admin1234! with role 'admin'.

5. Register simulator agent as MCP client (admin JWT):
POST /api/admin/mcp-clients
{ "client_did":"did:simulator:agent-app", "display_name":"BankAI Simulator Agent",
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

## Phase 13 — Final Polish & Security Invariants (CHANGED)

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
p. bankai-wallet:// and openid-credential-offer:// deep links work; Info.plist only via INFOPLIST_FILE.

Fix anything failing. Final git commit summarizing the v2 build.
```

---

## Quick Start (After Build)

```bash
# Terminal 1: Backend
cd bankAI/backend && npm run migrate && npm run dev
# Terminal 2: Frontend
cd bankAI/frontend && npm run dev
# Terminal 3: External Agent
cd bankAI/bankai-agent && npm run dev
# Xcode: open BankAIWallet/BankAIWallet.xcodeproj, run on iPhone 15 simulator

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
| Admin | admin@bankai.com | Admin1234! (RBAC role: admin) |
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

- **Tokenized RWA / collectibles marketplace** — this is the PRD's product wedge but a separate surface; adding it here
  would bloat the identity/agent rebuild. Build it as its own track once this foundation is solid.
- **Temporal / Conductor orchestration** — the prototype calls the Anthropic SDK directly, which is fine at this scale.
  Migrate agent and money workflows to Conductor/Temporal (per the PRD) when moving from prototype to production.
- **Partner-bank fiat rails, international corridors** — out of scope for the prototype; the ledger's
  external_clearing account is the seam where they'll attach later.
- **Production custody hardening (HSM-backed paymaster, multi-sig treasury)** — the Hedera operator key here is a
  testnet convenience. Production must move it to KMS/HSM with multi-party control (PRD Module 04).
```

