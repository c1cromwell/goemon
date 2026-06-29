# Corp B ramp — partner cutover checklist

Maps Phase A prototype seams to production partners. Each row is a **config flag + provider enum** in `backend/src/config.ts` with a `notImplemented()` stub until the contract is signed.

## Partner matrix

| Capability | Config | Providers (stub → prod) | Route / service | Counsel gate |
|---|---|---|---|---|
| Partner bank / BaaS | `BANK_RAILS_ENABLED`, `BANK_RAIL_PROVIDER` | simulated → column, treasuryprime, unit | `bankRailService` | FinCEN MSB, MTL |
| Debit card (Visa bridge) | `CARDS_ENABLED`, `CARD_PROCESSOR` | simulated → marqeta, lithic, stripe | `cardService` | BIN sponsor, PCI |
| Bill pay | `BILLPAY_ENABLED` | rides `BANK_RAIL_PROVIDER` | `billPayService` | biller network |
| KYC / IDV | `IDV_PROVIDER` | simulated → persona | `identityService` | vendor DPA |
| Sanctions | `SANCTIONS_PROVIDER` | simulated → trm | onboarding | OFAC program |
| Travel Rule | `TRAVEL_RULE_ENABLED`, `TRAVEL_RULE_PROVIDER` | simulated → notabene, sumsub, verifyvasp | `travelRuleService` | FATF compliance |
| Collectibles inventory | `COLLECTIBLES_PROVIDER` | simulated → courtyard, collectorcrypt | `collectiblesProvider` | B5 memo |
| **Seller P2P escrow** | `COLLECTIBLES_ESCROW_ENABLED` | prototype (no vault partner) | `collectiblePurchaseService` | MSB / marketplace intermediary — see `CORP-B-COLLECTIBLES-ESCROW.md` |
| **Courtyard vault** | `COLLECTIBLES_PROVIDER=courtyard` | stub → live API | `collectiblesProvider` + orders/webhooks/HTS/redemption — see [`integrations/COURTYARD-INTEGRATION.md`](../integrations/COURTYARD-INTEGRATION.md) |
| RWA issuers | `RWA_ISSUER_ENABLED`, `RWA_ISSUER_PROVIDER` | simulated → ondo, securitize, realt | `rwaIssuerService` | B4 securities |
| CCTP USDC bridge | `CCTP_ENABLED`, `CCTP_PROVIDER` | simulated → circle | `cctpService` | stablecoin |
| Tokenized equities | `EQUITIES_ENABLED`, `EQUITY_ISSUER` | simulated → dinari, firstparty | Phase 18.6 | BD/TA |
| Goemon Pay merchants | `GOEMON_PAY_ENABLED` | prototype | `paymentService` | MSB + escrow |
| Fraud remote | `FRAUD_ENGINE_URL` | local → fraud-engine service | `fraudClient` | vendor TM |
| Data warehouse | `DATA_WAREHOUSE_ENABLED`, `WAREHOUSE_SINK` | simulated → bigquery, snowflake | `warehouseExportService` | SOC 2 |

## Cutover order (recommended)

1. **Entity + AML pack** (B6) — before any real user money
2. **Collectibles partner** (Courtyard) — smallest regulated surface; `POST /api/admin/collectibles/sync`
3. **IDV + sanctions** — Persona + TRM/Chainalysis before Tier 2 fiat
4. **Partner bank** — Column/Treasury Prime; enables deposit/withdraw/card
5. **Travel Rule** — before P2P/off-ramp above $3k
6. **RWA issuers** — after B4 securities counsel
7. **Visa debit bridge** — mass-adoption on-ramp per PAYMENT-NETWORK-STRATEGY
8. **Goemon Pay** — programmable rail wedge

## Admin verification endpoints

```bash
# Collectibles sync (simulated or courtyard when wired)
curl -X POST localhost:3001/api/admin/collectibles/sync -H "Authorization: Bearer $ADMIN_JWT"

# RWA issuer catalog (requires RWA_ISSUER_ENABLED=true)
curl localhost:3001/api/admin/rwa/catalog -H "Authorization: Bearer $ADMIN_JWT"
```

## Production fatals

All simulated rails remain **prod-fatal** via `productionFatals()` in `config.ts` until counsel and partner contracts clear each flag.
