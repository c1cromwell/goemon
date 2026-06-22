# PRD vs Phase A vs Corp B/C — capability matrix

Single reader guide reconciling [argus_prdv1/](argus_prdv1/) (full v1 bank PRD), [LAUNCH.md](LAUNCH.md) (Phase A non-custodial software), phase design docs (17–22), and prototype build status in [CLAUDE.md](../CLAUDE.md).

## How to read this

| Lens | Audience | What it promises |
|---|---|---|
| **PRD modules 00–11** | Investors, product | Full v1 launch: partner bank, intl corridors, ~15 live RWAs, iOS+Android, Next.js, Go |
| **Phase A (LAUNCH.md)** | Founders, counsel | Non-custodial software NOW — collectibles first real-money surface; no MTL/BD |
| **Prototype (Phases 0–22)** | Engineering | TS/React monorepo with simulated partner seams — breadth ahead of launch scope |
| **Corp B** | Compliance, BD | Partner bank, MSB, Visa debit bridge, real KYC/fraud, Argus Pay rail |
| **Corp C** | Compliance, BD | Broker-dealer, ATS, lending, production tokenization |

## Capability matrix

| Capability | PRD v1 | Phase A launch | Prototype built | Corp B | Corp C |
|---|---|---|---|---|---|
| Passkey auth | ✅ | ✅ | ✅ | ✅ | ✅ |
| Non-custodial Hedera wallet | ✅ | ✅ (testnet) | ✅ build/sign/submit | mainnet KMS | HSM scale |
| DID / VC / MCP agents | ✅ | ✅ | ✅ verified e2e | ✅ | ✅ |
| Marketplace Invest/Collect | ✅ live partners | collectibles only | ✅ demo + partner seams | live inventory | ATS secondary |
| Courtyard collectibles | ✅ | ✅ target | ✅ `COLLECTIBLES_PROVIDER` | API contract | scale |
| Securities / RE RWAs | ✅ | demo only (B4) | demo seed | issuer APIs | first-party |
| US ACH/wire / FedNow | ✅ | ❌ | simulated Phase 19 | Column/TP | own rails |
| Intl corridors NG/PH/BR | ✅ | ❌ | simulated | corridor partners | expand |
| Debit card | v2 | ❌ | simulated Marqeta | BIN sponsor | scale |
| Bill pay | out of v1 PRD | ❌ | simulated | biller network | — |
| Argus Pay merchant rail | not in PRD | ❌ | Phase 21 prototype | MSB + merchants | scale |
| Trading equities/options | out of v1 PRD | ❌ | Phase 17 simulated | — | BD partner |
| Tokenized 1:1 equities | brief v2 mention | ❌ | Phase 18.6 seam | Dinari/Backed | BD+TA+ATS |
| Argus Starter (teen/family) | not in PRD | ❌ | Phase 22 prototype | COPPA counsel | custodial BD |
| Internal agent ops | Module 08 | ✅ draft-only support | Phase 15 built | real-time chat | scale |
| Fraud platform | vendor TM | stage-1 seam | fraud-engine add-on | Kafka/Flink | lakehouse |
| Identity Vault (Neo4j) | not in PRD | ❌ | designed | Neo4j Aura | prod graph |
| Data warehouse | not in PRD | ❌ | export seam | BigQuery/Snowflake | — |
| CCTP bridge | Module 04 | optional | ✅ seam | Circle API | — |
| HIP-583 EVM alias | REQ-RX-001 | ✅ | ✅ | ✅ | ✅ |
| Push notifications | Module 02 | ✅ | ✅ seam | APNs/FCM | — |
| Travel Rule $3k+ | Module 06 | ❌ | ✅ seam | Notabene/etc | — |
| iOS wallet | ✅ | B1 verify | source + Hiero | App Store | — |
| Android wallet | ✅ | fast-follow | scaffold | Play Store | — |
| Go backend / Next.js | ✅ | ❌ (TS/Vite OK Phase A) | TS prototype | migration | — |

## Docs added beyond PRD (fold into PRD supplement)

| Doc | Adds to PRD |
|---|---|
| [PAYMENT-NETWORK-STRATEGY.md](business/PAYMENT-NETWORK-STRATEGY.md) | Argus Pay programmable rail; barbell with Visa |
| [PHASE-18.6-TOKENIZED-EQUITIES.md](PHASE-18.6-TOKENIZED-EQUITIES.md) | Dividends, redemption, EquityIssuer |
| [PHASE-22-STARTER-TEEN.md](PHASE-22-STARTER-TEEN.md) | Household / teen wealth product line |
| [PHASE-17-TRADING-BROKERAGE.md](PHASE-17-TRADING-BROKERAGE.md) | SLA bulkheading, simulated trading |
| [PHASE-15-INTERNAL-AGENT-OPS.md](PHASE-15-INTERNAL-AGENT-OPS.md) | Runner contract, skill catalog |
| [FraudEngine.md](business/FraudEngine.md) | Stages 2–4 platform north star |
| [PRODUCTION-STRATEGY.md](business/PRODUCTION-STRATEGY.md) | Identity Vault, infra stages |
| [PHASE-23-WEALTH-PROPERTY.md](PHASE-23-WEALTH-PROPERTY.md) | Property lifecycle + wealth retention |
| [CORP-B-RAMP.md](business/CORP-B-RAMP.md) | Partner cutover checklist |
| [integrations/SANTANDER-AI.md](integrations/SANTANDER-AI.md) | Open-source AI adoption map |

## Stale doc pointers (updated by this pass)

- [LAUNCH.md](LAUNCH.md) — test counts and B1 script reference
- [PHASE-15-INTERNAL-AGENT-OPS.md](PHASE-15-INTERNAL-AGENT-OPS.md) header — prototype is built
- [ARGUS-PLAN.md](ARGUS-PLAN.md) top checklist — see CLAUDE.md for current status
