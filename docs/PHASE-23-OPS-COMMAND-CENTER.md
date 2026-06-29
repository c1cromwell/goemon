# Phase 23 — Internal Ops Command Center

**Status: DESIGN (not built).** A role-gated internal web app — an **Goeman Command Center** — that gives
leadership and operators read-only visibility into financial health, system stability, security/fraud
posture, and tokenization performance. It extends the existing admin console (`frontend/` `/admin/*`); it
does **not** introduce a separate internal product.

This doc is the authoritative design for Phase 23. Implementation is staged (§10); **pause for CEO/engineering
review after this design lands** before writing code.

**Related:** `docs/GOEMAN-PLAN.md` (master plan) · `docs/AGENTIC-OS.md` (CEO approvals + agent fleet) ·
`docs/LAUNCH.md` (Phase A posture) · Phase 20 warehouse/reconciliation · Phase 15 agent-ops · `fraud-engine/`

---

## 1. Problem statement

Goeman today has **many RBAC-gated admin APIs** and **Prometheus metrics**, but almost no **unified operator UI**:

| Surface today | What it does | Gap |
|---|---|---|
| `AdminConsole` (`/admin`) | KYC identity list + onboarding review queue | No funnel/abandonment analytics |
| `AdminApprovals` (`/admin/approvals`) | Agentic OS: CEO gates, KG, model router, corporate/product agents | Governance, not business KPIs |
| `AdminCollectibles` | Collectible seller review | Niche |
| `/api/admin/*` (15+ routers) | Reconciliation, FBO, warehouse, marketplace, bank, cards, agent-ops, … | curl-only; no charts |
| `GET /metrics` | Raw Prometheus | SRE must scrape; no in-app stability view |
| `fraud-engine` `:4500` | Case queue, decisions, remediation | Separate service; no SOC dashboard in Goeman |

As Corp B/C rails land (partner bank, cards, tokenization revenue), operators cannot answer “how is the
company doing?” without ad-hoc SQL and API calls. Phase 23 closes that gap **without** rebuilding analytics
from scratch — it **aggregates what already exists** behind a single read-only seam.

---

## 2. Vision & principles

**Vision:** One internal command center where the CEO sees business pulse, SRE sees stability, CISO/compliance
sees threat and money-integrity posture, and everyone drills into the **existing action surfaces** (approve
KYC, resolve fraud case, CEO launch gate) — not duplicate workflows.

**Principles (non-negotiable):**

1. **Read-only dashboards** — tiles and trends only; mutations stay on existing admin routes (`/api/admin/…`,
   agent-ops, fraud-engine actions).
2. **Ledger-derived money** — all currency amounts are integer **minor units** (`bigint` / string in JSON);
   never float. Aggregates come from `ledgerService` projections or existing services (`fboCoverage`,
   `statementService` patterns), not balance-column mutation.
3. **Aggregate by default for CEO** — counts and totals; no email/name tables on the CEO home (PII minimization).
4. **RBAC per section** — role gates on routes **and** API fields; `admin` is not a super-view into CEO-only
   financial narratives unless explicitly granted.
5. **Extend admin, don’t fork** — same `ADMIN_JWT`, same Quiet Premium admin styling, same passkey-ready auth
   path as Phase 5A/9.
6. **Agents narrate; code counts** — Agentic OS CFO/CISO skills may **summarize** Command Center JSON; live
   numbers always originate from `opsMetricsService`, never from LLM invention.
7. **Degrade gracefully** — if `fraud-engine` or Prometheus is unavailable, tiles show `degraded` + last-known
   snapshot; money tiles never fail open with zeros that look healthy.

---

## 3. Scope

### In scope (Phase 23)

