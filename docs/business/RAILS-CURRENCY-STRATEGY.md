# Rails, Currency & Instant-Payments Strategy

What Goemon should think about next on **instant payments**, **cross-border stablecoin rails**, and
**other currencies** — grounded in what's already built, with the honest gaps and the licensing posture.

> **How to read this.** Companion to `PAYMENT-NETWORK-STRATEGY.md` (the card-brand-vs-network analysis)
> and `CORPORATE-STRUCTURE.md` (the Corp A/B/C compliance ramp). Same tags: **DO NOW**,
> **DEFER → Corp B/C**, **⚖ see counsel**. Dollar/figure references are planning estimates, not quotes.
> This is strategy, not legal or investment advice.

---

## 1. The thesis (read this first)

**The instant, cross-border rail mostly already exists.** Goemon settles in **USDC on Hedera** — ~3s
finality, fractions-of-a-cent fees, no interchange, no chargeback reversals — wrapped in escrow for
disputes and authorizable by an AI agent under a scoped, user-signed grant. That *is* an instant,
global, programmable payment rail. The work that remains is **not the core** — it's at two edges:

- **The fiat edges.** Moving in/out of *fiat* instantly (FedNow/RTP/push-to-card) is not built — today
  `bankRailService`'s `"instant"` is a label, not a real-time rail. This is partner-bank gated (Corp B).
- **The currency surface.** The **ledger has always been multi-currency** (`ledgerService` balances
  journals *per currency group*; `Money` carries decimals), but every route hardcoded
  `z.enum(["USD","USDC"])` and there was **no FX engine**. The first build below fixes the surface.

```
                 ┌──────────────────────────────────────────────┐
   FIAT EDGE     │            USDC on Hedera (BUILT)             │   FIAT EDGE
  (gap: instant  │  ~3s · ~$0 fee · escrow disputes · agent-auth │  (gap: instant
   fiat in/out)  │     non-custodial · CCTP multi-chain reach    │   fiat in/out)
       ▲         └──────────────────────────────────────────────┘        ▲
       │                          ▲  currency surface                     │
   FedNow/RTP            (gap closed for the surface: registry + FX seam)  FedNow/RTP
   push-to-card                                                            local rails
```

**So: keep the stablecoin rail as the instant/cross-border core; invest at the edges only when partners
and licensing justify it.** Stablecoins before fiat FX; the registry + FX seam (built now) is the
enabler for everything else.

---

## 2. Instant payments

**What's instant today (DO NOW — already shipped):**
- **On-chain USDC** settles in ~3s via `hederaService` (build → sign → submit, non-custodial).
- **P2P** is built; **Goemon Pay** (Phase 21) settles merchant payments on the same rail, escrow-protected.

**What is *not* instant (DEFER → Corp B):**
- **Instant *fiat* out** — a real **FedNow** / **RTP** / **push-to-card** payout. `bankRailService` models
  `ach|wire|instant` but `"instant"` is a simulated method, not a wired real-time rail. ACH is the
  default and is *not* instant (1–3 days, returns).
- The honest framing: the rail is instant; the **off-ramp to a bank account** is only as instant as the
  partner bank's rails. FedNow/RTP need a **sponsor bank that supports them** (Corp B) + an MSB posture.

**Recommendation:** don't build a fake instant-fiat path. Keep stablecoin as the instant rail; add
FedNow/RTP at the edge when you take a BaaS partner (Phase 19 / Corp B). Optional small step now:
promote `bankRailService` `"instant"` from a label to a real seam *stage* (a `RealtimeRailProvider`
with simulated + `tch_rtp`/`fednow` stubs) so the integration is a provider swap later — same pattern
as every other seam. ⚖

---

## 3. Cross-border stablecoin rails (the strategic wedge)

This is where Goemon is genuinely differentiated and ~70% built. **Remittance + B2B payouts settled in
USDC**, with local fiat on/off-ramps per corridor.

**Reuses what exists:**
- **USDC on Hedera** (instant, ~$0) — the settlement layer.
- **`cctpService`** — Circle CCTP cross-*chain* USDC (ethereum/base/polygon/hedera) for **reach** into
  whichever chain a corridor partner lives on (simulated default; Circle prod-swap).
- **Escrow** (`escrowService`) — the dispute/chargeback substitute for an irreversible rail.
- **OID4VP + MCP + operation tokens** — agent-authorized, scope-limited cross-border payouts (a wedge
  card networks structurally cannot express).
- **`TRAVEL_RULE_ENABLED`** seam — the FATF Travel Rule originator/beneficiary data that cross-border
  payments require.

