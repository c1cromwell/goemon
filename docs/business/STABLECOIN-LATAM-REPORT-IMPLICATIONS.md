# Stablecoin LATAM (Stabledash × Bitso, MCS26) — What It Means for Goemon

**Source:** `docs/Stabledash x Bitso_MCS26_report.pdf` — Stabledash's field report from the **Bitso
Stablecoin Conference LATAM 2026** (Mexico City), synthesizing 19 founder/operator interviews
(Lightspark, Anchorage, Juno/Bitso, Morpho, Capa, Etherfuse, Incode, Rain, Verda, United Texas Bank,
Modern Treasury, El Dorado, Minteo, and others).

**Date:** 2026-07-09 · **Audience:** founder / internal · grounded in a 3-seam codebase audit.

> **The report's thesis, one line:** stablecoin *tech is settled* ("plumbing, not speculation"). The
> value moved to what the coin itself can't capture — **local (non-dollar) currency, onchain credit
> & FX, licenses ("close to the metal"), distribution/brand, and the trust layer (custody,
> settlement, compliance, identity)** — and the flagged next frontier is **"proving personhood when
> software agents move money."**

**The finding:** the report is essentially describing **Goemon's architecture as the winning shape**.
Goemon is closer to the frontier than expected — but **USD-pinned**, and it is **missing the one
thing it is best positioned to own: agent personhood.**

---

## 1. What it means for Goemon (seven themes)

1. **Speculation → plumbing.** Goemon is already plumbing-first (double-entry ledger, settlement,
   rails). Validated. Lead with "it just works," not tokens.
2. **Regulation is the moat; "close to the metal."** Reinforces the go-live licensing call in
   `docs/business/TOKENIZATION-GO-LIVE-STRATEGY.md`: the passthrough model is right for launch, but
   *owning* the license is the durable moat. No code — a strategy reinforcement.
3. **The dollar is settled; the race is local currency.** Goemon is **USD/USDC-only today** — the
   clearest product gap. But the money layer is genuinely registry-driven (`currencyRegistry.ts`)
   and FX/cross-border already exist, so this is nearer than it looks.
4. **Market cap is the wrong scoreboard; turnover wins.** Local coins are transaction rails, not
   savings — "almost nobody holds a balance." Goemon measures balances/AUM, not turnover/velocity.
5. **The real prize is credit & FX.** Onchain lending (Morpho ~$10B deposits; Juno launched the
   first MXN-denominated lend-borrow vault) and FX (Mexico USDC spread compressed ~250 bps → ~2.5
   bps). LATAM lend-borrow spreads are 10+ points vs ~3.5 in the US. Goemon has lending (USD-only,
   no supply/LP side) and FX (simulated, single-spread) — half-built for exactly this.
6. **Tech is a commodity; distribution/licenses/brand win. Cards are a wedge.** Goemon has the card
   wedge (`cardService`). Distribution/brand is the real weakness (pre-launch) — a GTM concern.
7. **Trust is the floor; AI escalates fraud; prove personhood for agents.** The headline. Incode
   flagged "proving who stands behind the agents" as the next frontier. Goemon already has the
   DID/VC + OID4VP + agent-grant stack — **~80% of the way to the one frontier the report says
   nobody has solved** — but KYC is simulated and there is **no explicit "a verified human
   authorized this agent" attestation.**

**Bottom line:** strong validation, and a spotlight on Goemon's most defensible, least-crowded edge —
**agent personhood.** Lean into that first (small, no licensing, pure differentiation); treat
local-currency + credit/FX as the bigger, partly license-gated bets Goemon is architecturally ready
for.

### Selected figures from the report (participant claims, not audited)
- ~$1.2B onchain volume through Minteo (COPM) in the trailing 12 months, from ~$100k/mo at launch.
- Mexico USDC FX spread ~250 bps → ~2.5 bps in three years (~100× compression).
- ~$10B deposits on Morpho's onchain lending rails; a Coinbase product on Morpho holds >$2B.
- Brazil's IOF tax on FX raised ~10× (0.38% → 3.5%), pushing volume onto stablecoin rails.
- Etherfuse regulatory timeline: ~2.5 years (Mexico) vs ~3 months (Kazakhstan).

---

## 2. Gap analysis (grounded in the code)

