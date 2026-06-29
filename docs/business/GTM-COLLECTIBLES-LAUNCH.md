# US Go-To-Market — the Tokenized Collectibles Wedge → Full-Suite Rollout

A bootstrapped, compliance-coupled launch plan: build audience and supply **now** around tokenized
graded collectibles (the only thing that's marketable today), launch the escrow-protected marketplace
the day **Corp B** unlocks it, then roll out the rest of the suite wave-by-wave as legal status lands.

> **How to read this.** Companion to `LAUNCH-READINESS.md` (the gate scorecard), `CORPORATE-STRUCTURE.md`
> (Corp A/B/C ramp), and `GO-LIVE-PLAN.md` §7 / `PRODUCTION-STRATEGY.md` §8 (which this builds on, not
> duplicates). Tags: **DO NOW**, **DEFER → Corp B/C**, **⚖ see counsel**.
>
> ⚖ **Strategy, not legal or investment advice.** Securities/MSB/marketing-claim calls go through the
> fintech + securities counsel named in `CORPORATE-STRUCTURE.md` / `GO-LIVE-PLAN.md`. Every marketing
> claim must pass the §3 say/never-say gate before it ships.

---

## 1. The wedge thesis

**Lead with one thing: a "graded slabs" marketplace** — PSA/BGS/SGC/CGC-graded **sports cards and Pokémon
/ TCG** under a single brand. The PRD already picked this wedge ("collectibles have proven consumer pull";
`goeman_prdv1/01`), and it's the **lowest-securities-risk** real-world asset (a whole graded card is a
*good*, not an investment contract — see §3), which is exactly why it's the safe first surface.

**The honest sequencing — the spine of this plan:**

| | Today (Phase A) | Launch (Corp B) |
|---|---|---|
| What's legal | Authentication, tokenization, **non-custodial ownership, provenance** | + **escrow-protected, fiat-friendly buying** (the trust moat) |
| What we do | **Build audience + supply** (waitlist, content, founding sellers tokenize slabs as provenance — *no money moves*) | **Transact** — the real marketplace goes live |
| Marketing | Demand + supply priming; "own it, prove it's real" | Convert the primed waitlist; "buy with zero risk" |

The escrow-protected purchase (`COLLECTIBLES_ESCROW_ENABLED`) is **prod-fatal pending Corp-B counsel +
MSB** (`LAUNCH-READINESS.md` §3). So we **manufacture demand and lock up supply now** — all Phase-A safe,
zero money movement — and flip the transactional marketplace on the day escrow is legal. A primed waitlist
+ a seeded catalog = a launch, not a cold start.

**Voice (PRD 01):** outcomes, not infrastructure. *"Own a graded first-edition Charizard — and actually
own it."* Marketplace, **not** an exchange. Never "investing app," never "crypto."

---

## 2. The value proposition — both sides of the marketplace

A two-sided market only works if both sides win. Map each claim to the real product.

### 2.1 To the consumer / buyer (the new + returning collector)

- **Authenticity, guaranteed.** Every listing is **grading-cert verified** (`CERT_VERIFY_PROVIDER`) and
  **AI pre-graded** (`sellerCollectibleService`) — the counterfeit and grading-scam problem that plagues
  eBay/Marketplace is designed out. *"If it's listed, it's real."*
- **You actually own it.** The token lives in your **non-custodial wallet** with **on-chain provenance** —
  not an account entry on someone's server. Portable, yours, verifiable.
- **Buy with zero risk (Corp B).** **Escrow-protected** purchase (`collectiblePurchaseService`:
  hold → ship → confirm → release) is the **chargeback substitute** an irreversible rail needs — funds
  release to the seller only when you confirm. *Scam protection without a credit-card middleman.*
