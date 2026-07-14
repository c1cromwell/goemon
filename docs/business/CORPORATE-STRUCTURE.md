# Corporate Structure & Compliance Strategy

A lean-now, licensed-later blueprint for incorporating Goemon Global Finance as a US tokenization-first
fintech — the least-compliance entry that still scales cleanly into a fully licensed money
business.

> **How to read this.** Every section is tagged **DO NOW**, **DEFER → Phase B/C**, or
> **⚖ see counsel**. Dollar and time figures are planning estimates (2025–2026 US), not quotes.
> This is strategy, not legal advice — the regulated decisions must be run past a fintech attorney
> and a CPA before you file or launch.
>
> **✓ Structure confirmed (2026-07-14):** a Wyoming-licensed attorney and a CPA have confirmed the core
> ownership design this doc describes — the two-member LLC (Chad 51% / Oran 40% / 9% pool), the partnership
> tax election, the IP-as-capital-contribution treatment, and the estate-planning design. Downstream
> licensing/regulated decisions (Phase B/C) remain **⚖ see counsel** as tagged.

---

## 1. Executive summary & the core legal thesis

**The thesis:** the cheapest legal way into fintech is to *not be a money business yet*. Goemon Global Finance's
locked architecture already supports this — keys live in the user's Secure Enclave, the server never
holds a private key, and tokenization is delivered as **software**. If you never take custody of
customer funds and never act as the intermediary that moves value, you stay outside the two most
expensive US regimes (money-transmitter licensing and broker-dealer registration) for as long as
possible.

So the strategy is a **three-phase compliance ramp**, with the corporate structure built on day one
to absorb each phase without re-papering the company:

| Phase | What you are | Licensing burden | Trigger to advance |
|---|---|---|---|
| **A — Launch** | Software + non-custodial wallet + tokenization infrastructure | Minimal: entity, AML *policy*, terms, IP. **No MTL.** | Live product, first users |
| **B — Partnered** | Same, plus regulated **partners** (BaaS bank, custodian, transfer agent, KYC vendor) move the money/assets for you | FinCEN MSB registration likely; partner due-diligence | You need fiat in/out or pooled custody |
| **C — Licensed** | You hold your own licenses / charter | State MTLs (or bank partnership), transfer-agent registration, possibly broker-dealer/ATS | Scale, unit economics justify owning the rails |

**The single most important rule:** the moment you touch customer fiat or hold their crypto for
them, you are probably a money transmitter in most states. Phase A is engineered to never do that.

**Recommendation at a glance:**

- **Form a Wyoming LLC now** (`Goemon Global Finance, LLC`) — the lowest-cost, lowest-admin, most private US entity,
  with pass-through taxation and crypto-friendly statutes. **Convert to a Delaware C-corp later**,
  when you raise institutional capital or stand up the regulated subsidiary (Phase B/C).
- **The agreed ownership is two founding members:** **Chad Cromwell — 51%** (Manager + CEO) and
  **Oran Cromwell — 40%** (father/son), with a **9% incentive pool** reserved for future team/advisors. The
  LLC is **manager-managed** (Chad) and taxed as a **partnership** (Form 1065; a K-1 to each member). This is
  the design the executed founding docs in `docs/legal/` (Operating Agreement, Initial Resolutions, Equity
  Incentive Plan, Articles/BOI) implement — see §4.
- **Adopt a real operating agreement** — it's the document partner banks, vendors, and a future conversion all
  lean on, and it's where the 51/40/9 split and Chad-as-manager control are recorded (the public Articles do
  not state ownership).
- **Assign the IP** (the code already in this repo) from you personally to the company immediately —
  the single cheapest-now / expensive-later action in this plan.
- **Do not market the product as a "bank"** or "banking." That word is regulated; using it can draw
  a cease-and-desist before you have a single user. (Yes, this affects the product name — see §9.)

---

## 2. Entity structure — start as a lean Wyoming LLC, convert into a holdco

### 2.1 What to form now (DO NOW)

