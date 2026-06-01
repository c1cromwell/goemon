# BankAI — End-to-End Validation Runbook

The single, repeatable validation that exercises whole **user journeys across every channel** — not
per-phase unit invariants (those live in `backend/test/phaseN.test.ts`). Referenced from
`docs/BANKAI-PLAN.md` at two anchors: **sub-step 8.12** (gate after Phase 8, `through-phase-8` scope) and
**Phase 16** (comprehensive pass after the last phase, `full` scope).

> **Status:** Phases 7–16 are not all built yet. The deterministic suite and the skills are authored
> against the documented contracts; each journey becomes fully exercisable as its phase lands. A journey
> whose phase isn't built yet is marked **PENDING** by the runner and skipped, not failed.

---

## 1. Purpose & how to run

**Preconditions**
- `cd backend && npm install`
- Migrations applied: `npm run migrate` (dev auto-runs them).
- Demo seeds loaded: the Phase 5A demo users and the Phase 8 `seed-marketplace-demo.ts` flows.
- Optional: Hedera testnet creds (`HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`) for the on-chain legs;
  without them, the chain legs run in simulated mode and the ledger⇄chain reconciliation check is skipped.

**Run — deterministic floor (always first):**
```bash
cd backend && npm run typecheck && npx vitest run e2e
```

**Run — full hybrid pass (deterministic + agent/MCP journeys):** invoke the **`e2e-validator`** skill with
a scope arg:
- `e2e-validator through-phase-8` — the 8.12 gate (Phase 0–8 journeys + cross-cutting invariants).
- `e2e-validator full` — the Phase 16 comprehensive pass (all journeys × all channels).

The validator runs the deterministic floor, then drives the NL/agent journeys via the
**`bankai-mcp-test-harness`** skill against a running dev server (`npm run dev` on :3001), and emits a
pass/fail report mapped to the journey table in §3.

---

## 2. Channels under test

| Channel | What it means here | How validated |
|---|---|---|
| **Web** (responsive) | Phase 9 React portal | HTTP flow scripts hit the same API the UI uses; UI smoke is manual until a browser-driver is added |
| **Mobile** | Phase 10 iOS wallet flows (Secure-Enclave signing, OID4VCI/OID4VP, Hedera send) | API-level validation of the build→sign→submit contract; on-device signing is manual |
| **Agentic CLI / headless** | SmartChat NL + MCP, no GUI | `bankai-mcp-test-harness` acts as the client |
| **Glasses / minimal-HUD** | text-led rendering of the same IA | validated *as* the CLI/headless text path until a device target exists (per the "one IA, rendered per channel" rule in Phase 9) |

---

## 3. Core journeys

Each journey: **preconditions → steps → expected invariants → automation method**. The "Method" column is
the hybrid split — **DET** = deterministic (vitest+supertest, `backend/test/e2e.test.ts`); **AGT** =
agent/MCP-driven (`bankai-mcp-test-harness`).

| # | Journey | Phase | Key invariants checked | Method |
|---|---|---|---|---|
| J1 | Onboarding + tiered identity ladder + passkey enrollment | 3 / 5A | tier transitions gated; passkey-first; password only if `ALLOW_PASSWORD_AUTH` | DET |
| J2 | Agentic account opening (risk-adaptive onboarding) | 5A | signal scoring → sub-agent selection; RBAC admin console gated | DET + AGT |
| J3 | DID/VC issuance + revocation | 2 | RS256 VC JWT issued; BitstringStatusList revocation reflected | DET |
| J4 | Cash + on-chain USDC: receive / send / ledger⇄chain mirroring | 4 / 5 | balances derived from ledger; integer minor units; mirror matches | DET (+ chain leg if creds) |
| J5 | SmartChat NL → 90s operation token → transfer, **>$500 MFA gate** | 6 | token TTL ≤ 90s; MFA required above $500; transfer idempotent on token id | AGT |
| J6 | External agent: OID4VP → **VP signature verified** → MCP scoped op | 7 | VP signature verified before access (no exceptions); scope enforced; 90s token | AGT |
| J7 | Marketplace: subscribe (escrow) → hold → compliance-gated transfer | 8 | atomic settlement; escrow refund on cancel; compliance rejection for unregistered recipient | DET + AGT |
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
                deterministic floor (DET)            agent / MCP coverage (AGT)
                backend/test/e2e.test.ts             bankai-mcp-test-harness skill
 J1 onboarding         ████                                  ░
 J2 agentic open       ███                                   ██   (sub-agent narrative)
 J3 DID/VC             ████                                   ░
 J4 cash + USDC        ████ (+ chain if creds)                ░
 J5 SmartChat/MFA       ░                                    ████
 J6 ext agent/MCP       ░                                    ████ (security-critical)
 J7 mkt subscribe      ███                                    ██   (NL "buy ..." path)
 J8 mkt buy/sell       ████                                   ░
```
Plus, when Hedera creds are present: the **Phase 15.3 ledger⇄chain reconciliation** daily-job check runs
once at the end and must report zero drift.

---

## 6. Pass / fail reporting

A green run = every **non-PENDING** journey passes its invariants and the deterministic floor is green.
The `e2e-validator` skill emits a report table mirroring §3 (PASS / FAIL / PENDING per journey) plus the
cross-cutting invariant results from §4. Artifacts (HTTP transcripts, the MCP harness log, the vitest
output) are written under `backend/test/.e2e-artifacts/` for triage. Any FAIL on a money-critical
invariant (§4) blocks the gate regardless of journey-level results.
