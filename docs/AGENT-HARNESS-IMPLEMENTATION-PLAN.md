# Agent Harness — Implementation Plan

**Status:** Phase 0 built — Phases 1–7 planned  
**Goal:** Replace the skill-only Phase 16 MCP/E2E harness with an executable, step-by-step client that walks Goemon product journeys (J5–J7 first), is CI-callable, and later feeds Agentic OS QA.

**Non-goals (this plan):**
- Do not put money side effects inside Temporal/Conductor as a second ledger — harness calls HTTP like a real client.
- Do not overload `journeyRunner` with validation DAGs in v1 (optional Phase 7).
- Do not use frontend Console as the CI host.

**Related:** `docs/E2E-VALIDATION.md`, `.claude/skills/e2e-validator/SKILL.md`, `.claude/skills/goemon-mcp-test-harness/SKILL.md`, `goemon-agent/`, `scripts/launch-gate.sh`, `docs/AGENTIC-OS.md`, `docs/PHASE-24-PRODUCTION-LAUNCH.md`.

---

## Architecture (target)

```
                    ┌─────────────────────────────┐
                    │  e2e-validator skill / CI    │
                    │  launch-gate.sh              │
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │  npm run harness            │
                    │  backend/test/harness/cli.ts│
                    └─────────────┬───────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   j5-smartchat.ts         j6-oid4vp-mcp.ts        j7-marketplace.ts
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  ▼
                    client.ts + walletSim.ts
                    (HTTP + jose ES256 + Idempotency-Key)
                                  │
                                  ▼
                    localhost:3001  (npm run dev)
                                  │
                                  ▼
                    .e2e-artifacts/<runId>/report.json
```

**Conventions (non-negotiable):**
- Money = integer minor units (`bigint` / string of digits); never float.
- Money POSTs send `Idempotency-Key`.
- Branch on `error.code` (`VP_INVALID`, `SCOPE_DENIED`, `REPLAY_DETECTED`, `MFA_REQUIRED`, `COMPLIANCE_BLOCKED`, …).
- Harness never holds production private keys; wallet sim is ephemeral ES256 (same posture as `goemon-agent`).

---

## Phase 0 — Scaffold

**Outcome:** Empty harness package that boots, writes a report skeleton, and exits 0/1.

### Files to add

| Path | Purpose |
|---|---|
| `backend/test/harness/types.ts` | `StepResult`, `JourneyResult`, `HarnessReport`, `StepFn` |
| `backend/test/harness/runner.ts` | Sequential step walker; budgets; fail-fast vs continue flags |
| `backend/test/harness/client.ts` | `fetch` wrapper: base URL, bearer, `Idempotency-Key`, decode `error.code` |
| `backend/test/harness/walletSim.ts` | Stub: generate ES256 keypair + `did:key` (fill in Phase 1) |
| `backend/test/harness/cli.ts` | CLI entry: `--journey j5,j6,j7` / `--all` / `--base-url` |
| `backend/test/harness/report.ts` | Write `backend/test/.e2e-artifacts/<ts>/report.json` + `summary.md` |
| `backend/test/harness/README.md` | How to run against a live server |

### Scripts / config

```jsonc
// backend/package.json
"harness": "tsx test/harness/cli.ts",
"harness:j6": "tsx test/harness/cli.ts --journey j6"
```

- Add `backend/test/.e2e-artifacts/` to `.gitignore` (keep a `.gitkeep` or document regen).
- Env: `HARNESS_BASE_URL` (default `http://localhost:3001`), `HARNESS_DEMO_EMAIL` / password (default demo seeds).

### Acceptance criteria

- [x] `npm run harness -- --help` prints journeys and exits 0
- [x] With placeholder journeys (0 steps), `--all` writes a PASS report and exits 0
- [x] Report path printed to stdout; JSON schema stable (`{ runId, startedAt, journeys: [{ id, status, steps[] }] }`)
- [x] `npm run typecheck` still green

### Dependencies

- Backend deps already include `jose`, `uuid` — no new packages expected.
- Requires a running API only once journeys are added (Phase 1+).

### Phase 0 delivered

`backend/test/harness/{types,client,walletSim,runner,report,registry,cli}.ts`, `README.md`, `npm run harness` / `harness:j6` / `harness:all`, gitignored `.e2e-artifacts/`.

---

## Phase 1 — Port J6 (OID4VP → MCP) — security-critical first

