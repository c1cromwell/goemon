# Phase 23 — Wealth & property lifecycle (design)

Extends Module 05 (tokenized fractions) into a **full wealth and property ownership** posture. Not yet in the PRD modules 00–11; folds into v2/v3 planning after Corp B/C ramps.

## Property ownership lifecycle

| Stage | User expectation | Goeman seam | Partner / build |
|---|---|---|---|
| Discover | Browse fractions, yield, lock-up | Marketplace Invest | Issuer APIs (RealT, Lofty) |
| Subscribe | Primary issuance escrow | Phase 8 escrow | transfer agent |
| Hold | Portfolio + statements | Ledger-derived holdings | — |
| **Income** | Rental distributions, 1099 | `rentalDistributionService` (TBD) | issuer payout feed |
| **Governance** | Votes, cap-ex, disclosures | `propertyGovernancePortal` (TBD) | LLC admin APIs |
| Trade | Secondary buy/sell | Marketplace + ATS | Corp C ATS |
| Redeem | Physical / liquidity events | escrow + compliance | issuer rules |
| **Insurance** | Vault + title coverage | custody attestation URI | Lloyd's / partner policy |
| **Mortgage** | Borrow against RE tokens | collateralized lending v2 | Figure-style partner |

### Regulatory notes

- US RE tokens: Reg D/S via issuer; Goeman = software + order router until Corp C
- International RE: jurisdiction matrix per Module 09 — thin today; expand per market
- On-chain title (Propy-style): optional v3; not v1 wedge

## Wealth management lifecycle

| Stage | User expectation | Goeman today | Gap |
|---|---|---|---|
| Net worth | Fiat + crypto + RWAs unified | Dashboard cash + holdings | off-platform aggregation |
| Goals | House, retirement, education | Phase 9 gamification dots | formal goals engine |
| Tax | Cost basis, 1099-B/DIV | export TBD | Robinhood-class tax center |
| Retirement | IRA, Roth, rollover | — | custodian partner |
| Estate | Beneficiary, trust | Phase 22 guardian model | Vanilla/Trust & Will partner |
| Advice | Allocation, optimization | explicitly out of scope | regulatory boundary |

## Product lines that cover gaps

- **Goeman Starter (Phase 22)** — teen/family wealth, custodial investing, credit-builder
- **Phase 18.6 equities** — 1099-DIV, dividends, on-chain redemption
- **Collateralized lending (PRD v2)** — borrow against marketplace holdings

## Staged build (when prioritized)

| Sub-phase | Deliverable | Kill-switch |
|---|---|---|
| 23.1 | Rental distribution UX + issuer webhook seam | `PROPERTY_INCOME_ENABLED` |
| 23.2 | Governance portal (read-only disclosures) | — |
| 23.3 | Net-worth aggregation (Plaid + on-chain) | `NET_WORTH_ENABLED` |
| 23.4 | Tax export (1099-B/DIV CSV) | counsel |
| 23.5 | IRA custodial (partner) | Corp C |

## Dependencies

- Corp B: partner bank, real issuers, tax counsel
- Corp C: ATS, BD, lending license for mortgage/collateral products
- Insurance: Q-COMP-005 coverage limits
