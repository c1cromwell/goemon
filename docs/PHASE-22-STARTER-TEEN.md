# Phase 22 — Argus Starter (13+ family/teen wealth-building suite)

**Status: DESIGN (not built).** Production-ready, scalable design for a full-suite starter product for the
**13+ age group**: a teen **debit card**, a **credit-builder card**, **high-yield savings**, and **custodial
investing** — all **gamified to teach how to build wealth**. (Working name "Argus Starter" — placeholder.)

This doc is the senior-eng + design/UX blueprint. It names the exact existing seams each feature extends so
the staged build (§14) is low-risk, and it states the legal posture a compliance/consumer-finance/securities
counsel must sign off on before any production launch.

---

## 1. Vision & principles

Give a teenager (and their guardian) a real account that **teaches wealth-building by doing it** — spend
responsibly, save toward goals, build credit habits, and invest for the long term — with guardrails that keep
it safe and a guardian in control.

Design principles (non-negotiable):
- **Teach, don't exploit.** Gamification motivates *saving and learning* — never overtrading, debt, or
  compulsive engagement. No gambling/lootbox mechanics, no "spend to win," no day-trading nudges.
- **Guardian-owned, teen-operated.** The guardian owns and is liable; the teen operates within guardian-set
  controls. Trust + autonomy in balance — autonomy grows as the teen demonstrates good habits.
- **Honest money.** Integer minor units, ledger as source of truth, every action audited — the same
  discipline as the rest of Argus. Fees and APY shown plainly; no dark patterns (CFPB/UDAAP).
- **Privacy-first for minors.** Data minimization, no third-party ad targeting of minors, parental consent.

## 2. Account model — the Household

The architecture is driven by the legal reality that a 13–17 user is a **minor**: they cannot independently
hold deposit/brokerage/credit accounts or enter binding contracts. So:

- **Household** = one **guardian** (adult, Tier-2 KYC, the legal owner and liable party) + **1..N teens**
  (minors, DOB-verified, passkey login, scoped/controlled access). The household is the tenancy + billing
  unit.
- **New primitives** (net-new — none exist today): a `households` table; a guardian↔teen link expressed by
  extending `identity_profiles` (`backend/src/services/identityService.ts`) with `account_type ∈
  {standard, guardian, minor}`, `guardian_user_id`, `dob`, `is_minor`. The guardian↔teen control relationship
  follows the shape of `userAgentGrantService.ts` (scoped delegation + ceiling + revoke).
- **Minor tier policy.** Teens still climb the identity ladder, but `TIER_OPS` is **overridden for minors** —
  a minor never gets `transfer:high` or `lending:read` regardless of tier; money-out is guardian-gated.
- **Onboarding.** Guardian onboards first (reuse the agentic onboarding + KYC). Guardian then creates teen
  sub-profiles (no independent KYC for the minor; guardian attests + provides DOB). Teen sets a passkey.

## 3. Teen debit card

Extends `cardService.ts` / migration 018 / `routes/cards.ts` (the auth→capture/void/refund lifecycle on the
`card_holds` system account, `CardProcessor` provider seam).

- New `card_type='teen_debit'`, `guardian_user_id` on the card; funded from the household (guardian transfers
  / allowance).
- **Guardian spend controls** — a new **spend-limit policy gate** (daily / weekly / monthly + per-category
  limits + merchant blocks) that slots into the existing money-out gate sequence *alongside* the freeze
  (`accountHoldService.isAccountFrozen`) and fraud (`fraudService.screenTransfer`) gates in `authorize()`.
- **Real-time approval** — an over-limit or blocked authorization escalates to the guardian via the
  operations human-gate (`operationsWorkflow` → `agent_reviews`, `requires_role='guardian'`) with a push;
  guardian approves/denies in-app.
- **Instant freeze** (`placeHold` with `source='guardian'`), activity visible to teen + guardian.

## 4. Credit-builder card

A real revolving credit card is not legal for a minor (must be 18, or 21 under the CARD Act). The
teen-appropriate analog is a **guardian-funded credit-builder (secured/charge) card** that builds a real
credit history (the Step model). Extends `cardService` with `card_type='credit_builder'`.

- Guardian funds a **secured limit**; the teen spends within it (same auth/hold lifecycle as debit).
- A monthly **statement cycle** closes the period; **autopay** posts the "payment" from the household funds
  (reuse the bill-pay scheduling pattern).
