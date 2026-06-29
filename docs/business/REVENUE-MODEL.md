# Revenue Model — full product suite, phased to the compliance ramp

How Goeman makes money, product by product, gated by the phase that legally unlocks it. Growth-first:
the collectibles wedge **acquires**, the wallet **retains**, the stack **monetizes** as you cross-sell
into a trusted base — and the agent-operated cost structure lets you price below incumbents.

> **How to read this.** Companion to `GTM-COLLECTIBLES-LAUNCH.md` (which sequenced the *marketing* waves —
> this sequences the *money*), `LAUNCH-READINESS.md` (the prod-fatal switches that gate each line), and
> `CORPORATE-STRUCTURE.md` (the Corp A/B/C ramp). Tags: **DO NOW**, **DEFER → Corp B/C**, **⚖ see counsel**.
>
> ⚖ **Illustrative — not financial or legal advice.** Fee/take-rate figures are benchmarked planning
> estimates (vs. eBay/Stripe/Chime/Robinhood), not quotes; projections in §4 are **illustrative**, not
> forecasts. Interchange, net-interest-margin, FX, securities, and lending lines each require counsel/CPA
> (`CORPORATE-STRUCTURE.md` / `GO-LIVE-PLAN.md`).

---

## 1. The revenue thesis

**Land-and-expand.** Don't monetize the wedge — monetize the *stack*. Win users with cheap, high-trust
collectibles (low take rate vs. eBay) and a zero-interchange rail, then earn as each downstream product
attaches to a base that already trusts you. Three structural advantages:

- **The wedge is sticky and supply-moated** (graded slabs + provenance), so acquisition cost stays low.
- **ARPU compounds**: a collector who also holds a USD balance, taps a card, sends cross-border, and buys
  an RWA is worth multiples of a single-product user — and each attach is a *new revenue line*, not a
  discount.
- **The agent-operated cost structure** (PRD target **<$0.50/MAU** operating cost) is a durable **margin**
  advantage: Goeman can undercut incumbents on price and still make money, because the back office is
  agents, not headcount.

**The honest spine — revenue follows the licence, not the code:**

| Phase | What you can charge | Shape |
|---|---|---|
| **A (now)** | Software/SaaS only (subscriptions, tokenization, promotion) — **no** transaction take rate | **Thin** |
| **B (partnered)** | Marketplace take rate + interchange + net-interest-margin + FX spread | **Inflection** |
| **C (licensed)** | Brokerage/RWA + lending + **own-rail economics** (recapture the partner share) | **Compounding** |

You **cannot book revenue from a switch that's off** (`LAUNCH-READINESS.md` §3). The plan is sequenced so
every line turns on only when its gate clears.

---

## 2. Revenue by phase (the core)

### Phase A — non-custodial software, no customer funds (DO NOW)