A **two-member Wyoming LLC**, `Goemon Global Finance, LLC` — **Chad Cromwell (51%, Manager + CEO)** and
**Oran Cromwell (40%)**, plus a **9% incentive pool** reserved for future team/advisors — **manager-managed**
by Chad. It is the cheapest, most private US entity for a lean start, and a multi-member LLC keeps a clean
co-founder structure without the cost and double-taxation of a C-corp. A multi-member LLC is taxed as a
**partnership for federal tax** (Form 1065; a Schedule K-1 to each member) — still **pass-through** (no
entity-level corporate tax), just filed at the entity level rather than on a single personal return.

Why the Wyoming LLC for a lean start:

- **Minimal cost & admin.** ~$100–150 to form, ~$60/yr to maintain, no state income tax.
- **Pass-through taxation.** No double tax; income and (subject to rules) losses flow through to the members'
  returns via K-1. A partnership return (1065) is more than a solo Schedule C but far lighter than a C-corp.
- **Privacy.** Wyoming doesn't publicly list LLC members — ownership lives in the operating agreement, not the
  public Articles.
- **Crypto-forward law.** Wyoming pioneered digital-asset statutes, the DAO LLC, and the SPDI charter.
- **Liability shield** for the members' personal assets — as long as you respect the formalities (separate
  bank account, operating agreement, no commingling).

The honest tradeoffs vs. a C-corp — and why they don't bite yet:

- **No QSBS.** The §1202 gain exclusion needs a C-corp. You forgo it *until you convert* — acceptable
  while pre-revenue and pre-raise.
- **Equity comp uses profits interests.** As a multi-member LLC you grant team/advisors **profits interests**
  (a share of *future* upside above a hurdle) from the 9% pool rather than clean ISOs/NSOs — tax-efficient if
  papered correctly (Rev. Procs. 93-27 / 2001-43), and it converts to a normal option pool at the C-corp step.
- **Investors require conversion.** Institutional money wants a Delaware C-corp; **LLC → C-corp
  conversion** later is a real, lawyer-assisted step (often structured tax-neutrally) costing ~$3–8k, at which
  point the members' units become founder stock and profits interests become the option pool.

So: the WY LLC is the right lean Phase-A vehicle. Treat the **conversion to a Delaware C-corp** as a
planned future event tied to your first institutional raise or your first regulated subsidiary —
not something to pay for now.

### 2.2 Where this is going (DEFER → Phase B/C): convert, then split into a holdco

When you raise capital or introduce regulated activity, **convert the LLC to a Delaware C-corp**
(statutory conversion, or an F-reorg/Up-C as counsel advises) and adopt a holdco + opco structure so
a license never contaminates your software IP:

```
                 ┌─────────────────────────┐
                 │   Goemon Global Finance, Inc. (Delaware)│  ← parent holdco; owns IP, cap table, brand
                 └───────────┬─────────────┘
            ┌────────────────┼──────────────────┐
            ▼                ▼                  ▼
   ┌────────────────┐ ┌────────────────┐ ┌──────────────────────┐
   │ Goemon Tech     │ │ Goemon Markets  │ │ Goemon Transfer/MT   │
   │ (software/IP)   │ │ (RWA issuance,  │ │ (regulated sub:      │
   │ non-custodial   │ │  Reg D/A+/CF)   │ │  MTLs / transfer     │
   │ software/IP home│ │  — Phase B      │ │  agent — Phase C)    │
   └────────────────┘ └────────────────┘ └──────────────────────┘
```

*(Until you convert, "Goemon Global Finance, LLC" simply **is** the software/IP entity — the boxes below collapse
into the single LLC. The split appears only at conversion.)*

The reason: licenses, bonds, regulatory exams, and money-movement liability sit in the regulated
subsidiary. If that entity ever has a problem, your core technology and IP — the valuable asset — are
insulated in a separate box owned by the parent. You **don't pay for this complexity until the
revenue or the regulator forces it.** ⚖ see counsel when you spin up the first subsidiary.

### 2.3 The alternative (if you'd rather optimize for fundability now)

If raising institutional money or pursuing licensing *soon* is likely, you can **skip straight to a
Delaware C-corp** and avoid a later conversion — at the cost of higher run-rate, double taxation, and
more admin than a bootstrapper needs in Phase A. For Goemon Global Finance's lean, pre-revenue start, the **Wyoming
LLC is the recommended default**, converting when the money or the regulator makes the C-corp worth
it.

