# Phase 27 — Virtual & Credit Cards (Customer & Agent-Issued)

**Status: DESIGN (not built).** Extends the Phase-19.4 debit-card seam into: **virtual cards**
(instant, disposable, merchant-locked), a consumer **credit** card (revolving), and
**agent-issued programmable cards** — a card an AI agent can mint under a scoped, revocable grant
with its own limits and burn-after-use. Answers Revolut disposable virtual cards + Robinhood/Apple
credit + a net-new agent-commerce primitive.

Ramp: virtual **debit** cards ride the Phase-19.4 card processor (**Phase B**); the **credit** card
needs a lender/BIN-sponsor + bureau reporting (**Phase C**). ⚖ counsel-gated.

---

## 1. What's built vs new
- **Built (Phase 19.4):** `cardService` + swappable `CardProcessor` (simulated; marqeta/lithic/stripe
  stubs); auth → capture / void / refund as ledger holds (`card_holds`), masked PAN (last4), freeze +
  balance + fraud gates, idempotent, `CARDS_ENABLED`. This is the substrate — reuse it.
- **New here:** virtual-card issuance, credit accounts, and **agent-issued cards** with per-agent
  programmable controls.

## 2. Card types

| Type | What | Backing | Reuses |
|---|---|---|---|
| **Virtual debit** | Instant card number, spend from cash; single-use / merchant-locked / expiry options | `user_cash` (debit, existing) | `cardService` + controls |
| **Consumer credit** (revolving) | A credit line; monthly statement + minimum payment; interest; reports to bureaus | `credit_line` liability account + `lendingService` mechanics | Phase 19.4 + 22.4 credit-builder seam |
| **Agent-issued programmable** | An agent mints a card under a grant, with its own ceiling, allowlist, TTL, single-use | `user_cash` (or a sub-budget) via a scoped grant | Phase-7 MCP grants + `cardService` |

## 3. Programmable controls (all card types)
A `card_controls` record: per-card **spend limit**, **merchant/category allowlist**, **expiry / single-use
(burn after one auth)**, **velocity** (max N/day). Enforced deterministically in `cardService.authorize`
alongside the existing freeze/balance/fraud gates. Agent-issued cards inherit the **grant ceiling ∧ card
control** (double-bound, like MCP transfer ceilings).

## 4. Agent-issued cards — the new primitive
- A user grants an agent `card:issue` scope with a **budget ceiling** (Phase-7 grant, revocable, VP-verified).
- The agent calls a new MCP tool `issue_card` → mints a **virtual, single-use or budget-capped** card
  bound to that grant; spend can never exceed `grant ceiling ∧ card control ∧ cash balance`.
- Every issuance + authorization is append-only audited (`mcp_audit_logs` + `card_authorizations`);
  revoking the grant kills the card. **Liability model** (who owns agent-issued spend) is the key ⚖
  question — a scoped, user-funded, capped virtual card keeps the user as principal.

## 5. Staged build
- **27.0 — Virtual debit:** issuance + `card_controls` (limit/allowlist/single-use/expiry) on `cardService`.
  `VIRTUAL_CARDS_ENABLED` (prod-fatal while simulated).
- **27.1 — Agent-issued cards:** `card:issue` scope + `issue_card` MCP tool, grant-∧-control bound.
- **27.2 — Consumer credit:** `credit_line` accounts, statement close/min-payment/interest (reuse
  `lendingService` + 22.4 bureau-reporting seam), autopay via bill-pay. `CREDIT_CARD_ENABLED` (prod-fatal).

## 6. Compliance gate (⚖)
Virtual debit → card processor + BIN sponsor + PCI scope (Phase B, same as Phase 19.4). Credit card →
**lender of record + BIN sponsor + Reg Z / TILA disclosures + credit-bureau furnisher agreement + fair-lending
(ECOA)** (Phase C). Agent-issued cards → clarified liability + consumer-protection posture. Simulated
processors are **prod-fatal**.

## 7. Acceptance (when built)
Issue a virtual single-use card → one authorization succeeds, a second is declined by control → void
releases the hold → all balanced at the ledger, append-only audited. Agent mints a budget-capped card
under a grant → spend caps at `grant ∧ control ∧ balance` → revoking the grant disables the card. Credit:
a purchase draws the line, statement closes, min payment + interest post as balanced journals.
