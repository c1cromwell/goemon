# Documentation reconciliation log

Tracks PRD vs prototype vs launch posture after competitive-gap + Tier 1/2 implementation passes.

**Last reconciled:** 2026-06

## Source-of-truth hierarchy

1. **Shipped code** (`backend/`, `frontend/`, `ArgusWallet/`) — what actually runs
2. **`docs/LAUNCH.md`** — Phase A go/no-go
3. **`docs/argus_prdv1/11-open-questions-and-risks.md`** — founder decisions
4. **`docs/PRD-PHASE-MATRIX.md`** — PRD vs prototype vs Corp B/C
5. **`docs/argus_prdv1/`** modules — aspirational v1 bank PRD (some items deferred)

## Intentional PRD divergences (documented)

| PRD says | Prototype ships | Notes |
|---|---|---|
| Go backend | TypeScript/Node | Go is long-term target per locked decision |
| Next.js 15 web | React + Vite | Phase A portal is Vite |
| Parallel US + intl | US-first (Q-ROADMAP-001) | Intl Phase B |
| Tier 0 buy collectibles | Tier 1+ buy (Q-ID-003) | Tier 0 browse-only |
| `@handle` discovery | Deferred (Q-ID-001 open) | Contact/QR only v1 |

## Tier 1 implementation status

| Item | Doc | Code / script |
|---|---|---|
| iOS verify B1 | LAUNCH.md §3 | `scripts/verify-ios-wallet.sh` |
| Android fast-follow | `ArgusWalletAndroid/` | Gradle scaffold + README |
| Legal memos B4–B6 | `docs/legal/` | Templates; B5 updated for Q-ID-003 |
| E2E/UI gate | LAUNCH.md §4 | `scripts/launch-gate.sh`, `frontend/e2e/wallet.spec.ts` |
| Trail of Bits audit | Q-WALLET-001 | `docs/security/TRAIL-OF-BITS-AUDIT.md` |
| SantanderAI P1 | `integrations/SANTANDER-AI.md` | `mechGovService.ts`, `syntheticFraudGraph.ts` |
| CCTP + HIP-583 + push | LAUNCH.md §2 | `cctpService`, `hip583.ts`, `notificationService`, Wallet UI |

## Tier 2 implementation status

| Item | Doc | Code |
|---|---|---|
| Identity Vault | PRODUCTION-STRATEGY §4 | `identityVaultService.ts`, migration `031`, admin sync |
| Argus Pay wedge | PAYMENT-NETWORK-STRATEGY | `paymentService` + `/pay` + `Pay.tsx` UI |
| Doc recon | this file | PRD-PHASE-MATRIX, LAUNCH, open-questions synced |

## Still open (not stale — genuinely pending)

- B4/B6 counsel sign-off
- Trail of Bits SOW execution
- Courtyard API client (`COLLECTIBLES_PROVIDER=courtyard` stub)
- Neo4j Aura swap for Identity Vault (SQLite prototype today)
- `ARGUS_PAY_ENABLED` / `COLLECTIBLES_ESCROW_ENABLED` prod counsel before flip

## Maintenance

Re-run reconciliation when:

- A founder decision lands in `11-open-questions-and-risks.md`
- A new phase ships (update `CLAUDE.md` + `PRD-PHASE-MATRIX.md` + this file)
- Test count changes (update `LAUNCH.md` §2)
