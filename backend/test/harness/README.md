# Goemon agent harness

Executable step-by-step client for product journeys (J5–J7). Replaces the skill-only MCP harness with a CI-callable CLI.

**Plan:** [`docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md`](../../../docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md)

## Status

| Phase | Journey | Status |
|---|---|---|
| 0 | Scaffold (CLI, report, placeholders) | **Built** |
| 1 | J6 OID4VP → MCP | **Built** |
| 2 | J5 SmartChat + MFA | **Built** |
| 3 | J7 Marketplace | Planned |

## Run

```bash
cd backend
npm run harness -- --help
npm run harness -- --all          # j6 live + j5/j7 placeholders
```

### J5 / J6 (requires live API)

```bash
npm run seed:e2e
npm run dev                       # :3001
# other terminal:
npm run harness:j5
npm run harness:j6
```

Env overrides: `HARNESS_BASE_URL`, `HARNESS_DEMO_EMAIL`, `HARNESS_DEMO_PASSWORD`, `HARNESS_RECIPIENT_EMAIL` (default `blair@demo.com`).

- **J5** asserts: NL `$10` transfer (TTL ≤ 90s, no MFA), ledger debit in integer minor units, idempotent `POST …/tokens/:id/execute`, `$600` MFA gate + confirm.
- **J6** asserts: scoped token TTL ≤ 90s, MCP `get_balance`, `VP_INVALID`, `REPLAY_DETECTED`, `SCOPE_DENIED`.

## Artifacts

Written under `backend/test/.e2e-artifacts/<runId>/`:

- `report.json` — `{ runId, startedAt, finishedAt, baseUrl, status, journeys[] }`
- `summary.md` — human-readable trail
- `transcript.md` — redacted step trail (no raw VC/VP/tokens)

Artifact dirs are gitignored; regenerate on each run.