- **Lower fees.** Far below **eBay (~13% all-in)** and **auction houses (~20%+ buyer's premium)** — more
  of the price goes to the card, not the platform.
- **Instant liquidity + discovery.** Resell in taps, not a 7-day auction; an **AI agent** helps you find,
  price, and track cards under scoped, revocable permission.
- **One app.** Your slabs sit **next to your dollars and other tokenized assets** — the advantage
  single-category players (Courtyard, Collector Crypt, PWCC Vault) structurally can't match.

### 2.2 To the collectible holder / seller (the slab owner)

- **Instant liquidity for a graded slab** — a global buyer pool on tap, not a consignment queue.
- **An authenticity/provenance premium** — a tokenized, cert-verified slab with on-chain history is worth
  more and sells faster than a photo on a forum.
- **Get paid, keep it** — **escrow** means no chargebacks, no "item not as described" reversals, no PayPal
  holds (Corp B). The buyer can't claw funds after you've shipped.
- **Keep more** — a take rate well under eBay/auction houses; price discovery instead of a lowball offer.
- **The physical stays safe** — vault-or-ship-on-sale via escrow; tokenize once, trade many times without
  the card moving each time.
- **Be early** — the **Founding Sellers** program (§4) gives the first holders catalog placement and
  status before the marketplace is public.

---

## 3. Compliance-coupled messaging guardrails (the say / never-say gate)

The wedge is safe **only if we keep the framing tight.** Graded cards are **goods, not securities** —
*provided* we never fractionalize, never promise returns, and never market them as investments. That is
the whole reason collectibles is the launch surface; cross the line and it becomes a securities offering
(B5 collectibles memo, `LAUNCH-READINESS.md`). ⚖

| ✅ Say | ❌ Never say |
|---|---|
| own, collect, authenticate, provenance, trade, true ownership | **invest, investment, returns, ROI, appreciate, portfolio, yield** |
| graded, cert-verified, escrow-protected, non-custodial | **bank, banking, deposits, FDIC, account** (the chartered terms) |
| marketplace, collection, liquidity | **exchange, securities, shares, fractional** (v1) |
| "own a piece of the hobby" | "your cards will go up in value" / price predictions |

Every post, caption, creator brief, and landing-page line passes this gate before it ships. The Howey
line is a **firing-offense rule** for anyone authoring marketing.

---

## 4. Phase 0 — build audience + supply NOW (guerrilla, zero money movement)

Everything here is **Phase-A safe**: no customer funds, no money movement, collectibles framed as goods.
This is pure top-of-funnel + supply lock-up while the Corp-B gates close.

### 4.1 Demand engine (the hobby lives on video)
- **TikTok + YouTube Shorts — "rip" culture.** The hobby's center of gravity. Partner with rippers/
  breakers; the shareable moment is *"pull → grade → tokenize → own it forever, provably real."*
- **Instagram Reels** — slab beauty shots, provenance reveals, the design-led brand aesthetic.
- **X — build-in-public** — the tech (non-custodial, provenance, agent discovery) for the crypto/AI-curious
  crossover audience; ship log + demos.
- **Reddit / Discord** — r/PokemonTCG, r/sportscards, r/PSAcard, grading Discords. **Value-first**
  participation (authentication tips, scam call-outs), never spam.
- **Invite-only waitlist + referral loop** — manufacture scarcity, control onboarding risk, and measure a
  referral coefficient. Founding-collector tiers by referral count.
- **Card-show circuit** — the cheapest high-intent in-person channel; a booth that *authenticates +
  tokenizes on the spot* (provenance only) turns attendees into founding sellers.

### 4.2 Supply moat (the harder, more important side)
- **"Founding Sellers / Holders" program.** Recruit slab owners to **authenticate + tokenize their
  inventory as provenance only** — cataloged, not yet for sale. **No money moves → fully Phase-A safe.**
  This seeds the catalog and a **supply advantage** competitors can't quickly copy, and gives sellers
  status + placement at launch. The catalog *is* the moat: marketplaces are won on supply.
- **Creator seeding** — give rippers/PSA influencers founding-seller status; their pulls become the launch
  catalog and their audiences become the waitlist.

### 4.3 Cadence, funnel, metrics
- **Weekly:** 3–5 TikTok/Shorts, 2–3 Reels, daily X presence + replies, ongoing community value posts,
  1 long-form "how authentication/provenance works."
- **Funnel:** content → **waitlist** → referral → **founding-seller tokenization (supply)** → (at Corp B)
  **first buy/sell**.
- **Metrics that matter:** waitlist signups, **referral coefficient (K)**, **# slabs tokenized as
  provenance** (supply), creator-content reach/saves, Discord/community size. Optimize the loops, not
  vanity counts.

---

## 5. The launch moment (at Corp B) — the marketplace goes transactional

The day `COLLECTIBLES_ESCROW_ENABLED` clears counsel + MSB, the escrow-protected, fiat-friendly
marketplace opens — and the primed waitlist + seeded catalog convert into a real launch:

- **Convert the waitlist** in invite waves (scarcity + onboarding-risk control).
- **The trust-moat campaign:** *cert-verified + AI-graded + escrow-protected + you-truly-own-it + zero
  counterfeit* — the single message no incumbent marketplace can claim all of.
- **Founding-seller drops** — the seeded catalog goes live first; founding sellers get launch-week
  spotlight.
- **Amplify:** Product Hunt, hobby-press + crypto/fintech-press PR, creator launch content, the card-show
  circuit now selling for real.
- **Launch-week mechanics:** limited drops, referral unlocks, a public "authenticity guarantee."

---

## 6. Full-suite rollout — sequenced to legal/compliance status

Each product's marketing wave is **gated on its compliance unlock** (the prod-fatal switches in
`LAUNCH-READINESS.md` §3; the Corp A/B/C ramp in `CORPORATE-STRUCTURE.md`). Marketing a capability before
its gate clears is how fintechs get a cease-and-desist — so the waves are strict.