| | Wyoming LLC *(recommended now)* | Delaware C-corp | Offshore token entity |
|---|---|---|---|
| Setup cost | ~$100–500 | ~$500–1,500 (DIY–lawyer) | $$$ + ongoing |
| Annual cost | ~$60–150 | ~$400–900 | high |
| Taxation | Pass-through (simplest) | Double (corp + dividends) | Complex (CFC/PFIC) |
| Stock/options | Units / profits interests | Native, clean | n/a |
| QSBS | ❌ (gained on conversion) | ✅ | ❌ |
| Fundraising-ready | Convert first | ✅ best | Complicates US raise |
| Regulator/bank credibility | Good | ✅ high | Scrutiny / de-risking |
| Best for | **Your lean Phase-A start** | Imminent raise/licensing | Not recommended US-first |

---

## 3. Where to incorporate

**Wyoming for the LLC now. Delaware when you convert. Wyoming again on the radar for a future charter.**

- **Wyoming (now)** — the LLC home: no state income tax, member privacy, low fees, and the most
  crypto-forward statutes in the US (digital-asset law, the **DAO LLC**, and the **Special Purpose
  Depository Institution (SPDI)** charter — a long-term option for a crypto-native, custody-capable
  "bank-like" entity without FDIC deposit-taking). You'll **foreign-qualify** in your home state
  (where you actually work) and pay that state's fees too — budget for both. If you live in a
  high-tax/high-fee state (e.g., CA), confirm whether you must *also* register the LLC there. ⚖
- **Delaware (on conversion)** — when you raise or issue equity, convert to a **Delaware C-corp**:
  predictable corporate law (Court of Chancery), a playbook every investor/bank/lawyer knows, and
  clean stock mechanics. This is the planned Phase-B/C move, not a day-one cost.
- **Offshore (Cayman/BVI/CH/UAE)** — common for token *issuance* in pure-crypto projects, but for a
  **US-first, US-user** product it adds tax complexity (CFC/PFIC rules), banking friction, and
  regulator suspicion. **Not recommended** for your launch. Revisit only if a token-generation event
  for a protocol token (not the product) is ever on the table. ⚖ see counsel.

**Decision:** form `Goemon Global Finance, LLC` in Wyoming now; foreign-qualify where you live; plan the **Delaware
C-corp conversion** for your first raise/regulated subsidiary; keep the **Wyoming SPDI** as the deep
Phase-C charter option.

---

## 4. Founding ownership & equity structure (LLC units)

Membership interests are **membership units** governed by the **operating agreement** — no stock, no
authorized-share count, no Delaware franchise tax to engineer. The Company authorizes **10,000,000 units**,
all Class A Voting, split between the two founding members with a reserved incentive pool.

**Agreed ownership (as implemented in `docs/legal/OPERATING-AGREEMENT.md` + `INITIAL-RESOLUTIONS.md`):**

| Member / reserve | Units | Interest | Class / vote |
|---|---|---|---|
| **Chad Cromwell** — Manager + CEO + Partnership Representative | 5,100,000 | **51%** | Class A Voting |
| **Oran Cromwell** (father/son) | 4,000,000 | **40%** | Class A Voting |
| **Equity Incentive Plan pool** — *reserved, unissued* | 900,000 | **9%** | per award |
| **Total authorized** | 10,000,000 | 100% | |

Both founders' units are **fully vested** on the effective date. The 9% pool is reserved (not outstanding, no
vote, no allocations) until issued as **profits-interest** awards under the Plan. *(Governance percentages are
computed on issued/outstanding units; see the OA §2.2 and `INITIAL-RESOLUTIONS.md`. The father/son ownership
is a deliberate design — confirm the estate/gift implications with counsel + CPA. ⚖)*

