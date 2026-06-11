# Phase 17 — Trading & Brokerage (Design)

**Status: design only — not built. Gated on Corp C (registered broker-dealer + clearing partner).**
This is the implementation-ready architecture for bringing Robinhood-class trading — equities, options,
and crypto spot — onto the Argus Financial Partners platform, **without letting the trading subsystem
degrade the money-critical SLAs** of the core bank (ledger, transfers, auth, agent/MCP access). It mirrors
the deliverable style of `docs/PHASE-15-INTERNAL-AGENT-OPS.md` and `docs/business/FraudEngine.md`.

> Read with: `docs/ARGUS-PLAN.md` Phase 17 (scope + corporate gate), `docs/business/CORPORATE-STRUCTURE.md`
> Phase C (broker-dealer/ATS), and Phase 4/8 in the plan (the ledger + asset-as-currency pattern this reuses).

---

## 0. The one-line thesis

**Trading is a separate, bulkheaded domain that the core bank never blocks on.** The ledger
(`backend/src/services/ledgerService.ts`) stays the single source of truth for *cash*; trading owns its own
orders/positions/market-data stores and touches the ledger **only at settlement**, asynchronously and
idempotently, through the existing `external_clearing` seam. A market-data storm, a broker outage, or a
runaway PnL computation can degrade *trading* — it can **never** breach the SLO of a `transfer`, a balance
read, an MCP scoped op, or a passkey login.

---

## 1. Why trading threatens the money-critical SLAs (the problem)

Trading introduces workloads with a fundamentally different shape from banking, and naïvely sharing
infrastructure lets them contend with money operations:

| Trading workload | SLA threat if coupled to the bank |
|---|---|
| **Market-data ingestion** (level-1 quotes, thousands of ticks/sec) | floods the shared DB + event loop; starves ledger writes |
| **Order placement → broker/clearing API** (variable latency, outages) | a stalled external call exhausts shared connection pools / blocks the Node event loop |
| **Position & PnL recompute** (per tick, per user) | CPU-bound work starves latency-sensitive money endpoints |
| **Price fan-out** to many connected clients | connection/memory pressure on the shared web tier |
| **Options greeks / margin** | bursty CPU; risk of synchronous coupling into order auth |

The core bank today is a **modular monolith on Node (single event loop)** with one Postgres/SQLite pool.
Without isolation, any of the above becomes a *noisy neighbor* that violates the bank's SLOs.

---

## 2. SLA classes — make the priority explicit and enforceable

Define two **classes of service** with separate, published SLOs. The governing rule:
**trading may be throttled, shed, or disabled to protect Class A; never the reverse.**

| Class | Surfaces | Target SLO (illustrative) | Degradation policy |
|---|---|---|---|
| **A — Money-critical** | ledger post, transfer, balance read, auth/passkey, DID/VC, MCP scoped op, idempotency | availability **99.95%**; `transfer` p99 **< 250ms**; **zero** correctness defects | never shed; protected by resource governor |
| **B — Trading** | order ack, fills, positions/PnL, market data, price fan-out | order-ack p99 **< 500ms** (excl. broker time); market data **best-effort** | shed/throttle first; kill-switchable without touching Class A |

These SLOs become real via per-class metrics (extend the prom-client registry in
`backend/src/observability/metrics.ts`), per-class rate limits, and a load-shedding/governor that
sheds Class B before Class A under pressure.

---

## 3. Architecture — bulkhead the trading domain, decouple at the money seam

```
            CLASS A (money-critical, protected)                     CLASS B (trading, isolated)
   ┌───────────────────────────────────────────┐        ┌─────────────────────────────────────────┐
   │  Core Bank (existing)                       │        │  Trading Service (NEW, own deploy)       │
   │  • auth / DID-VC / MCP                       │        │  • order mgmt (orders, fills)            │
   │  • ledgerService  ← SOURCE OF TRUTH (cash)   │        │  • positions / PnL (own store)           │
   │  • transferService / idempotency / audit     │        │  • market-data ingest + cache (CQRS)     │
   │  • own DB pool, own event loop               │        │  • risk: options approval, margin        │
   └───────────────▲─────────────────────────────┘        │  • own DB pool, own event loop, own scale │
                   │ settlement only                       └───────┬───────────────▲─────────────────┘
                   │ (async, idempotent,                           │ orders/fills  │ quotes
                   │  balanced journal)                            ▼               │
        ┌──────────┴───────────┐                          ┌────────────────┐  ┌───┴─────────────┐
        │ Settlement Worker     │◀── durable queue ───────│ Broker/Clearing │  │ Market-data feed │
        │ (idempotent ledger     │   (T+1 equities,        │  (partner BD)   │  │  (partner)       │
        │  post via external_    │    instant crypto)      └────────────────┘  └─────────────────┘
        │  clearing seam)        │        each behind a circuit breaker + bounded pool (anti-corruption layer)
        └───────────────────────┘
```

