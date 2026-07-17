---
name: e2e-validator
description: Run Goemon Global Finance's end-to-end validation pass across user journeys and channels. Use when asked to validate Goemon Global Finance end-to-end, run the E2E suite, execute the Phase 8 validation gate, run the Phase 16 comprehensive validation, or produce a journey × channel pass/fail report. Takes a scope arg (through-phase-8 | full).
---

# Goemon Global Finance E2E Validator

Orchestrates the **hybrid** end-to-end validation defined in `docs/E2E-VALIDATION.md`: a deterministic
floor first, then the executable agent harness (`npm run harness`), then a single pass/fail report.

## Scope

- `through-phase-8` — the **8.12 gate**: journeys J1–J8 (Phase 0–8) + the §4 cross-cutting invariants.
- `full` — the **Phase 16** pass: every journey × every channel in `docs/E2E-VALIDATION.md`, including the
  Phase 15.3 ledger⇄chain reconciliation check when Hedera creds are present.

Default to `full` when Phases 9+ are built (current repo state).

## Procedure

1. **Preconditions.**
   ```bash
   cd backend && npm install
   npm run seed:e2e          # migrate + demo users + marketplace
   ```
   If Hedera creds are absent, note that chain legs run simulated and reconciliation is skipped.

2. **Deterministic floor (always first).**
   ```bash
   cd backend && npm run typecheck && npx vitest run e2e
   ```
   If this fails on any §4 money-critical invariant, stop and report FAIL — the gate is blocked.

3. **Agent/MCP journeys (AGT).** Ensure a dev server is up, then run the code harness:
   ```bash
   cd backend && npm run dev          # :3001 — leave running
   # other terminal:
   cd backend && npm run harness:all  # J5 + J6 + J7
   ```
   Or per journey: `npm run harness:j5` / `harness:j6` / `harness:j7`.
   The thin skill wrapper is `goemon-mcp-test-harness` — it documents assertions; the CLI is authoritative.

4. **PENDING handling.** A journey whose channel isn't built (e.g. on-device iOS) is **PENDING**
   (skipped), not FAIL. J5–J7 AGT are implemented in the harness — they must PASS, not PENDING.

5. **Report.** Emit a table mirroring §3 of `docs/E2E-VALIDATION.md` (PASS / FAIL / PENDING per journey)
   plus §4 invariant results. Point at the latest dir under `backend/test/.e2e-artifacts/`. Any §4 FAIL
   or harness FAIL blocks the gate.

## Fresh-clone path (B3)

```bash
cd backend && npm install && npm run seed:e2e && npm run dev
# other terminal:
cd backend && npm run typecheck && npx vitest run e2e && npm run harness:all
```

## References

- Runbook: `docs/E2E-VALIDATION.md`
- Harness plan: `docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md`
- Plan anchors: `docs/GOEMON-PLAN.md` sub-step 8.12 and Phase 16
- Deterministic suite: `backend/test/e2e.test.ts`
- Harness CLI: `backend/test/harness/` (`npm run harness`)