| Item | Recommendation | Why |
|---|---|---|
| Ownership | **Chad 51% / Oran 40% / 9% pool** | Clean co-founder split; Chad holds majority control + manages |
| Units | **10,000,000 units** authorized (5.1M / 4.0M issued; 0.9M reserved) | Clean for future grants + the C-corp conversion |
| Capital contribution | Each member contributes cash (e.g., $500–1,000); **Chad also contributes the assigned IP** | Establishes basis + the LLC's capital (§704(c) on the contributed IP — ⚖ CPA) |
| Tax election | Default **partnership** (multi-member); **revisit S-corp election** only if profits get large | Don't over-optimize taxes pre-revenue |

**Operating agreement — your most important governance document. DO NOW.** It defines ownership (the 51/40/9
split), management (**Chad as manager**), capital, unanimous-consent Reserved Matters, transfer restrictions,
the two-member **deadlock/buy-sell** backstop, and how **profits interests** get admitted from the pool. Banks
and a future conversion both rely on it, and it reinforces the liability shield (an LLC without one is easier
to "pierce").

**Incentive equity for future hires/advisors — profits interests.** When you bring people on, an LLC
grants **profits interests** (a share of *future* upside, not existing value) rather than stock
options. They're tax-efficient if papered correctly — and the moment they get complex is exactly the
moment to do the **Delaware C-corp conversion** (§2.2) and switch to a normal option pool.

**The 83(b) nuance for an LLC. ⚖ note.** The founders' units are issued **fully vested and outright**, so the
classic founder-stock 83(b) urgency doesn't apply to Chad's or Oran's initial units. But 83(b) *does* matter
for the pool: every **profits-interest** award (and any later unit subject to vesting) should file a protective
**83(b) election within 30 days** of that grant. Keep the 30-day rule on the radar for every Plan award — it's
unfixable if missed.

**SAFE-ready / raise posture.** You can technically raise into an LLC, but most investors want a
Delaware C-corp and a SAFE. So the plan is: stay lean as the LLC; **convert to a DE C-corp the moment
a real raise is on the table**, then raise on a standard **SAFE** (the YC standard). Don't contort the
LLC to look like a startup it isn't yet.

**Tooling:** a cap-table tool is overkill for a closely-held two-member LLC — the operating agreement's
Schedule A plus a folder of signed docs is the cap table now. Adopt **Carta/Pulley** at conversion, when
options and investors arrive.

---

## 5. Governance, founding documents & the IP assignment

Every LLC needs the real paper — skipping it weakens the liability shield and creates problems exactly when
you can least afford them (a raise, a partner-bank diligence, an acquisition). With two members it also fixes
the split, the manager's authority, and the deadlock/buy-sell rules before they're ever tested.

**The document set (DO NOW):**

- **Articles of Organization** (filed with Wyoming) — the LLC's name and registered agent (ownership stays
  off the public filing).
- **Operating Agreement** — the 51/40/9 ownership, **Chad as manager**, capital, Reserved Matters, transfer
  restrictions, and the rules for admitting profits interests from the pool (§4). The cornerstone document.
- **Initial Member/Manager Resolutions** — issue the founders' units, appoint Chad Manager+CEO, adopt the
  partnership tax classification, authorize the bank account + the IP contribution (`INITIAL-RESOLUTIONS.md`).
- **EIN** from the IRS (free; needed for the bank account — a multi-member LLC files Form 1065 under its EIN).
- **IP / Invention Assignment** — **Chad** signs one assigning his work to the LLC as a capital contribution;
  every contributor signs one too (see below).

**The IP assignment — do this immediately. ⚖ DO NOW.**
Right now, *you personally* wrote the code sitting in this repository — which means **you**, not the
company, may own it. Before any value accrues, execute a **Technology/IP Assignment Agreement**
transferring all of it (code, designs, the Goemon Global Finance marks, domains, the architecture docs) to
`Goemon Global Finance, LLC`. This is the #1 thing acquirers and investors diligence, it survives the future C-corp
conversion intact, and it's trivially cheap to fix today and expensive to fix later. Make sure any
contractor or contributor (now or ever) signs an assignment too — work-for-hire alone is not enough
for IP.

---

## 6. The phased compliance roadmap *(the heart of this document)*

### Phase A — Launch as non-custodial software (DO NOW)

**Goal: deliver real product value while staying outside money-transmitter and broker-dealer scope.**

What keeps you out of scope:

