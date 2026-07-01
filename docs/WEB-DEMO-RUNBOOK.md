# Goemon Global Finance — Full-Feature Web Demo Runbook

A single, web-only walkthrough that exercises **every** customer-portal feature with seeded
users and products, so nothing looks empty. This is the *demo* companion to the test-matrix in
`E2E-UX-TEST-GUIDE.md` and the automated gate in `E2E-VALIDATION.md`.

- **Scope:** the React portal (`frontend/`, :5173) over the Express API (`backend/`, :3001).
- **Money is simulated** — every provider (bank, cards, on/off-ramp, FX, treasury, lending)
  runs in its dev/simulated mode. No real funds, no external accounts.
- **On-chain wallet** (`/wallet`) is **off by default**; see **Appendix C** to make it live on
  Hedera testnet.

> **Verified:** the setup below was run end-to-end and all 22 feature surfaces returned live
> (no `*_DISABLED`) with seeded data populated. See **Appendix A** for the matrix.

---

## 1. One-time setup

### 1.1 Backend env — enable every feature (dev only)
The full-feature flags are already applied to `backend/.env` (block headed
`FULL-FEATURE WEB DEMO`). They are **prod-fatal by design** and safe only because
`NODE_ENV=development`. If you start from a fresh `.env`, add:

```dotenv
NODE_ENV=development
ALLOW_PASSWORD_AUTH=true
# money rails (simulated)
BANK_RAILS_ENABLED=true
BANK_RAIL_PROVIDER=simulated
CARDS_ENABLED=true
BILLPAY_ENABLED=true
ONRAMP_ENABLED=true        # ONRAMP_PROVIDER=simulated
OFFRAMP_ENABLED=true       # OFFRAMP_PROVIDER=simulated
LENDING_ENABLED=true
TREASURY_ENABLED=true
# markets & assets (prototype seams)
TRADING_ENABLED=true
EQUITIES_ENABLED=true
CREATOR_DROPS_ENABLED=true
COLLECTIBLES_ESCROW_ENABLED=true
# FX
FX_ENABLED=true            # FX_RATE_PROVIDER=simulated
FX_SETTLEMENT_ENABLED=true
# payments
GOEMON_PAY_ENABLED=true
CHECKOUT_VP_ENABLED=true
# family
TEEN_ENABLED=true
TEEN_CREDIT_BUILDER_ENABLED=true
TEEN_CUSTODIAL_ENABLED=true
# on-chain stays off (see Appendix C)
HEDERA_ENABLED=false
```

### 1.2 Seed users + products
```bash
cd backend
npm install                 # first time only
npm run seed:demo           # = setup + seed:marketplace + seed:products (idempotent-ish*)
```
`seed:demo` creates the admin/CEO accounts + simulator MCP client + 5 demo users
(`npm run setup`), the two original marketplace assets (`seed:marketplace`), and the
**enriched products + named-user holdings** (`seed:products`, new in this runbook).

> *\*Re-running note:* `seed:marketplace` is **not** idempotent (it adds fresh assets each
> run). For a clean re-seed, reset the DB first — see **§5**.

### 1.3 Start both servers
```bash
# terminal 1
cd backend && npm run dev          # API on http://localhost:3001 (migrations auto-run in dev)
# terminal 2
cd frontend && npm run dev         # portal on http://localhost:5173
```
Health check: `curl localhost:3001/api/health` → `{"status":"ok",...}`. Open
**http://localhost:5173**.

---

## 2. Cast of demo users

All passwords are `Demo1234!`. (Password auth is dev-only; passkeys also work — see Act 1.)

| Login | Tier | Cash | Pre-seeded state | Best for demoing |
|---|---|---|---|---|
| **blair@demo.com** | 2 | ~$32k* | $5k Treasury (3k pledged), **open $1k loan**, 20 GREEN units, a creator drop | **Invest, Earn, Borrow, Drops, Pay, Agent** |
| **alex@demo.com** | 2 | ~$12.5k | owns 1× JORDAN86 collectible | Everyday money, **Collect**, SmartChat, Console |
| **casey@demo.com** | 1 | $3k | rejection doc `1` | Onboarding tier-1, **KYC rejection** |
| **drew@demo.com** | 0 | $750 | rejection doc `2` | Fresh signup, **tier ladder 0→2** |
| **erin@demo.com** | 0 | $250 | rejection doc `3` | Fresh signup, rejection |
| **admin@goemonglobal.com** | — | — | RBAC admin (`Admin1234!`) | **Admin console** (Act 8) |

