# Argus Financial Partners — Launch Readiness & Go-To-Market

The single end-to-end (E2E) launch document: what we ship at launch, the legal posture that keeps it
shippable, the gates that must be green, and who signs off. It ties the **technical** gate
(`docs/E2E-VALIDATION.md`) to the **legal/corporate** gate (`docs/business/CORPORATE-STRUCTURE.md`).

> **Read order:** this doc → `PRD-PHASE-MATRIX.md` (PRD vs Phase A vs Corp B/C) → `CORPORATE-STRUCTURE.md` → `E2E-VALIDATION.md` → `ARGUS-PLAN.md`.

---

## 1. Launch thesis — Phase A, non-custodial software

**We launch as an AI-operated, tokenization-first money app — *not* "a bank."** This is the
`CORPORATE-STRUCTURE.md` **Phase A** posture (§1, §6): deliver real product value while staying outside
the two most expensive US regimes (money-transmitter licensing and broker-dealer registration) for as
long as possible.

What keeps us in scope at launch (CORPORATE-STRUCTURE §6, "What you CAN do in Phase A"):
- **Non-custodial by architecture** — keys live in the user's Secure Enclave; the server never holds a
  user's private key (a *locked* architecture decision). We hold no customer funds → generally not a
  money transmitter.
- **Tokenization framed as software** — we build the rails; we are not the issuer of record taking in
  investor money. Demo securities stay explicitly labeled "not a real offering."
- **Partner out everything that touches money** — no fiat on/off-ramp run by us; route crypto purchases
  to a licensed third party under *their* license.

**Compliance-safe messaging (non-negotiable — the reason for the Argus rebrand).** Per CORPORATE-STRUCTURE
§1 and §9(4), "bank"/"banking" are regulated terms; using them without a charter invites a
cease-and-desist. The rebrand from "BankAI" to **Argus Financial Partners** removes that trap. Marketing
copy says: **"tokenized assets," "non-custodial wallet," "agentic finance."** It must **never** say:
"deposits," "FDIC," "bank account," "your bank," or promise investment returns.

**What we CANNOT do at launch (Phase A):** hold customer USD or crypto, run an exchange/order book as
intermediary, issue and sell securities to the public, or move money between users as the middleman.
Those are Phases 17–20 (`ARGUS-PLAN.md`), gated on the **Corp B/C** ramp.

---

## 2. MVP-launchable scope (what ships)

The Phase 0–16+ prototype is launchable as non-custodial software once the §3 blockers clear.
Run `cd backend && npm test` for the current count (**302 pass / 3 todo**).

| Capability | Status | Notes |
|---|---|---|
| Passkey-first auth (WebAuthn) | ✅ built | password only behind `ALLOW_PASSWORD_AUTH` (forbidden in prod) |
| DID / Verifiable Credentials | ✅ built | RS256 VC JWT, key rotation, BitstringStatusList revocation |
| Tiered identity ladder + risk-adaptive onboarding | ✅ built | Phase 5A; simulated IDV/sanctions (Corp B cutover) |
| Double-entry ledger (integer minor units) | ✅ built | single source of truth for balances |
| Hedera USDC **non-custodial** wallet | ✅ built | build/sign/submit; HIP-583 EVM alias; testnet default |
| CCTP bridge seam | ✅ built | `CCTP_ENABLED`; Circle prod swap |
| Push notifications seam | ✅ built | device registry + simulated provider |
| Mirror inbound polling | ✅ built | `MIRROR_SUBSCRIPTION_ENABLED`; push on credit |
| SmartChat NL → 90s operation token → transfer | ✅ built | MFA gate above $500 |
| External agent: OID4VP → VP-verified → MCP scoped op | ✅ built | 90s scoped token; per-agent rate limit |
| Collectibles partner seam | ✅ built | `COLLECTIBLES_PROVIDER`; admin sync → marketplace |
| Tokenized marketplace (collectibles, HTS) | ✅ backend + UI | Invest/Collect tabs |
| Real-estate / securities tokenization | ⚠ demo only | **legal hold** until B4 counsel |
| Travel Rule seam | ✅ built | `TRAVEL_RULE_ENABLED`; vendor TBD |
| Stage-1 fraud + fraud-engine add-on | ✅ built | graph eval via SantanderAI seam |
| Internal agent ops + mech-gov | ✅ built | Phase 15; R3 human gate on KYC/compliance |
| Admin console + RBAC | ✅ built | compliance surfaces gated |
| Android wallet | ~ scaffold | `ArgusWalletAndroid/` fast-follow |

---

## 3. Hard blockers (go/no-go gates)

Launch is blocked until each of these is cleared. Engineering gates are verifiable today; legal/custody
gates require external action.

| # | Blocker | Type | Owner | Clears when |
|---|---|---|---|---|
| B1 | **iOS wallet verification** | Eng | Engineering | `scripts/verify-ios-wallet.sh` PASS + device smoke (Secure Enclave, OID4VP, Hedera send) |
| B2 | **Frontend portal + UI smoke** | Eng | Engineering | Playwright suite green incl. `wallet.spec.ts` |
| B3 | **E2E validation green** (see §4) | Eng | Engineering | `e2e-validator full` PASS |
| B4 | **Securities counsel sign-off** | Legal | Counsel | Template: `docs/legal/B4-securities-counsel-memo.md` |
| B5 | **Collectibles legal memo** | Legal | Counsel | Template: `docs/legal/B5-collectibles-legal-memo.md` |
| B6 | **Entity + Phase-A compliance pack** | Compliance | Founder/Counsel | Template: `docs/legal/B6-phase-a-compliance-pack.md` |
| B7 | **Hedera posture** — testnet labeled OR mainnet KMS/HSM | Eng/Sec | Engineering | Phase-20 custody before mainnet |

**Not blockers for Phase A:** partner-bank fiat rails, real KYC vendor, ATS/broker-dealer, production Kafka fraud, data warehouse sink.

---

## 4. E2E validation gate (technical)

- Deterministic floor: `cd backend && npm run typecheck && npm test` — green.
- Browser UI: `cd frontend && npm run test:e2e` — green (includes wallet smoke).
- Hybrid: `e2e-validator full` — journeys J1–J8 PASS; money invariants zero FAIL.
- iOS: gated on B1 (`scripts/verify-ios-wallet.sh`).

---

## 5. Corporate & compliance readiness (legal)

See `docs/legal/README.md` and `docs/business/CORPORATE-STRUCTURE.md` §5–10.

---

## 6. Go / No-Go checklist + sign-offs

| Gate | Source | Status | Sign-off |
|---|---|---|---|
| iOS wallet verified (B1) | §3 | ☐ | Engineering |
| Frontend + Playwright green (B2) | §3 | ☐ | Engineering |
| `e2e-validator full` green (B3) | §4 | ☐ | Engineering |
| Securities counsel (B4) | `docs/legal/` | ☐ | Legal |
| Collectibles memo (B5) | `docs/legal/` | ☐ | Legal |
| Phase-A pack (B6) | `docs/legal/` | ☐ | Compliance |
| Hedera testnet OR mainnet KMS (B7) | §3 | ☐ | Engineering / Security |
| Compliance-safe messaging | §1 | ☐ | Product / Legal |

**Decision:** ☐ GO ☐ NO-GO — date: ________  ·  Engineering: ____  Legal: ____  Compliance: ____  Product: ____

---

*Corp B partner cutover: `docs/business/CORP-B-RAMP.md`. Wealth/property future: `docs/PHASE-23-WEALTH-PROPERTY.md`. SantanderAI: `docs/integrations/SANTANDER-AI.md`.*
