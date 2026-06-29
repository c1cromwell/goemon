# Payment Network Strategy — can Goeman build a card on a *new* (non-Visa/MC/Amex) rail?

An honest feasibility take on the founder question: *"Can we create a credit-card brand, but build a new
card network — new tech or a stablecoin rail — that isn't Amex, Visa, or Mastercard?"*

> **How to read this.** Sections are tagged **DO NOW**, **DEFER → Corp B/C**, or **⚖ see counsel** (matching
> `CORPORATE-STRUCTURE.md`). Dollar/market figures are planning estimates, not quotes. This is strategy, not
> legal or investment advice. It reconciles with — and extends — `docs/goeman_prdv1/06-payments-and-rails.md`
> (which currently plans the card as a **Visa/MC debit, v2**), `CORPORATE-STRUCTURE.md` (the Corp A/B/C ramp),
> and `docs/GOEMAN-PLAN.md` (Phases 19–20).

---

## 1. The honest verdict (read this first)

**Yes, it's possible — but reframe the goal, because "a new card network" is three different things and only
one of them is a good idea.**

- **A card *brand* (issuer):** easy. You ride Visa/MC via an issuer-processor + a sponsor bank. Months, not
  years. This is **Corp B** and is already the PRD plan. It is *not* a new network — you're a Visa program.
- **A new consumer card *network* that beats Visa/MC/Amex at in-store acceptance:** **don't.** It's a
  two-sided market with a 60-year, ~150M-merchant acceptance flywheel. Amex and Discover — funded, decades
  in — still under-index on acceptance. Apple, PayPal, and Cash App, with enormous distribution, all chose
  to **ride** Visa/MC rather than rebuild the rails. A startup cannot buy acceptance head-on.
- **A new *rail* (stablecoin / programmable) for a focused wedge:** **genuinely credible, and the only
  honest path to "not Visa/MC/Amex."** You own issuance (the Goeman wallet/users) and acceptance (merchants
  you directly integrate), and you settle in **USDC on Hedera** (~3s finality, ~zero fee, no interchange, no
  chargebacks). The unlock that legacy networks structurally cannot match is **programmable, scoped,
  agent-authorized payments** — which Goeman already has the primitives for.

**So the recommendation is a barbell:** issue a **Visa-rails card as a bridge** for legacy acceptance on day
one (Trojan horse), while building your **own stablecoin settlement rail** for the places where acceptance is
*greenfield* — crypto-native commerce, online/API checkout, P2P, and agent-to-merchant payments. Don't fight
Visa on acceptance; out-flank it on programmability and cost where it's weak. **"Credit" (a loan) is a
separate, harder layer** layered on top of whichever rail (see §6).

---

## 2. Card BRAND vs card NETWORK — two different things (the core confusion)

| | What it is | Who does it | Difficulty | Corp phase |
|---|---|---|---|---|
| **Brand / Issuer** | Your name on a card; you pick rewards, UX, the funding source | A program manager on **Marqeta/Lithic** + a **BIN-sponsor bank** | Low — a few months | **Corp B** |
| **Network** | The rails that route + clear + settle a transaction, and the **rulebook** both sides trust | Visa/MC/Amex today; *you*, if you build a rail | Very high (acceptance) | **Corp B/C+** |

A "network" is defined by owning **both sides** — cardholders *and* merchant acceptance — plus settlement and
the dispute/rulebook layer. Conflating "I want my own card" (brand, easy) with "I want my own network" (rails,
near-impossible head-on) is the trap. Goeman can have a **brand on Visa now** and a **rail of its own** for a
specific wedge — those are not in conflict; they're the bridge-and-beachhead.

---

## 3. The acceptance flywheel trap — why a Visa frontal assault is a graveyard

A card network is a **two-sided market**, and the hard side is **acceptance**, not issuance:

- **The flywheel:** merchants accept Visa because every consumer carries it; consumers carry it because every
  merchant accepts it. ~150M merchant acceptance points and decades of terminal/PSP integration. A new
  network starts at **zero acceptance** — a card that works nowhere is worthless, so no one carries it, so no
  merchant bothers. Cold-start in its purest form.