- A new **`CreditBureauReporter` provider seam** (simulated default; a real reporting bureau partner in prod)
  reports **on-time payments + utilization** to build the teen's file. Guardian is the liable account holder;
  CARD-Act-aware disclosures.
- **Teaches** the two habits that drive a real score: pay on time, keep utilization low. The gamification
  surfaces both.
- **Partner/legal-gated** (bureau-reporting partner + consumer-credit counsel) for production.

## 5. High-yield savings + goals/vaults

The ledger already has a **`user_savings`** account kind (`ledgerService.ts`, `getUserBalances`→{cash,savings})
— but **no interest engine exists**.

- **`interestAccrualService` (new)** — APY in basis points, daily accrual, periodic post from a new
  `interest_source` system account, **idempotent per (account, period)** — mirrors the per-holder idempotent
  posting in `corporateActionService.distributeDividend`. Run as a Temporal batch job.
- **Goals / vaults** — named savings sub-accounts (e.g., "Concert", "First car") with a progress ring;
  **round-ups** (spare change from debit spend swept to a goal); **guardian match** (e.g., match 50% of what
  the teen saves — the strongest wealth-habit lever). Guardian-lock on teen withdrawals from savings.
- High-yield framing is education: compounding visualized over time ("save $10/week → …").

## 6. Custodial investing (UGMA/UTMA, real)

Investing for a minor is done through a **custodial account** the guardian owns (UGMA/UTMA); the teen learns
and proposes, the guardian approves. Reuses `marketplaceService.placeOrder` (atomic cash+asset+fee journal,
**fractional** via `decimals`), Phase-18.6 equities (`equityIssuerService`/`redemptionService`/
`corporateActionService`), and Phase-17 `tradingService`.

- The custodial account is guardian-owned; the teen places **fractional** orders that **require guardian
  approval** (human-gate) before they settle on the rails.
- **Dividend pass-through** + optional auto-reinvest (teaches compounding).
- **Education-first**: explain risk, diversification, long-term horizon; **no day-trading mechanics**, no
  leverage, no options for minors.
- **Partner/legal-gated** for production: a custodial broker-dealer + transfer agent (the Phase-18 stack).

## 7. Gamification engine — teach wealth-building

Extends the Phase-9 "quiet gamification" scaffold (`TierLadder`, `ProgressRing`, streak dot, `lib/tiers.ts`).

