# Argus Financial Partners — End-to-End UX & System Test Guide

A hands-on guide to exercising **every product, every channel, and the fraud platform** as a
real user/operator, plus how to build/run/validate the backend end-to-end. This is the manual,
"drive the actual apps" companion to the automated runbook in
[`docs/E2E-VALIDATION.md`](./E2E-VALIDATION.md) (deterministic vitest + the `e2e-validator` skill).

- **Use this doc** to click through journeys, see the fraud system react, and demo the product.
- **Use `E2E-VALIDATION.md`** for the repeatable pass/fail gate (CI-style).

---

## 0. The stack — what runs where

| # | Service | Start in | URL / port | Needed for |
|---|---|---|---|---|
| 1 | **Backend API** | `backend/` | `http://localhost:3001` (health: `/api/health`) | everything |
| 2 | **Customer portal** (React) | `frontend/` | `http://localhost:5173` | all user journeys |
| 3 | **External agent app** (OID4VP + MCP) | `argus-agent/` | `http://localhost:5174` | connected-agent journey |
| 4 | **Fraud engine** (standalone) | `fraud-engine/` | `http://localhost:4500` (health: `/health`) | fraud journey, learning loop |
| 5 | **Temporal** (optional) | `backend/` compose | gRPC `localhost:7233`, UI `http://localhost:8233` | durable money + agent ops |
| 6 | **Conductor** (optional) | `backend/` compose | API `http://localhost:8080/api`, UI `http://localhost:5001` | agent-ops orchestration |
| 7 | **iOS wallet** (`ArgusWallet/`) | Xcode | simulator | mobile (unverified source — needs macOS/Xcode) |

**Primary starting URL for almost everything: `http://localhost:5173`** (the customer portal).
Admin journeys start at `http://localhost:5173/admin/login`. The external-agent journey starts at
`http://localhost:5174`.

---

## 1. First-time setup & test data

```bash
# --- backend ---
cd backend
npm install
cp .env.example .env            # then edit (see §1.1)
npm run seed:e2e                # migrate + seed RBAC admin + register simulator MCP client
                                #   + 5 demo users + marketplace assets (idempotent)
npm run dev                     # API on :3001 (auto-migrates in dev)

# --- customer portal (new terminal) ---
cd frontend && npm install && npm run dev      # :5173

# --- external agent app (new terminal) ---
cd argus-agent && npm install && npm run dev    # :5174

# --- fraud engine (new terminal) ---
cd fraud-engine && npm install && cp .env.example .env && npm run dev   # :4500
```

### 1.1 `.env` flags that unlock journeys

Most products are behind kill-switches (off by default). For a full demo set these in `backend/.env`:

```bash
ALLOW_PASSWORD_AUTH=true          # lets you log in with the demo passwords (passkeys otherwise)
TRADING_ENABLED=true              # /trade journey (Phase 17 simulated broker)
ARGUS_PAY_ENABLED=true            # Argus Pay merchant journey (Phase 21)
BANK_RAILS_ENABLED=true           # bank rails: deposit/withdraw/statement (Phase 19 Stage-1)
CARDS_ENABLED=true                # debit cards: issue/authorize/capture (Phase 19.4)
BILLPAY_ENABLED=true              # bill pay: payees + scheduled/recurring payments (Phase 19.3)
# Fraud engine wiring (both sides must share the key):
FRAUD_ENGINE_URL=http://localhost:4500
FRAUD_ENGINE_API_KEY=<a-strong-shared-secret-32+chars>
# Optional orchestration (see §9):
# TEMPORAL_MONEY_ENABLED=true     CONDUCTOR_ENABLED=true     TEMPORAL_ENABLED=true
# Optional on-chain (else simulated):
# HEDERA_ENABLED=true  HEDERA_OPERATOR_ID=…  HEDERA_OPERATOR_KEY=…  HEDERA_USDC_TOKEN_ID=…
```

In `fraud-engine/.env` set the **same** `FRAUD_ENGINE_API_KEY` (the engine validates it and reuses it
for freeze callbacks).

> ⚠️ These flags are **prod-fatal** — the server refuses to boot in `NODE_ENV=production` with
> `TRADING_ENABLED`/`ARGUS_PAY_ENABLED`/`ALLOW_PASSWORD_AUTH` on, or `KMS_PROVIDER=local`. They are for
> local/dev demoing only.