| Wave | Product | Compliance trigger (switch / phase) | The message | Pulls / cross-sell |
|---|---|---|---|---|
| 0 | **Provenance + non-custodial wallet** | Phase A (now) | "Own it. Prove it's real." | Collectors → waitlist + supply |
| 1 | **Escrow-protected collectibles marketplace** | **Corp B** · `COLLECTIBLES_ESCROW_ENABLED` ⚖ | "Buy with zero risk." | The launch; waitlist → buyers/sellers |
| 2 | **USD cash balance + retention** | Phase A→B (non-custodial USDC now; fiat at B) | "Your dollars live next to your cards." | Marketplace users → hold balances |
| 3 | **Debit cards** | Corp B · `CARDS_ENABLED` (BIN-sponsor + PCI) ⚖ | "Spend from your collection's value." | Holders → daily spend |
| 4 | **Bank rails / ACH (deposit-withdraw)** | Corp B · `BANK_RAILS_ENABLED` (BaaS + MSB) ⚖ | "Move real dollars in and out." | Everyone → primary-account behavior |
| 5 | **FX / cross-border** | Corp B/C · `FX_*ENABLED` (MT posture) ⚖ | "Buy from / sell to collectors worldwide." | Sellers → global liquidity |
| 6 | **Goeman Pay (stablecoin rail)** | Corp B/C · `ARGUS_PAY_ENABLED` ⚖ | "Pay any merchant, agent-native." | Power users → payments |
| 7 | **RWA: real estate / treasuries / equities** | Corp B/C · `EQUITIES_ENABLED` + counsel/TA/ATS ⚖ | "Own everything else, same tap." | Broaden the marketplace surface |
| 8 | **Starter (teen / family)** | Corp B/C · `TEEN_ENABLED` (COPPA, custodial) ⚖ | "Start your kid's collection + savings." | Parents in the collector base |

**The throughline:** collectibles is the **acquisition wedge**; the **wallet + USD balance is retention**;
each later wave is a **cross-sell into a base that already trusts the brand** — and each only turns on when
its license/partner exists. You market what's legal, in order.

---

## 7. Brand & positioning guardrails

- **Outcomes, not infrastructure** (PRD 01): "own a graded Charizard," not "HTS tokens on Hedera."
- **Marketplace, not exchange.** No charts, no day-trading UX, no "buy low sell high."
- **The anti-positioning** (PRD 01) is a marketing constraint: not an investing app, not a crypto exchange,
  no advice, no recommendations — *users browse and decide.* This *is* the compliance moat.
- **Design-led** — the monochrome + jade "Quiet Premium" aesthetic as a recognizable signature against a
  loud, scammy category.

---

## 8. Funnel & metrics across phases

```
Phase 0 (now):   content → waitlist → referral(K) → founding-seller tokenizations (SUPPLY)
Launch (Corp B): waitlist → activation → first buy/sell → GMV → take-rate revenue
Retention:       30/90-day retention → USD-balance attach → cross-product attach (waves 3–8)
```
The few numbers to watch by phase: **supply** (slabs tokenized) and **K** pre-launch; **activation +
first-transaction conversion + GMV** at launch; **retention + attach rate** after. Keep it lean.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Incumbent copies the wedge** (Robinhood/PayPal) | Win **supply** first (founding-seller moat); be tokenization-native + one-app, not bolt-on |
| **Howey-reframe trap** — community/creators call it "investing" | The §3 gate is a hard rule; brief every creator; correct "investment" language publicly |
| **Supply cold-start** | Founding-Sellers program + card-show on-the-spot tokenization *before* launch |
| **Corp-B timing slip** (escrow delayed) | The **provenance + authentication product stays live as the bridge** — audience keeps a reason to engage without money movement |
| **Creator dependency** | Diversify across rippers/sports/Pokémon + owned channels (waitlist, Discord, email) |
| **Counterfeit / grading-fraud reputational hit** | Cert-verify + AI-grade + escrow are the product; lead with the "authenticity guarantee" |

---

## 10. The one-line strategy

**Manufacture demand and lock up supply now around the one thing that's legal to market — authenticated,
truly-owned graded slabs — then flip the escrow-protected marketplace on at Corp B and cross-sell the rest
of the suite into a base that already trusts you, one compliance unlock at a time.**

---

*Companion documents: `LAUNCH-READINESS.md` (gate scorecard + the prod-fatal switches that gate each wave),
`CORPORATE-STRUCTURE.md` (Corp A/B/C), `GO-LIVE-PLAN.md` §7 (guerrilla channels), `PRODUCTION-STRATEGY.md`
§8 (positioning), `goeman_prdv1/01`,`/05` (vision + marketplace). Product surface: `sellerCollectibleService`,
`collectiblePurchaseService`, `marketplaceService`, `collectiblesProvider`.*
