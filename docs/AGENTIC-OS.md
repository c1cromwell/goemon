# Argus Agentic OS — Corporate Brain Design

**Status:** M1 — design + branding + webview (CEO sign-off gate)  
**Authoritative webview:** [`agentic-os/index.html`](agentic-os/index.html)  
**Related:** [`agenticos_argus.rtf`](agenticos_argus.rtf) (CEO brief)

---

## Mission & framing

**Mission:** Run Argus Financial Partners with the smallest possible human staff — an auditable, agent-native corporation where AI agents hold real jobs, every material decision is logged, and humans gate only what must never run unattended: money out, first production launches, and final legal sign-offs.

**Positioning (Phase A):** Tokenization-first, non-custodial, agentic finance. We are *not* a bank — we are the all-seeing guardian of your money: keys in your device, decisions in an append-only ledger, agents that operate under scoped credentials, and a CEO who remains the final authority on financial outputs, launches, and legal posture.

**Brand motif:** Argus — the many-eyed sentinel. Jade accent (`#2dd4a7`) on dark surfaces; type-led hierarchy; no hype.

---

## Design principles

1. **Agents decide; deterministic code executes; humans gate material outcomes** — already encoded in `runOperation` → `resolveReview` (`backend/src/operations/operationsWorkflow.ts`).
2. **Corporate brain + product squads** — C-suite agents route portfolio work; per-product squads run PDLC.
3. **Append-only audit everywhere** — corporate decision log + product KG; no silent overwrites.
4. **Model-agnostic PDLC** — Claude-tiered router now; vendor seam for OpenAI/Google/local later (M4).
5. **CEO primary, Chief of Staff backup** — three gated output classes only escalate to humans when required.

---

## Human gates (CEO → CS backup)

| Output class | Primary gate | Backup | Maps to |
|---|---|---|---|
| **Financial outputs** | CEO | Chief of Staff | CFO agent outputs; treasury, spend, revenue recognition |
| **New product — first production launch** | CEO | Chief of Staff | CPO + PDLC Orchestrator launch gate |
| **Final legal signoff** | CEO | Chief of Staff | CLO agent; counsel memos B4–B6 |

**Implementation (M2):** gate-policy map `(agent, output-class) → required role` feeding `runOperation` escalation → `agent_reviews.requires_role`. Existing `SupervisionTier` values:

| Tier | Meaning |
|---|---|
| `auto_approve` | Execute immediately; audit only |
| `auto_approve_audit` | Execute + flagged audit trail |
| `human_required` | Queue to `agent_reviews`; human must approve |
| `human_led` | Agent drafts; human decides |

---

## Approval workflow

```
Agent invoke → gate() → escalate?
                              │
                    no ───────┴─────── yes → agent_reviews (requires_role: ceo)
                              │                      │
                         execute               CEO approves / rejects
                              │                      │
                              │               CEO unavailable?
                              │                      │
                              │               CS backup (chief_of_staff)
                              ▼
                    audit_log + KG write (M3)
```

---

## Corporate agents (C-suite brain)

| Agent | Charter | Supervision | CEO gate |
|---|---|---|---|
| **Argus Brain** (Office of CEO / Orchestrator) | Routes work, convenes agents, owns CEO/CS approval queue and corporate decision log | `human_led` | Owns queue |
| **CFO** | Budgets, treasury, revenue/spend reporting | `human_required` on financial outputs | **Financial outputs** |
| **CLO** (General Counsel) | Legal/regulatory posture, memo drafts, filing prep | `human_required` on final signoff | **Legal signoff** |
| **CISO** | Corporate security posture; peers with product Cyber Specialist | `auto_approve_audit` | — |
| **CPO** | Product portfolio, roadmap, launch readiness | `human_required` on first prod launch | **Launch gate** |
| **CMO** | Brand, positioning, GTM (uses marketing skill) | `auto_approve_audit` (≥1k audience → admin) | — |
| **CRO / Compliance** | Risk, audit, regulatory filings | `human_required` (reuses `complianceSkill`) | — |
| **COO / SRE** | Infra, vendors, reliability | `auto_approve_audit` (reuses SRE skill) | — |

**Reuse today:** `complianceSkill`, back-office SRE/marketing skills in `backend/src/operations/skills/`.

---

## Product squad agents

| Agent | Charter | Supervision |
|---|---|---|
| **AI Product Strategist** | The *why* — market, positioning, strategy docs | `auto_approve_audit` |
| **AI Engineer** | Implementation, PRs, migrations | `auto_approve_audit` |
| **AI Spec / PDLC Orchestrator** | Spec → design → build → test → launch; enforces gates | `human_required` at launch |
| **AI Cyber Specialist** | Per-product threat modeling, security review | `human_required` on material findings |
| **AI Agentic Builder** | Updates agents, skills, MCP servers continuously | `auto_approve_audit` |
| **AI QA / Test** *(recommended)* | Test plans, regression, e2e gates | `auto_approve_audit` |
| **AI SRE / Reliability** *(recommended)* | SLOs, incident summaries | `auto_approve_audit` |
| **AI Support** *(recommended)* | Support issues → product KG | `human_required` on customer-facing fixes |
| **AI Designer / UX** *(recommended)* | Quiet Premium UI, accessibility | `auto_approve_audit` |