- **The economics that defend it:** interchange (~1.5–3.5%) flows from merchant → issuer and funds the
  rewards that make consumers carry the card. A new network either (a) charges similar fees (no reason for
  merchants to switch) or (b) charges less (and can't fund acquisition). Visa/MC also run as low-margin
  *utilities* on volume you don't have.
- **The evidence:** **Amex** built its own network and *still* trails Visa/MC on acceptance after 60 years.
  **Discover** is perennially the "also accepted" network. **Apple Card, PayPal, Cash App, Chime** — all with
  massive distribution — chose to **issue on Visa/MC**, not rebuild rails. If they didn't try a frontal
  assault, a startup shouldn't.

**Conclusion (DEFER / don't): do not try to out-Visa Visa on general in-person acceptance.** That door is
closed by structure, not by effort or capital.

---

## 4. The reframe — a stablecoin-settled, agent-native rail (where Goeman is actually strong)

The credible "new network" doesn't replace Visa's acceptance; it builds a **different rail** where Goeman
*already owns both sides* and the incumbents are weak.

**What "the network" means here:**
- **Issuance side:** the Goeman non-custodial wallet + user base (you control it).
- **Acceptance side:** merchants you **directly integrate** (checkout SDK / API / QR), starting where they
  *want* a new rail — see §5.
- **Settlement:** **USDC on Hedera** — ~3s finality, fractions-of-a-cent fees, **no interchange**, no
  multi-day settlement, no chargeback reversals. The ledger's existing **`external_clearing`** account is the
  attach seam; merchant payout is a balanced journal mirrored on-chain (the same money-seam discipline as the
  Phase-17 trading settlement).

**The genuine unlock legacy networks cannot match — programmable, scoped, agent-authorized payments.** Goeman
already has the primitives: **OID4VP + the MCP server + 90s scoped operation-tokens** (`presentationService`,
`routes/mcp.ts`, `smartchatService`). That means a payment can be **authorized by an AI agent under a
user-signed, scope-limited, time-boxed grant** — "spend up to $X at merchant Y for purpose Z, expiring in 90s."
A card network's rails were designed for a plastic card and a terminal; they cannot natively express
agent-to-merchant or machine-to-machine commerce. **This is the wedge** — not "a cheaper Visa," but "the
payment rail for agentic and programmable commerce."

**Honest tradeoffs (don't hand-wave these):**
- **Irreversibility vs chargebacks.** On-chain finality means no chargeback. Consumers *expect* dispute
  protection. You must build an **escrow + dispute layer** (hold-then-release, mediated refunds) — reuse the
  Phase-8 escrow pattern. This is real product work, not a footnote.
- **Volatility / UX.** USDC mitigates FX volatility; but on/off-ramp friction and "why do I need a stablecoin"
  remain. The card bridge (§5) hides this for legacy use.
- **Cold-start.** Even a great rail needs the *first* merchants and the *first* spenders. The beachhead (§5)
  is the whole game.
- **Compliance.** A stablecoin rail is money transmission + the 2025–26 stablecoin regime (see §7) ⚖.

---

## 5. The beachhead + the Visa bridge (Trojan horse)

**Beachhead — go where acceptance is *greenfield*, not where Visa is entrenched:**
1. **Crypto-native merchants** — already want stablecoin settlement; no terminal to displace.
2. **Online / API checkout** — a "Pay with Goeman (USDC)" button; integration is software, not hardware.
3. **P2P** — already built (Hedera USDC, ~3s; `06-payments-and-rails.md` §P2P). The social on-ramp.
4. **Agent-to-merchant / machine commerce** — the structurally-defensible frontier (§4); AI agents paying
   under scoped grants. Few competitors, and Goeman is ahead on the primitives.

**The bridge — issue a Visa card anyway, as a Trojan horse (DO NOW when at Corp B):**
- A **virtual + physical Visa card** (Marqeta/Lithic, BIN-sponsor bank) that **pulls from the USDC balance**
  (auto-convert at authorization). This gives **day-one acceptance everywhere** while the native rail's
  merchant side is still small.
- Strategy: **bridge now, migrate volume later.** Every transaction that can settle on the *native* rail
  (integrated merchant, online, agentic) does — capturing the economics and the programmability; everything
  else falls back to Visa. As the merchant side compounds, native volume grows and the Visa dependency shrinks
  for the use-cases where it matters.
- **Be candid:** you do **not** escape Visa for general in-store tap-to-pay in the near term. The card *is*
  Visa. What you own is the *balance, the rail for direct merchants, and the agentic layer* — and the brand.

---

## 6. "Credit" specifically — a loan, and a separate (harder) layer

The question said *credit* card. Credit ≠ the rail; **credit = lending = a loan**, with its own regime:

- **Unsecured revolving credit** (a real "credit card"): **Reg Z** / TILA, **state lending licenses (NMLS)**
  *or* a partner-bank originator, underwriting + alternative data, servicing (statements, collections,
  disputes), and **balance-sheet capital** to fund receivables. This is **PRD v3** and the hardest thing here.
  ⚖ see counsel.
- **Start lighter, in order:**
  1. **Charge card / pay-in-full** (settle the balance each cycle) — far less lending exposure; closer to a
     debit+float product.
  2. **Stablecoin-/RWA-collateralized credit** — already designed as **PRD v2 collateralized lending**
     (`06-payments-and-rails.md` §Lending): pledge Goeman-held RWA tokens, borrow USDC, auto-liquidate on LTV
     breach. This is a *secured* loan — much more tractable than unsecured, and it fits the tokenization stack.
  3. **Unsecured revolving** — defer to v3, behind a lending partner/license + capital.
- **Key point:** credit **rides on top of** whichever rail. Decide the *rail* (§4–5) first; bolt credit on
  once there's volume, a balance-sheet/partner, and the licenses.

---

## 7. Regulatory + capital reality (Corp B/C — multi-year, capital-heavy)

| Layer | What it triggers | Phase |
|---|---|---|
| Card **brand** on Visa + USD/USDC balances | BIN-sponsor bank, **FinCEN MSB**, program-manager compliance | **Corp B** |
| **Stablecoin settlement rail** | **Money transmission**; the 2025–26 US **stablecoin regime** (GENIUS Act / state frameworks) ⚖; AML/Travel-Rule on payments; settlement-risk + a **dispute/chargeback substitute** | **Corp B/C** |
| **Credit** (lending) | **Reg Z**/TILA, **NMLS or partner-bank** origination, underwriting/servicing, **receivables capital** | **Corp C / v3** |
| Operating a **network** (rules for third parties) | Network rulebook, settlement guarantees, possible additional registration as scale grows | **Corp C+** |

This is **not a near-term build.** It's a separate, capital-intensive venture — but it is **architecturally
seeded** by what already exists (Hedera USDC, the double-entry ledger + `external_clearing`, escrow, the
agent-authorization stack). Sequence it behind the corporate ramp; don't let "we're building a card" imply
"we're a bank" or "we offer credit" before the licenses exist (the `CORPORATE-STRUCTURE.md` §9 naming
caution applies doubly to the words *credit* and *network*).

---

## 8. How it maps onto the roadmap

- **Card brand / issuing** → extends **Phase 19 — Full-bank rails** in `docs/GOEMAN-PLAN.md` (BaaS partner +
  MSB already the gate there); the Visa-bridge card is a Phase-19 deliverable.
- **Native stablecoin settlement rail + agent-native payments** → **Phase 21 — "Goeman Pay"** (Corp B/C),
  reusing: the ledger **`external_clearing`** seam, **Hedera USDC**, the **OID4VP/MCP/operation-
  token** authorization stack, the **Phase-8 escrow** pattern (for the dispute layer), and the
  **SLA-isolation discipline** from the Phase-17 trading seam (payments must not degrade money-critical SLOs).
  **Stage-1 prototype now BUILT** (see `docs/GOEMAN-PLAN.md` Phase 21): merchants + payment intents,
  escrow-protected pay→capture/refund/dispute, the `pay_merchant` MCP scope for agent-to-merchant commerce,
  zero rail fee, `GOEMAN_PAY_ENABLED` kill-switch (prod-fatal until licensed).
- **Credit** → **collateralized** lending is PRD v2 (rides the rail); **unsecured** is PRD v3 (lending
  license/partner + capital).

> **One-line summary for the cap table / a pitch:** *Goeman isn't building "a cheaper Visa" — that's a
> graveyard. It's building the **settlement rail for agentic and stablecoin-native commerce**, with a Visa
> card as the bridge to legacy acceptance. The card is the on-ramp; the agent-authorized USDC rail is the moat.*