\*blair's cash is below $40k because the seed spent it on Treasury, the loan disbursed $1k
back, and the GREEN subscription. Exact numbers show in the UI.

**Seeded products:** Invest → `GREEN` ($25), `OAK` ($100), `MAPLE` ($50, accredited-gated);
Collect → `JORDAN86` ($890), `ZARD99` ($2,400), `MANTLE52` ($19,500), `FLEER57` ($1,240);
Treasury `ATB` (par $1.00, ~4.5% APY); Drop → "Goemon Genesis — Founders Edition".

---

## 3. The demo flow (8 acts)

Each step is **page → action → what to point out / verify**. Cherry-pick acts for a short
demo; run all eight for the full tour. Money always moves in **integer minor units** and shows
up in **Activity**.

### Act 1 — Identity & onboarding
1. **/register** → create a throwaway account (email + password) → optionally **enroll a
   passkey** (Face ID / Touch ID / device PIN). *Point out:* passkey-first; the password form
   only appears because `ALLOW_PASSWORD_AUTH=true`.
2. **/login** → sign in as **drew@demo.com**. → **/onboarding**: walk the **tier ladder**
   0 → 1 (add phone) → 2 (legal name + DOB + country → KYC pass). *Verify:* progress ring
   advances; Agent/Console/Starter unlock at Tier 2.
3. **Rejection demo:** log in as **casey** (or drew/erin), start onboarding, submit the
   user's assigned **doc number** (casey=1, drew=2, erin=3) → KYC **rejected** with a reason.
4. **/credentials** → issue a W3C Verifiable Credential; show/hide the JWT; revoke it.

### Act 2 — Everyday money (login: alex)
1. **/** (Dashboard) → balance, tier dots, recent activity, quick actions.
2. **Dashboard → Send / SmartChat** → P2P transfer alex → blair (small amount). *Verify:* both
   balances move; **/activity** shows the entry; Idempotency-Key auto-attached.
3. **/requests** → create a request-to-pay; pay a received one.
4. **/bank** → **deposit** (ACH on-ramp) then **withdraw** (ACH/wire); show linked accounts +
   statement. *Verify:* transfer rows with settlement status.
5. **/cards** → issue a debit card → **authorize** a purchase (hold) → **void** it. *Verify:*
   the hold appears then releases.
6. **/bills** → save a payee → **pay now** and **schedule** a recurring one → cancel it.
7. **/send-abroad** → cross-border quote → send (native rail). **/fx** → quote **USD→USDC** (or
   USDT) → convert. *Note:* only USD/USDC/USDT are enabled currencies.

### Act 3 — Get money on / off the rail (login: blair)
1. **/add-cash** → enter USD → live quote (fee disclosed) → **Buy USDC** (simulated instant
   delivery). *Verify:* USDC credited net of the 1% fee.
2. **/earn** → Treasury position already shows (~$2,000 ATB, ~4.5% APY); **Move to Treasury**
   to buy more, or **Redeem** some. Show the yield-distribution history.
3. **/borrow** → blair already has an **open $1,000 loan** against $3,000 ATB; show the
   **health bar**, then **repay** inline. Open a new loan to show borrowing-power quote.
4. **/cash-out** → enter USDC → live quote → **Cash out** to fiat (simulated).

### Act 4 — Invest & Collect
1. **/invest** (blair) → three listings (GREEN, OAK, MAPLE). Open **GREEN** → **AssetDetail** →
   **Subscribe** (escrow) → it closes → units land in portfolio. *Verify:* MAPLE shows
   accredited/Tier-2 gating; a Tier-1 user is blocked.