- **Non-custodial by architecture.** Keys are generated and held in the user's Secure Enclave; the
  server never holds a user's private key (a *locked* architecture decision in this repo). You are
  not holding customer funds, so you are generally not a money transmitter under FinCEN's framework
  for non-custodial wallet software.
- **Tokenization framed as software.** You build the rails; you are not the issuer of record taking
  in investor money. The repo's demo securities are explicitly labeled "not a real offering" — keep
  that posture until an entity is set up to issue properly (Phase B).
- **Partner out everything that touches money.** No fiat on/off-ramp run by you. If users need to
  buy crypto, route them to a licensed third party (e.g., an embedded on-ramp like MoonPay/Stripe
  Crypto/Coinbase) under *their* license, not yours.

**What you CAN do in Phase A:** non-custodial wallet, DID/VC identity, tokenized-asset *viewing* and
*peer-to-peer* transfers the user signs themselves, the AI agent/MCP experience operating under
user-granted, user-signed authorizations (already built), and a marketplace UI that *links to* but
does not *operate* the trade as principal.

**What you CANNOT do in Phase A:** hold customer USD or crypto, run an exchange/order book as
intermediary, issue and sell securities to the public, or move money between users as the middleman.

**The securities reality of tokenized RWAs. ⚖ see counsel — this is the sharpest edge.**
A tokenized building, fund, or business interest is almost certainly a **security**. Selling it in
the US requires either registration or an exemption:

| Exemption | Who can invest | Raise cap | Marketing | Fit for Goemon Global Finance |
|---|---|---|---|---|
| **Reg D 506(c)** | Accredited only (verified) | Unlimited | Public solicitation OK | Best early path; pair with accreditation checks |
| **Reg A+ (Tier 2)** | Anyone | $75M/yr | Public | Costly "mini-IPO"; later phase |
| **Reg CF** | Anyone | $5M/yr | Via funding portal | Needs a registered portal partner |

Your repo already models the compliance gating (tier/jurisdiction/holder-cap, the Compliance Module),
which maps cleanly onto Reg D accreditation + holder caps — but the *legal* offering wrapper must be
built with a securities attorney before you sell anything real.

**Phase A compliance you DO still need (cheap, do it now):**

- A written **AML/KYC policy** and a named compliance officer (you), even pre-license — it's table
  stakes for partner diligence and good hygiene. The repo's identity ladder + VC issuance + append-only
  audit log are most of the technical substrate.
- **OFAC/sanctions screening** at onboarding (screen every user against SDN lists).
- **Terms of Service, Privacy Policy, E-Sign consent, risk disclosures.**

### Phase B — Partnered (DEFER → when you need fiat or pooled custody)

When users need to move real dollars or you need to custody pooled assets, plug in regulated partners
rather than becoming regulated yourself:

- **BaaS / partner bank** (e.g., Column, Lead Bank, Unit/Treasury Prime as middleware) — for FBO
  accounts, ACH, debit, fiat rails. *They* hold the banking license; you ride it.
- **Qualified custodian** for crypto/RWA custody (e.g., Anchorage, BitGo, Fireblocks-backed).
- **Transfer agent** for tokenized securities cap-table-of-record.
- **KYC/AML vendor** (Persona, Alloy, Footprint) to industrialize identity + sanctions + ongoing
  monitoring.

**Trigger:** the first time money or pooled custody flows through *you*, you very likely must
**register as a FinCEN Money Services Business (MSB)** (a federal registration, ~free, biennial) and
your written AML program becomes mandatory, not optional. ⚖ see counsel on the exact trigger.

### Phase C — Licensed (DEFER → when scale justifies owning the rails)

The expensive, defensible end state, pursued only when unit economics justify it:

- **State Money Transmitter Licenses (MTLs)** — the big one. ~$50–150k+ to get a meaningful US
  footprint, surety bonds per state, minimum net worth, multi-year timeline. Most fintechs **partner
  instead** (Phase B) for years; only bring MTLs in-house when margin demands it.
- **Broker-dealer / ATS** — if you want to operate secondary trading of tokenized securities as
  principal/venue, you need a registered broker-dealer and likely an **ATS** (Alternative Trading
  System). Realistically a partnership (e.g., with a licensed BD/ATS) long before you own one.