### 1.2 Test credentials & data created by `seed:e2e`

| Who | Login | Tier / state | Use for |
|---|---|---|---|
| **admin@argusfinancial.com** / `Admin1234!` | `/admin/login` | RBAC `admin` | admin console, agent-ops, escrow mediation |
| **alex@demo.com** / `Demo1234!` | `/login` | Tier 2, $12,500 | transfers, SmartChat, escrow |
| **blair@demo.com** / `Demo1234!` | `/login` | Tier 2, $40,000 | marketplace Invest (accredited) |
| **casey@demo.com** / `Demo1234!` | `/login` | Tier 1, $3,000 | KYC step-up; rejection demo (expired doc #1) |
| **drew@demo.com** / `Demo1234!` | `/login` | Tier 0, $750 | fresh signup; rejection demo (tampered doc #2) |
| **erin@demo.com** / `Demo1234!` | `/login` | Tier 0, $250 | fresh signup; rejection demo (low-quality doc #3) |

Plus: marketplace Invest/Collect assets, and the simulator MCP client `did:simulator:agent-app`
(used by the external-agent app, $500 ceiling).

Extra data created inline per journey below (a merchant for Argus Pay, an agent-ops review) via `curl`.

---

## 2. Customer-portal journeys (start at `http://localhost:5173`)

Each journey lists the **start URL**, steps, and **what to verify**. Log in as the noted demo user.

### J1 — Auth (passkey-first) & registration
- **Start:** `/register` → `/login`.
- Register a new user (passkey if your browser supports WebAuthn; password form appears only when
  `ALLOW_PASSWORD_AUTH=true`). Then log in.
- **Verify:** session persists; `Idempotency-Key` is auto-attached to money POSTs (Network tab);
  5 failed password attempts → `ACCOUNT_LOCKED` (reset with `npm run reset:auth`).

### J2 — Agentic onboarding & the tier ladder
- **Start:** `/onboarding` (log in as **drew** or **erin**, Tier 0).
- Submit signals/document. The risk orchestrator scores signals → may require step-up
  (document/possession). Low confidence or a "weak" doc number routes to **manual review**.
- **Verify:** the tier-ladder dots advance; a clean flow grants Tier 2; **drew/erin/casey** (seeded
  with rejection doc numbers 1/2/3) land in the admin review queue (see J13).

### J3 — Dashboard & money transfer (now on Temporal-capable path)
- **Start:** `/` as **alex**.
- Send a transfer to **blair** (by email). Amounts render only from integer minor units.
- **Verify:** balance updates; `/activity` shows `transfer_out` + matching `transfer_in`; a **replay
  with the same Idempotency-Key posts no second journal** (exactly-once). With `TEMPORAL_MONEY_ENABLED`
  the transfer runs as a durable Temporal workflow (see the worker logs / Temporal UI :8233) — same
  result, because the ledger is the source of truth.

### J4 — Invest (tokenized RWA / securities)
- **Start:** `/invest` as **blair** (accredited, Tier 2).
- Open an asset (`/asset/:id`) → **quote** (see fee/source/as-of/staleness) → **TradeSheet** confirm.
- **Verify:** a single atomic cash+asset+fee journal; holdings appear; a Tier-1 user (**casey**) is
  compliance-gated (`COMPLIANCE_BLOCKED` / `TIER_REQUIRED`).

### J5 — Collect (collectibles)
- **Start:** `/collect`. Buy/sell a collectible; same quote→confirm flow.
- **Verify:** holding reflects in the ledger; secondary sell posts the atomic journal.

### J6 — Agent / SmartChat (NL → 90s operation token → MFA gate)
- **Start:** `/agent` as **alex** (Tier 2 required).
- Type "send $50 to blair@demo.com". Watch the **90-second token countdown**. Try ">$500" to trigger
  the **MFA gate**.
- **Verify:** intent classified → scoped 90s RS256 operation token → transfer posts idempotently on the
  token id; an expired token is rejected; MFA required above $500.

### J7 — Trading (Phase 17 simulated broker; needs `TRADING_ENABLED=true`)
- **Start:** `/trade` as **alex**.
- Place a simulated equity/crypto order.
- **Verify:** order accepted on the hot path; settlement posts into the ledger **asynchronously** and
  idempotently; trading is bulkheaded — a broker stall doesn't block J3 transfers (SLA isolation).

### J8 — Escrow (chargeback substitute)
- **Start:** `/escrow` as **alex** (payer) → hold funds for **blair**.
- **Verify:** hold debits payer to the `escrow` system account; release→credits recipient; refund→back to
  payer; dispute → mediated by admin (J13). Each step is an idempotent ledger journal.

### J9 — Argus Pay (merchant rail; needs `ARGUS_PAY_ENABLED=true`)
Create a merchant first (as **blair**, Tier 2). Get a session token by logging in via the portal and
copying the Bearer from the Network tab, or use the API:
```bash
# register merchant (blair is the settlement account)
curl -sX POST localhost:3001/api/pay/merchants -H "Authorization: Bearer $BLAIR" \
  -H 'Content-Type: application/json' -d '{"name":"Acme Coffee"}'
# merchant requests money (idempotent)
curl -sX POST localhost:3001/api/pay/intents -H "Authorization: Bearer $BLAIR" \
  -H 'Idempotency-Key: pay-1' -H 'Content-Type: application/json' \
  -d '{"merchantId":"<id>","amountMinor":"500","currency":"USD"}'
```
- Pay the intent as **alex**, then capture as **blair**; try a refund and a payer dispute.
- **Verify:** every payment is **escrow-protected** (status derives from the escrow row); zero rail fee;
  agents can pay via the `pay_merchant` MCP tool (scope `pay:merchant`).

### J9b — Bank rails: deposit, withdraw, statement (needs `BANK_RAILS_ENABLED=true`)
- **API** (Tier 2; get `$ALEX` Bearer from the portal Network tab). The simulated partner bank settles
  instantly into the ledger via `external_clearing`.
```bash
# on-ramp (deposit) — Idempotency-Key required
curl -sX POST localhost:3001/api/bank/deposit -H "Authorization: Bearer $ALEX" \
  -H 'Idempotency-Key: dep-1' -H 'Content-Type: application/json' -d '{"amountMinor":"50000"}'
# off-ramp (ACH payout)
curl -sX POST localhost:3001/api/bank/withdraw -H "Authorization: Bearer $ALEX" \
  -H 'Idempotency-Key: wd-1' -H 'Content-Type: application/json' -d '{"amountMinor":"20000","method":"ach","destination":"ext-1"}'
curl -s "localhost:3001/api/bank/statement?from=1970-01-01T00:00:00Z&to=2999-01-01T00:00:00Z" -H "Authorization: Bearer $ALEX"
# admin: ACH return reversal + FBO coverage (compliance/admin)
curl -sX POST localhost:3001/api/admin/bank/transfers/<id>/return -H "Authorization: Bearer $ADMIN"
curl -s localhost:3001/api/admin/bank/fbo?currency=USD -H "Authorization: Bearer $ADMIN"
```
- **Verify:** deposit credits / withdraw debits `user_cash` (visible in `/activity`); replaying an
  Idempotency-Key posts no second journal; an over-balance withdrawal → `INSUFFICIENT_FUNDS`; a frozen
  account (fraud, J§4) → `ACCOUNT_FROZEN`; the statement's closing balance reconciles to the ledger; FBO
  coverage shows the partner bank backing customer cash 1:1; a return reverses the journal.

### J9c — Debit cards: issue, authorize, capture/void/refund (needs `CARDS_ENABLED=true`)
```bash
# issue a card (Tier 2)
curl -sX POST localhost:3001/api/cards -H "Authorization: Bearer $ALEX"
# simulate a purchase — places a hold on funds (Idempotency-Key required)
curl -sX POST localhost:3001/api/cards/<cardId>/authorize -H "Authorization: Bearer $ALEX" \
  -H 'Idempotency-Key: auth-1' -H 'Content-Type: application/json' -d '{"amountMinor":"7500","merchant":"Acme"}'
# cardholder cancels before capture
curl -sX POST localhost:3001/api/cards/authorizations/<authId>/void -H "Authorization: Bearer $ALEX"
# merchant/processor side (admin): capture or refund
curl -sX POST localhost:3001/api/admin/cards/authorizations/<authId>/capture -H "Authorization: Bearer $ADMIN"
curl -sX POST localhost:3001/api/admin/cards/authorizations/<authId>/refund  -H "Authorization: Bearer $ADMIN"
```
- **Verify:** only a masked PAN (••••last4) is returned; authorize **holds** funds (spendable cash drops
  into `card_holds`); capture settles out via `external_clearing` (money gone); void releases the hold
  back; refund returns a captured amount; replaying the auth Idempotency-Key places no second hold;
  over-balance → `INSUFFICIENT_FUNDS`; a frozen account → `ACCOUNT_FROZEN`.

### J9d — Bill pay: payees + scheduled/recurring payments (needs `BILLPAY_ENABLED=true`)
```bash
# save a biller
curl -sX POST localhost:3001/api/billpay/payees -H "Authorization: Bearer $ALEX" \
  -H 'Content-Type: application/json' -d '{"name":"City Power","category":"utility","last4":"4321"}'
# pay now (Idempotency-Key); or schedule with "scheduledFor":"2026-07-01T00:00:00Z" + "recurrence":"monthly"
curl -sX POST localhost:3001/api/billpay/pay -H "Authorization: Bearer $ALEX" \
  -H 'Idempotency-Key: bp-1' -H 'Content-Type: application/json' -d '{"payeeId":"<id>","amountMinor":"9000"}'
curl -sX POST localhost:3001/api/billpay/payments/<id>/cancel -H "Authorization: Bearer $ALEX"  # cancel a scheduled one
# ops due-loop (admin): settle all due scheduled payments
curl -sX POST localhost:3001/api/admin/billpay/process -H "Authorization: Bearer $ADMIN"
```
- **Verify:** pay-now debits `user_cash` via `external_clearing` (visible in `/activity`); replaying the
  Idempotency-Key pays once; over-balance → `INSUFFICIENT_FUNDS`; frozen → `ACCOUNT_FROZEN`; a future-dated
  payment stays `scheduled` until the due-loop settles it; a recurring payment seeds its next instance on send.

### J10 — On-chain wallet (only with `HEDERA_ENABLED=true`)
- **Start:** `/wallet`. Provision a Hedera account → Receive (QR) → Send USDC.
- **Verify:** on-chain transfer posts a matching ledger journal; balances reconcile; settlement is gated
  by the daily reconciliation (`RECONCILIATION_HOLD`) and the signer custody mode (`HEDERA_SIGNER`).
  Without Hedera creds this journey is simulated/skipped.

### J11 — Credentials (DID / Verifiable Credentials)
- **Start:** `/credentials`. View your issued VC; check JWKS at `GET /api/credentials/.well-known/...`.
- **Verify:** VC is RS256-signed by the issuer; revocation flips status (BitstringStatusList) and a
  revoked VC is rejected at the MCP gate (J12).

### J12 — Connected agents & grants (start at `http://localhost:5174`)
- **Start:** the **external agent app** `http://localhost:5174`.
- Link your account (issues a VC + binds the wallet `did:key` + grant), then chat: the app does
  `detectIntent → present/challenge → wallet-signed VP → 90s scoped token → mcp/call`.
- In the portal, **start at `/permissions`** to see/revoke the grant.
- **Verify:** VP signature verified before access; `SCOPE_DENIED` when out of scope; a transfer posts a
  balanced journal; `REPLAY_DETECTED` on a reused nonce/VP; revoking the grant blocks further calls.

### J13 — Admin console (RBAC; start at `http://localhost:5173/admin/login`)
- Log in as **admin@argusfinancial.com**.
- **Verify:** onboarding **review queue** (approve/reject drew/erin/casey), escrow **dispute mediation**,
  MCP-client **suspend**, **reconciliation** view, and the back-office **agent-ops** surface (§3).
  Sensitive actions require `compliance`/`admin` and are written to `audit_logs` with the actor id.

---

## 3. Back-office agent operations (Phase 15) — API + admin

The internal AI agents run on the operations runner. **Invariant: agents recommend; a deterministic,
RBAC-checked, audited gate executes; humans approve anything material.** Drive them via the admin API
(get `$ADMIN` Bearer by logging into `/admin/login` and copying the token, or via `/api/admin/...`).

```bash
ADMIN=<admin bearer>
# KYC review (drafts a recommendation, queues for compliance)
curl -sX POST localhost:3001/api/admin/agent-ops/kyc-review -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"userId":"<casey-id>","fullName":"Casey Morgan","documentNumber":"DOC-9"}'
# generic trigger for any registered skill:
curl -sX POST localhost:3001/api/admin/agent-ops/run -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"skill":"sanctions-rescreen","input":{"userId":"<id>","fullName":"Blocked Person"}}'
curl -sX POST localhost:3001/api/admin/agent-ops/run -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"skill":"compliance-filing","input":{"filingType":"SAR","subjectRef":"acct-1","summary":"structuring"}}'
# review queue + overdue (SLA breaches) + the append-only run trail:
curl -s localhost:3001/api/admin/agent-ops/reviews -H "Authorization: Bearer $ADMIN"
curl -s localhost:3001/api/admin/agent-ops/reviews/overdue -H "Authorization: Bearer $ADMIN"
curl -s localhost:3001/api/admin/agent-ops/runs/<workflowRun> -H "Authorization: Bearer $ADMIN"
# a human (compliance) resolves a queued review:
curl -sX POST localhost:3001/api/admin/agent-ops/reviews/<id>/decision -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"decision":"approve","reason":"verified"}'
```

**Skills to exercise:** `kyc-review` (human-gated tier grant), `sanctions-rescreen` (clean auto-passes;
"Blocked Person" → escalate + 10-day OFAC deadline + human-approved freeze), `compliance-filing`
(SAR 30d / OFAC 10d / CTR 15d, agent-drafted/human-filed), `support-response`, `incident-summary` (SRE),
`marketing-draft` (auto < 1,000 recipients, admin gate ≥ 1,000), `marketplace-dd`.

**Verify:** a queued item appears in the review queue with a `due_at` for compliance items; only
`compliance`/`admin` can resolve sanctions/filing items (support is `FORBIDDEN`); approving a KYC review
grants Tier 2 via the deterministic `completeKycDecision` (the agent never grants); `agent_runs` is
append-only. With `CONDUCTOR_ENABLED`/`TEMPORAL_ENABLED` the same flow runs through that orchestrator
(see §9) and **degrades to in-process** if the server is down.

---

## 4. The fraud system — how it works, logs, and learns

**Architecture (hybrid):** the backend's in-app triage (`fraudService`) classifies each money event and
routes it:
- **Blocking** (`fraudClient.scoreSync` → `POST :4500/v1/events?mode=score`) — waits for an advisory
  score, merges it, then applies a **local deterministic gate** (the engine is advisory; Argus decides).
  Degrades **open** unless `FRAUD_REMOTE_REQUIRED=true`.
- **Fire-and-forget** (`emitAsync` → `POST :4500/v1/events?mode=async`) — no wait. On a **severe** async
  decision the engine calls back `POST :3001/api/internal/remediation/freeze` (service-bearer auth) to
  **freeze** the account → append-only `account_holds` → derived `isAccountFrozen` → new transfers/pays
  hit the `ACCOUNT_FROZEN` gate. Idempotent on `decisionId`.

**Inside the engine (`:4500`):** event bus + schema registry → per-user **feature store** + enrichment →
ensemble (`rules-v1`) + sequence model (`seq-v0`) via a model **registry + serving** with **config-driven
routing + shadow/canary** → append-only **decision** topic → analyst **case queue** → async
**remediation** → **label → retrain** loop that registers shadow candidates.

### How to test the fraud journey
1. Wire the engine (§1.1) and start it (`:4500`). Confirm `curl localhost:4500/health`.
2. Trigger scored events by doing **transfers** in the portal (J3) / SmartChat (J6) — `fraudService`
   screens new, fundable transfers.
3. **Inspect what it logged** (service-bearer = `FRAUD_ENGINE_API_KEY`):
   ```bash
   FK=<FRAUD_ENGINE_API_KEY>
   curl -s localhost:4500/v1/decisions -H "Authorization: Bearer $FK"        # recent decisions
   curl -s localhost:4500/v1/cases     -H "Authorization: Bearer $FK"        # analyst case queue
   curl -s localhost:4500/v1/cases/<id> -H "Authorization: Bearer $FK"
   ```
   Backend side: the append-only `fraud_decisions` table + `fraud_decision_total` / `fraud_remote_call_total`
   / `account_hold_total` metrics at `localhost:3001/metrics`.
4. **See it freeze:** push a severe async event (large/structured velocity) → engine calls back → the
   payer's next transfer returns `ACCOUNT_FROZEN`. Inspect `account_holds`; unfreeze via the engine's
   `/v1/cases/:id/action` or `POST :3001/api/internal/remediation/unfreeze`.
5. **See it learn:** label a decision and retrain:
   ```bash
   curl -sX POST localhost:4500/v1/labels  -H "Authorization: Bearer $FK" \
     -H 'Content-Type: application/json' -d '{"decisionId":"<id>","label":"fraud"}'
   curl -sX POST localhost:4500/v1/retrain -H "Authorization: Bearer $FK"      # registers a shadow candidate
   curl -s   localhost:4500/v1/models      -H "Authorization: Bearer $FK"      # see versions + shadow/canary
   curl -s   localhost:4500/v1/routing     -H "Authorization: Bearer $FK"      # current routing
   curl -sX PUT localhost:4500/v1/routing  -H "Authorization: Bearer $FK" \
     -H 'Content-Type: application/json' -d '{"primary":"rules-v1","shadow":"seq-v0","canaryPct":10}'
   # promote a candidate once it earns trust:
   curl -sX POST localhost:4500/v1/models/<version>/promote -H "Authorization: Bearer $FK"
   ```
   **Verify the learning loop:** label → retrain registers a new shadow model → routing can canary it →
   promotion makes it primary. The decision topic, cases, and `fraud_decisions` are append-only (audit).

> The real Kafka/Flink/Triton/MLflow/lakehouse are the production swap; the interfaces map 1:1. See
> `docs/business/FraudEngine-GapAnalysis.md`.

---

## 5. Backend end-to-end testing (build · start · stop · validate)

```bash
cd backend
# Build / typecheck
npm run typecheck            # tsc --noEmit (run after every change)
npm run build                # compile to dist/ (+ copies SQL migrations)

# Start / stop
npm run dev                  # dev server :3001 (auto-migrates); Ctrl-C to stop
npm start                    # run compiled dist/ (after build)
npm run migrate              # apply migrations explicitly

# Validate — deterministic suite (the money/security invariants + per-phase suites)
npm test                     # vitest run (full suite — currently 223 pass / 3 todo)
npx vitest run e2e           # just the e2e journey suite
npx vitest run test/invariants.test.ts        # money no-float, balanced journals, idempotent replay
npx vitest run test/kms.test.ts test/signer.test.ts   # custody / HSM-signer seam
npx vitest run test/operations.test.ts test/compliance.test.ts test/backoffice-skills.test.ts  # agent ops

# Validate — live orchestration (need the matching server up; see §9)
npm run temporal:live-check  # ops KYC review → Tier 2 through a real Temporal server
npm run conductor:live-check # same through a real Conductor server
npm run money:live-check     # exactly-once transfer through a real Temporal money workflow

# Validate — agent/MCP journeys as a real client (the hybrid layer)
#   invoke the `e2e-validator` skill (scope: through-phase-8 | full) — see docs/E2E-VALIDATION.md
#   it drives SmartChat + external-agent (OID4VP+MCP) and asserts token TTL / MFA / scope / replay.

# Other services
cd ../fraud-engine && npm test        # fraud-engine suite (27 tests)
```

**Stop everything:** Ctrl-C each `npm run dev`; for orchestration containers
`docker rm -f argus-temporal argus-conductor`.

**A clean validation pass (copy/paste):**
```bash
cd backend && npm install && npm run typecheck && npm test && \
cd ../fraud-engine && npm install && npm run typecheck && npm test && \
cd ../frontend && npm install && npm run typecheck
```

---

## 6. Optional: durable orchestration (Temporal + Conductor)

```bash
cd backend
docker compose -f docker-compose.temporal.yml  up -d    # Temporal  (UI :8233)
docker compose -f docker-compose.conductor.yml up -d    # Conductor (UI :5001 — wait ~1 min for ES)
npm run money:worker          # money transfers durable (TEMPORAL_MONEY_ENABLED=true)
npm run conductor:worker      # agent ops via Conductor (CONDUCTOR_ENABLED=true)  [or temporal:worker]
```
With these on, J3/J6 transfers and the §3 agent-ops flows run as durable workflows you can watch in the
Temporal/Conductor UIs. Both **degrade to in-process** if the server is unavailable — the runner never
fails closed. Tear down: `docker rm -f argus-temporal argus-conductor`.

---

## 7. Journey × channel coverage matrix

| Journey | Web (:5173) | SmartChat (:5173 /agent) | External agent (:5174) | Admin (:5173 /admin) | API/MCP |
|---|---|---|---|---|---|
| Auth / onboarding | ✅ J1/J2 | — | link step | review J13 | ✅ |
| Transfer (money) | ✅ J3 | ✅ J6 | ✅ J12 | — | ✅ |
| Invest / Collect | ✅ J4/J5 | — | — | listing lifecycle | ✅ |
| Trading | ✅ J7 | — | — | — | ✅ |
| Escrow | ✅ J8 | — | — | mediation J13 | ✅ |
| Argus Pay | via API J9 | — | `pay_merchant` tool | — | ✅ |
| On-chain wallet | ✅ J10 | — | — | reconciliation | ✅ |
| Credentials/VC | ✅ J11 | — | consumes VC | revoke | ✅ |
| Agent ops (Phase 15) | — | — | — | ✅ §3 | ✅ |
| Fraud | (triggered by money journeys) | ✅ | ✅ | freeze/cases | ✅ §4 |

---

## 8. Where to add agents, skills & MCP services (expansion review)

The runner + scoped-skill + MCP scaffolding makes new capabilities cheap. High-value additions:

**New operations skills** (`backend/src/operations/skills/`, register in `skills/index.ts`) — read/recommend/draft only:
- **Collections / dunning** — drafts outreach for negative balances / failed pays → human send (reuse the support pattern).
- **Dispute/chargeback analyst** — gathers escrow + payment context, recommends a mediation outcome → `compliance` gate (feeds J8/J13).
- **Transaction-monitoring triage** — turns fraud-engine cases into structured dispositions (clear / RFI / freeze / SAR) → routes to `compliance-filing`. (Closes the §6 design item that's currently only sanctions+filing.)
- **Marketplace re-screening** — periodic issuer DD refresh feeding the Phase 8 listing lifecycle.
- **Reconciliation analyst** — drafts an incident from `reconciliation_findings` drift → SRE/compliance.

**New MCP tools for external agents** (`backend/src/routes/mcp.ts`, gated by scope ∩ client ∩ grant):
- `quote_asset` / `subscribe_asset` (read + escrow-gated invest) under a `marketplace:*` scope.
- `escrow_status` / `open_dispute` under `escrow:read` / `escrow:dispute`.
- `statement_export` under `statement:read` (already a tier op) — a common agent ask.
- A **read-only `pay_status`** companion to the existing `pay_merchant`.

**New MCP *servers*** (beyond the in-app tools):
- Wrap each **operations skill** as an internal MCP server so the same scoped toolset is reusable by
  Conductor/Temporal workers and external compliance tooling (the design's "internal skill servers").
- A **fraud-analytics MCP** exposing read-only `get_case` / `get_decision` / `query_blockchain_analytics`
  to analyst agents (maps to the §6 Fraud & AML skill).

**SmartChat intents** (`smartchatService`): add `escrow.hold`, `pay.merchant`, `invest.quote` as
classified intents → operation-token → existing services (mirrors `transfer.send`).

**Orchestration:** add a money **saga** workflow (ledger debit → on-chain settle → reconcile) on the
Temporal money queue — the `src/money/` seam already supports multi-activity workflows.

Each addition should keep the invariants: **money/state via deterministic idempotent services; agents
only recommend/draft; humans gate material actions; every tool scoped + audited.**

---

## 9. Troubleshooting

- **Can't log in with a password** → set `ALLOW_PASSWORD_AUTH=true` and restart; or use a passkey.
- **`ACCOUNT_LOCKED`** → `npm run reset:auth`.
- **`/trade`, Pay, bank, cards, or bill-pay 503** → set the matching `*_ENABLED` flag (`TRADING_ENABLED` / `ARGUS_PAY_ENABLED` / `BANK_RAILS_ENABLED` / `CARDS_ENABLED` / `BILLPAY_ENABLED`).
- **Fraud engine "unreachable, degrading open"** → engine not running or `FRAUD_ENGINE_URL`/key mismatch.
- **Temporal/Conductor "falling back to in-process"** → server not up; start the compose file (§6).
- **CORS errors from :5174** → ensure `CORS_ORIGIN` allows the agent app origin.
- **On-chain journeys skipped** → no Hedera creds; set `HEDERA_*` or accept simulated mode.
```
