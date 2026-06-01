---
name: e2e-validator
description: Run BankAI's end-to-end validation pass across user journeys and channels. Use when asked to validate BankAI end-to-end, run the E2E suite, execute the Phase 8 validation gate, run the Phase 16 comprehensive validation, or produce a journey × channel pass/fail report. Takes a scope arg (through-phase-8 | full).
---

# BankAI E2E Validator

Orchestrates the **hybrid** end-to-end validation defined in `docs/E2E-VALIDATION.md`: a deterministic
floor first, then agent/MCP-driven journeys, then a single pass/fail report.

This skill is the thing a human (or you) invokes. It depends on the **`bankai-mcp-test-harness`** skill to
drive the NL/SmartChat and external-agent (OID4VP+MCP) journeys as a real client.

## Scope

- `through-phase-8` — the **8.12 gate**: journeys J1–J8 (Phase 0–8) + the §4 cross-cutting invariants.
- `full` — the **Phase 16** pass: every journey × every channel in `docs/E2E-VALIDATION.md`, including the
  Phase 15.3 ledger⇄chain reconciliation check when Hedera creds are present.

Default to `through-phase-8` if no scope is given and Phases 9+ are not yet built.

## Procedure

1. **Preconditions.** Confirm `backend/` deps installed, migrations applied (`npm run migrate`), and demo
   seeds loaded (Phase 5A users + Phase 8 `seed-marketplace-demo.ts`). If Hedera creds are absent, note
   that chain legs run simulated and the reconciliation check is skipped.
2. **Deterministic floor (always first).** Run `cd backend && npm run typecheck && npx vitest run e2e`.
   If this fails on any §4 money-critical invariant, stop and report FAIL — the gate is blocked.
3. **Agent/MCP journeys.** Ensure a dev server is up (`npm run dev` on :3001). Use the
   `bankai-mcp-test-harness` skill to drive J5 (SmartChat NL → 90s token → transfer, incl. the >$500 MFA
   gate), J6 (external agent OID4VP → VP-verify → MCP scoped op), and the NL "buy/subscribe" path of J7.
4. **PENDING handling.** A journey whose phase isn't built yet is **PENDING** (skipped), not FAIL.
5. **Report.** Emit a table mirroring §3 of `docs/E2E-VALIDATION.md` (PASS / FAIL / PENDING per journey)
   plus §4 invariant results. Write artifacts under `backend/test/.e2e-artifacts/`. Any §4 FAIL blocks the
   gate regardless of journey-level results.

## References

- Runbook & journey definitions: `docs/E2E-VALIDATION.md`
- Plan anchors: `docs/BANKAI-PLAN.md` sub-step 8.12 and Phase 16
- Deterministic suite: `backend/test/e2e.test.ts`
- Per-phase invariants to reuse: `backend/test/phaseN.test.ts`