2. **/collect** (alex) → four graded slabs; alex already **owns JORDAN86**. Buy another → then
   **transfer** to a friend (no compliance gate for collectibles).
3. **/collect/sell** → list a slab (cert verify → comps → human review queue).
4. **/drops** → Browse shows "Goemon Genesis — Founders Edition" → **claim** one; or **Create**
   your own limited edition.
5. **/pay** (Goemon Pay) → register a merchant → create a payment **intent** → pay it
   (escrow-protected) → capture. *Point out:* zero interchange, escrow-backed.
6. **/escrow** → as payer create → **release**; or **dispute** (admin resolves in Act 8).

### Act 5 — Agents (the differentiator)
1. **/agent** (SmartChat, Tier 2) → type *"what's my balance?"* then *"send $20 to
   alex@demo.com"* → 90-second operation-token countdown → confirm. Then *"send $750 to
   alex@demo.com"* → **>$500 triggers the MFA gate**. *Verify:* no money moves without the
   token + MFA.
2. **/console** → same agent as a terminal: `balance`, `history`, `pay`, `send`, `help`.
3. **/agents** (Internal agents) → create a scoped automation agent with a per-transfer limit.
4. **/permissions** (Connected agents) → grant an external agent access (DID + allowed
   functions + ceiling); revoke it. *(The external-agent OID4VP+MCP round-trip itself lives in
   the `goemon-agent/` app on :5174 — out of scope for this portal-only runbook; see
   Appendix B.)*

### Act 6 — Family (login: blair, Tier 2)
1. **/starter** (guardian) → create a household → invite a teen → set a daily spend limit →
   approve/decline a teen transaction.
2. **/starter/teen** → teen view: balance, daily limit, **request money** from parent.

### Act 7 — Trust & exit
1. **/self-custody** → what's yours (non-custodial keys) vs. what's custodial (cash);
   **export** the signed portable record (right-to-exit, no lock-in).
2. **/wallet** → shows the **"not enabled"** state by design (Hedera off). To make it live —
   Receive QR, Send, on-chain settlement — follow **Appendix C**.

### Act 8 — Admin (login: admin@goemonglobal.com at /admin/login)
1. **/admin** → identities list + decision trail; **review queue** → approve/reject a pending
   KYC (drives the Act-1 rejection demo).
2. **Escrow disputes** → resolve (release/refund) the dispute opened in Act 4.
3. **/admin/approvals** → CEO operation approvals + model registry.
4. **/admin/collectibles** → approve/reject the slab listed in Act 4.

---

## 4. Verification checkpoints (what "passing" looks like)

| Invariant | How to see it | Where |
|---|---|---|
| Money is integer minor units | balances/quotes never show float drift | every money page |
| Double-entry ledger is the source of truth | a transfer debits one, credits another, nets zero | /activity + admin |
| Append-only audit | actions appear in Activity and can't be edited | /activity |
| Idempotency on money POSTs | re-submitting the same action doesn't double-charge | Bank/Cards/SmartChat |
| 90s operation token + MFA >$500 | SmartChat gates the large transfer | /agent |
| Compliance gating | MAPLE blocks a Tier-1 recipient (`COMPLIANCE_BLOCKED`) | /invest → AssetDetail |
| Fraud freeze path | a flagged event can freeze an account (`ACCOUNT_FROZEN`) | see `E2E-VALIDATION.md` §4 |

Deeper invariant detail + curl probes: `docs/E2E-VALIDATION.md` §4.

---

## 5. Reset / re-run

Because `seed:marketplace` adds fresh assets each run, reset the DB for a clean demo:
```bash
cd backend
# stop the dev server first, then:
rm -f data/goemon.db data/goemon.db-shm data/goemon.db-wal
npm run seed:demo
npm run dev
```
Auth lockout during testing? `npm run reset:auth`.

---

## Appendix A — Feature / flag matrix (verified live)

Every row below was confirmed returning a live response (not `*_DISABLED`) with the demo `.env`.

