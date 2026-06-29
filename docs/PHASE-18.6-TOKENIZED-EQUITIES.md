# Phase 18.6 — Tokenized 1:1-backed Public Equities

**Status: prototype seam BUILT (simulated, off by default); production is partner/legal-gated.**

The product: tokens that represent **actual shares of public companies, custodied 1:1** — users
**trade, hold, and redeem on-chain**, and **receive dividends automatically**. Explicitly **no
derivatives and no IOUs**: each token is a digital claim on a real share held 1:1 by a regulated
issuer/custodian. This is the Dinari dShares / Backed bToken / Ondo Global Markets model.

This is a **gap** the prior roadmap did not cover: **Phase 17** is *off-chain* brokerage of real
equities via a clearing partner (no on-chain token, no on-chain redemption, dividends land at the
broker); **Phase 18** tokenizes treasuries/real-estate/private credit and has no dividend, corporate-
action, or on-chain-redemption machinery. Phase 18.6 closes that gap.

---

## 1. Why it fits Goeman cleanly

The Phase-8 marketplace already provides the substrate, so equities **reuse, not rebuild**:
- **Holdings derive from the ledger** — each asset is its own currency code `ASSET:<id>` (no holdings
  table); a balance *is* a holding (`ledgerService`, `tokenizationService`).
- **Compliance gate** — `complianceService.checkTransfer` enforces identity-registry + tier +
  jurisdiction + holder-cap on every acquisition (equity is treated as a security → `COMPLIANCE_BLOCKED`).
- **Atomic, idempotent, append-only money** — buys/sells/subscriptions post one balanced journal;
  integer minor units only.
- **Pricing / listings** — `pricingService` (source/as-of/staleness) + versioned listings.

The only genuinely new machinery is **dividends/corporate-actions** and **on-chain redemption** — both
built here as a prototype seam.

## 2. Issuance model — both, as phases

A swappable `EquityIssuer` provider (`backend/src/services/equityIssuerService.ts`, selected by
`EQUITY_ISSUER`) decouples Goeman from the backing/redemption mechanism:

- **v1 — distribute a regulated 1:1 issuer (recommended first).** Integrate an issuer that already does
  1:1 backing + dividend pass-through + on-chain redemption:
  - **Dinari (dShares)** — US, SEC-registered transfer agent, 1:1 backed, dividends, on-chain redemption.
    Cleanest US fit and matches the no-derivative/1:1 requirement directly.
  - **Backed Finance (bTokens)** / **Ondo Global Markets** — EU/non-US.
  - Goeman = on-chain wallet + compliance + distribution + dividend/redemption **pass-through**. Lightest
    path; the issuer holds the shares, is the transfer agent, and bears the securities-law weight.
- **v2 — first-party issuance (later phase).** Goeman custodies real shares via a partner and mints its
  own ERC-3643 equity tokens. Requires the **full Phase 18 stack**: broker-dealer, **transfer agent of
  record** (SEC Form TA-1 / Tokeny), **qualified custodian + DTC participant**, and an **ATS** for
  secondary. Maximum control/margin, heaviest cost and licensing.

The prototype ships a `simulated` issuer; `dinari` and `firstparty` are `NOT_IMPLEMENTED` stubs whose
interface maps 1:1 to the real integrations.

## 3. Custody & the 1:1 proof-of-backing

- **Where the shares sit:** the issuer/its custodian (v1); a qualified custodian + DTC participant (v2).
- **Proof of 1:1 backing:** `EquityIssuer.backingAttestation()` returns custodied-shares vs on-chain
  token supply + `backedOneToOne`. In production this is fed by the issuer/custodian and **reconciled on
  a schedule** — reuse the `reconciliationService` pattern (compare on-chain supply vs custodied count;
  drift → hold + incident, exactly like the ledger⇄chain `RECONCILIATION_HOLD`). Surfaced to users at
  `GET /api/marketplace/assets/:id/backing`.

## 4. Dividends & corporate actions (automatic pass-through)

- **Lifecycle:** ex-date → record-date → pay-date. A corporate action is an **append-only declaration**
  (`corporate_actions`); distribution pays **every holder on record** pro-rata from the ledger.
- **Built (prototype):** `corporateActionService.declareCorporateAction` + `distributeDividend` post one
  balanced journal **per holder** (`corporate_action` system account → `user_cash`), idempotent per
  `(corporateActionId, userId)` — a holder simply holding the token receives cash. Per-share == per-base-
  unit (equity tokens are whole-share, decimals 0), integer minor units.
- **Production additions:** a **corporate-actions data feed** (issuer or market-data vendor) drives
  declarations; **splits** adjust supply; **tax** — 1099-DIV issuance and non-resident withholding —
  drafted by the Phase-15 `compliance-filing` skill (agent-drafted, human-filed) on the deadline SLAs.

