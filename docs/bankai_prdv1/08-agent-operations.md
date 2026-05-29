# 08 — Agent Operations

## The thesis

Bankai's structural cost advantage comes from running a meaningful share of bank operations through AI agents. This isn't a "we'll have a chatbot" thesis — it's "we design every back-office workflow around an agent participant from day one." Traditional banks spend 50-70% of OpEx on people performing repeatable knowledge work (support, KYC review, fraud investigation, compliance drafting, marketing operations). A correctly-designed agent layer reduces that to 20-30%, with the remaining humans focused on edge cases, escalations, and supervision.

This module specifies how agents fit into the architecture, what skills they have, where humans are required, and what guardrails are in place.

## Architectural model

Agents are not free-floating chatbots. Each agent is invoked from a **Conductor OSS workflow** and operates with a scoped set of **MCP tool servers** ("skills") for the duration of its task. When the workflow completes, the agent context is discarded.

```
Conductor Workflow
    │
    ├── Step 1: Gather context (deterministic Go activity)
    │
    ├── Step 2: Invoke agent with task + scoped MCP toolset
    │       │
    │       ├── Agent uses tools (via MCP)
    │       │     ├── Read user history
    │       │     ├── Query ledger (read-only)
    │       │     ├── Check sanctions database
    │       │     └── Draft response
    │       │
    │       └── Returns: structured output + reasoning trace
    │
    ├── Step 3: Apply policy gate (deterministic check)
    │     If action threshold exceeded → escalate to human
    │     Otherwise → proceed
    │
    └── Step 4: Execute action (deterministic Go activity)
```

Key architectural properties:

- **Agents don't act directly.** They produce structured outputs that workflows act on. This separates decision from execution, making both auditable.
- **Tool scope is per-skill.** A support agent invoked for a refund question gets the support toolset; it cannot access the marketing toolset or the engineering toolset.
- **Every agent action is logged.** Reasoning traces, tool calls, and final outputs go to the audit log.
- **Human override is always available.** Any agent-handled task can be escalated to a human at any step.

## Skills (MCP servers)

Each skill is an MCP server with a versioned API, scoped permissions, and its own deployment cadence. Skills run as Go services and expose MCP-over-HTTP endpoints.

### Skill: Customer Support

**Purpose:** First-line handling of customer support inquiries via in-app chat, email, and (eventually) phone.

**Tools exposed:**
- `get_user_account` — read account info (no PII beyond what user can see themselves)
- `get_user_transactions` — read transaction history
- `get_user_kyc_status` — read tier and verification status
- `search_knowledge_base` — query Bankai's docs and FAQ
- `draft_response` — produce a customer-facing message
- `create_internal_note` — annotate the ticket for human reviewers
- `escalate_to_human` — route to human queue with reason

**Permissions:** Read-only on user data. Cannot modify account state, issue refunds, or initiate transactions. All customer-facing replies are sent by the workflow, not directly by the agent.

**Human handoff:**
- Any refund request (regardless of amount)
- Any complaint with regulatory implications
- Any question the agent's confidence score on is below a threshold
- Any user who explicitly requests a human

### Skill: KYC Review

**Purpose:** Resolve KYC verifications that the IDV vendor flagged for manual review (confidence below threshold, document quality issues, name mismatch, etc.).

**Tools exposed:**
- `get_kyc_submission` — read the submission package (document images, selfie, vendor scores)
- `get_user_history` — read prior account activity
- `query_sanctions_databases` — check name across OFAC and other lists
- `recommend_decision` — produce a structured recommendation (approve/deny/request more info) with reasoning
- `request_additional_info` — draft a message to the user asking for clarification

**Permissions:** Read on KYC data; recommend-only on decisions. **All actual approve/deny decisions are made by human reviewers** in v1 (auto-approval considered in v2 once we have confidence data).

**Human handoff:** Always. The agent prepares the case; the human decides.

### Skill: Fraud and AML Monitoring

**Purpose:** First-pass triage of transaction monitoring alerts; investigation support for compliance team.

**Tools exposed:**
- `get_transaction_context` — full context around a flagged transaction (user history, counterparty risk, related transactions)
- `query_blockchain_analytics` — TRM Labs or Chainalysis lookups
- `query_sanctions_databases`
- `draft_sar_narrative` — produce a draft SAR/STR narrative for human review
- `recommend_disposition` — clear, escalate, or freeze recommendation
- `freeze_account` — restricted; requires step-up via compliance officer sign-off

**Permissions:** Read on transaction and user data. Can recommend freezes; cannot execute them without human approval. Can draft SARs; humans file them.

**Human handoff:** All disposition decisions, all SAR filings, all account freezes.

### Skill: Marketplace Due Diligence

**Purpose:** Research and analysis for new RWA listing proposals.

**Tools exposed:**
- `fetch_issuer_documents` — pull public filings, audit reports, offering documents
- `validate_smart_contract` — check contract on-chain, verify it's ERC-3643 conformant, check audit history
- `verify_proof_of_reserve` — confirm Chainlink PoR feed exists and is recent
- `compare_to_existing_listings` — flag if asset overlaps with current marketplace
- `draft_listing_record` — produce the listing record for compliance review

**Permissions:** Read-only on external data; draft-only on listing records. Final approval is by compliance team.

**Human handoff:** All approve/deny decisions on new listings.

### Skill: Marketing Operations

**Purpose:** Draft and schedule marketing communications (push notifications, email campaigns, social posts).

