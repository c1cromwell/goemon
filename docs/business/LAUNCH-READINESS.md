# Launch Readiness — honest scorecard + 90-day gate-closing plan

A candid go/no-go on launching Goemon in the US: where each gate actually stands, who owns it, and the
shortest dependency-ordered path to a real launch. **No new features** — this is about closing gates.

> **How to read this.** Companion to `LAUNCH.md` (the gate definitions B1–B8), `CORPORATE-STRUCTURE.md`
> (the Corp A/B/C ramp), and `GO-LIVE-PLAN.md` (entity + ownership + GTM). Status: 🔴 not started ·
> 🟡 in progress · 🟢 done. Tags: **DO NOW**, **DEFER → Corp B/C**, **⚖ see counsel**.
>
> ⚖ **Honest opinion + readiness map — not legal advice.** Entity, MSB, securities, and money-transmitter
> decisions must go through the fintech attorney + CPA named in `CORPORATE-STRUCTURE.md` / `GO-LIVE-PLAN.md`.

---

## 1. The verdict

**Not ready to fully launch — and the gap is not features, it's gates.** The codebase is feature-rich and
architecturally strong (append-only ledger, non-custodial keys, DID/VC + agent rails, a real fraud
engine, disciplined prod-fatal config). But "launch a US money business" is gated on
**legal · licensing · partners · verification**, and almost none of that is done. **More prototype
features do not close a single gate.**

**Two doors:**

- **Door 1 — narrow Phase-A launch** (non-custodial *software*, **no customer funds**, money rails OFF,
  testnet, RWA demo-only). The only door open in **weeks-to-months**, and it's mostly *non-engineering*
  work (counsel, vendor contracts, app verification). **Still not ready** — see §2.
- **Door 2 — the full neobank** (deposits, cards, FX, Goemon Pay, real trading/RWA). **Corp B/C**:
  **multi-quarter-to-multi-year, capital-intensive**, gated on a partner bank + FinCEN MSB + real
  vendors + licensing + production custody + SOC 2 + an ops org that doesn't exist yet. See §3.

---

## 2. Phase-A scorecard (Door 1 — the only near-term path)

These are the `LAUNCH.md` B1–B8 gates plus the Phase-A compliance items, scored honestly.

| Gate | Status | Owner | Evidence today | Effort |
|---|---|---|---|---|
| **Entity formed** (WY LLC) + EIN + registered agent | 🔴 | Founder | `B6` checklist all unchecked | 1–2 wks |
| **IP assignment** (repo/marks → LLC) | 🔴 | Founder/Counsel | Not executed; #1 diligence item (`GO-LIVE-PLAN.md`) | days ⚖ |
| **Operating agreement** | 🔴 | Founder/Counsel | Not adopted | days ⚖ |
| **AML/BSA policy + named compliance officer** | 🔴 | Founder/Counsel | No written policy | 2–4 wks ⚖ |
| **Real OFAC/sanctions screening** | 🔴 | Eng + Vendor | `SANCTIONS_PROVIDER=simulated` (stub) | 2–4 wks |
| **Real KYC/IDV** (if onboarding real users) | 🔴 | Eng + Vendor | `IDV_PROVIDER=simulated` (stub) | 3–6 wks |
| **ToS / Privacy / E-Sign / "not advice" disclaimers** | 🔴 | Counsel | Not published | 2–3 wks ⚖ |
| **Compliance-safe messaging** (no "bank"/"deposits"/"FDIC") | 🟡 | Product/Legal | Rebrand done; copy review pending (`LAUNCH.md` §1) | days |
| **B1 — iOS wallet verified** | 🔴 | Eng | Source never compiled (no Xcode) | 1–3 wks |
| **B2 — Frontend + Playwright UI smoke** | 🟡 | Eng | Portal built; `wallet.spec.ts` green TBD | 1–2 wks |
| **B3 — `e2e-validator full` green** | 🟡 | Eng | Deterministic floor green; full hybrid TBD | days–1 wk |
| **B4 — Securities counsel sign-off** (if real RWA) | 🔴 | Counsel | `docs/legal/B4` is a scaffold | 3–6 wks ⚖ |
| **B5 — Collectibles legal memo** | 🔴 | Counsel | `docs/legal/B5` is a scaffold | 2–4 wks ⚖ |
| **B6 — Entity + Phase-A compliance pack** | 🔴 | Founder/Counsel | scaffold, all unchecked | rolls up the above ⚖ |
| **B7 — Hedera posture** (testnet-labeled OR mainnet KMS/HSM) | 🟡 | Eng/Sec | Testnet OK to launch *labeled*; mainnet needs KMS/HSM+multisig | testnet: now |
| **B8 — Trail of Bits wallet audit** | 🔴 | Sec | "ENGAGEMENT PLANNED — not scheduled" | schedule now; 4–8 wks to report |

**Phase-A reality:** ~everything red is **paperwork, counsel, vendor contracts, and app verification** —
not code. The engineering that remains (B1/B2/B3) is small next to the legal/compliance lift.

---

## 3. The Corp-B wall (Door 2 — every money rail is gated)

`backend/src/config.ts` makes **14 capabilities prod-fatal**. Each is a prototype on a simulated
provider; flipping it on in production is blocked until its real prerequisite exists. **Do not flip any
of these for launch.**

