# Goemon — Sept 1, 2026 Launch Plan & Founder Roadmap

**Date:** 2026-07-10 · **Audience:** founder · **Target launch:** Sept 1, 2026 (~7.5 weeks out)
**Method:** grounded in a codebase launch-readiness inventory + sourced regulated-fintech timeline research
+ sourced founder/business-fundamentals research. Companion to `docs/LAUNCH.md` (Phase-A thesis + blockers
B1–B8), `docs/business/LAUNCH-READINESS.md` (go/no-go scorecard), `CORPORATE-STRUCTURE.md` (Corp A/B/C),
`docs/business/TOKENIZATION-GO-LIVE-STRATEGY.md`, and `docs/PHASE-0-GO-LIVE-RUNBOOK.md`.

> **The one thing to internalize:** your **code is the smallest risk.** Goemon is a genuinely advanced build
> (real double-entry ledger, real passkeys, real GCP KMS + non-custodial Hedera wallet, 481 tests, Phase-0/1
> infra done). The launch gap is **gates, not features** — entity, counsel, compliance program, partners,
> licensing. The biggest gates (sponsor bank, SOC 2 Type II, MTLs) each *individually* exceed 7.5 weeks.
> `LAUNCH-READINESS.md` already says it: *"not ready — the gap is not features, it's gates."*

---

## 1. The honest verdict

**A custodial, regulated-money GA by Sept 1 is not achievable.** In the passthrough (BaaS) model the *sponsor
bank* legally holds and moves customer fiat — you cannot take a dollar of customer money without an executed
sponsor agreement (**6–12+ months** in the post-Synapse enforcement climate) plus a written AML/BSA program the
bank approves. **SOC 2 Type II**'s observation window is a **3-month calendar minimum** and can't be
compressed. Your own MTLs are avoided by using a sponsor, but the sponsor *is* the blocker. **Any Sept 1 shape
that touches customer fiat is off the table.**

**What Sept 1 *can* be — a real product, not a demo: a Phase-A, non-custodial, invite-only launch.** It uses
everything genuinely real today, and because you **never hold customer fiat / never act as a money
transmitter**, it sidesteps the sponsor-bank and MTL gates entirely — while the long poles run in parallel
toward a **custodial GA around Q1–Q2 2027**, which is where the real revenue (float + interchange) turns on.

---

## 2. The Sept 1 launch shape — Phase A: non-custodial, invite-only

**Ships (all real today):**
- Passkey auth (real WebAuthn), DID/VC identity, the double-entry ledger (real, append-only, reconciled).
- **Non-custodial USDC-on-Hedera wallet** — user holds keys; the server holds none.
- **SmartChat + external-agent MCP** — the agent-native layer, your actual differentiator + the
  agent-personhood attestation ("a verified human authorized this agent").
- The collectibles/RWA marketplace as **distribution** (not self-issuance).

**Tokenized assets:** distribute a **regulated partner's** product — **Dinari** dShares (widget/API, "zero
technical lift"; US users accredited-verified via 506(c) KYC). Do **not** self-issue: your own
broker-dealer/transfer-agent/ATS is a multi-year build.

**Explicitly OFF (stay behind the 14 `productionFatals()` kill-switches):** fiat on/off-ramp, bank
rails/ACH/wire, cards, bill-pay, lending, trading, tokenized treasury/equities/deposits, Goemon Pay, teen
suite. Every one is partner/license-gated.

**Invite-only**, web-first (see B1). Position as *"non-custodial software, not a bank."* Careful marketing
copy — do not imply unlicensed money services or promise custodial features you can't yet deliver.

---

## 3. The 7.5-week critical path to Sept 1 (what's actually in the way)

### A. Founder + counsel — the true blockers (start immediately)
- [ ] **Entity** — form it (`CORPORATE-STRUCTURE.md`: Wyoming LLC now, or **Delaware C-corp** if raising
  soon — investors expect a C-corp). *(B6)*
