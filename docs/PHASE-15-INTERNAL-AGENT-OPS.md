# Phase 15 — Internal Agent Operations (Design)

**Status: design only — not built.** This is the implementation-ready elaboration of
the Phase 15 block in `BANKAI-PLAN.md`, grounded in the code that already exists so
each sub-phase can be picked up directly. Prerequisites are met: Phase 7 (MCP +
presentation gate) and Phase 12 (RBAC, per-agent-DID rate limit, metrics) are in.

It runs the bank's **back office** — support, KYC review, fraud/AML triage,
marketplace due-diligence, marketing, SRE, compliance drafting — through AI agents
fronted by internal MCP "skill" servers, with the governance and controls that make
that safe.

---

## 1. The one invariant

> **Agents decide; deterministic code executes; humans gate anything material.**

An agent never moves money, mutates account/identity/credential state, or files with
a regulator. It emits a **structured recommendation + reasoning trace**; a
deterministic, RBAC-checked, audited **policy gate** is the only thing that acts.

This is not new — it generalizes the existing onboarding invariant:

- `backend/src/services/riskOrchestratorService.ts:136` — `finalizeDecision()` is
  documented as *"the ONLY place a tier grant is authorized — the model is advisory."*
  Phase 15 makes that pattern the rule for every workflow.

## 2. Canonical workflow

Every workflow has the same five-step shape; the agent context is discarded on
completion:

```
gather (deterministic) → invoke (scoped MCP toolset) → gate (deterministic, RBAC)
                       → execute (deterministic) → audit (append-only)
```

**It already exists in code** — Phase 5A onboarding *is* this workflow:

| Step | Onboarding reference implementation |
|---|---|
| gather | `signalService.assessSignals()` (`signalService.ts:85`) |
| invoke | `orchestratorModel.assessRisk()` (`utils/orchestratorModel.ts`) + `onboardingAgents` sub-agents |
| gate | `riskOrchestratorService.finalizeDecision()` (`:136`) — deterministic policy |
| execute | `identityService.completeKycDecision()` |
| audit | `auditService.logAudit()` + `onboarding_agent_runs` (migration `004`) |

Phase 6 SmartChat reinforces it: advisory `smartchatService.classifyIntent()` →
operation-token + MFA gate → `ledgerService.transfer()`.

### Design sketch — the reusable runner (15.0, not built)

```ts
// backend/src/operations/operationsWorkflow.ts  (DESIGN SKETCH)
export type SupervisionTier =
  | "auto_approve" | "auto_approve_audit" | "human_required" | "human_led";

export interface WorkflowDef<Ctx, Rec, Out> {
  skill: string;              // e.g. "kyc-review"
  version: string;            // independently deployable
  supervision: SupervisionTier;
  gather: (input: unknown) => Promise<Ctx>;                 // pure/deterministic
  invoke: (ctx: Ctx, mcp: ScopedSkillClient) => Promise<Rec>; // ONLY LLM-touching step
  gate: (ctx: Ctx, rec: Rec, actor?: AdminActor) => GateDecision; // deterministic + RBAC
  execute: (ctx: Ctx, decision: GateDecision) => Promise<Out>;    // deterministic services
}

export interface GateDecision {
  action: "approve" | "reject" | "escalate";
  reason: string;
  requiresRole?: AdminRole[];     // enforced via rbac.requireRole
  humanReviewId?: string;         // when escalated to the review queue
}

// The runner: gather → invoke → validate/clamp → gate → (escalate? queue : execute) → audit.
export async function runOperation<Ctx, Rec, Out>(
  def: WorkflowDef<Ctx, Rec, Out>, input: unknown, actor?: AdminActor
): Promise<{ runId: string; outcome: "executed" | "queued" | "rejected" }>;
```

The runner reuses: `orchestratorModel` (invoke), the `finalizeDecision` gate pattern
(gate), existing services (execute), `auditService` + the new `agent_runs` store
(audit), and a DB-backed human-review queue (already present for onboarding in the
admin console).

### Design sketch — `agent_runs` (generalize `onboarding_agent_runs`)

```sql
-- DESIGN SKETCH — append-only (UPDATE/DELETE blocked by trigger, like audit_logs)
CREATE TABLE agent_runs (
  id            TEXT PRIMARY KEY,
  skill         TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  workflow_run  TEXT NOT NULL,         -- correlates the 5 steps
  supervision   TEXT NOT NULL,         -- SupervisionTier
  tool_calls    TEXT NOT NULL,         -- JSON: scoped tool invocations
  recommendation TEXT NOT NULL,        -- JSON: structured output (NO raw PII beyond gate scope)
  gate_decision TEXT NOT NULL,         -- approve|reject|escalate + reason
  actor_admin_id TEXT,                 -- the human at the gate, when applicable
  outcome       TEXT NOT NULL,         -- executed|queued|rejected|error
  confidence    REAL,                  -- escalation vs ONBOARDING_REVIEW_FLOOR-style floors
  created_at    TEXT NOT NULL
);
```