**Outcome:** Executable coverage of the external-agent path currently described only in the skill + `presentation.test.ts`.

### Extract / port from

| Source | Lift |
|---|---|
| `goemon-agent/src/lib/wallet.ts` | ES256 key + `signPresentation` (Node: no `localStorage` — in-memory / temp file) |
| `goemon-agent/src/lib/didKey.ts` | Prefer import from backend `src/utils/didKey.ts` to avoid drift |
| `goemon-agent/src/lib/api.ts` / `agent.ts` | challenge → present → mcp/call step order |
| `backend/test/presentation.test.ts` | Wrong-key, replay, nonce, grant-missing, scope intersection cases |
| `backend/src/scripts/first-run-setup.ts` | Simulator MCP client `did:simulator:agent-app` already seeded |

### Files to add / change

| Path | Purpose |
|---|---|
| `backend/test/harness/walletSim.ts` | Full jose ES256 signer + did:key |
| `backend/test/harness/journeys/j6-oid4vp-mcp.ts` | Step list below |
| `backend/test/harness/setup.ts` | Login demo user, issue VC, bind wallet, ensure grant |
| `backend/test/harness/cli.ts` | Register `j6` |

### J6 steps (ordered)

1. **Health** — `GET /api/health` → 200  
2. **Auth** — password login as seeded Tier-2 demo (`alex@demo.com`) when `ALLOW_PASSWORD_AUTH`  
3. **Issue VC** — `POST /api/credentials/issue` (idempotent)  
4. **Bind wallet** — `POST /api/credentials/bind-wallet` with sim `did:key`  
5. **Grant** — ensure grant for `did:simulator:agent-app` with scopes ∩ client ceiling  
6. **Challenge** — `POST /api/present/challenge` → nonce + aud  
7. **Happy path** — sign VP → `POST /api/present` → scoped token; assert `expires_in ≤ 90`  
8. **MCP transfer or balance** — `POST /api/mcp/call` within scope → PASS  
9. **Wrong key** — VP signed by unbound key → `VP_INVALID`  
10. **Replay** — resubmit same VP hash → `REPLAY_DETECTED`  
11. **Scope deny** — request/call outside grant → `SCOPE_DENIED`  

### Acceptance criteria

- [ ] Against `npm run setup` + `npm run dev`: `npm run harness:j6` exits 0  
- [ ] Failures surface `error.code` in step detail (not opaque HTTP text)  
- [ ] Artifacts include HTTP transcript snippets (redact tokens/VC/VP per logging conventions)  
- [ ] No private key material written to artifacts  
- [ ] Overlaps with `presentation.test.ts` are OK (harness = live HTTP; vitest = in-process)

### Preconditions

```bash
cd backend && npm run seed:e2e && npm run dev
# separate terminal:
npm run harness:j6
```

---

## Phase 2 — Port J5 (SmartChat + MFA + idempotency)

**Outcome:** NL → operation token → MFA gate → transfer → replay, as a real client.

### Extract / port from

| Source | Lift |
|---|---|
| `backend/test/phase6.test.ts`, `smartchat-rails.test.ts` | Intent shapes, MFA threshold, token TTL |
| `frontend/src/pages/Agent.tsx` / `Console.tsx` | User-facing request shapes (reference only) |
| `.claude/skills/goemon-mcp-test-harness/SKILL.md` | J5 procedure |

### Files

| Path | Purpose |
|---|---|
| `backend/test/harness/journeys/j5-smartchat.ts` | Step list below |
| `backend/test/harness/cli.ts` | Register `j5` |

### J5 steps (ordered)

1. Auth as funded demo user (Tier-2, sufficient cash)  
2. **Small transfer NL** — e.g. “send $10 to …” → classify → operation token; assert TTL ≤ 90s  
3. **Execute** via token; assert one balanced journal; amounts as integer minor units  
4. **Idempotent replay** — same token/jti → one effect  
5. **Large transfer NL** — amount > $500 → assert MFA required (`MFA_REQUIRED` or equivalent gate) before execute  
6. Complete MFA (dev path / test bypass if documented) → transfer succeeds once  

### Acceptance criteria

- [ ] `npm run harness -- --journey j5` exits 0 on seeded DB  
- [ ] Step trail distinguishes MFA-gated vs auto-approve paths  
- [ ] Replay step fails the journey if a second journal posts  
- [ ] Deposit / non-money intents optional; out of scope for v1 unless cheap

