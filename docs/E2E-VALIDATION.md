# Goemon Global Finance — End-to-End Validation Runbook

The single, repeatable validation that exercises whole **user journeys across every channel** — not
per-phase unit invariants (those live in `backend/test/phaseN.test.ts`). Referenced from
`docs/GOEMON-PLAN.md` at two anchors: **sub-step 8.12** (gate after Phase 8, `through-phase-8` scope) and
**Phase 16** (comprehensive pass after the last phase, `full` scope).

> **Status:** Hybrid validation is **executable**. Deterministic floor = `vitest run e2e` (+ phase tests).
> AGT journeys J5–J7 = `npm run harness` (`backend/test/harness/`). Skills (`e2e-validator`,
> `goemon-mcp-test-harness`) are thin wrappers over those commands. Channels still PENDING where noted
> (on-device iOS, live Hedera reconciliation without creds).

---

## 1. Purpose & how to run

**Preconditions**
- `cd backend && npm install`
- Demo seeds: `npm run seed:e2e` (migrations + demo users + marketplace).
- Optional: Hedera testnet creds (`HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`) for on-chain legs;
  without them, chain legs run simulated and ledger⇄chain reconciliation is skipped.

**Run — deterministic floor (always first):**
```bash
cd backend && npm run typecheck && npx vitest run e2e
```

**Run — agent/MCP journeys (AGT, requires live API):**
```bash
cd backend && npm run seed:e2e && npm run dev   # :3001
# other terminal:
cd backend && npm run harness:all               # J5 + J6 + J7
# or: npm run harness:j5 | harness:j6 | harness:j7
```

**Run — full hybrid pass:** invoke the **`e2e-validator`** skill (or run the two blocks above). Scope args:
- `e2e-validator through-phase-8` — 8.12 gate (Phase 0–8 journeys + cross-cutting invariants).
- `e2e-validator full` — Phase 16 comprehensive pass.

Artifacts: `backend/test/.e2e-artifacts/<runId>/` (`report.json`, `summary.md`, `transcript.md`).

Env: `HARNESS_BASE_URL` (default `http://localhost:3001`), `HARNESS_DEMO_EMAIL` / `HARNESS_DEMO_PASSWORD`,
`HARNESS_RECIPIENT_EMAIL`, `HARNESS_TIER1_EMAIL`.

Launch gate: `scripts/launch-gate.sh` runs the harness when the API is up; set `HARNESS_REQUIRED=1` to
fail the gate if the API is down (CI).

---

## 2. Channels under test

| Channel | What it means here | How validated |
|---|---|---|
| **Web** (responsive) | Phase 9 React portal | Playwright `frontend/e2e` + same API the UI uses |
| **Mobile** | Phase 10 iOS wallet (Secure-Enclave, OID4VCI/OID4VP, Hedera send) | `scripts/verify-ios-wallet.sh` compile; on-device smoke manual |
| **Agentic CLI / headless** | SmartChat NL + MCP, no GUI | `npm run harness` (`backend/test/harness/`) |
| **Glasses / minimal-HUD** | text-led rendering of the same IA | validated *as* the CLI/headless text path until a device target exists |

---

## 3. Core journeys

Each journey: **preconditions → steps → expected invariants → automation method**. The "Method" column is
the hybrid split — **DET** = deterministic (`backend/test/e2e.test.ts` + phase tests); **AGT** =
`npm run harness` (documented by the `goemon-mcp-test-harness` skill).

| # | Journey | Phase | Key invariants checked | Method |
|---|---|---|---|---|
| J1 | Onboarding + tiered identity ladder + passkey enrollment | 3 / 5A | tier transitions gated; passkey-first; password only if `ALLOW_PASSWORD_AUTH` | DET |
| J2 | Agentic account opening (risk-adaptive onboarding) | 5A | signal scoring → sub-agent selection; RBAC admin console gated | DET + AGT |
| J3 | DID/VC issuance + revocation | 2 | RS256 VC JWT issued; BitstringStatusList revocation reflected | DET |
| J4 | Cash + on-chain USDC: receive / send / ledger⇄chain mirroring | 4 / 5 | balances derived from ledger; integer minor units; mirror matches | DET (+ chain leg if creds) |
| J5 | SmartChat NL → 90s operation token → transfer, **>$500 MFA gate** | 6 | token TTL ≤ 90s; MFA required above $500; transfer idempotent on token id | AGT (`harness:j5`) |
| J6 | External agent: OID4VP → **VP signature verified** → MCP scoped op | 7 | VP signature verified before access (no exceptions); scope enforced; 90s token | AGT (`harness:j6`) |
| J7 | Marketplace: subscribe (escrow) → hold → compliance-gated transfer | 8 | atomic settlement; fee disclosure; compliance rejection for ineligible holder | DET + AGT (`harness:j7`) |
| J8 | Marketplace: buy / sell (atomic USDC+asset+fee in one journal) | 8 | one journal balances per currency *and* per asset, or reverts; fee disclosed pre-trade | DET |

---

## 4. Cross-cutting invariants (the deterministic floor)

Asserted across journeys, reusing the Phase-14 / per-phase invariants:
- **Money is integer minor units (`bigint`)** everywhere — never float (DB, API, response).
- **Balances derived from the double-entry ledger** — no mutable balance column read.
- **`audit_logs`, `ledger_entries`, `ledger_journals`, `mcp_audit_logs` are append-only** (UPDATE/DELETE blocked).
- **Money-mutating endpoints require `Idempotency-Key`** and replay-collapse to one effect.
- **Verifiable Presentations have their signature verified** against the wallet `did:key` before any access.
- **Errors use a stable `ErrorCode`**; clients branch on `error.code` (incl. `COMPLIANCE_BLOCKED`).

---

## 5. Hybrid automation map

```
                deterministic floor (DET)            agent harness (AGT)
                backend/test/e2e.test.ts             npm run harness
 J1 onboarding         ████                                  ░
 J2 agentic open       ███                                   ██
 J3 DID/VC             ████                                   ░
 J4 cash + USDC        ████ (+ chain if creds)                ░
 J5 SmartChat/MFA       ░                                    ████  harness:j5
 J6 ext agent/MCP       ░                                    ████  harness:j6
 J7 mkt subscribe      ███                                    ███  harness:j7
 J8 mkt buy/sell       ████                                   ░
```
Plus, when Hedera creds are present: the **Phase 15.3 ledger⇄chain reconciliation** daily-job check runs
once at the end and must report zero drift.

---

## 6. Pass / fail reporting

A green run = every **non-PENDING** journey passes its invariants, the deterministic floor is green, and
`npm run harness:all` exits 0. The `e2e-validator` skill emits a report table mirroring §3 (PASS / FAIL /
PENDING per journey) plus §4 invariant results. Artifacts under `backend/test/.e2e-artifacts/`. Any FAIL
on a money-critical invariant (§4) or harness journey blocks the gate.