## 3. Supervision tiers & escalation

Set **per workflow** (not per skill): `auto_approve · auto_approve_audit ·
human_required · human_led`. In v1 every user-impacting or money-moving decision is at
least `human_required`, and money movement / state mutation is **not an exposed agent
capability** at all.

Independent of tier, auto-escalate to a human on: confidence below floor (mirrors
`config.ONBOARDING_REVIEW_FLOOR` / `GRANT_GUARDRAIL_FLOOR = 0.3`), threshold exceeded,
hallucination (output references a nonexistent record → block + log), explicit user
request, or repeated escalations.

## 4. Skills catalog (internal MCP servers)

Each skill exposes a versioned, scoped tool set for one domain. Every tool is
**read / recommend / draft** — none execute. "Backing" = code a tool reads through;
**(gap)** = to build.

| Skill | Representative tools | Posture | Backing / human gate |
|---|---|---|---|
| **Customer Support** | get_user_account, get_user_transactions, get_user_kyc_status, search_knowledge_base, draft_response, escalate_to_human | read/draft | `ledgerService.getUserBalances`, `transferService.getTransactionHistory`, `identityService`; refunds + regulatory complaints → human |
| **KYC Review** | get_kyc_submission, get_user_history, query_sanctions_databases, recommend_decision, request_additional_info | read/recommend | `identityService.screenSanctions`; gate → `completeKycDecision`; **human decides always** |
| **Fraud & AML** | get_transaction_context, query_blockchain_analytics, query_sanctions_databases, draft_sar_narrative, recommend_disposition, freeze_account | read/recommend/**restricted** | `ledgerService`/`transferService`; freeze + SAR → `requireRole("compliance","admin")` |
| **Marketplace DD** | fetch_issuer_documents, validate_smart_contract, verify_proof_of_reserve, draft_listing_record | read/draft | feeds Phase 8 listing lifecycle; compliance approves |
| **Marketing Ops** | query_user_segments (aggregate only — no PII), draft_notification/email, submit_for_approval | read/draft | send by notification service, not agent; ≥1K or claims → human/legal |
| **SRE / On-Call** | query_logs, query_metrics, query_traces, correlate_with_deploys, draft_incident_summary, page_humans | read/draft | pino logs + `prom-client`; **no deploy/restart**; humans remediate |
| **Compliance Drafting** | fetch_regulatory_templates, fetch_user_evidence, draft_regulatory_filing, schedule_filing | read/draft | `auditService` evidence; **humans file every filing**; `schedule_filing` queues only |

**No skill ever gets a tool that** moves money / posts to the ledger, mutates
tier/credential/account state, submits to a regulator, reads raw PII beyond what the
supervising human may see, or touches infrastructure.

## 5. Security controls

- **No-execute boundary** — the hard, architectural control (§1–§2).
- **Per-skill tool scoping** — model on Phase 7 `mcp_clients.allowed_functions` ∩ the
  `tokenFactory` exchange-token `scope` (`mintExchangeToken` / `mintScopedToken`,
  `tokenFactory.ts:36,52`). Effective scope = requested ∩ skill-allowed (the same
  intersection `presentationService` already enforces).
- **Delegation tokens** — short-lived signed tokens via `tokenFactory`; action tokens
  ≤ 90s with `exp` validated at execute (`verifyToken`, `:84`). Tokens never logged.
- **RBAC on every human gate** — `middleware/rbac.ts` `requireRole(...)`:
  compliance/admin for freezes, SAR, OFAC reports, listing approvals; support for
  support sends; admin for ≥1K marketing. Sensitive actions logged with the actor
  admin id (the Phase 12 pattern).
- **Audit & reasoning traces** — every invocation → append-only `audit_logs` /
  `mcp_audit_logs` + the generic `agent_runs` store. **Never log secrets/tokens/full
  PII/VC-VP** (the existing pino redaction config already covers tokens/VC/VP).
- **Containment** — per-skill kill-switch + circuit breaker (degrade to human-only,
  reusing the `assessRisk` → deterministic-fallback pattern), per-agent-DID rate limit
  (Phase 12 `agentRateLimit`), hallucination guard, structured-output validation
  (sanitize/clamp before the gate).
- **Pre-deploy eval gates** — functional ≥95% (auto-approve) / ≥90% (human-required);
  **safety/adversarial eval 100%** required for any production deploy.

## 6. Compliance automation (trigger → skill → gate → role → deadline → audit)

- **Sanctions screening** at the PRD-09 cadence (signup IP/geo, Tier-1 phone, Tier-2
  full, daily Tier-2 rescreen, on-chain/fiat counterparties, marketplace both sides).
  Confirmed match → auto-freeze + OFAC blocking report (**10 days**); fuzzy →
  `pending_review` + agent context + **compliance decision ≤ 24h**.
- **Transaction monitoring** (velocity, structuring, pass-through, mule, geo-anomaly)
  → Fraud/AML triage → compliance disposition (clear / RFI / freeze / SAR).
- **Regulatory reporting** — SAR (**30d**), OFAC blocking (**10d**), CTR (v2 card),
  state MTL, 1099, FATCA/CRS — all **agent-drafted, human-filed**.
- **Daily reconciliation** — ledger projection vs Hedera Mirror Node / partner bank;
  drift → incident. (This is Phase 14 invariant *n*, currently deferred.)
- **Jurisdiction availability matrix** — first-class data, enforced at the API gateway
  by verified jurisdiction (also gates Phase 8 marketplace eligibility). Agents read
  it; only `admin` edits it.

## 7. Orchestration — prototype now, Conductor/Temporal target

The contract is substrate-agnostic: `gather`, `gate`, `execute` are pure deterministic
functions; `invoke` is the only LLM-touching step.

- **Now (prototype):** a thin in-process `operationsWorkflow` runner using the existing
  direct-Anthropic-SDK + simulated-fallback pattern (`orchestratorModel`), the
  `finalizeDecision` gate pattern, existing services for execute, `auditService` +
  `agent_runs` for audit, and the DB-backed human-review queue in the admin console.
- **Target (production):** **Conductor OSS** for agent workflows (durable execution,
  built-in human-task queues for gates) + **Temporal** for money workflows
  (exactly-once at the ledger seam). Mapping: workflow→definition,
  gather/execute→worker/activity, invoke→agent-task worker calling the scoped MCP
  server, gate→decision/human task, audit→engine event history **plus** the retained
  append-only stores.
- **Migration seam:** because gather/gate/execute are pure functions, they become
  workers/activities unchanged — only the runner swaps. Money execution stays in
  `ledgerService`/`transferService` keyed on idempotency keys; the engine orchestrates
  but never becomes a second ledger.

## 8. Governance & lifecycle

Named **skill owner** per skill; tier *relaxations* require eval evidence + compliance
sign-off. Versioned skills with independent deploy; rollback = version pin.

Production monitoring (new metrics, same prom-client style as Phase 12):
`agent_run_total{skill,result}`, `agent_tokens_total{skill}`,
`agent_escalation_total{skill,reason}`; reasoning-trace capture; weekly sampled human
review (PRD-09 cadence); drift detection; per-workflow token-cost alerts.

Failure handling: LLM/MCP down → human-only; low confidence → escalate; hallucination
→ block + incident; kill-switch is an audited event. Human-in-the-loop SLAs (e.g.
fuzzy sanctions hit ≤ 24h) raise alerts on breach. Every incident is added to the eval
set so it can't silently recur.

## 9. Sub-phases & acceptance

| Sub-phase | Scope | Eval / acceptance gate |
|---|---|---|
| **15.0** | Policy-gate & run-ledger framework: `operationsWorkflow` runner, `agent_runs` (generalize `onboarding_agent_runs`), `SupervisionTier`, human-review queue, per-skill kill-switch + per-DID rate limit | Runner re-expresses Phase 5A onboarding with zero behavior change (regression: existing onboarding tests pass) |
| **15.1** | First skill — **KYC Review** or **Fraud/AML triage**: one MCP server (read/recommend/draft only), workflow + gate + admin review queue | functional ≥90%, **safety/adversarial 100%** |
| **15.2** | Remaining read-only skills — Support, SRE, Marketing, Marketplace DD | per-skill eval gates |
| **15.3** | Compliance reporting — sanctions rescreen cadence, txn-monitoring triage, SAR/OFAC/CTR drafting (agent-drafted, human-filed), daily reconciliation (invariant *n*) | deadline SLAs encoded + alerted |
| **15.4** | Conductor/Temporal migration — lift durable/money workflows onto the production substrate | parity with the in-process runner; money seam stays in the ledger services |

## 10. Out of scope (PRD-08 non-goals — encoded, not omitted)

Agents making user-impacting decisions without human approval; real-time customer chat
agents (v1 = drafted + approved); agents managing investments or executing
payments/transfers (**never, by policy**); agents deploying production code.

---

*This document is the Phase 15 deliverable. No runtime code is built in this phase; the
design sketches above mark the seams for sub-phases 15.0–15.4.*