**What's new (gated):**
- **FX** (Part of the registry + FX seam — §4) to quote the local-currency leg.
- **Per-corridor on/off-ramp partners** (local bank / PSP / stablecoin liquidity in each country).
- **Per-jurisdiction sanctions + KYC** (the SANCTIONS_PROVIDER/IDV_PROVIDER seams extend here).
- **The business model:** an **FX spread** + a small rail fee — *not* the zero-fee domestic posture.
  Cross-border is where the margin is.

**Licensing (⚖ — Corp B/C, multi-year):** FinCEN **MSB** registration, **state money-transmission**
(or a sponsor that holds it), **per-country** licensing in each corridor, Travel Rule compliance, and
the 2025–26 **stablecoin regime** (GENIUS Act for USD stablecoins; **MiCA** if any EUR leg). This is
**not** near-term — but it's *architecturally seeded* today. Don't market "cross-border payments"
before the licenses exist (the `CORPORATE-STRUCTURE.md` §9 naming caution applies).

**Corridor-picking heuristic:** start where (a) USDC liquidity is deep, (b) a local ramp partner exists,
(c) the receive side *wants* dollars (high-inflation / remittance-heavy corridors), and (d) you can get
licensed or ride a partner. Don't boil the ocean — one corridor, end-to-end, first.

---

## 4. Multi-currency & FX

**The surprising finding: the ledger was already multi-currency.** What blocked other currencies was
the *surface* (hardcoded `z.enum(["USD","USDC"])` in every money route) and the absence of FX — not the
core. The **first build (below)** closes the surface gap.

**Sequencing rule — stablecoins before fiat FX:**
- **Stablecoins** (USDT, EURC, PYUSD) ride the *same* rail and are mostly a **registry entry** + their
  system ledger accounts. Cheap, on-rail, no new settlement mechanics.
- **Fiat FX** (true EUR/GBP balances) needs rate sourcing, **spread accounting**, and on/off-ramps in
  that currency — a bigger lift. Do it for cross-border corridors, not speculatively.

**"Do you need other currencies yet?"** For a **US-first launch: no fiat FX yet.** USD + USDC is right.
**But build the registry now** (done) so adding EURC/USDT later is a one-line flag, not a code sweep —
and so the cross-border corridor work has rates to quote.

**Regulatory notes (⚖):** USD stablecoins → the **GENIUS Act** regime (reserve/redemption/issuer rules);
EUR stablecoins → **MiCA**. Multiple stablecoins also raise **de-peg / reserve quality** risk — treat
"1 USDC = $1" as an assumption to monitor, not a law.

---

## 5. Other items to think about (the gaps you didn't ask about)

| # | Item | Why it matters | Posture |
|---|---|---|---|
| 1 | **Instant-fiat rails** (FedNow/RTP/push-to-card) | The only non-instant leg is the fiat edge | DEFER → Corp B (sponsor bank) ⚖ |
| 2 | **FX spread / fee model** | The cross-border business model; transparency vs. the zero-fee wedge | DO NOW (design); price at Corp B |
| 3 | **Per-currency system accounts** | Enabling a currency needs its escrow/fee/clearing ledger accounts | **BUILT** — settlement creates them on demand (`getOrCreateSystemAccount`) |
| 4 | **Cross-currency *settlement*** | Quote→convert journal (debit FROM, credit TO, spread→fee) touches the money path | **BUILT** — `fxSettlementService` (§6.2) |
| 5 | **Multi-chain reconciliation** | Phase-20 ledger⇄chain recon is Hedera-only; CCTP reach needs per-chain recon | DEFER → Stage 1 |
| 6 | **Yield on stablecoin balances** | Tempting, but paying yield on deposits can make you an **unregistered security / bank** | ⚠ ⚖ sharp edge — counsel first |
| 7 | **De-peg / reserve risk** | A stablecoin is only as good as its reserves; don't assume 1:1 | DO NOW (monitor; diversify) |
| 8 | **Multi-rail redundancy** | Single-chain = single point of failure; CCTP gives Base/Solana fallback | DEFER → Stage 1 |
| 9 | **Off-ramp diversity** | Cards-push, RTP, local rails — don't depend on one exit | Corp B |
| 10 | **Travel Rule at scale** | Per-jurisdiction originator/beneficiary data on cross-border | seam exists; wire a vendor at Corp B ⚖ |
| 11 | **Treasury custody** | Multi-currency/stablecoin treasury keys — KMS/HSM + multisig (built for Hedera) | extend per chain |
| 12 | **Dust / rounding** | 2dp fiat vs 6dp tokens; floor-rounding on conversion creates dust | handled by `Money.decimals`; define a dust policy at settlement |

