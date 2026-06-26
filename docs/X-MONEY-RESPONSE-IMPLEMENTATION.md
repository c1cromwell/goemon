# X Money Response — Implementation Plan

Step-by-step build plan for the features recommended in `docs/business/COMPETITIVE-X-MONEY.md`
(selective feature-match + differentiate). Ordered by **competitive leverage × buildability × phase**.
Each feature is a prototype seam consistent with the repo (swappable provider, kill-switch, tests).

> The strategy: don't fight X on yield/distribution; **win the segment that won't trust X** with
> non-custodial, asset-native, agent-native product. These features make that real.

---

## Feature order

| # | Feature | Competitive purpose | Phase / gate | Status |
|---|---|---|---|---|
| **1** | **Tokenized yield-bearing Treasury** | The anti-6%-APY: "own a yield-bearing **asset**, not a balance someone can freeze" | B/C · `TREASURY_ENABLED` ⚖ | ✅ **built** |
| **2** | **Self-custody / anti-deplatforming proof** | The #1 wedge made real: self-custody report + signed attestation + portable export | A | ✅ **built** |
| **3** | **P2P money requests on the native rail** | Differentiate table-stakes P2P (request-to-pay; no Visa/partner) | A→B | ✅ **built** |
| **4** | **Visa-bridge card: native-rail funding + USDC cashback** | Match X's card, but *spend from USDC* + cashback as an asset you own | B · `CARDS_ENABLED` ⚖ | ✅ **built** (bridge) |
| **5** | **Collector / creator drops** | Re-aim X's creator-payout hook to tokenized goods the creator owns | B · `CREATOR_DROPS_ENABLED` ⚖ | ✅ **built** |
| **6** | **Cross-border send (remittance)** | Reach the global / dollar-access audience X (US-only) can't serve | B/C · `FX_SETTLEMENT_ENABLED` ⚖ | ✅ **built** |

---

## Feature 1 — Tokenized yield-bearing Treasury (building now)