---

## Phase 3 — Port J7 (Marketplace subscribe / compliance)

**Outcome:** Quote → Tier-2 escrow subscribe; Tier-1 / unregistered recipient gated.

### Extract / port from

| Source | Lift |
|---|---|
| `backend/test/phase8.test.ts` | Escrow subscribe, `COMPLIANCE_BLOCKED` |
| `npm run seed:marketplace` | Asset IDs / listings |
| Skill J7 NL path | Optional NL “subscribe …” via SmartChat if stable; else direct API steps OK for v1 |

### Files

| Path | Purpose |
|---|---|
| `backend/test/harness/journeys/j7-marketplace.ts` | Quote → subscribe → assert escrow hold; negative compliance case |
| `backend/test/harness/cli.ts` | Register `j7` |

### J7 steps (ordered)

1. Auth Tier-2 user; ensure marketplace seed present  
2. **Quote** — fee disclosed (gross / fee / net as integer minor units)  
3. **Subscribe** (primary issuance escrow) → hold journal balanced  
4. Auth / switch to under-tier or unregistered recipient path  
5. Assert `COMPLIANCE_BLOCKED` (or listing gate) with stable `error.code`  

### Acceptance criteria

- [ ] `npm run harness -- --journey j7` exits 0 after `seed:marketplace`  
- [ ] Fee fields never parsed as float  
- [ ] DET coverage in `phase8.test.ts` remains; harness adds client-shaped AGT path

---

## Phase 4 — Wire skills + launch gate + docs

**Outcome:** Skills and CI call code; docs stop claiming “skill-only” as the source of truth.

### Files to change

| Path | Change |
|---|---|
| `.claude/skills/goemon-mcp-test-harness/SKILL.md` | Procedure → “run `npm run harness -- --journey …`”; keep assertion table |
| `.claude/skills/e2e-validator/SKILL.md` | Floor: `typecheck` + `vitest run e2e` → then `npm run harness -- --all` |
| `scripts/launch-gate.sh` | After backend tests: start/reuse server or document “server required”; run harness; FAIL gate on non-zero |
| `docs/E2E-VALIDATION.md` | Update §1/§5/§6: AGT = code harness; remove “phases not all built” staleness; document CLI |
| `docs/LAUNCH.md` / `docs/business/LAUNCH-READINESS.md` | B3 checkbox references `npm run harness` |
| `CLAUDE.md` | Phase 16 note: hybrid = vitest + `npm run harness` |
| `backend/package.json` | `harness`, `harness:all` scripts |

### Launch-gate design choice (pick one in implementation)

| Approach | Pros | Cons |
|---|---|---|
| **A.** Harness starts API via subprocess | Self-contained CI | Port races; heavier |
| **B.** Require `HARNESS_BASE_URL` already up | Simple; matches skill today | CI must orchestrate two steps |
| **C.** Vitest globalSetup boots app (supertest) | No port | Less “real client”; diverges from skill |

**Recommendation:** **B for v1** (document in launch-gate); **A as follow-up** if CI flakes on manual server.

### Acceptance criteria

- [ ] Fresh clone path documented: `seed:e2e` → `dev` → `harness --all`  
- [ ] `e2e-validator` skill text matches code entrypoints  
- [ ] Launch gate fails when harness fails (when server available)  
- [ ] Artifacts path unchanged: `backend/test/.e2e-artifacts/`

---

## Phase 5 — Agentic OS: product-qa executes harness

**Outcome:** `product-qa` / PDLC stops faking `testsGreen: true`; runs harness under `runOperation` and escalates on FAIL.

### Files to change

| Path | Change |
|---|---|
| `backend/src/operations/skills/productSquadSkills.ts` | Add tool `run_e2e_harness` (scope `product:draft` or tighter `product:qa`) that spawns `tsx test/harness/cli.ts --all` or imports runner in-process |
| Workflow def for `product-qa` | Gate: FAIL → `human_required` / CEO if launch proposal; PASS → continue PDLC |
| `docs/AGENTIC-OS.md` | Document AI QA agent executes harness; append-only `agent_runs` trail |
| Admin surface | Optional: show last harness report link in Approvals / agent-ops |

### Design constraints

- Prefer **subprocess** with timeout + cwd `backend/` so harness stays a plain client (no ops runner importing money services).
- Capture exit code + summary.md into `agent_runs` detail (no raw VC/VP/tokens).
- Kill-switch: if harness binary missing, escalate (fail closed for launch proposals).

