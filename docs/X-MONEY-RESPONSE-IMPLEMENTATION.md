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
| 3 | Non-custodial P2P + "X can freeze you, we can't" | Differentiate the table-stakes P2P (already built) | A→B | planned |
| 4 | Visa-bridge debit card | Match X's card, funded from the USDC balance | B · `CARDS_ENABLED` ⚖ | seam exists |
| 5 | Collector / creator drops | Re-aim X's creator-payout hook to tokenized goods | A→B | planned |
| 6 | Global / cross-border packaging | Reach the audience X (US-only) can't serve | B/C · `FX_*` ⚖ | seam exists (RAILS-CURRENCY) |

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

## Features 3–6 (subsequent)

- **F3 — Non-custodial P2P + positioning:** P2P is built (Hedera USDC ~3s); add request-money + the
  differentiated framing.
- **F4 — Visa-bridge card:** `CARDS_ENABLED` seam exists; turn on at Corp B with a BIN sponsor + PCI ⚖.
- **F5 — Collector/creator drops:** extend `sellerCollectibleService` for creator-issued authenticated
  drops.
- **F6 — Global packaging:** the FX/cross-border seam exists (`RAILS-CURRENCY-STRATEGY.md`); package for
  the global/dollar-access audience.

---

*Source of recommendations: `docs/business/COMPETITIVE-X-MONEY.md`. Reuses: `corporateActionService`,
`tokenizationService`, `marketplaceService`, `ledgerService`, the prototype-seam + prod-fatal pattern.*