### 3.1 Topology — a separate bounded context (and, when trading goes live, a separate deployable)
- Trading is its **own bounded context** with its **own database/schema and its own connection pool**, so
  trading query load can never exhaust the bank's pool. At go-live (real money, real volume) it is a
  **separate deployable service** with independent CPU/memory and horizontal scaling — a true bulkhead, not
  just a module. (Prototype-scale Stage 1, §9, can live in-process behind a hard module boundary + its own
  pool, then be lifted out unchanged.)
- The bank does **not** import trading code on any Class-A path. Trading depends on the bank only through
  the narrow, asynchronous **settlement seam** (§3.2).

### 3.2 The money seam — settlement only, async, idempotent
- The **only** write trading makes to the core ledger is a **settled cash + position movement**, posted via
  `ledgerService.postJournal` keyed on an **idempotency key derived from the fill/order id** (the same
  pattern Phase 8 trades and `transferService` already use). Retries after broker/network failures
  **collapse to one journal** — exactly-once settlement.
- It posts through the existing **`external_clearing`** system account (the documented attach seam, see
  `ledgerService.ts` account kinds) for cash in/out, and models **positions as ledger currency codes**
  (the Phase 8 `ASSET:<id>` pattern) so a settlement journal balances per-currency *and* per-instrument,
  or reverts.
- Critically, this post happens on a **durable settlement worker draining a queue**, **never** synchronously
  in the order-acceptance path. The order hot path acks against the trading store; cash only moves when the
  trade *clears/settles* (instant for crypto, T+1 for equities). The ledger is therefore never on the
  market-data or broker-latency critical path.

### 3.3 CQRS — a separate read path for quotes, positions, PnL
- Market data, the order book view, positions, and PnL are served from a **read-optimized store**
  (cache / stream / materialized view), **not** from `ledger_entries`. The money DB is never read on the
  hot quote path.
- Price fan-out to clients uses **pub/sub (SSE/WebSocket)**, not DB polling, on the trading web tier —
  isolated from the bank's web tier so connection/memory pressure stays in Class B.

### 3.4 Durable trade lifecycle (Phase 20 / Temporal target)
- A trade is a **long-running, durable workflow**: `placed → routed → (partial) filled → cleared →
  settled`. This is the natural fit for the **Temporal** money-workflow target named in Phase 20 /
  Phase 15.4. The workflow owns retries, timeouts, and compensation; the **ledger post is the final,
  idempotent activity**. Until Temporal lands, the same contract runs on a durable queue + the
  idempotent settlement worker (the seam is engine-agnostic, exactly like the Phase 15 runner).

---

## 4. SLA-protection mechanisms (the checklist that enforces §2)

1. **Bulkheads** — separate process/service, DB, connection pools, and thread/concurrency budgets for
   trading; no shared event loop with Class A at go-live.