- [ ] **IP assignment** (PIIAs for every founder/contractor), **founder vesting** (4yr / 1yr cliff),
  **83(b) election within 30 days**, clean cap table. These are seed-diligence killers if missing.
- [ ] **Legal stack** — Terms of Service, Privacy Policy (GLBA/Reg S-P), E-SIGN consent, non-custodial
  risk disclaimers. Weeks with counsel.
- [ ] **Counsel sign-offs** — securities-counsel memo on the Dinari-distribution posture *(B4)*, collectibles
  memo *(B5)*, the Phase-A compliance pack *(B6)*.
- [ ] **Insurance** — bind **D&O + Tech E&O + Cyber** (days via Vouch/Corgi; add Crime before real money).

### B. Engineering — achievable in-window (much of it in this repo now)
- [ ] Apply the Phase-0 **Terraform to a real GCP project**; run the migrate job on Cloud SQL; finish CI
  Workload-Identity-Federation (`docs/PHASE-0-GO-LIVE-RUNBOOK.md`).
- [ ] **Mainnet Hedera** operator + KMS (Phase-1: KMS operator signing is BUILT; remaining = Mirror-Node
  provider, test-token, threshold KeyList, `hedera:live-check` — needs the GCP project + a funded operator).
- [ ] **Frontend deploy** — *there is no frontend deploy step today.* Shipped in this change set (Cloud
  Storage + CDN IaC + a `deploy.yml` frontend job).
- [ ] `e2e-validator full` green *(B3)* · Playwright `wallet.spec.ts` green *(B2)* · Hedera posture labeled *(B7)*.

### C. The two hard engineering blockers (workaround decided)
- [ ] **B1 — iOS wallet unverified** (never compiled; needs a Mac + Xcode). **Launch web-first** (the browser
  passkey + embedded-wallet path) with native iOS as a fast-follow. Verifying iOS is a founder/Mac action.
- [ ] **B8 — Trail of Bits audit** ("planned, not scheduled"). Launch the tiny-amount invite beta with the
  audit **in-flight and disclosed**; do not open broadly until it clears.

---

## 4. Parallel long-poles — kick off NOW (for custodial GA ~Q1–Q2 2027)

Every day of delay pushes the *real* business right:
1. **Sponsor-bank application** — Column / Lead Bank (charter-owning). 6–12+ mo. The #1 long pole.
2. **SOC 2 Type II** observation window — Vanta/Drata now; report ~Q1 2027. The audit clock is calendar time.
3. **Written AML/BSA program + a fractional BSA/Compliance Officer** — the bank must approve it before go-live.
4. **Circle Mint KYB** — 2–8 wk. *Validate your operating bank actually wires to Circle's settlement banks
   (the hidden gate).*
5. **KYC/IDV vendor** (Persona/Incode) + sanctions (TRM) integration — weeks.

---

## 5. Everything a founder needs — the full checklist ([BEFORE LAUNCH] / [LATER])

**Entity & legal.** [BL] DE C-corp · vesting · 83(b) · IP assignment · cap-table hygiene. [LATER] the Corp
A/B/C HoldCo → licensed-subsidiary structure (isolate regulated risk; plan the pattern now).

**Fundraising.** [LATER, plan now] pre-seed ~$250K–$1.5M → seed ~$2–5M from **fintech-specialist** funds (they
underwrite regulatory risk without education and open bank/compliance doors). Size the raise to clear the
sponsor-bank + SOC-2 long poles *plus buffer* (they slip). Bootstrapping the Phase-A beta is viable;
bootstrapping to full licensed GA is not.

**Team.** [BL, fractional] BSA/Compliance Officer (legally required once you touch money — can be fractional) ·
vCISO · fractional GC / regulatory counsel. [LATER] FTE head of risk, in-house CCO, fraud-ops team as volume
grows. Fractional is ~50–70% cheaper than FTEs.