| Prod-fatal switch | What it enables | Blocking prerequisite | Phase |
|---|---|---|---|
| `BANK_RAILS_ENABLED` | deposits / ACH / wire | **BaaS partner bank + FinCEN MSB + KYC/AML vendor** | Corp B ⚖ |
| `CARDS_ENABLED` | debit cards | **card processor + BIN-sponsor bank + PCI scope** | Corp B ⚖ |
| `GOEMON_PAY_ENABLED` | stablecoin merchant rail | **money-transmission licensing / partner** | Corp B/C ⚖ |
| `FX_ENABLED` / `FX_SETTLEMENT_ENABLED` | currency conversion | **licensed FX rate provider + MT posture** | Corp B/C ⚖ |
| `BILLPAY_ENABLED` | bill pay | **partner bank + biller network** | Corp B ⚖ |
| `TRADING_ENABLED` | brokerage | **broker-dealer/clearing partner** | Corp C ⚖ |
| `EQUITIES_ENABLED` | tokenized equities | **issuer + transfer agent + ATS + securities counsel** | Corp B/C ⚖ |
| `COLLECTIBLES_ESCROW_ENABLED` | in-app collectible escrow | **MSB / marketplace-intermediary counsel** | Corp B ⚖ |
| `TEEN_ENABLED` (+ credit/custodial) | teen suite | **BaaS/card issuer + COPPA + custodial broker** | Corp B/C ⚖ |
| `DATA_WAREHOUSE_ENABLED` | analytics sink | real warehouse (not blocking launch) | Stage 1 |

**Also missing for a real money product** (not seams — operational reality): customer **support/ops
console**, **dispute/chargeback** ops, **statements + tax docs (1099-INT/B/DIV)**, production
**notifications**, **real-time fiat rails** (FedNow/RTP — today "instant" is a label), **multi-chain
reconciliation** (Hedera-only today), **fraud at scale** (in-process, not Kafka/Flink), **SOC 2**,
insurance (E&O/D&O/cyber), and a **status page + incident-response** runbook.

---

## 4. The 90-day gate-closing plan (ships ZERO new features)

Dependency-ordered. The goal of 90 days is **Door 1 ready**, *not* Door 2. Costs are planning estimates.

### Sprint 1 (Days 1–30) — exist + freeze + engage
- **Freeze feature scope.** No new seams. Pick the wedge: **web-first, non-custodial, no customer funds,
  collectibles *viewing* + agent experience, money rails OFF, RWA demo-only.** *(Owner: Founder. Exit:
  written one-paragraph scope, all money switches confirmed off in the prod env template.)*
- **Form the entity + EIN + registered agent + operating agreement; execute the IP assignment.** *(Founder
  + Counsel. Exit: `B6` entity rows checked; signed IP assignment. ~$2–4k ⚖)*
- **Engage fintech/securities counsel + a startup CPA** (scoped hours). *(Founder. Exit: engagement
  letters signed. ~$5–15k ⚖)*
- **Schedule the Trail of Bits audit** (B8). *(Eng+Sec. Exit: SOW signed, dates booked.)*
- **Close B3 + start B2:** get `e2e-validator full` green and the Playwright wallet smoke running.
  *(Eng. Exit: green run artifacts.)*

### Sprint 2 (Days 31–60) — compliant + verifiable
- **Write the AML/BSA policy; name the compliance officer; wire a REAL OFAC/sanctions vendor** (swap
  `SANCTIONS_PROVIDER` off simulated). *(Founder/Counsel + Eng. Exit: policy doc + a live SDN screen on
  onboarding. ⚖)*
- **Wire a real KYC/IDV vendor** *if* onboarding real users (else keep waitlist + manual). *(Eng. Exit:
  one real identity verified end-to-end, or a documented decision to defer with no real onboarding.)*
- **Decide iOS vs. web-only for v1** and close it: either pass `verify-ios-wallet.sh` + device smoke
  (B1), or **launch web-only** and shelve the app. *(Eng. Exit: B1 green OR a written web-only decision +
  B2 green.)*
- **Draft ToS / Privacy / E-Sign / disclaimers** with counsel. *(Counsel. Exit: published-ready drafts. ⚖)*

### Sprint 3 (Days 61–90) — launch posture + the Corp-B decision
- **Securities posture (B4/B5):** counsel sign-off, or keep **all** RWA explicitly demo-labeled and
  ship nothing real. *(Counsel. Exit: signed memo OR enforced demo-only. ⚖)*
- **Publish ToS/Privacy/disclaimers; finalize compliance-safe messaging review.** *(Counsel/Product.)*
- **Lock the Phase-A prod config:** Hedera testnet-labeled (B7), every money switch off, password auth
  off — and run `LAUNCH.md` §6 go/no-go with all four sign-offs. *(Eng/Founder. Exit: a real GO on the
  §6 checklist.)*
- **Begin the Corp-B conversation (do NOT build):** shortlist a **BaaS partner bank** + start **FinCEN
  MSB** prep so the *first* money rail has a home after Door 1 is live. *(Founder/Counsel. Exit: partner
  shortlist + MSB checklist — not an integration. ⚖)*

**Outcome at day 90:** a defensible **Phase-A launch** (or invite-only beta) of non-custodial software,
or a clear-eyed decision to stay in private testing — with the Corp-B path scoped but not yet built.

---

## 5. The one-line answer

You're **not** missing features — you have more than enough. You're missing an **entity, counsel, real
compliance vendors, app verification, and a partner/licensing path.** Stop building; start closing gates.

---

*Companion documents: `LAUNCH.md` (gate definitions + §6 sign-off), `CORPORATE-STRUCTURE.md` (Corp A/B/C
ramp), `GO-LIVE-PLAN.md` (entity/ownership/GTM), `docs/legal/` (B4–B6 scaffolds),
`docs/security/TRAIL-OF-BITS-AUDIT.md` (B8).*
