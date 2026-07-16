# Goemon agent harness

Executable step-by-step client for product journeys (J5–J7). Replaces the skill-only MCP harness with a CI-callable CLI.

**Plan:** [`docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md`](../../../docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md)

## Status

| Phase | Journey | Status |
|---|---|---|
| 0 | Scaffold (CLI, report, empty placeholders) | **Built** |
| 1 | J6 OID4VP → MCP | Planned |
| 2 | J5 SmartChat + MFA | Planned |
| 3 | J7 Marketplace | Planned |

## Run

```bash
cd backend
npm run harness -- --help
npm run harness -- --all          # Phase 0: placeholders, 0 steps → PASS
npm run harness:j6                # same until Phase 1 adds steps
```

Phase 1+ requires a live API:

```bash
npm run seed:e2e
npm run dev                       # :3001
# other terminal:
npm run harness -- --journey j6
```

Env overrides: `HARNESS_BASE_URL`, `HARNESS_DEMO_EMAIL`, `HARNESS_DEMO_PASSWORD`.

## Artifacts

Written under `backend/test/.e2e-artifacts/<runId>/`:

- `report.json` — stable schema `{ runId, startedAt, finishedAt, baseUrl, status, journeys[] }`
- `summary.md` — human-readable trail

Artifact dirs are gitignored; regenerate on each run.