**Go-to-market.** [BL] one **beachhead vertical** + waitlist→invite; instrument the **activation "aha" event**;
sequence Acquisition → Activation → **Retention** *before* Revenue/Referral. Recommended wedge:
**agent-operated treasury yield / agent-native access** — least crowded, tightest to your differentiator.

**Unit economics.** Revenue stack, by margin: **float/reserve spread** (GENIUS-Act-protected) + **interchange**
(150–200 bps via a Durbin-exempt sponsor — the scalable workhorse) + **tokenization take-rates** + on/off-ramp
spread + subscriptions. Investor metrics: ARR, TPV **with** take-rate, NRR > 120%, **LTV:CAC ≥ 3:1**, CAC
payback < 12 mo, **burn multiple ~1×**, Rule of 40. Series-A baseline ≈ $1.5–3M ARR.

**Ops must-haves.** [BL] AML program · incident-response plan · fraud ops · dispute/chargeback workflow ·
data-retention policy · customer support with SLAs · accounting/bookkeeping + tax (crypto specialist) · status
page · board/advisors.

**Licensing / GENIUS strategy.** [BL decision] do **not** self-license MTLs — use the sponsor passthrough. If
you touch a stablecoin, structure around the **GENIUS Act** (issue via a *permitted* issuer/partner, not
self-issue). Get regulatory counsel on this specifically. *(This is founder-oriented guidance, not legal
advice — validate with qualified fintech/crypto counsel.)*

---

## 6. The path to a multi-million-dollar business

| Phase | When | What happens | Revenue |
|---|---|---|---|
| **A — Non-custodial beta** | **Sept 1, 2026** | Invite-only; zero fiat custody; distribute Dinari; prove **activation + retention** with a beachhead cohort. Long poles running. | ~$0 (learning + take-rate on distributed assets) |
| **B — Custodial GA** | ~Q1–Q2 2027 | Sponsor bank + SOC 2 Type II + AML program land → flip the money rails (bank rails, on/off-ramp, cards). **Raise the seed** here on the beta's retention story + the cleared compliance path. | **Float + interchange** (the margin engine) + tokenization take-rates |
| **Scale** | 2027+ | Expand rails + verticals; own the agent-native + tokenized-RWA wedge; layer lending/FX; build the metrics story toward Series A. | Diversified stack toward ~$1.5–3M ARR |

**The blunt sequencing truth:** the three things that actually gate this business are (a) the
**licensing/GENIUS strategy** and its 12–24-month timeline — solved early via a sponsor bank; (b) a real
**AML/BSA + fraud + IR compliance program** with a (fractional) BSA officer *before* you touch a dollar; and
(c) **clean entity/cap-table/IP/83(b) hygiene** so the seed round that funds the licensing doesn't die in
diligence. None of those is code.

---

## 7. What engineering is shipping with this plan (in-repo, now)

- **Frontend deploy** — IaC (Cloud Storage static site + Cloud CDN) + a `deploy.yml` frontend job. Closes the
  no-frontend-deploy gap; the Phase-A web-first launch depends on it.
- **Phase-1 Hedera steps 3–4** — a real **Mirror-Node balance provider** for reconciliation (public node +
  backoff) and a **`hedera:mint-test-usdc`** script (self-issued HTS token to prove the money path before wiring
  Circle USDC).
- Verification: backend `typecheck` + tests green; frontend build produces a deployable artifact; launch-gate
  portable subset clean.

**Not in scope for engineering (founder/counsel actions):** entity formation, IP/vesting/83(b), ToS/privacy/
counsel memos, insurance, iOS-Xcode verification (B1), Trail-of-Bits scheduling (B8), and all partner
onboarding (sponsor bank, Circle, Dinari, KYC vendor). These are the true long poles — see §3A and §4.

---

*Sources behind the timeline/fundamentals claims (sponsor-bank/SOC-2/MTL durations, GENIUS Act, unit-economics
benchmarks, Dinari distribution) are captured in the research pass that produced this plan; refresh via the
deep-research workflow as dates move.*
