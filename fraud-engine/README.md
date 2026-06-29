# Goeman Fraud Engine

A **standalone, real-time fraud-intelligence service** — the production-shaped build of
`docs/business/FraudEngine.md` Stages 2–4, delivered as an **add-on**. It imports nothing from the Goeman
backend; Goeman *uses* it over HTTP. The whole platform runs in one Node/TS process at prototype scale, with
each layer behind an interface that maps 1:1 to the north-star tech (Kafka, Flink, a feature store, a model
server, MLflow, a lakehouse), so production graduation is a swap, not a rewrite.

## Why a separate service

Fraud is a "listener-first" capability: it should subscribe to the bank's event stream, score with its own
models, and act — without coupling to core money code. Keeping it a separate deployable enforces that
boundary. Goeman's only dependency is a thin HTTP client (`backend/src/services/fraudClient.ts`) and a
service-authenticated callback route (`/api/internal/remediation`).

## Architecture (layer → north-star analog)

| Dir | Layer | North-star (FraudEngine.md) |
|---|---|---|
| `bus/eventBus.ts` | in-process pub/sub w/ consumer groups | Kafka / Redpanda backbone |
| `bus/schemaRegistry.ts` | versioned zod event schemas, validated on ingest | Avro/Protobuf Schema Registry |
| `features/featureStore.ts` | per-user state: velocity, trailing max, payees, sequence, geo/device | Flink state + online feature store |
| `features/enrichment.ts` | raw event → feature snapshot → enriched event | Flink stateful enrichment |
| `models/rulesModel.ts` (`rules-v1`) | deterministic typologies: velocity, spike, structuring, pass-through, geo/device | rules ensemble |
| `models/sequenceModel.ts` (`seq-v0`) | time-aware sequence scorer (robust z-score + burst + escalation) | served Transformer |
| `models/registry.ts` | versions + rollout status (prod/shadow/canary/retired) | MLflow / Model Registry |
| `models/serving.ts` | runnable model instances + `ServingBackend` seam | Triton / vLLM / SageMaker |
| `router/router.ts` | config-driven prod ensemble + shadow + hash-bucketed canary | dynamic model router |
| `router/decisionEngine.ts` | enrich → route → append-only decision → publish | decision pipeline |
| `cases/caseService.ts` | analyst alert/case queue + immutable case audit | case management |
| `remediation/*` | async consumer → open case → call Goeman to freeze/flag | decision → action loop |
| `learning/*` | outcome labels + retrain → register shadow candidate + drift | lakehouse + retraining |

**Invariant:** the model score is **advisory**; the deterministic `routing_config` thresholds decide the
action, and only the async path can escalate to `freeze`. This mirrors Goeman's own "model advisory,
deterministic code gates, humans review" rule (`assessRisk → finalizeDecision`).

Append-only tables (`decisions`, `case_events`) are enforced by SQLite triggers, like the Goeman ledger.

## Run

```bash
npm install
cp .env.example .env          # set FRAUD_ENGINE_API_KEY (and ARGUS_SERVICE_KEY to match Goeman)
npm run migrate               # create ./data/fraud.db
npm run dev                   # listen on :4500
npm test                      # vitest
```

Health: `curl localhost:4500/health` · Metrics: `curl localhost:4500/metrics`

## HTTP API (all `/v1` require `Authorization: Bearer <FRAUD_ENGINE_API_KEY>`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/events?mode=score` | sync scoring → returns a Decision (Goeman blocking path) |
| POST | `/v1/events?mode=async` | fire-and-forget → `202`; consumer may open a case + remediate |
| GET | `/v1/decisions?userId=` | decision history |
| GET | `/v1/cases` · `GET /v1/cases/:id` | analyst queue |
| POST | `/v1/cases/:id/resolve` · `/action` | resolve/dismiss; `action=freeze|unfreeze` calls Goeman back |
| GET | `/v1/models` · POST `/v1/models/:v/promote` | registry + rollout (`prod|shadow|canary`) |
| GET/PUT | `/v1/routing` | decision thresholds |
| POST | `/v1/labels` · POST `/v1/retrain` | outcome feedback → register a shadow candidate |

## How Goeman integrates (hybrid)

1. A money event hits `transferService` / `paymentService` → `fraudService.screenTransfer`.
2. The in-Goeman **triage** (the `rules-v0` scorer) classifies it:
   - **non-benign → blocking**: `POST /v1/events?mode=score`, wait, merge (advisory) → local deterministic
     gate blocks if effective action is `block`.
   - **benign → fire-and-forget**: `POST /v1/events?mode=async`, transfer settles immediately.
3. On a severe **async** decision the engine opens a case and (if `FRAUD_AUTO_REMEDIATE`) calls
   `POST {ARGUS_BASE_URL}/api/internal/remediation/freeze` (service bearer, idempotent on `decisionId`).
   Goeman records an append-only `account_holds` row; the frozen account can no longer move money.

If the engine is unreachable, Goeman **degrades open** (a missing fraud service never blocks money) unless
`FRAUD_REMOTE_REQUIRED=true`.

## Production graduation (out of scope here, by design)

Real Kafka/Flink/Triton/MLflow/lakehouse behind these interfaces; a trained neural Transformer in place of
`seq-v0`; cross-process exactly-once delivery. Same posture as Temporal/Conductor in the main repo — a
locked-architecture decision.