- **Transfer-agent registration** — SEC Form TA-1 if you become the official record-keeper for
  securities holders.
- **Wyoming SPDI charter** — the long-horizon "crypto bank" option for custody at scale.

---

## 7. Corporate bank account & money movement

**DO NOW:** open a corporate account at a **fintech-friendly bank** once you have the EIN + formation
docs:

- **Mercury** — the startup default; good API, treasury, crypto-tolerant. Strong first choice.
- **Brex** — cards + spend management; good if you want corporate cards early.
- **Column / regional banks** — relevant later as actual banking *partners* (Phase B), distinct from
  your operating account.

What they'll ask for: EIN, Articles of Organization + operating agreement, your ID,
beneficial-ownership info, and a description of the business. **Be precise and honest** that you're building crypto/tokenization
software — vague or evasive answers get accounts frozen ("de-risked"). A clean "non-custodial
software, no customer funds in Phase A" story is bankable; "we move customer crypto" without licenses
is not.

**The commingling rule (non-negotiable):** the moment any customer-adjacent funds exist, they live in
**separate FBO/escrow accounts**, never your operating account. Commingling customer money with
corporate money is how fintechs get shut down and founders get personal liability. In Phase A you
avoid this entirely by not holding customer funds.

---

## 8. KYC/AML & BSA program (even before you're licensed)

Build the program early — it's cheap as policy, expensive as a retrofit, and every partner bank will
demand to see it.

| Element | What it is | Repo substrate that maps to it |
|---|---|---|
| **Written AML/BSA policy** | Your documented program | — (author it; ~$2–5k with counsel or a template) |
| **Designated compliance officer** | A named human (you, initially) | — |
| **CIP / KYC** | Verify identity at onboarding | Tiered identity ladder, DID/VC issuance, risk-adaptive onboarding |
| **Sanctions/OFAC screening** | Screen against SDN/blocklists | Onboarding signal scoring hook |
| **Transaction monitoring** | Flag suspicious patterns | The ledger + orchestration engine (basis for the fraud system in the tech plan) |
| **SAR/CTR readiness** | File Suspicious Activity / Currency Transaction Reports when required | Append-only `audit_logs` / `mcp_audit_logs` give the immutable trail |
| **Recordkeeping** | Retain records 5 yrs | Append-only ledger + audit logs |

The point: your existing technical primitives (append-only audit, identity ladder, VC, signal
scoring) are already ~70% of a credible AML program's *evidence layer*. What's missing is the
**written policy + named officer + screening vendor**, which is mostly paperwork and a tool.

---

## 9. What you're missing — the founder checklist

| # | Item | Priority | Notes |
|---|---|---|---|
| 1 | **EIN** | DO NOW | Free from IRS; gates the bank account |
| 2 | **Registered agent** in Wyoming | DO NOW | ~$50–125/yr (Wyoming Agents, Northwest, etc.) |
| 3 | **Foreign qualification** in your home state | DO NOW | Where you actually operate; confirm if a high-fee state requires LLC registration too |
| 4 | **⚠ "Bank" naming risk** | DO NOW | "Bank"/"banking" are **regulated terms**; using them without a charter invites cease-and-desist. Consider a market-facing brand that avoids implying you *are* a bank ("Goemon Global Finance" the company is fine; marketing copy saying "your bank" is not). ⚖ see counsel |
| 5 | **Trademark** the brand | Soon | USPTO search + file; the name/marks should be company-owned (via §5 IP assignment) |
| 6 | **Terms of Service / Privacy Policy / E-Sign / risk disclosures** | DO NOW | Before any user signs up |
| 7 | **Data protection: GLBA + state privacy (CCPA/CPRA etc.)** | DO NOW | Fintech data is sensitive; GLBA safeguards apply once you're financial |
| 8 | **Cyber + tech E&O insurance** | Phase B | Partners will require it; also basic prudence |
| 9 | **Cap-table tool** (Carta/Pulley) | At conversion | Overkill for a closely-held two-member LLC (Schedule A is the cap table); adopt when options/investors arrive |
| 10 | **Accounting + R&D tax credits** | Soon | A startup CPA; the federal R&D credit can offset payroll tax — real money for a dev-heavy build |
| 11 | **Beneficial Ownership (BOI)** reporting | Check status | FinCEN BOI rules have shifted; confirm current applicability ⚖ |
| 12 | **Business insurance / D&O** | Phase B | Especially before taking on any investor |
| 13 | **"Not advice" disclaimers** in-product | DO NOW | Especially around tokenized-asset/investment surfaces |