The only thing you can charge for without being a money business is **software/SaaS revenue you keep** —
*not* a take rate on a peer sale (that's intermediation = Corp B). Honestly thin until the marketplace
goes transactional, consistent with the GTM "audience-now, launch-at-Corp-B" timing.

| Line | Mechanism | Benchmark | Gate |
|---|---|---|---|
| **Goeman Plus/Pro subscription** | Monthly collector tier (price alerts, agent discovery, portfolio view, priority authentication) | ~$5–15/mo (PRD plans tiers; free tier at launch) | Phase A ✅ |
| **Tokenization / authentication fee** | Flat per-slab fee to mint provenance (a software service, not a sale) | ~$1–5 / slab | Phase A ✅ |
| **Featured listing / promotion** | Seller pays to boost placement (software) | flat or tiered | Phase A ✅ |
| **Provenance / data services** | API/report access to authenticated history | per-call / tier | Phase A ✅ |

> Phase-A monetization is **revenue you collect for software** (Stripe processes *your* revenue — that's
> not money transmission). It is **not** a cut of buyer→seller funds; that needs escrow + Corp B.

### Phase B — partnered: BaaS bank + FinCEN MSB + custodian (the inflection)

| Line | Mechanism | Benchmark | Gate (switch) |
|---|---|---|---|
| **Collectibles marketplace take rate** ⭐ | Seller fee on each escrow-protected sale | **~2–5%** (vs. eBay ~13%, auction houses ~20%+) | `COLLECTIBLES_ESCROW_ENABLED` ⚖ |
| **Card interchange** | Share of interchange on debit spend | **~1.0–1.5%** of spend (Durbin-exempt partner BIN) | `CARDS_ENABLED` ⚖ |
| **Net interest margin / float** | Yield earned on idle USD balances via partner-bank sweep (you keep the spread) | a few % of balances × NIM | `BANK_RAILS_ENABLED` ⚖ |
| **FX spread** | Markup on currency conversion (the built `FX_SPREAD_BPS` ~50bps + cross-border markup) | **~0.5–1.5%** | `FX_ENABLED` / `FX_SETTLEMENT_ENABLED` ⚖ |
| **Instant/expedited + ACH/wire fees** | Optional fee for instant withdrawal; wire fees | $ flat per txn | `BANK_RAILS_ENABLED` ⚖ |
| **Bill-pay** | Small fee or float on scheduled payments | $ flat / float | `BILLPAY_ENABLED` ⚖ |
| **Goeman Pay** | **Zero rail fee** (the wedge — do **not** add interchange) → monetize via **merchant SaaS / premium** | $/merchant/mo | `ARGUS_PAY_ENABLED` ⚖ |

> The marketplace take rate is the flagship Phase-B line; interchange + NIM + FX are the "boring bank"
> lines that turn a marketplace user into a primary-account ARPU. **Goeman Pay stays free** — it's an
> acquisition/retention rail, not a revenue line (the wedge from `PAYMENT-NETWORK-STRATEGY.md`).

### Phase C — licensed: own MTLs, broker-dealer/ATS, transfer agent (compounding)

| Line | Mechanism | Benchmark | Gate (switch) |
|---|---|---|---|
| **Brokerage** | Commission/spread + **margin interest** + a **Gold-style subscription** | sub ~$5–10/mo; margin ~5–11% APR | `TRADING_ENABLED` ⚖ |
| **RWA / tokenized equities** | Issuance fees + secondary-trading take rate + **AUM/management-fee** share + dividend/corporate-action processing | bps on AUM + take rate | `EQUITIES_ENABLED` ⚖ |
| **Collateralized lending** | Interest spread on RWA-backed loans | spread over cost of funds | (PRD v2) ⚖ |
| **Own-rail economics** | Recapture the partner share once you hold the licences (interchange, MT, custody); the **Wyoming SPDI** custody-at-scale option | margin recapture | Corp C ⚖ |
| **Starter (teen/family)** | Family subscription + (gated) interchange on teen cards | ~$5–10/mo/family | `TEEN_ENABLED` ⚖ |

---

## 3. The ARPU stack & unit economics

Revenue compounds because each wave adds a line, not a discount. Illustrative **per-user revenue stack**
(benchmarked, monthly, blended):

```
Collector only (Phase A):        subscription (a few $)                              → low single-$ ARPU
+ Marketplace buyer/seller (B):  + take rate × trade volume                          → +$$
+ Primary account (B):           + interchange × spend + NIM × balance + FX spread    → +$$$
+ Investor (C):                  + brokerage/RWA take + AUM share                     → +$$$$
```

- **Attach rate is the master lever** — the same MAU is worth 3–5× more when card + balance + FX + RWA
  attach. Growth-first spend should buy *attach*, not just signups.
- **Margin moat:** with operating cost targeted **<$0.50/MAU** (agents, not headcount; PRD), even thin
  per-line take rates clear healthy contribution margin — the structural reason Goeman can price under
  Robinhood/Chime/eBay and still profit.

---

## 4. Illustrative projection scenarios *(illustrative — not a forecast)*

No real traction exists yet; these show the **shape** (an S-curve gated by licensing) and the **levers**,
not a prediction. Inputs are blended-ARPU × MAU × attach; treat the numbers as placeholders.

| | Year 1 (Phase A) | Year 2 (Corp B) | Year 3 (Corp C) |
|---|---|---|---|
| Live revenue lines | subscriptions, tokenization | + marketplace take, interchange, NIM, FX | + brokerage/RWA, lending, own-rail |
| **Low** | nominal (waitlist + founding sellers) | modest (marketplace ramps) | meaningful (stack attaches slowly) |
| **Base** | thin but real | **inflection** (take rate + interchange carry it) | compounding (ARPU 3–5× via attach) |
| **High** | small | strong marketplace + primary-account attach | full-stack ARPU + own-rail margin |

**Sensitivity (what actually moves the model):** (1) **attach rate** across waves, (2) **marketplace take
rate** vs. the eBay-beating promise, (3) **MAU** from the guerrilla wedge, (4) **NIM/interchange** terms
from the partner bank, (5) **Corp-B/C timing** — every Phase-B/C line is zero until its licence lands.

---

## 5. Compliance coupling — revenue you can't book until the gate clears

Every line is gated by a prod-fatal switch (`LAUNCH-READINESS.md` §3) and a Corp phase. This reconciles
1:1 with the GTM rollout waves (`GTM-COLLECTIBLES-LAUNCH.md` §6).

| Revenue line | Switch | Phase |
|---|---|---|
| Subscriptions / tokenization / promotion | (none — software) | **A** |
| Marketplace take rate | `COLLECTIBLES_ESCROW_ENABLED` | B ⚖ |
| Card interchange | `CARDS_ENABLED` | B ⚖ |
| NIM / float, ACH/wire/instant | `BANK_RAILS_ENABLED` | B ⚖ |
| FX spread | `FX_ENABLED` / `FX_SETTLEMENT_ENABLED` | B/C ⚖ |
| Bill-pay | `BILLPAY_ENABLED` | B ⚖ |
| Goeman Pay (merchant SaaS only) | `ARGUS_PAY_ENABLED` | B/C ⚖ |
| Brokerage | `TRADING_ENABLED` | C ⚖ |
| RWA / equities | `EQUITIES_ENABLED` | B/C ⚖ |
| Teen/family | `TEEN_ENABLED` | B/C ⚖ |

---

## 6. Flag-and-avoid — the edgy revenue lines

Three tempting lines that **conflict with the brand and/or carry regulatory risk**. Recommendation:
**avoid or defer-with-counsel.**

- **PFOF (payment for order flow).** Tempting "free trading" economics, but it's under regulatory scrutiny,
  optically toxic, and **contradicts the PRD anti-positioning** ("not an investing app, no advice,
  marketplace not exchange"). **Avoid** — monetize brokerage via transparent commission/spread + margin +
  subscription instead. ⚖
- **Marketed yield-on-balances.** Paying advertised "yield" on customer balances can make the balance look
  like an **unregistered security** (and intersects the GENIUS-Act stablecoin regime). Earn **net interest
  margin** quietly via the partner-bank sweep (§2 Phase B), but **do not market a yield** as a product
  feature without securities counsel. **Defer ⚖.**
- **Data monetization.** Selling/sharing user behavioral data breaks the **trust moat** that the whole
  authentication/provenance brand is built on, and triggers GLBA/CCPA exposure. **Avoid** — data powers
  *your* product (discovery, fraud), it is not a product you sell. ⚖

---

## 7. Margin moat & risks

**The moat is margin, not a single line.** The agent-operated back office (support/compliance/ops at
<$0.50/MAU) lets Goeman run thin take rates profitably — the durable advantage incumbents bolt on later
and can't match on cost structure.

| Risk | Mitigation |
|---|---|
| **Take-rate compression** (race to zero vs. eBay/incumbents) | Win on **trust + provenance + escrow**, not just price; the cost moat protects margin |
| **Interchange caps / Durbin** | Use a Durbin-exempt partner BIN; don't over-index on interchange |
| **Incumbent copy** (Robinhood/PayPal) | Supply moat + the agent-cost advantage + the one-app cross-sell |
| **Regulatory shift** (stablecoin/securities) | Keep the brand-safe lines; flag-and-avoid §6; counsel-gate every regulated line ⚖ |
| **Corp-B/C timing slip** | Revenue is gated on licensing — fund the runway accordingly; the GTM keeps the audience warm with the Phase-A product |

---

## 8. The one-line model

**Subsidize the collectibles wedge to acquire a trusted base; monetize the stack — marketplace take,
interchange, net-interest-margin, FX, then brokerage/RWA and own-rail margin — one compliance unlock at a
time; and out-margin everyone because the back office is agents, not headcount.**

---

*Companion documents: `GTM-COLLECTIBLES-LAUNCH.md` (the marketing waves these revenue lines attach to),
`LAUNCH-READINESS.md` §3 (the prod-fatal switches gating each line), `CORPORATE-STRUCTURE.md` (Corp A/B/C),
`RAILS-CURRENCY-STRATEGY.md` (the FX spread), `PAYMENT-NETWORK-STRATEGY.md` (the zero-interchange Goeman Pay
wedge), `goeman_prdv1/00`,`/02` (subscription tiers + fee-structure positioning).*