**What:** a tokenized T-bill–style asset (`ATB`, ~$1 par) the user **holds non-custodially**; yield
**accrues to holders automatically** and lands as cash — the direct, on-brand counter to X Money's 6%
custodial APY. Per `REVENUE-MODEL.md` §6 and `COMPETITIVE-X-MONEY.md` §5, this matches the *job* ("idle
dollars should earn") **without** marketing a custodial yield (the CLARITY-Act trap that threatens X).

**Why it wins the comparison:** X holds your money and pays a yield it can stop/freeze and that may be
regulated away; Argus gives you an **asset you own** whose yield is an automatic, ledger-auditable
distribution. "Own a yield-bearing asset, not a balance someone can freeze."

**Maximum reuse:** the yield engine already exists — `corporateActionService.distributeDividend`
(pro-rata, **idempotent per holder**); asset creation via `tokenizationService.createAsset`/`mint`;
holdings as `user_asset` ledger positions (`assetLedgerCode`); balanced journals via `ledgerService`.

**Steps:**
1. `config.ts` — `TREASURY_ENABLED` (kill-switch, **prod-fatal** like equities) + `TREASURY_APY_BPS`
   (default 450 = 4.5%).
2. `AssetKind` += `"treasury"` (`tokenizationService.ts`); `equityIssuerService` add
   `assertCorporateActionsEnabled()` (passes if `EQUITIES_ENABLED || TREASURY_ENABLED`);
   `corporateActionService` allow `kind ∈ {equity, treasury}` and use the combined gate.
3. `treasuryService.ts` — `seedTreasury()` (idempotent; creates the `ATB` asset + supply);
   `subscribe(user, qtyBase)` (cash → token at par, balance-gated); `redeem` (token → cash at par);
   `accrueYield(periodDays)` (perUnit = par × apy × days/365 → `declareCorporateAction(dividend)` →
   `distributeDividend`); `positions(user)`.
4. Migration `036_treasury.sql` — append-only `treasury_accruals` log; `treasury_apy_total` metric.
5. `routes/treasury.ts` (`/api/treasury`: subscribe · redeem · positions · admin accrue) + mount +
   seed at boot (gated).
6. `test/treasury.test.ts` — subscribe debits cash/credits holding at par; **accrueYield distributes
   pro-rata** (two holders, proportional payouts); re-distribution is idempotent (no double-pay);
   redeem returns cash; `TREASURY_ENABLED` off ⇒ disabled; prod-fatal.

**Scope guardrails:** prototype seam, prod-fatal (it's a security — issuer/transfer-agent/ATS + counsel
are the real-launch gate, per `LAUNCH-READINESS.md`); par-priced (no market data); decision/asset-only —
reuses the existing ledger money path, posts only balanced journals.

---

## Feature 2 — Self-custody & portability (built)

**What:** make the non-custodial guarantee **tangible and verifiable** — the direct antidote to X's #1
weakness (trust + deplatforming). `selfCustodyService` + `/api/self-custody`:
- **report** — splits **self-custodied** (wallet `did:key`, server holds **no** signing key; on-chain
  Hedera account with `serverHoldsKey` disclosed) from the **custodial** ledger balance (honestly
  disclosed: can be held only for a fraud review under due process — *not* deplatforming), with the
  guarantee statements.
- **attestation** — the report wrapped in an **issuer-signed, JWKS-verifiable JWT** (`signIssuerJwt`) so
  anyone can verify Argus's statement against `/.well-known/jwks.json`.
- **export** — the portable **"right to exit"** manifest (wallet DID + credential + Hedera account +
  holdings + instructions), signed — proving there's no lock-in.

Phase-A safe (read-only, no money movement); always available (self-custody is the architecture, not a
toggle). Reuses `vcService`, `hederaService`, `ledgerService`, `accountHoldService`, the token factory.
`self-custody.test.ts` (4): report split, JWKS-verifiable attestation, signed export, on-chain branch.

## Feature 3 — P2P money requests on the native rail (built)

**What:** "request $X from @user" (or an open request link), settled on **Argus's own rail** — the
existing `executeTransfer` path (double-entry ledger / USDC on Hedera), idempotent at the ledger. **No
Visa, no partner bank, no escrow:** the payer holds their funds until they choose to fulfill, then it
settles as a direct peer transfer. The differentiator vs. X Money's P2P: instant, **non-custodial, your
rail not a network's** — and it **advances the own-rail North Star** (see below).

`paymentRequestService` + `/api/requests` (create · list?role · get · fulfill · decline · cancel); a
lightweight state machine (requested → fulfilled/declined/canceled/expired); money moves **only on
fulfill** and only as a balanced, idempotent journal; directed requests pay only by the named payer.
Migration `037_payment_requests.sql`; `payment-requests.test.ts` (5): fulfill settles, idempotent (pays
once), directed-payer guard, decline/cancel move no money, self-request + insufficient-funds rejected.

> **North Star (recorded):** long-term, Argus should be **its own network rail for all payments / cards /
> money movement — minimal partners, self-contained.** Treat Visa/BaaS/Circle as *bridges*, migrate
> volume to the native USDC-on-Hedera + ledger + escrow + agent-auth rail (the Corp C "own the rails"
> phase). Every money-movement feature should note its partner dependency and its path to the native rail.
> F3 (P2P requests) is already 100% native. F4 (the Visa card) is an explicit *bridge*, not the destination.

## Feature 4 — Visa-bridge card: native-rail funding + USDC cashback (built; a BRIDGE)

**What:** the Phase-19.4 card lifecycle (issue/authorize/capture/void/refund) already exists; F4 adds the
two X-competitive differentiators:
- **Spend from the native rail** — a card issued in `USDC` authorizes/holds against the user's **USDC**
  balance (the card already funds from its `currency`), so spend pulls from the native rail, not a
  custodial USD balance. *"Spend from assets you own."*
- **Cashback as an asset you own** — on capture, the program pays `CARD_CASHBACK_BPS` (e.g. 300 = 3%, to
  match X's card) as **USDC** to the cardholder (idempotent per auth), recorded in `card_rewards`
  (migration 038). *"Earn a real asset, not points locked in a platform."* `GET /api/cards/rewards`
  surfaces the total; `card_cashback_total` metric.

`cards-cashback.test.ts` (3): 3% USDC cashback on capture + rewards history; off at 0 bps; a USDC-funded
card authorizes on the native rail.

> **Per the North Star, the Visa card is a BRIDGE, not the destination** — legacy acceptance on day one
> (Corp B, BIN-sponsor + PCI ⚖), while every transaction that *can* settle on the native rail (USDC
> funding, native P2P, Argus Pay) does — migrating volume off Visa over time toward the self-contained rail.

## Feature 5 — Collector/creator drops (built)

**What:** re-aims X Money's creator-payout hook to tokenized **goods the creator owns**. A creator issues
a **limited, authenticated tokenized edition** (`createDrop` → a `collectible` asset, supply = edition
size minted to the asset treasury); fans **claim** editions they **own** (a token in their non-custodial
position), paying the creator **directly** — no ad-revenue middleman, no platform that can deplatform the
creator. **Scarcity is enforced at the ledger** (the asset treasury IS the cap → sold-out when it hits
zero); each claim is a balanced, idempotent journal.

`creatorDropService` + `/api/drops` (create · list · claims · get · claim); migration `039_creator_drops.sql`;
`CREATOR_DROPS_ENABLED` (prod-fatal — marketplace-intermediary/MSB + collectible-as-goods counsel, like the
collectibles escrow); `creator_drop_claim_total` metric. `creator-drops.test.ts` (4): create issues the
edition, claim pays the creator + transfers an owned token, scarcity sells out, idempotent claim +
self-claim + insufficient-funds + the gate/prod-fatal. Reuses `tokenizationService.createAsset`/`mint`
and the ledger primitives (same pattern as the treasury).

## Feature 6 — Cross-border send / remittance (built)

**What:** send money to **another user in a different currency/corridor** (e.g. USD/USDC → EURC), settled
on **Argus's own rail** — no Visa, no US-only constraint. The global, **dollar-access** audience X Money
(US-centric via Visa/Cross River/FDIC) **can't serve**. One balanced journal across two currency groups
joined by the `fx_settlement` treasury, with the FX spread as an explicit fee; idempotent at the ledger.

`crossBorderService` (`quoteCorridor` preview + `send`) + `/api/cross-border` (quote · send · sends);
migration `040_cross_border.sql`; reuses the FX rate seam (`getFxProvider`/`convertAmountMinor`) and the
ledger; gated by **`FX_SETTLEMENT_ENABLED`** (already prod-fatal while simulated); `cross_border_send_total`
metric. `cross-border.test.ts` (5): corridor quote, send (debit FROM, credit recipient net TO, capture
spread), idempotent, insufficient/same-currency/same-user rejected, gate off.

---

## ✅ The X Money response is complete (F1–F6)

All six features built, tested, and shipped — **don't fight X head-on; win the segment X can't serve**:

| # | Feature | The wedge vs. X Money |
|---|---|---|
| F1 | Tokenized Treasury | Own a yield-bearing **asset**, not a custodial 6% balance (no CLARITY-Act risk) |
| F2 | Self-custody & portability | "X can freeze your money — we can't; you hold the keys" (verifiable) |
| F3 | P2P money requests | Instant, **non-custodial**, native rail — your rail not a network's |
| F4 | Visa-bridge card | Match the card, but **spend from USDC** + cashback **as an asset you own** |
| F5 | Creator/collector drops | Re-aim the creator hook to **tokenized goods the creator owns** |
| F6 | Cross-border send | Serve the **global / dollar-access** audience X (US-only) can't |

Every money-moving feature settles on the **native rail** (own-rail North Star); the Visa card is the lone
explicit **bridge**. Full backend suite: **361 pass / 3 todo (55 files)**.

---

*Source of recommendations: `docs/business/COMPETITIVE-X-MONEY.md`. Reuses: `corporateActionService`,
`tokenizationService`, `marketplaceService`, `ledgerService`, the prototype-seam + prod-fatal pattern.*