## 5. On-chain redemption (no IOU — burn → deliver the underlying)

- **Built (prototype):** `redemptionService.redeem` runs ONE atomic, idempotent journal — burn
  (`user_asset` → `treasury` in `ASSET:<id>`) + deliver proceeds (`equity_issuer` → `user_cash` in USD),
  proceeds = `qtyBase * priceMinor` (matches the marketplace valuation). `POST
  /api/marketplace/assets/:id/redeem` (Idempotency-Key).
- **Production:** the burn maps to a real issuer/HTS burn; delivery is the issuer settling the
  underlying (cash sale proceeds, or share delivery to a brokerage account). Where settlement is T+,
  model the request/claim split (ERC-7540-style async) — the `redemptions` row is already a state machine
  (`requested → settled | failed`).

## 6. Secondary trading

- **In-app peer transfer** of held tokens is compliance-gated and already works (`transferAsset`).
- **A secondary market** (continuous resale) for securities generally requires a **broker-dealer/ATS**
  (Securitize Markets, tZERO) or routing to the issuer's venue — a partner dependency, not in-app.

## 7. Compliance, KYC & jurisdiction

Reuse the Phase-8 Compliance Module (tier/jurisdiction/holder-cap). In v1 the **Reg-D/Reg-A posture is
inherited from the issuer**; a **jurisdiction availability matrix** gates eligibility (US vs non-US
dShares differ, and US persons may be restricted from some non-US tokens). Equity assets are flagged
`isSecurity`, so the existing gate applies automatically.

## 8. Ledger mapping & money invariants

| Flow | Journal (per currency balanced, append-only, idempotent) |
|---|---|
| Buy/subscribe | `user_cash → settlement/issuer` + fee + `treasury → user_asset` (existing) |
| Dividend | `corporate_action → user_cash` per holder (`equity:div:<caId>:<userId>`) |
| Redemption | `user_asset → treasury` (burn) + `equity_issuer → user_cash` (proceeds) (`equity:redeem:<key>`) |

Integer minor units throughout; holdings derived from the ledger; nothing bypasses it.

## 9. Partner integration spec (the `EquityIssuer` seam)

```ts
interface EquityIssuer {
  backingAttestation(symbol, tokenSupply): { sharesCustodied, tokenSupply, backedOneToOne, custodian, asOf }
  submitRedemption({ userId, symbol, qtyBase, pricePerUnitMinor }): { proceedsMinor, externalRef }
}
```
Production providers implement this against: **Dinari/Backed/Ondo** APIs (v1) or the **custodian +
transfer-agent + HTS mint/burn** stack (v2); plus a **market-data feed** (prices) and a
**corporate-actions feed** (dividends/splits). The kill-switch `EQUITIES_ENABLED` is prod-fatal in the
prototype until a real provider + counsel sign-off are in place.

## 10. Corp mapping & hard dependencies

**Corp B/C** owns the issuer/BD/TA/ATS partner relationships and the distribution entity. Hard
dependencies (production only): **securities counsel** posture; a regulated **1:1 issuer** (v1) or
**broker-dealer + transfer agent + qualified custodian + ATS** (v2); a **corporate-actions + market-data
feed**; a **jurisdiction matrix**. None are needed for the prototype (simulated issuer), and the
interfaces map 1:1 to the real partners.

---

## What was built (prototype seam)

- Migration `016_equities.sql` — `equity` asset kind (reuses `assets`); append-only `corporate_actions`;
  mutable `redemptions` (state machine).
- `equityIssuerService.ts` (provider seam + simulated issuer + dinari/firstparty stubs + kill-switch),
  `corporateActionService.ts` (declare + per-holder idempotent dividend), `redemptionService.ts`
  (atomic burn+deliver + backing attestation).
- Routes: `POST /api/marketplace/assets/:id/redeem`, `GET /api/marketplace/assets/:id/backing`,
  `POST /api/admin/assets/:id/corporate-action`, `POST /api/admin/corporate-actions/:caId/distribute`
  (admin = compliance/admin).
- Config `EQUITIES_ENABLED` (prod-fatal) + `EQUITY_ISSUER`; metrics `equity_dividend_total`,
  `equity_redemption_total`; `equities.test.ts` (6).

## Verification

`cd backend && npm run typecheck && npm test` (suite 229 pass / 3 todo). `equities.test.ts` asserts:
pro-rata dividend + idempotent replay; redemption burn+deliver + idempotent; compliance block on an
ineligible buyer; 1:1 backing attestation; `EQUITIES_ENABLED` gate; `productionFatals` refuses it in
prod. Manual: `EQUITIES_ENABLED=true`, create an `equity` asset + listing, buy → hold → declare/distribute
a dividend → redeem (see `docs/E2E-UX-TEST-GUIDE.md`).