| Portal page | API surface | Flag | Live in demo |
|---|---|---|---|
| Dashboard / Activity | `/marketplace/portfolio`, `/activity` | — | ✅ |
| Invest / Collect / AssetDetail | `/marketplace/*` | — | ✅ |
| Agent / Console | SmartChat token exchange | — (Tier 2) | ✅ |
| Bank | `/bank/*` | `BANK_RAILS_ENABLED` | ✅ |
| Cards | `/cards/*` | `CARDS_ENABLED` | ✅ |
| Bills | `/billpay/*` | `BILLPAY_ENABLED` | ✅ |
| Add Cash | `/onramp/*` | `ONRAMP_ENABLED` | ✅ |
| Cash Out | `/offramp/*` | `OFFRAMP_ENABLED` | ✅ |
| Earn | `/treasury/*` | `TREASURY_ENABLED` | ✅ |
| Borrow | `/lending/*` | `LENDING_ENABLED` | ✅ |
| Trade | `/trading/*` | `TRADING_ENABLED` | ✅ |
| FX | `/fx/*` | `FX_ENABLED` / `FX_SETTLEMENT_ENABLED` | ✅ (USD/USDC/USDT) |
| Pay | `/pay/*` | `GOEMON_PAY_ENABLED` | ✅ |
| Drops | `/drops/*` | `CREATOR_DROPS_ENABLED` | ✅ |
| Requests | `/requests/*` | — | ✅ |
| Send Abroad | `/cross-border/*` | — | ✅ |
| Escrow | `/escrow/*` | — | ✅ |
| Starter (family) | `/starter/*` | `TEEN_ENABLED` | ✅ |
| Self-custody / Credentials | `/self-custody`, `/credentials` | — | ✅ |
| **On-chain Wallet** | `/hedera/*` | `HEDERA_ENABLED` | ⛔ off (Appendix C) |

---

## Appendix B — Optional automated cross-check

Not required for the manual demo, but to validate the agent/MCP paths deterministically:
- `e2e-validator full` — runs the vitest floor + agent harness, writes a journey×channel table.
- `goemon-mcp-test-harness` — drives SmartChat NL + external-agent OID4VP/MCP as a real client.
- External-agent app: `cd goemon-agent && npm run dev` (:5174) for the live OID4VP→MCP round-trip.

---

## Appendix C — Make the on-chain wallet live (Hedera testnet)

`/wallet` (Receive QR, Send, on-chain USDC settlement) needs a Hedera operator account.
**Testnet only — no real value.**

1. **Create a testnet account:** go to the **Hedera Portal** → https://portal.hedera.com →
   sign up → create a **testnet** account. You'll get an **Account ID** (`0.0.xxxxx`) and a
   **private key** (use the **ECDSA** or **ED25519** key the portal issues; the portal funds it
   with test HBAR automatically).
2. **Set the operator creds** in `backend/.env`:
   ```dotenv
   HEDERA_ENABLED=true
   HEDERA_NETWORK=testnet
   HEDERA_OPERATOR_ID=0.0.xxxxx
   HEDERA_OPERATOR_KEY=<the testnet private key>
   ```
   *Dev note:* a **raw** operator key is accepted in development. In production the key must be
   vault-wrapped (`gcm.v1.…`, see `config.ts` and `npm run wrap-secret`) — not needed for the
   testnet demo.
3. **USDC test token:** set `HEDERA_USDC_TOKEN_ID` to a testnet token id. Options:
   - Use an existing Hedera **testnet USDC** token id if you have one; **associate** your
     operator account to it; or
   - Create your own HTS test token via the Portal / SDK and use its id (it just needs to be a
     fungible token the demo can transfer). Leave unset to provision Hedera accounts without a
     USDC token bound.
4. **Restart the backend.** Now **/wallet** provisions a Hedera account (network fee sponsored
   by the operator/paymaster), shows the **Receive QR**, and **Send** posts a real testnet
   transfer mirrored into the ledger. The non-custodial build/submit path
   (`HEDERA_SIGNER=ondevice`) is also available for a device-signed flow.

⚠ Keep testnet creds out of git. Never put a mainnet key in `.env`.