**PDLC flow (M6):** Strategist → Engineer + Cyber (parallel) → QA → Orchestrator launch proposal → **CEO gate** → production.

---

## Agent interaction map (corporate ↔ product)

```
                    ┌─────────────┐
                    │ Argus Brain │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
        CFO/CLO         CPO/CMO      CRO/COO/CISO
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                  Product squad (PDLC)
                           │
              Strategist → Engineer → QA
                     ↘ Cyber ↗
                  Agentic Builder (skills/MCP)
                           │
                    CEO launch gate
```

---

## Decision knowledge graph (M3)

Append-only, in-DB (reuse append-only trigger pattern).

**Nodes:** `Decision`, `Strategy`, `Product`, `Launch`, `Incident`, `SupportIssue`, `Fix`, `Agent`, `Approval`, `Filing`

**Edges:** `decided_by`, `rationale_for`, `gated_by`, `supersedes`, `relates_to`, `resulted_in`

**Write points:**

| Event | KG action |
|---|---|
| `runOperation` completes | `Decision` node + `Agent` edge + rationale |
| `resolveReview` (human gate) | `Approval` node + `gated_by` edge |
| Product launch (M6) | `Launch` + `Product` + `Strategy` |
| Support fix (M6) | `SupportIssue` → `Fix` → `Product` |

**Scope:** Corporate KG = all decisions. Product KG = engineering, launches, strategies, support issues + fixes.

---

## Model router (M4)

**Registry fields:** id, vendor, capability tier, context window, $/token in+out, latency class

**Routing policy:** task class → required capability + token budget → cheapest qualifying model + fallback chain

**Claude tiers (now):**

| Tier | Model class | Use when |
|---|---|---|
| High | Opus-class | Legal drafts, launch decisions, complex reasoning |
| Standard | Sonnet-class | Specs, code review, compliance analysis |
| Fast | Haiku-class | Triage, summaries, high-volume reads |

**Provider seam:** `AnthropicProvider` (live) · `OpenAIProvider` (stub) · `GoogleProvider` (stub) · `LocalProvider` (stub)

**Telemetry:** `model_invocations` table — tokens, cost, task class → powers swap-by-usage policy.

**Replaces:** direct `ANTHROPIC_MODEL` calls in `skills/kycReviewSkill.ts` and peers.

---

## Reuse map (do NOT rebuild)

| Capability | Location |
|---|---|
| Human-gate engine | `operationsWorkflow.ts` — `runOperation`, `resolveReview`, `SupervisionTier` |
| Skill registry | `skillRegistry.ts`, `operations/skills/*` |
| Workflow engine | `engine.ts`, Temporal, Conductor |
| Audit | `auditService.ts`, append-only `audit_logs` |
| Admin agent-ops | `/api/admin/agent-ops` — extend for CEO/CS (M2) |
| RBAC | `middleware/rbac.ts` — add `ceo`, `chief_of_staff` (M2) |
| Doc render | `docs/build/render.mjs` |

---

## Milestone roadmap (CEO sign-off each deploy)

| Milestone | Deliverable | Backend code? |
|---|---|---|
| **M1** | This doc + branding + webview | **No** |
| **M2** | `ceo`/`chief_of_staff` RBAC, gate-policy, Approvals admin UI | Yes |
| **M3** | `kg_nodes`/`kg_edges`, `decisionGraph` service, graph API | Yes |
| **M4** | `modelRouter`, `model_invocations`, skill refactor | Yes |
| **M5** | Corporate agent fleet as runner skills | Yes |
| **M6** | Product squad + PDLC orchestrator + product KG | Yes |

---

## M1 verification checklist

- [ ] Open `docs/agentic-os/index.html` in a browser (no server)
- [ ] Every corporate + product agent has a card (charter · responsibilities · interactions · tools · tier · gate)
- [ ] Three CEO-gated categories + CEO → CS backup flow visible
- [ ] SVG org diagram + logo render; Argus branding
- [ ] Knowledge graph + model router overviews present
- [ ] Render `AGENTIC-OS.html` / `.pdf` via `docs/build/render.mjs`
- [ ] CEO reviews webview + doc → signs off → M1 deployed → plan M2

---

*Strategic guidance only — not legal advice. Financial and legal gates require human CEO/CS approval regardless of agent recommendation.*