### Acceptance criteria

- [ ] Triggering product-qa with harness down or failing journey creates a review (not auto-approve)  
- [ ] Green harness allows PDLC launch proposal path to proceed to existing CEO gate  
- [ ] `productSquadSkills` no longer hardcodes `testsGreen: true` without running tools  
- [ ] Ops tests cover degrade/escalate (`backoffice` / new `harness-ops.test.ts`)

---

## Phase 6 — Optional: validation as `JourneyDef` data

**Outcome:** Only if product wants one declarative engine for onboarding *and* QA.

### Approach

- New step types in `backend/src/journeys/stepRegistry.ts`: `http_assert`, `mcp_call`, `wallet_sign` (test-only; gated by `JOURNEYS_ENABLED` + `HARNESS_JOURNEYS=1`).
- JourneyDefs under `backend/test/harness/journey-defs/` mirroring J5–J7.
- Runner remains `journeyRunner` for product; harness CLI can `startJourney` for validation defs **or** keep parallel `runner.ts`.

### Acceptance criteria

- [ ] Validation journey defs do not execute in production customer traffic  
- [ ] Existing onboarding shadow journey unchanged  
- [ ] Document tradeoff vs Phase 0–3 `runner.ts` — prefer keeping `runner.ts` unless SDUI/builder needs one schema

**Default:** skip until journey builder / SDUI needs a shared step vocabulary.

---

## Phase 7 — Optional extensions (Phase 24+)

Documented for backlog; not required for B3 green:

| Journey | Notes |
|---|---|
| Pay / x401 / x402 | Per `docs/PHASE-24-PRODUCTION-LAUNCH.md` A4 |
| Bank rails NL | SmartChat `bank.deposit` / `bill.pay` already in `smartchat-rails.test.ts` — promote if needed |
| iOS channel | Out of band — `verify-ios-wallet.sh` + manual smoke; harness stays API/agent |

---

## Build order summary

| Phase | Deliverable | Exit gate |
|---|---|---|
| **0** | Scaffold + CLI + report | typecheck; empty harness OK |
| **1** | J6 OID4VP/MCP | `harness:j6` green vs live server |
| **2** | J5 SmartChat/MFA | `harness --journey j5` green |
| **3** | J7 marketplace | `harness --journey j7` green |
| **4** | Skills + launch-gate + docs | B3 runnable from docs alone |
| **5** | Agentic OS product-qa executes harness | FAIL escalates; no fake green |
| **6** | (Optional) JourneyDef validation DAGs | Only if product asks |
| **7** | (Optional) Pay/x401 journeys | Phase 24 backlog |

---

## Suggested PR slices

1. **PR1 — Scaffold** (Phase 0)  
2. **PR2 — J6** (Phase 1) — highest security value  
3. **PR3 — J5** (Phase 2)  
4. **PR4 — J7** (Phase 3)  
5. **PR5 — Wire-up** (Phase 4)  
6. **PR6 — Agentic OS QA** (Phase 5)

Keep each PR green on `npm run typecheck && npm test`; harness journeys need a live server in CI only once Phase 4 chooses approach A or a compose service.

---

## Definition of done (whole plan)

- [ ] `cd backend && npm run seed:e2e && npm run harness -- --all` is the documented AGT path  
- [ ] Skills are thin wrappers over that CLI  
- [ ] Launch readiness B3 can be checked without a Claude session  
- [ ] Agentic OS PDLC QA calls the harness for real  
- [ ] Artifacts land in `backend/test/.e2e-artifacts/` with redaction  
- [ ] J1–J4/J8 remain DET in vitest; harness owns J5–J7 AGT  

---

## Open questions (resolve during Phase 0–1)

1. **CI server lifecycle** — launch-gate approach A vs B (see Phase 4).  
2. **MFA in harness** — use existing test/dev MFA completion endpoint vs simulate WebAuthn.  
3. **Shared did:key helper** — import backend `didKey.ts` from harness vs duplicate (prefer import).  
4. **Demo user isolation** — dedicated `harness@demo.com` seed vs reuse `alex@demo.com` (prefer dedicated to avoid balance races with Playwright).  

Resolve #4 in Phase 1 setup by adding `npm run seed:harness-user` or extending `seed:users` if races appear.