- **Quests** — verify, set your first goal, save your first $, finish a lesson, set up round-ups.
- **Streaks** — daily check-in / save streak (a new append-only `user_streaks` tick).
- **Badges / milestones** — saved $100, 4-week streak, first dividend, on-time credit habit.
- **Net-worth journey** — a single honest visualization of cash + savings + investments growing over time
  (the product's north-star metric, derived from the ledger).
- **Learn-and-earn** — short age-appropriate lessons + quizzes; small rewards (guardian-funded) for completion.
- **Allowance / chores** — automated recurring allowance + chore→reward (reuse bill-pay scheduling/recurrence).
- **Anti-pattern rules (enforced in design review):** no gambling/lootbox/variable-reward mechanics; no
  rewards for trading frequency or volume; no incentives that encourage debt or overspending.

## 8. Agentic money coach

A teen-facing AI coach built as a **read / recommend / draft** skill (`operations/skillRegistry.ts` +
`skills/`) and/or a SmartChat persona (`smartchatService.ts`):

- `analyze_spending` (read), `recommend_savings_goal` (recommend), `draft_money_lesson` (draft), nudges.
- **Guardian-visible**: coach insights surface on the guardian dashboard.
- **Never executes money.** Every actionable suggestion becomes a teen-request → guardian-gate, or an
  educational nudge. Age-appropriate tone; no upsell.

## 9. Guardian experience

- **Dashboard** — per-teen balances, activity, coach insights, goal progress, the net-worth journey.
- **Controls** — set/adjust spend limits + categories, allowance/match, freeze (`placeHold`).
- **Approval queue** — approve/deny teen requests (debit over-limit, withdrawals, investment orders) via the
  reused `agent_reviews` queue (`requires_role='guardian'`, `decided_by`=guardian id), with push.
- **Multi-teen** management within one household; the guardian's own adult Argus account is unaffected.

## 10. Compliance & legal (counsel sign-off required)

- **Guardian-owned + liable**; KYC on the guardian (Persona/Alloy); teen DOB/minor verification.
- **COPPA** posture for the 13–17 band: data minimization, verifiable parental consent, no marketing/ad
  targeting to minors, careful PII handling. (Under-13 is explicitly out of scope.)
- **Deposits**: FDIC **via the partner bank**, never marketed as Argus's own (the bank-naming rule).
- **Investing**: **UGMA/UTMA** custodial structure; guardian-approved; partner broker-dealer + transfer agent.
- **Credit-builder**: secured/charge structure, guardian liability, CARD-Act-aware disclosures, FCRA-compliant
  bureau reporting via partner.
- **CFPB / UDAAP**: gamification + fees reviewed for fairness; no dark patterns.
- **State money-transmission** + **bureau reporting** ride partner licenses.
- Every teen/guardian action is on the append-only audit trail (`auditService` extended with teen + guardian
  ids).

## 11. Partners (named; each maps 1:1 to a provider seam)

| Capability | Candidate partners | Seam |
|---|---|---|
| BaaS / partner bank (deposits, FBO, ACH) | Column · Treasury Prime · Unit | `BankRailProvider` |
| Card issuing (teen debit + secured) | Marqeta · Lithic | `CardProcessor` |
| Credit-builder bureau reporting | a credit-builder reporting partner | `CreditBureauReporter` (new) |
| Custodial brokerage + transfer agent | custodial broker-dealer / transfer agent | equities/marketplace rails |
| KYC / identity (guardian) | Persona · Alloy | identity/onboarding |

## 12. Architecture & scale

- **Household** is the tenancy + data-isolation unit; per-household authorization.
- **Ledger is the source of truth** — balances/holdings/statements/net-worth all derive from it; no mutable
  balance columns.
- **Provider seams** everywhere (the repo pattern): simulated default + `NOT_IMPLEMENTED` stubs; config
  selects the real partner.
- **`TEEN_ENABLED` kill-switch**, **prod-fatal** until partners + counsel are in place (mirrors
  `CARDS_ENABLED`/`BANK_RAILS_ENABLED`).
- **Batch jobs** on Temporal/Conductor: interest accrual, statement cycles, bureau reporting, round-up sweeps,
  allowance runs.
- **Idempotency + append-only audit** on every money mutation; analytics/event export for product + risk.

## 13. UX / design system

- A brighter **"Starter" theme** — a variant of Quiet-Premium (softer/secondary accent, larger touch targets,
  motivating-but-honest copy), mobile-first, accessible (WCAG AA).
- **Distinct guardian vs teen views** off the same components; the teen view leads with the goal/streak/
  net-worth journey, the guardian view leads with controls + the approval queue.
- New components extend the scaffold: `<GoalProgress>`, `<NetWorthJourney>`, `<Quest>`, `<StreakMeter>`,
  `<SpendingMeter>` (remaining vs limit), `<GuardianApproval>`.

## 14. Staged build path (later execution)

Each stage follows the repo convention: simulated provider seam + `TEEN_ENABLED`-gated (prod-fatal) + tests;
partner/legal items clearly deferred.

| Stage | Scope | Gated by |
|---|---|---|
| **22.0** | Households + guardian↔teen linkage + `minor` account type + restricted `TIER_OPS` + guardian dashboard skeleton + audit/RBAC extension | buildable now (simulated) |
| **22.1** | Teen debit: spend-limit policy gate + guardian real-time approval + freeze | buildable now |
| **22.2** | High-yield savings: `interestAccrualService` + goals/vaults + round-ups + guardian match | buildable now |
| **22.3** | Gamification core: quests/streaks/badges/lessons/net-worth + teen money coach | buildable now |
| **22.4** | Credit-builder card + `CreditBureauReporter` seam | **bureau partner + credit counsel** |
| **22.5** | Custodial investing (UGMA/UTMA) + guardian-approved fractional orders | **custodial broker + transfer agent** |

Stages 22.0–22.3 are fully buildable now as simulated seams (no partner). 22.4/22.5 build their seams now but
stay prod-fatal until the partner + counsel land.

## 15. Out of scope / non-goals

Under-13 users (COPPA-strict); teen-independent account ownership; real revolving credit to minors; the agent
auto-executing money; any gambling/lootbox/variable-reward or overtrading mechanic; leverage/options for minors.

---

*This document is the Phase 22 design deliverable. No runtime code is built in this phase; the reuse seams
named above (cardService, bankRailService, marketplace/equities, operationsWorkflow human-gate,
accountHoldService, identityService, the gamification components) make each staged build a direct extension.*