| # | Report says | Goemon today | Gap | Effort |
|---|---|---|---|---|
| 1 | Local-currency coins win | USD/USDC only; `currencyRegistry.ts` ready; EURC/OUSD defined-but-disabled | No enabled non-USD coin; ramps USD-pinned; `settlementStablecoin()` seam unwired; Hedera rail USDC-specific | Med |
| 2 | FX collapsing onchain, biggest near-term market | `fxRateService`/`fxSettlementService`/`crossBorderService` exist; simulated rate, single symmetric spread | No real rate feed; no FX buy/sell with directional spread | Med |
| 3 | Onchain credit = "sleeping superpower of non-dollar" | `lendingService` USD-only (`BORROW_CURRENCY="USD"`), single `lending_pool`, no LP side | No non-USD loans; no real vault/liquidity side | Med |
| 4 | RWA becomes the collateral layer | Only the treasury `ATB` is eligible collateral (only asset with `metadata.parMinor`) | Broader RWA not pledgeable; par-only valuation, no oracle | Med |
| 5 | Turnover, not market cap | Balance/AUM metrics only | No turnover/velocity metric | Low |
| 6 | Deterministic identity is the trust layer (Incode) | KYC simulated; `IDV_PROVIDER` enum exists but only read by a prod gate; no liveness | No wired swappable IDV vendor seam; no liveness/deepfake | Med |
| 7 | **Prove personhood when agents move money** | Full DID/VC/OID4VP + grant stack + holder binding — but personhood is *implicit* only | No agent-personhood attestation / claim | **Low** |

---

## 3. Feature backlog (prioritized, with real extension points)

**A — Agent-Personhood Attestation (flagship).** Make "a KYC-verified human authorized this agent" a
first-class, cryptographically-anchored, enforced claim. Mint at grant time
(`userAgentGrantService.grantAgent`), bind to the user's KYC VC + wallet `did:key` + agent
`client_did` + scope, enforce in `presentationService.verifyPresentation` before minting the scoped
token, and carry a `personhood: verified-human` claim on the scoped token / MCP context so a
merchant/counterparty can rely on it. The report's #1 frontier; Goemon's clearest edge; small; no
licensing. **Built (this cycle).**

**C — Local-currency stablecoin (first non-USD coin).** One demo coin (`MXNe`, 6dp) via
`currencyRegistry.REGISTRY` + `money.ts` `KNOWN_DECIMALS` + an FX sim rate; relax the USD/USDC
transfer guard for registry-enabled stablecoins. On-chain settlement + ramps stay USD-pinned by
design (ledger/FX-layer prototype behind existing kill-switches). **Built (this cycle).**

**D — Non-USD-denominated lending.** Thread `borrowCurrency` through `lendingService`; FX-value the
USD-par collateral in the borrow currency. Delivers the report's "peso-denominated lend-borrow."
**Built (this cycle).**

**B — Deterministic-Identity vendor seam (Incode/Persona) — DEFERRED.** Turn the config-only
`IDV_PROVIDER` enum into a wired swappable `IdvProvider` (copy the `BankRailProvider` pattern),
inserted at `identityService.completeKycDecision` + `onboardingAgents.runDocumentValidationAgent`.
Makes the Feature-A personhood claim *strong* (real deterministic identity vs simulated) and adds a
liveness/deepfake insertion point. **Natural next step** — until then, Feature A rides on simulated
KYC exactly as the rest of the platform does today.

**E — Turnover/velocity metric — DEFERRED.** Read-only metric surfacing coin turnover (period
volume ÷ balance) rather than AUM, per "market cap is the wrong scoreboard."

**F — Strategy notes (doc-only) — DEFERRED.** Fold "close to the metal" (own-license moat) and the
brand/distribution weakness into the go-live strategy doc.

---

## 4. Explicitly deferred / out of scope (documented boundaries)

- **On-chain settlement of the non-USD coin** — the live Hedera rail is USDC-specific; a peso coin
  needs its own token/chain. `MXNe` is a ledger + FX-layer prototype only.
- **Non-USD on/off-ramps** — `onRampService`/`offRampService` remain USD/USDC-only.
- **Real FX rate feeds** — `circle`/`oanda` providers stay `NOT_IMPLEMENTED`; FX runs on the
  simulated mid-market provider behind `FX_ENABLED`/`FX_SETTLEMENT_ENABLED` (prod-fatal while
  simulated).
- **Real lending supply/LP side** — `lending_pool` is still an unfunded system account; `MXNe`
  lending inherits the existing prototype caveat (no lender of record, prod-fatal via
  `LENDING_ENABLED`).
- **Deterministic IDV / liveness (Feature B)** — deferred; the personhood attestation currently
  attests the *simulated* KYC tier.

These are guardrails, not oversights: nothing money-critical changes without a fallback, and every
prototype surface stays behind its existing prod-fatal kill-switch.
