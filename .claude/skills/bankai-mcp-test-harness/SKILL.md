---
name: bankai-mcp-test-harness
description: Drive BankAI's NL/SmartChat, operation-token exchange, and external-agent (OID4VP + MCP) flows as a real client, asserting token TTL, MFA-gate, and compliance behaviors. Use when validating the SmartChat or external-agent paths end-to-end, or as the client dependency of the e2e-validator skill. Not for money-critical deterministic invariants (those run in vitest).
---

# BankAI MCP Test Harness

A thin client for exercising the genuinely NL- and client-driven paths that the deterministic vitest suite
can't cover well. Used directly or as the `bankai-mcp-test-harness` dependency of **`e2e-validator`**.

Assumes a dev server on `http://localhost:3001` (see `docs/BANKAI-PLAN.md` Ports).

## Flows it drives

1. **SmartChat NL → operation token → transfer (J5).**
   - POST a natural-language intent to the SmartChat endpoint; assert intent classification.
   - Assert the issued **operation token TTL ≤ 90s** (RS256) and that it's keyed for one operation.
   - For an amount **> $500**, assert the **MFA gate** is required before the transfer executes.
   - Execute the transfer via the token; replay with the same token id and assert **idempotent** (one effect).

2. **External agent: OID4VP → VP-verify → MCP scoped operation (J6, security-critical).**
   - Present a Verifiable Presentation; assert the server **verifies the VP signature against the wallet
     `did:key` before any access** — a tampered/unsigned VP must be rejected (no exceptions).
   - Assert the granted scope is enforced (an out-of-scope MCP call is denied) and the operation token
     expires at 90s.

3. **Marketplace NL "buy / subscribe" path (J7).**
   - Drive a natural-language purchase/subscribe; assert it lands on the same ledger/compliance path as the
     deterministic J7/J8, and that a securities transfer to an unregistered recipient returns
     `COMPLIANCE_BLOCKED` with a clear reason.

## Conventions to respect

- Money is **integer minor units**; format only for display, never parse floats.
- Money-mutating POSTs send an **`Idempotency-Key`**.
- Report per-assertion PASS/FAIL back to the caller (the `e2e-validator` skill aggregates them); write a
  transcript to `backend/test/.e2e-artifacts/`.

## References

- Runbook: `docs/E2E-VALIDATION.md` (§3 journeys J5–J7, §5 automation map)
- SmartChat: Phase 6 — `backend/src/routes/smartchat.ts`, `backend/src/services/smartchatService.ts`
- External agent / MCP + VP verification: Phase 7 (security-critical) in `docs/BANKAI-PLAN.md`