2. **Circuit breakers** — broker, clearing, and market-data integrations each behind a breaker with
   timeouts and a **bounded concurrency pool**; on trip → fail fast / degrade gracefully ("trading
   temporarily unavailable"), never back up into shared resources.
3. **Backpressure & load-shedding** — bounded queues with explicit drop/coalesce policy for market data;
   a **resource governor** sheds Class B before Class A under CPU/mem/DB pressure.
4. **Timeouts everywhere** — every external call has a deadline; no unbounded awaits that could pin the
   event loop.
5. **Per-class rate limits & quotas** — extend the existing limiter pattern
   (`authLimiter`/`apiLimiter`/`agentRateLimit`) with per-class and per-user trading limits.
6. **Kill-switch** — a config flag (`TRADING_ENABLED`, mirroring `HEDERA_ENABLED`/`FRAUD_ENGINE_ENABLED`)
   disables all trading instantly **without touching the bank** — a one-flag partial-outage control.
7. **Independent failure domain & scaling** — a trading outage leaves banking, wallet, transfers, and
   agent access fully up; trading scales horizontally on its own.
8. **Idempotent exactly-once settlement** — fill→ledger keyed on fill/order id (§3.2).
9. **Per-class observability & SLO alerting** — distinct counters/histograms + error budgets so a Class-B
   regression never hides inside Class-A metrics.

---

## 5. Domain model & reconciliation

- **New trading tables** (own schema): `instruments` (symbol, type=equity|option|crypto, tick/lot rules),
  `orders` (side, type, qty base units, tif, status, broker_order_id, idempotency_key), `fills`
  (order_id, qty, price, fee, cleared_at), `positions` (derived/materialized), `trading_accounts`
  (approval levels, options tier, margin enabled). **Money stays integer minor units / integer base units**
  — never float, per `CONVENTIONS.md`.
- **Cash & positions remain ledger-derived.** Positions are represented as ledger currency codes
  (Phase 8 pattern) at settlement; the trading `positions` table is a **fast read projection** that must
  **reconcile** to the ledger + broker statements daily (ties into the Phase 20 reconciliation job /
  invariant *n*). Any drift gates trading, not banking.
- **No second ledger.** The trading store records orders/fills/market-state; it never becomes an
  authoritative cash ledger. Authoritative cash = `ledgerService`.

---

## 6. External integrations (anti-corruption layer)

- **Broker-dealer / clearing**: introducing-broker via a partner (e.g. Apex/DriveWealth) first; options
  clear via OCC through the partner; **self-clearing only at scale**. Wrapped in an **anti-corruption
  layer** so partner-specific APIs never leak into the domain, and behind §4 breakers/timeouts.
- **Crypto spot**: routes through a **licensed venue/custodian** — distinct from the existing self-custodial
  Hedera USDC wallet (that stays non-custodial; spot trading is a custodial brokerage relationship under
  the partner's license).
- **Market data**: licensed level-1 feed (last/NBBO); replaces the Phase-8 simulated `pricingService`
  source/as-of/staleness model — which already has the right shape for a real feed.

---

## 7. Sub-phases

- **17.1 Equities & ETFs** — market/limit/stop orders, T+1 settlement, the order→fill→settle workflow,
  positions, the settlement seam. Compliance: Reg BI / suitability, best-execution, CAT reporting.
- **17.2 Options** — adds an **options-approval tier** (levels gate strategies), greeks/margin risk,
  OCC clearing, expanded risk disclosure. Strictly gated above the equities tier.
- **17.3 Crypto spot** — BTC/ETH/major pairs via a licensed venue/custodian; instant settlement;
  reuses the same order/settlement contract.
- **17.4 Margin / leverage** — **last**; adds credit risk + Reg T; only after 17.1–17.3 and a margin
  partner. Out of scope until then.

---

## 8. Compliance (Corp C surface)

Reg BI / suitability at order entry; options-approval levels; **best-execution** + order-routing
disclosure; **CAT** (Consolidated Audit Trail) reporting; market-data licensing; SEC/FINRA supervision.
These are **partner + license** obligations (broker-dealer/ATS), not pure engineering — hence the Corp C
gate. The existing **append-only audit** (`audit_logs`) + tiered identity + DID/VC give the recordkeeping
substrate; the licensed supervision layer is the missing piece.

---

## 9. Prototype Stage 1 — ✅ BUILT (simulated, fully isolated)

> **Status: built.** `backend/src/services/tradingService.ts` + `tradingBroker.ts` + migration
> `008_trading.sql` (`instruments`, `orders_trading`, append-only `fills`) + `TRADING_ENABLED` kill-switch
> + `trading_order_total`/`trading_settlement_total` metrics. Tests: `backend/test/trading.test.ts` (8) —
> incl. two **SLA-isolation** tests proving a stalled/failed broker cannot block or corrupt the money path.
> Full suite 149 pass / 3 todo.

Like the fraud Stage-1 seam, a **simulated** trading slice is built to prove the SLA-isolation
architecture **without a broker**:
- A **`tradingService`** behind a hard module boundary with **its own DB pool** and a `TRADING_ENABLED`
  kill-switch; a **simulated broker + simulated market-data** (deterministic, offline — mirroring the
  `simulated` provider pattern in `config.ts`).
- Orders ack against the trading store; a **settlement worker** posts the (simulated) fill to the ledger
  via `ledgerService.postJournal` keyed idempotently — exercising the exact money seam, exactly-once.
- Per-class metrics + a circuit breaker around the simulated broker, so the **isolation invariants are
  testable**: a forced broker stall / market-data flood must show **zero** impact on `transfer` latency
  and the §4 money invariants (a vitest like `fraud.test.ts`).
- This is throwaway-free: the simulated broker/feed become the anti-corruption-layer adapters that a real
  partner later implements.

---

## 10. What this design deliberately does NOT include

Real broker-dealer/clearing/ATS integration, real market-data licensing, options/margin go-live, the
Temporal engine itself (Phase 20), and any real-money trading — all gated on **Corp C** licensing/partners
(`CORPORATE-STRUCTURE.md` Phase C) and a locked-architecture decision. This document is the design; the only
buildable-now artifact is the isolated, simulated Stage-1 seam in §9.
```
Invariant restated: the double-entry ledger is the single source of truth for cash; trading mirrors
and settles into it, asynchronously and idempotently, and can always be shed to protect the bank.
```