**Tools exposed:**
- `query_user_segments` — read segment definitions and sizes (no PII)
- `draft_notification` — produce push notification copy with variants
- `draft_email_campaign` — produce email content
- `propose_send_schedule` — recommend timing
- `submit_for_approval` — route to human reviewer

**Permissions:** No read on individual users (only aggregate segment metadata). No send capability — humans approve and the notification service executes.

**Human handoff:**
- Any campaign reaching >1,000 users requires human approval
- Any campaign making product claims requires legal review
- Any campaign in a category the user has opted out of is blocked at the notification service layer regardless of agent intent

### Skill: SRE and Engineering On-Call

**Purpose:** First-pass triage of production alerts; root-cause analysis support.

**Tools exposed:**
- `query_logs` — read service logs
- `query_metrics` — read Prometheus/Grafana metrics
- `query_traces` — read distributed traces
- `correlate_with_deploys` — match alert timing to recent deploys
- `draft_incident_summary` — produce an incident report draft
- `page_humans` — escalate to on-call rotation

**Permissions:** Read-only on observability data. **Cannot deploy, restart services, or modify infrastructure.** Can recommend remediation; humans execute.

**Human handoff:** All remediation actions.

### Skill: Compliance Drafting

**Purpose:** Draft regulatory communications and reports.

**Tools exposed:**
- `fetch_regulatory_templates` — load latest templates (BSA, SAR, FBAR, FATCA, etc.)
- `fetch_user_evidence` — pull the evidence package for a case
- `draft_regulatory_filing` — produce a draft for human review
- `schedule_filing` — submit to the workflow queue (no direct external submission)

**Permissions:** Read on compliance cases; draft-only on filings. **Humans review and submit every regulatory filing.**

**Human handoff:** All filings.

## Agent supervision model

Each skill has a supervision tier that defines when humans are required:

| Tier | Description | Examples |
|---|---|---|
| **Auto-approve** | Agent action executes without human review | Knowledge-base responses to common questions, internal notes on tickets |
| **Auto-approve with audit** | Agent action executes, human reviews sample post-hoc | Marketing campaigns under 1K recipients with no claims content |
| **Human-required** | Human approves before action executes | Refunds, KYC decisions, marketing >1K recipients, listing approvals |
| **Human-led** | Human leads; agent assists | SAR filings, complex fraud investigations, regulatory communications |

The supervision tier is set per workflow, not per skill — the same skill might be auto-approve in one workflow and human-required in another.

## Quality and safety

### Pre-deployment evaluation

Every skill version goes through evaluation before deploying:

- **Eval set** of ~100-500 representative tasks with known-good outputs
- **Pass rate** ≥95% for auto-approve tiers; ≥90% for human-required tiers
- **Safety eval** — adversarial prompts attempting to make the agent take unauthorized actions; pass rate must be 100% for production deploy

### Monitoring in production

- **Reasoning trace** of every agent invocation is captured and stored
- **Sampled review** — random sample of agent outputs is reviewed by humans weekly; aggregate accuracy reported
- **Drift detection** — if agent confidence scores trend downward, trigger investigation
- **Cost monitoring** — track LLM token cost per workflow; alert on anomalies

### Failure handling

- **Agent unavailable** (LLM API down, MCP server unreachable) — workflow falls back to "human-only" mode; tasks queue for human handling
- **Agent confidence too low** — auto-escalate to human regardless of supervision tier
- **Agent hallucination detected** (output references nonexistent records, etc.) — block action, log incident, escalate
- **Repeated escalations on similar tasks** — automatic alert to skill owner to investigate prompt or tools

## Cost model

The economics that make this work:

| Operation | Traditional cost | Agent cost | Reduction |
|---|---|---|---|
| First-line support ticket | $5-10 (human, 5-10 min) | $0.10-0.50 (agent + 1 min sampled review) | ~95% |
| KYC manual review (case prep) | $15-25 (human, 15-25 min) | $1-3 (agent prep + 5-min human decision) | ~80% |
| Fraud alert triage | $20-40 (human, 20-40 min) | $2-5 (agent + 5-min human dispo) | ~85% |
| New marketplace listing DD | $500-2000 (humans, multiple days) | $50-200 (agent + 2-hour human review) | ~85% |
| Marketing campaign draft | $200-500 (human marketing person) | $5-20 (agent + 30-min human edit) | ~95% |

At 1M users, conservative estimates put agent-driven OpEx savings at $15-25M/year vs running the same ops with humans only.

## Out of scope for v1

- Agents making any user-impacting decision without human approval (v2 consideration for low-stakes cases with strong eval data)
- Agents directly interacting with users in real-time chat (v1 uses agent-drafted, human-approved responses; v2 considers real-time with strong guardrails)
- Agents managing investment decisions on behalf of users (never — out of scope by policy)
- Agents executing payments or transfers (never — out of scope by policy)
- Agents writing or deploying code in production (v3 consideration with strong guardrails)

## Open questions

- `[Q-AGENT-001]` Which LLM provider for each skill? Anthropic Claude for general reasoning; do we need a specialized model for any specific skill?
- `[Q-AGENT-002]` Build vs buy on Conductor OSS — self-host or use Orkes Cloud (already in [Module 07](./07-technical-architecture.md))
- `[Q-AGENT-003]` Customer-facing real-time chat agent in v1 or wait for v2 with stronger eval data?
- `[Q-AGENT-004]` What's our policy on agents reading user PII for support purposes (currently no, but limits how helpful first-line support can be)?

## Cross-references

- For Conductor OSS technical setup, see [07 — Technical Architecture](./07-technical-architecture.md)
- For compliance review processes the agents support, see [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
