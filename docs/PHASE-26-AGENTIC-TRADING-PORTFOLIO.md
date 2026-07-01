# Phase 26 — Agentic Trading & Portfolio Management

**Status: DESIGN (not built).** The differentiator: an AI agent that can **propose and (under gates)
execute** trades and **manage a portfolio** — rebalancing, tax-loss harvesting, allocation to targets —
on top of SmartChat. Answers Robinhood **Cortex/Strategies** + robo-advisors, but on Goemon's
**"agents decide; deterministic code executes; humans gate"** invariant (Phase 15).

Ramp: the **agentic layer is Phase-A software**; live execution rides the **Phase-17 trading** gate
(broker-dealer / market-data partner, Phase C). Investment *advice* at scale is a regulated activity
(RIA) — ⚖ counsel-gated.

---

## 1. Principle — advise → gate → execute (never a rogue trader)

The agent **never moves money or places an order directly.** It gathers (read-only tools), reasons, and
**proposes** a plan; a **deterministic gate** (policy + human approval where required) executes the plan
through the existing idempotent services. This is the exact `runOperation` pattern in
`src/operations/operationsWorkflow.ts` (gather → invoke → gate → execute|queue → audit) extended with a
trading skill. No new money path — orders settle through **Phase-17 `tradingService`** (SLA-isolated,
idempotent at the `external_clearing` seam).

Guardrails (non-negotiable): per-agent + per-user **ceilings** (client ∧ grant, like MCP transfers);
**MFA/human approval** above a threshold (reuse the SmartChat >$500 gate + Phase-15 `human_required`
tier); **kill-switch** (`AGENTIC_TRADING_ENABLED`, prod-fatal while simulated); every proposal +
decision + fill **append-only audited**; no discretionary trading without an explicit, revocable grant.

## 2. Capabilities

| Capability | What the agent does | Executes via |
|---|---|---|
| **Conversational trading** | "Buy $200 of BTC", "sell 5 AAPL" via SmartChat/Console | Phase-6 intent → operation token → Phase-17 `tradingService` |
| **Portfolio review** (advisory) | Score allocation/risk/drift vs a target; explain | read-only skill tools; no execution |
| **Rebalancing** | Propose orders to return to target weights; human/gate approves the basket | batch of Phase-17 orders, idempotent per plan id |
| **Tax-loss harvesting** | Identify lots at a loss, propose harvest + replacement (wash-sale aware) | proposal → gate → orders; ledger lots |
| **Recurring / DCA** | Scheduled buys to a plan | Temporal/Conductor schedule → gated execute |
| **Guardrailed autonomy** | Within a user-set mandate (max drift, budget, allowlist), auto-approve small rebalances; escalate the rest | Phase-15 supervision tiers |

## 3. Architecture (reuse)

- **Skill:** a new `tradingAdvisorSkill` in `src/operations/skills/` — read/recommend/draft only, scope
  intersection (granted ∩ skill-allowed), tool-call trail (no PII), like `kycReviewSkill`.
- **MCP tools (new, scoped):** `portfolio:read`, `market:read`, `trade:propose`, `trade:execute`
  (ceiling-bound) — added to the Phase-7 registry; VP-verified + grant-gated like all MCP access.
- **Runner:** `runOperation` supervision — small in-mandate rebalances `auto_approve_audit`; anything
  above ceiling or outside mandate `human_required`.
- **Execution:** Phase-17 `tradingService` (never a second order path); positions are ledger currency
  codes (Phase-8 pattern); market data from `marketDataService` (Phase-17 Stage-2 seam).
- **Money invariant:** the agent proposes; the gate + `tradingService` execute; Temporal money-workflow
  optionally wraps the settlement (exactly-once at the ledger).

## 4. Staged build
- **26.0 — Advisory only:** portfolio review + rebalance/TLH *proposals* (no execution). Phase-A software.
- **26.1 — Gated execution:** conversational trading + human-approved rebalance baskets on `tradingService`.
- **26.2 — Guardrailed autonomy:** user mandate → auto-approve small in-mandate actions; escalate rest.
- **26.3 — Scheduling:** recurring/DCA via Temporal/Conductor.

## 5. Compliance gate (⚖)
Live order execution → **broker-dealer / clearing + market-data licensing** (Phase-17, Corp C).
Automated **investment advice** → likely **RIA registration** + suitability/best-interest + disclosures.
Discretionary management → advisory agreement + fiduciary duties. Simulated trading is **prod-fatal**.

## 6. Acceptance (when built)
A user grants a trading mandate → asks the agent to rebalance → agent proposes a basket → gate/MFA
approves → orders settle through `tradingService` into balanced ledger journals → proposal + approval +
fills append-only audited → replay is idempotent → an over-ceiling or out-of-mandate action escalates to
`human_required` and does **not** execute without approval.