---

## 10. 90-day action checklist (ordered)

**Days 1–14 — exist as a company**
1. Pick the exact legal name; clear it (Wyoming name check + USPTO knockout search).
2. File the **Wyoming LLC** (Articles of Organization); appoint a registered agent.
3. Get the **EIN**.
4. Adopt the **operating agreement** (Chad as manager; Chad 51% / Oran 40% / 9% pool) and the **initial
   resolutions**; each member makes their **capital contribution**.
5. Execute the **IP/Technology Assignment** (repo → `Goemon Global Finance, LLC`); Chad contributes the IP and
   every contributor signs an invention assignment.
6. *(The founders' units are issued fully vested, so no founder 83(b) is triggered. But file a protective
   **83(b)** within 30 days of any **profits-interest** grant from the 9% pool — unfixable if missed.)*

**Days 15–45 — be operational & bankable**
7. Open the **Mercury** (or Brex) business account.
8. Foreign-qualify in your home state.
9. Engage a **startup CPA** and (for the regulated questions) a **fintech/securities attorney** —
   even a few scoped hours now prevents expensive mistakes.

**Days 46–90 — compliance & launch posture**
11. Draft **ToS / Privacy / E-Sign / risk disclosures**; publish before onboarding users.
12. Write the **AML/KYC policy**; name yourself compliance officer; wire in **OFAC screening**.
13. Lock the **Phase-A product scope** to non-custodial / no-customer-funds; document *why* each
    feature stays in scope (this doc + counsel sign-off is your defense).
14. File the **trademark**; finalize the market-facing brand that avoids the "bank" trap.
15. Decide the **Phase-B trigger** in writing (what user need forces partners + MSB registration) so
    you advance deliberately, not by accident.

---

### Appendix — rough first-year cost envelope (bootstrap)

| Line | Estimate |
|---|---|
| Wyoming LLC formation (DIY–assisted) | $100–500 |
| Registered agent | $50–125/yr |
| Wyoming annual report / license tax | ~$60–100/yr |
| Home-state foreign qualification | $100–400 |
| Operating agreement (template + review) | $0–1.5k |
| Legal (scoped: formation review, IP, AML policy, securities Q&A) | $3–10k |
| Startup CPA (setup + first year) | $1–3k |
| ToS/Privacy (templated + reviewed) | $0.5–3k |
| **Total realistic Year-1** | **~$5–18k** (LLC keeps the floor lower than a C-corp) |

Compare that to Phase-C licensing ($50–150k+ for MTLs alone) and the logic of the lean ramp is
obvious: **spend thousands to launch, defer the hundreds-of-thousands until revenue earns it.**

---

*Operative legal set: `docs/legal/` — `OPERATING-AGREEMENT.md` (cornerstone), `INITIAL-RESOLUTIONS.md`,
`EQUITY-INCENTIVE-PLAN.md`, and `FORMATION-articles-of-organization.md`. These implement the **two-member
Chad 51% / Oran 40% / 9% pool** design described above and are the authoritative record of ownership,
management, and the pool.*

*Superseded alternative: `GO-LIVE-PLAN.md` proposed a different ownership design — an anonymous, child-owned
Wyoming IP HoldCo plus a separate founder-owned management company. **That design was not adopted** (the
two-member LLC above was), and `GO-LIVE-PLAN.md` is retained only for its reasoning + guerrilla-marketing plan.*

*Next document: the Production Deployment & Technology Strategy — cloud, the agent/MCP/skills
automation fabric, the Neo4j Identity Vault, the fraud system on your orchestration engine,
Constellation digital evidence, iOS-vs-Android, and GTM.*
