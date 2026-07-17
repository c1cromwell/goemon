---
name: goemon-mcp-test-harness
description: Drive Goemon Global Finance's NL/SmartChat, operation-token exchange, and external-agent (OID4VP + MCP) flows as a real client, asserting token TTL, MFA-gate, and compliance behaviors. Use when validating the SmartChat or external-agent paths end-to-end, or as the client dependency of the e2e-validator skill. Not for money-critical deterministic invariants (those run in vitest).
---

# Goemon Global Finance MCP Test Harness

Executable step-by-step client for AGT journeys J5–J7. Used directly or as the dependency of
**`e2e-validator`**. Implementation: `backend/test/harness/` (see
`docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md`).

Assumes a dev server on `http://localhost:3001` (override with `HARNESS_BASE_URL`).

## How to run (source of truth)

```bash
cd backend
npm run seed:e2e          # migrate + demo users + marketplace
npm run dev               # :3001 — leave running
# other terminal:
npm run harness:j5        # SmartChat + MFA
npm run harness:j6        # OID4VP → MCP
npm run harness:j7        # Marketplace subscribe / compliance
npm run harness:all       # J5 + J6 + J7
npm run harness -- --help
```

Artifacts land under `backend/test/.e2e-artifacts/<runId>/` (`report.json`, `summary.md`,
`transcript.md` — secrets redacted). Exit code 0 = PASS, 1 = FAIL, 2 = misconfig / API down.

Do **not** re-implement these flows by hand in the agent session unless the CLI cannot run;
prefer shelling out to `npm run harness`.

## Flows / assertions

1. **J5 — SmartChat NL → operation token → transfer**
   - NL intent → operation token **TTL ≤ 90s**
   - Amount **> $500** → **MFA gate** before execute; `devMfaCode` in non-prod
   - Execute + `POST /api/smartchat/tokens/:id/execute` replay → **one ledger effect** (integer minor units)

2. **J6 — External agent OID4VP → VP-verify → MCP (security-critical)**
   - VP signature verified against wallet `did:key` before access
   - Wrong key → `VP_INVALID`; replay → `REPLAY_DETECTED`; out-of-scope tool → `SCOPE_DENIED`
   - Scoped token TTL ≤ 90s; in-scope MCP `get_balance` succeeds

3. **J7 — Marketplace subscribe / compliance**
   - Quote fee disclosure as **integer minor-unit strings** (gross / fee / net)
   - Tier-2 escrow subscribe → open order + cash debit
   - Tier-1 subscribe → `COMPLIANCE_BLOCKED`

## Conventions to respect

- Money is **integer minor units**; never parse floats.
- Money-mutating POSTs send an **`Idempotency-Key`**.
- Branch on stable `error.code`.
- Report PASS/FAIL from the CLI exit code + artifact summary to the caller (`e2e-validator`).

## References

- Runbook: `docs/E2E-VALIDATION.md` (§3 journeys J5–J7, §5 automation map)
- Harness README: `backend/test/harness/README.md`
- SmartChat: `backend/src/routes/smartchat.ts`, `backend/src/services/smartchatService.ts`
- External agent / MCP: Phase 7 in `docs/GOEMON-PLAN.md`