- Backend: `opsMetricsService` + `/api/admin/command/*` read-only aggregation API.
- Frontend: `/admin/command/*` dashboard pages with role-aware nav.
- CEO business pulse, SRE stability summary, SOC/fraud command, compliance/money integrity, tokenization/marketplace analytics.
- Cross-links to existing consoles (Approvals, identity review, reconciliation admin actions).
- Tests: deterministic aggregate invariants (money exactness, RBAC deny, degraded fraud/prom paths).

### Out of scope (explicit non-goals)

- Replacing Grafana/Datadog/SIEM for deep SRE or SOC investigation.
- A second React app or mobile admin client.
- Customer PII search/export (stays in identity admin / compliance tooling).
- New money-moving capabilities or “dashboard actions” that bypass human gates.
- Real-time sub-second streaming (batch refresh 30–60s is fine for v1).
- Full BI warehouse UI (Phase 20 export pipeline feeds **23.6** historical series only).

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  frontend/admin  /admin/command/{ceo,sre,soc,compliance,…}  │
└────────────────────────────┬────────────────────────────────┘
                             │ GET /api/admin/command/*
┌────────────────────────────▼────────────────────────────────┐
│  opsMetricsService (NEW)                                     │
│  - SQL aggregates (ledger, onboarding, cards, marketplace)   │
│  - Optional prom snapshot (HTTP scrape /metrics or registry) │
│  - fraud-engine proxy (cases, decision counts)               │
│  - warehouse cursor freshness (Phase 20)                     │
└─────┬──────────┬──────────────┬──────────────┬───────────────┘
      │          │              │              │
   Ledger/DB   Prometheus    fraud-engine    warehouseExport
```

**File layout (planned):**

| Path | Purpose |
|---|---|
| `backend/src/services/opsMetricsService.ts` | Single aggregation seam; all dashboard queries |
| `backend/src/routes/commandCenterAdmin.ts` | RBAC-gated routes mounted at `/api/admin/command` |
| `frontend/src/pages/admin/command/` | Dashboard pages + shared chart/tile components |
| `frontend/src/pages/AdminCommandLayout.tsx` | Nav shell linking Command ↔ Identities ↔ Approvals |
| `backend/test/command-center.test.ts` | RBAC + aggregate invariants |

**Config (planned):**

| Env | Default | Purpose |
|---|---|---|
| `COMMAND_CENTER_ENABLED` | `true` in dev/test | Kill-switch; prod-fatal if disabled in production |
| `FRAUD_ENGINE_URL` | existing | SOC tiles proxy |
| `METRICS_TOKEN` | existing | Optional prom scrape auth |

---

## 5. Role matrix & routes

### Admin roles (existing + usage)

| Role | Command Center access |
|---|---|
| `ceo` | Full CEO pulse + links to Approvals; read-only SOC/SRE summary tiles |
| `chief_of_staff` | Same as CEO (backup) |
| `admin` | SRE, SOC, compliance, marketplace; **not** CEO financial narrative unless policy extended |
| `compliance` | Compliance/money integrity, SOC, onboarding depth; truncated CEO counts |
| `support` | Support-relevant tiles only (queue depth, no FBO/ledger totals) |

### Frontend routes

| Route | Primary audience | Content |
|---|---|---|
| `/admin/command` | All (role redirect) | Home: tiles allowed for role |
| `/admin/command/ceo` | CEO, CS | Business pulse (§6.1) |
| `/admin/command/sre` | admin, CEO (summary) | Stability (§6.2) |
| `/admin/command/soc` | admin, compliance, CEO (summary) | Security & fraud (§6.3) |
| `/admin/command/compliance` | compliance, admin | Money integrity (§6.4) |
| `/admin/command/marketplace` | admin, compliance, CEO | Tokenization (§6.5) |

**Nav integration:** Refactor existing admin header to include **Command · Identities · Approvals · Collectibles**.

---

## 6. Dashboard specifications

All timestamps ISO-8601 UTC. Money fields suffixed `Minor` as stringified `bigint`. Percentages as basis points
or explicit `{ num, den }` pairs — no floats in API contracts.

### 6.1 CEO — Business pulse

**Endpoint:** `GET /api/admin/command/ceo`  
**Roles:** `ceo`, `chief_of_staff`

| Tile | Metrics | Source |
|---|---|---|
| **Accounts** | Total users; active (Tier ≥ 1); net new 7d/30d; by tier histogram | `users`, `identity_profiles` |
| **Onboarding funnel** | Started → in_progress → pending_review → approved / rejected; **abandonment rate** (started, no progress 24h+) | `onboarding_sessions` |
| **Money flows** | Deposits/withdrawals 7d/30d (count + volume); card capture volume; bill pay volume | Ledger journals on `user_cash`, `external_clearing`, `card_holds`; `bank_transfers` |
| **Customer liability** | Total customer cash (USD minor); savings total; FBO covered boolean | Ledger aggregate; `fboCoverage()` |
| **Cards** | Cards issued (active); auths 24h/7d; decline rate | `cards`, `card_authorizations` |
| **Tokenization** | Listed assets; primary subscriptions 30d; secondary trades 30d; fee revenue 30d (ledger) | `marketplace_assets`, listings, escrow, marketplace journals |
| **Goeman Pay** | Payment intents paid 30d; GMV; open disputes | `payment_intents`, `escrow_events` |
| **Agent activity** | MCP calls 24h; SmartChat operation tokens 24h | `mcp_audit_logs`, `operation_tokens` |
| **Human gates** | Pending CEO reviews count; overdue compliance reviews | `agent_reviews` → link `/admin/approvals` |

**UX:** Single-page scroll; jade accent on “healthy” indicators; red only for hard gates (FBO drift,
reconciliation hold, overdue regulatory SLAs).

### 6.2 SRE — Stability

**Endpoint:** `GET /api/admin/command/sre`  
**Roles:** `admin`, `ceo`, `chief_of_staff` (summary subset for CEO)

| Tile | Metrics | Source |
|---|---|---|
| **API health** | p50/p95 latency; 5xx rate; request rate | Prometheus `http_request_duration_seconds` or cached snapshot |
| **Money path** | `ledger_post_total`; failed posts | Prometheus |
| **Hedera** | `hedera_tx_total{result}` success rate | Prometheus |
| **Reconciliation** | Settlement gated?; latest run status; drift account count | `reconciliationService`, `reconciliation_*` metrics |
| **Trading bulkhead** | Orders accepted vs shed; broker circuit state | `trading_*` metrics, `TRADING_ENABLED` |
| **Orchestration** | Temporal/Conductor money + ops worker health (degraded flags) | Config + optional health probes |
| **Kill-switches** | List of `*_ENABLED` flags that are off | `config.ts` safe export (no secrets) |
| **Incidents** | Open agent-ops SRE drafts; link to run incident-summary skill | `agent_runs` / agent-ops |

**Note:** Deep dashboards remain in Grafana; this view is the **“are we on fire?”** page.

### 6.3 SOC — Security & fraud command

**Endpoint:** `GET /api/admin/command/soc`  
**Roles:** `admin`, `compliance`, `ceo`, `chief_of_staff` (summary)

| Tile | Metrics | Source |
|---|---|---|
| **VP / agent access** | `vp_verify_total{result}`; replay blocks | Prometheus |
| **MCP abuse** | Calls by tool/result; scope denials; agent rate limits hit | Prometheus + `mcp_audit_logs` |
| **Fraud queue** | Open cases by severity; cases opened 24h; MTTR proxy | `fraud-engine` `GET /v1/cases` (backend proxy) |
| **Account controls** | Active freezes; holds placed 24h | `account_holds`, `account_hold_total` |
| **Auth attacks** | Lockouts; failed admin logins | auth limiter / audit_logs |
| **Model spend anomalies** | Invocations 24h; cost micro-USD spike | `model_invocations` (Agentic OS M4) |
| **Custody posture** | KMS wrap coverage % (keys encrypted); reconciliation hold | `kms` tests seam / admin summary |

**Actions:** Link out to fraud-engine case detail (future embed) and `/admin/approvals` for human gates —
no inline freeze from dashboard v1.

### 6.4 Compliance / CFO — Money integrity

**Endpoint:** `GET /api/admin/command/compliance`  
**Roles:** `compliance`, `admin`, `ceo`, `chief_of_staff`

| Tile | Metrics | Source |
|---|---|---|
| **FBO coverage** | Liability vs FBO balance; covered flag | `/api/admin/bank/fbo` logic |
| **Ledger⇄chain** | Latest reconciliation; findings count | `reconciliationService` |
| **KYC queue** | Pending onboarding reviews | `adminService.listReviewQueue` |
| **Regulatory SLAs** | Overdue agent reviews (`due_at`) | `listOverdueReviews()` |
| **Sanctions / filings** | Pending compliance-filing reviews | `agent_reviews` by skill |
| **Warehouse freshness** | Last export run; records lagging | `warehouseExportService` |

### 6.5 Marketplace — Tokenization analytics

**Endpoint:** `GET /api/admin/command/marketplace`  
**Roles:** `admin`, `compliance`, `ceo`, `chief_of_staff`

| Tile | Metrics | Source |
|---|---|---|
| **Assets** | Count by kind (security, collectible, equity); active listings | `marketplace_assets`, listings |
| **Primary issuance** | Subscriptions open/closed 30d; escrow held | escrow + marketplace journals |
| **Secondary** | Trades 30d; volume; compliance blocks | marketplace trade path |
| **Revenue** | Platform fees 30d (ledger fee accounts) | ledger fee currency codes |
| **Collectibles pipeline** | Pending seller submissions | collectibles admin queue |
| **Equity / redemption** | Redemptions pending; dividend distributions | Phase 18.6 services |

---

## 7. API contract (summary)

Base path: `/api/admin/command` — all routes require `requireAdmin` + role check.

| Method | Path | Roles | Response |
|---|---|---|---|
| GET | `/summary` | any admin | Role-filtered tile list + deep links |
| GET | `/ceo` | ceo, chief_of_staff | §6.1 payload |
| GET | `/sre` | admin, ceo, chief_of_staff | §6.2 payload |
| GET | `/soc` | admin, compliance, ceo, chief_of_staff | §6.3 payload |
| GET | `/compliance` | compliance, admin, ceo, chief_of_staff | §6.4 payload |
| GET | `/marketplace` | admin, compliance, ceo, chief_of_staff | §6.5 payload |

**Response envelope:**

```typescript
interface CommandCenterResponse<T> {
  asOf: string;           // ISO timestamp of aggregation
  degraded: string[];     // e.g. ["prometheus", "fraud_engine"]
  data: T;
}
```

**Caching:** In-process TTL 30s per section (configurable); stale cache served with `degraded` if refresh fails.

---

## 8. Reuse map (do NOT rebuild)

| Need | Use |
|---|---|
| Human gates / CEO approvals | `AdminApprovals`, `agentOpsAdmin`, `agent_reviews` |
| Identity / KYC queue | `AdminConsole`, `adminService` |
| FBO / bank ops | `bankAdminRouter`, `fboCoverage` |
| Reconciliation | `reconciliationAdminRouter`, `reconciliationService` |
| Warehouse | `warehouseAdminRouter`, `warehouseExportService` |
| Fraud cases | `fraud-engine` `/v1/cases` via `fraudClient` pattern |
| Metrics | `observability/metrics.ts`, `GET /metrics` |
| Agent summaries | Agentic OS CFO/CISO skills read Command Center JSON (post-23.1) |
| Money conventions | `backend/CONVENTIONS.md`, `db/money.ts` |

---

## 9. Agentic OS integration (post-M6)

| Agent | Command Center use |
|---|---|
| **CFO** | `GET /command/ceo` + `/command/compliance` → draft financial narrative (CEO gate unchanged) |
| **CISO** | `GET /command/soc` → posture report (`ciso-posture` skill already audits; wire to live data) |
| **COO/SRE** | `GET /command/sre` → incident summary context |
| **Goeman Brain** | Route “show me company health” → CEO pulse |

No new agent workflows required for Phase 23 v1; optional **23.7** adds `ceo-pulse-summary` skill that reads the API.

---

## 10. Staged build plan

Each sub-phase = backend slice + UI slice + tests. CEO sign-off optional per sub-phase deploy.

| Sub-phase | Deliverable | Acceptance |
|---|---|---|
| **23.0** | Admin nav shell; `/admin/command` redirect by role; `COMMAND_CENTER_ENABLED` | Nav links render; non-enabled returns 501 |
| **23.1** | `opsMetricsService` core + `/command/summary`; ledger-safe account counts | Tests: no float money; RBAC deny |
| **23.2** | CEO dashboard (§6.1) + `/command/ceo` | Funnel + money tiles match SQL spot checks |
| **23.3** | SRE dashboard (§6.2) + prom snapshot adapter | Degrades if `/metrics` unreachable |
| **23.4** | SOC dashboard (§6.3) + fraud-engine proxy | Case counts match fraud-engine |
| **23.5** | Compliance (§6.4) + marketplace (§6.5) | FBO + tokenization tiles |
| **23.6** | Warehouse-backed 7d/30d trend series on CEO/marketplace | Uses `warehouse_export_runs` cursors |
| **23.7** *(optional)* | Agentic OS: CFO/CISO “summarize pulse” skill reading Command API | Skill test with mocked JSON |

**Recommended first implementation slice after review:** **23.0 + 23.1 + 23.2** (CEO Business Pulse).

---

## 11. Testing strategy

| Test | Assert |
|---|---|
| `command-center.test.ts` | CEO route 403 for `support`; 200 for `ceo` |
| Money aggregates | Sum of journal entries = tile total (exact bigint) |
| Onboarding funnel | Counts partition sessions without overlap |
| Degraded mode | fraud-engine down → `degraded` includes `fraud_engine`; no throw |
| Append-only | Command Center never writes to ledger/money tables |
| Idempotency | Refresh endpoint safe to call repeatedly |

---

## 12. Launch & compliance notes

- **Phase A (current):** Command Center is **operational tooling**, not customer-facing; no new regulated
  activity. Demo/simulated rails still label tiles as simulated where applicable.
- **Corp B:** CEO and compliance dashboards become **launch blockers** for real money — FBO and reconciliation
  tiles must be green before go-live (`docs/LAUNCH.md` engineering gate).
- **Messaging:** Internal UI must not use “bank deposits” language inconsistent with `LAUNCH.md` Phase A posture.

---

## 13. Open questions (for review)

1. Should `admin` role see full CEO financial tiles, or only `ceo` / `chief_of_staff`?
2. Prometheus: in-process registry read vs periodic scrape job (affects 23.3 complexity)?
3. Embed fraud-engine case UI in iframe/panel vs link to separate analyst tool?
4. Historical trends (23.6): priority vs shipping 23.2 CEO pulse first?
5. New role `cfo` / `ciso` in RBAC, or map to existing `admin` + compliance?

---

## 14. Review checklist (before implementation)

- [ ] CEO confirms dashboard sections match how they want to run the company weekly
- [ ] Engineering confirms aggregation sources and no float money in API contract
- [ ] Compliance confirms PII boundaries on CEO vs compliance views
- [ ] Security confirms SOC tiles and fraud-engine proxy auth model
- [ ] Product confirms tokenization/revenue definitions match marketplace fee logic
- [ ] ARGUS-PLAN updated with Phase 23 entry (this doc linked)

---

*Phase 23 design — v1 draft. Implementation paused pending review.*
