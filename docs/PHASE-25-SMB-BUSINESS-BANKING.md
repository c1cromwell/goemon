# Phase 25 — SMB / Small-Business Banking

**Status: DESIGN (not built).** A business-account product line — checking, savings, loans,
payments, payroll, and invoicing — for sole proprietors, LLCs, and small companies. Answers the
**Revolut Business / Mercury / Novel** wedge. Net-new: no business-entity concept exists today.

Ramp: **B → C** (`docs/business/CORPORATE-STRUCTURE.md`). Business deposit accounts ride a **BaaS
partner + FinCEN MSB** (Wave 1, Phase B); business lending as principal is Phase C. This doc names
the exact existing seams each feature extends so the staged build is low-risk. ⚖ counsel-gated.

---

## 1. Vision & principles

Give a small business a real operating account — move money, get paid, pay people and bills, and
borrow against receivables/holdings — with the same **honest-money discipline** as consumer Goemon:
integer minor units, ledger as source of truth, every action audited, no commingling. Agent-native:
a business can grant a scoped agent (bookkeeper AI) the same OID4VP/MCP access consumers use.

Non-negotiables: **never commingle** business customer funds with corporate funds (FBO/escrow only);
**KYB** (know-your-business) + beneficial-ownership (BOI) at onboarding; business is the liable entity.

## 2. Account model — the Business

- **Business** = one legal entity (sole prop / LLC / C-corp) + 1..N **authorized members** (each a
  Tier-2 KYC human) with roles (owner, admin, bookkeeper, employee). Follows the **Household**
  pattern in `docs/PHASE-22-STARTER-TEEN.md` (owner + scoped operators) and the delegation shape of
  `userAgentGrantService.ts` (scoped ceiling + revoke).
- **New primitives:** a `businesses` table; `business_members` (user ↔ business + role); extend
  `identity_profiles` with `account_type ∈ {standard, guardian, minor, business}`. **KYB** verification
  service alongside the existing `identityService` (business registration doc, EIN, BOI).
- **Ledger:** business cash/savings are ordinary ledger accounts (`user_cash`/`user_savings` scoped to
  the business id) — **reuse `ledgerService`**; balances stay derived, never mutated.

## 3. Features → existing seams

| Feature | Reuses | New |
|---|---|---|
| Business **checking** (deposit/withdraw/ACH/wire) | Phase-19 `bankRailService` (`external_clearing` seam) | business-scoped accounts, KYB gate |
| Business **savings / treasury** | Treasury (ATB) + Phase-28 treasury-yield | business holder eligibility |
| **Payments** (pay vendors, get paid) | Phase-21 Goemon Pay (merchant intents + escrow), bill-pay | invoicing layer |
| **Payroll** (batch ACH to employees) | `bankRailService` batch payout | `payroll_runs` (scheduled batch, idempotent per run) |
| **Invoicing / AR** | payment requests (`/api/requests`) + Goemon Pay intents | `invoices` (line items, due dates, status) |
| **Loans** (against receivables/holdings) | Phase-19 `lendingService` (collateralized) | receivables-backed underwriting seam |
| **Cards** (corporate + per-employee) | Phase-19.4 `cardService` + Phase-27 virtual/agent cards | spend policies per member |
| **Bookkeeping agent** | Phase-7 MCP + Phase-15 runner | `business:*` scopes |

## 4. Staged build

- **25.0 — Entity core (Phase A software):** `businesses` + `business_members` + KYB stub (simulated
  provider seam like `IDV_PROVIDER`), RBAC roles, business-scoped ledger accounts. `SMB_ENABLED`
  kill-switch (prod-fatal while simulated).
- **25.1 — Payments & invoicing:** invoices + AR on Goemon Pay / requests; get-paid + pay-vendor flows.
- **25.2 — Checking + payroll:** deposit/withdraw on `bankRailService`; batch payroll payout.
- **25.3 — Cards:** corporate + per-member cards (Phase 27) with spend policies.
- **25.4 — Lending:** receivables/holdings-backed loans on `lendingService`.

## 5. Compliance gate (⚖)
Business deposit accounts / ACH / cards → **BaaS partner + FinCEN MSB + KYB/AML vendor** (Phase B).
Business lending as principal / higher limits → lender-of-record + state licensing (Phase C).
Never commingle; FBO/escrow for all customer-adjacent funds. BOI reporting per FinCEN. Simulated
providers are **prod-fatal** — real partners required before launch.

## 6. Acceptance (when built)
Business onboarding (KYB) → funded business account → send/receive payment → issue an invoice paid by
a customer → run payroll to N employees → open a receivables loan → all balanced at the ledger,
append-only audited, idempotent, with the business (not Goemon) as principal. Tests mirror
`bank-rails.test.ts` / `payments.test.ts` patterns.