---

## 6. What's built: registry + FX quote seam + cross-currency settlement

Prototype seams in the exact pattern of the others (swappable provider, `simulated` default +
`NOT_IMPLEMENTED` prod stubs, kill-switch, append-only audit, a `*_total` metric).

### 6.1 Registry + quote (read-only; no ledger write)

- **`currencyRegistry.ts`** — one source of truth (`code/decimals/kind/enabled`); `isSupportedCurrency`,
  `assertSupported`, `currencySchema()`. Replaces the scattered `z.enum(["USD","USDC"])` across
  `accounts/pay/escrow/mcp/myAgents/admin/marketplaceAdmin` and the service-level allowlists in
  `escrowService`/`paymentService`. Seeds USD/USDC/USDT live + **EURC defined-but-disabled** (flip one
  flag to admit it — proven by `fx.test.ts`, no handler code touched).
- **`fxRateService.ts`** — `FxRateProvider` seam (`FX_RATE_PROVIDER`: simulated | circle | oanda);
  `quote({from,to,amountMinor})` → exact **integer** conversion (parts-per-million rates, decimal-aware)
  with `source/asOf/stale`; append-only `fx_quotes` snapshots (migration 033); `FX_ENABLED` kill-switch
  (**prod-fatal while simulated**); `fx_quote_total` metric.
- **`/api/fx`** — `GET /currencies`, `POST /quote`.

### 6.2 Cross-currency settlement (moves money; deferred-then-built)

The money-moving stage now exists too — kept as a **separate** kill-switch from quotes because it
touches the ledger:

- **`fxSettlementService.ts`** — `convert()` settles a conversion as **one balanced journal across two
  currency groups**, joined by an `fx_settlement` treasury account, with an explicit spread fee in the
  TO currency: `FROM: user→fx_settlement` (nets 0) and `TO: fx_settlement→user + fee` (nets 0). Exact
  integer math; **idempotent** (exactly-once at the ledger); balance-gated (`INSUFFICIENT_FUNDS`);
  per-currency system accounts created **on demand** (closes gap #3). Append-only `fx_conversions`
  (migration 034); `fx_conversion_total` metric.
- **`FX_SETTLEMENT_ENABLED`** kill-switch + **`FX_SPREAD_BPS`** (default 50 = 0.50%); **prod-fatal while
  the rate provider is simulated** (settling at a fake rate is a prototype).
- **`/api/fx`** — `POST /convert` (auth + Idempotency-Key), `GET /conversions`. A frontend widget
  (`pages/Fx.tsx`) drives quote → convert.

**Still deferred (its own plan):** multi-chain reconciliation of the FX treasury position, slippage
controls, and real-rate provider integration. The simulated rate keeps this a prototype — a real
provider (circle/oanda) is the prod swap.

---

## 7. Sequencing onto the compliance ramp

| Stage | Currency / rails | Corp phase |
|---|---|---|
| **Now** | USD + USDC live; registry + FX quote **and cross-currency settlement** (prototype); +USDT/EURC are a flag | **Corp A** (non-custodial software) |
| **Stage 1** | Real-rate provider; multi-chain (CCTP) reach + FX-treasury recon; instant-fiat seam | **Corp B** (partners + FinCEN MSB) |
| **Stage 2** | One cross-border corridor end-to-end (FX spread, local ramp, Travel Rule) | **Corp B/C** (per-country licensing) ⚖ |
| **Stage 3** | Own corridors / liquidity; multi-currency treasury at scale | **Corp C** |

**The throughline:** the instant, programmable, cross-border *rail* is already yours (USDC on Hedera).
You spend on FX, instant-fiat edges, and corridor licensing only as partners and volume earn it —
the same lean-now / licensed-later logic as the corporate ramp.

---

*Companion documents: `PAYMENT-NETWORK-STRATEGY.md` (card brand vs. network; the stablecoin-rail wedge),
`CORPORATE-STRUCTURE.md` (the Corp A/B/C ramp), `GOEMON-PLAN.md` Phases 19–21 (bank rails, Goemon Pay).
The registry + FX quote seam and cross-currency settlement referenced in §6 are implemented
(`backend/src/services/currencyRegistry.ts`, `fxRateService.ts`, `fxSettlementService.ts`, `routes/fx.ts`,
`test/fx.test.ts`; frontend `pages/Fx.tsx`).*
