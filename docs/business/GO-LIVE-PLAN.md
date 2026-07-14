# Go-Live Plan — Child-Owned, Founder-Controlled, with a Guerrilla GTM

> ## ⚠️ SUPERSEDED — alternative ownership design, NOT ADOPTED
> The **child-owned Wyoming IP HoldCo + separate founder-owned management company** design described below was
> **not adopted.** The agreed and operative structure is the **two-member `Goemon Global Finance, LLC`** —
> **Chad Cromwell 51% (Manager + CEO) / Oran Cromwell 40% / 9% incentive pool, partnership-taxed** — as
> implemented in the `docs/legal/` set (`OPERATING-AGREEMENT.md`, `INITIAL-RESOLUTIONS.md`,
> `EQUITY-INCENTIVE-PLAN.md`, `FORMATION-articles-of-organization.md`) and now reflected in
> `docs/business/CORPORATE-STRUCTURE.md`.
>
> **Do not treat the ownership/entity mechanics in this document (child-owns-100%-anonymously, the gift/Form
> 709, the separate `Goemon Management LLC` + Management Services Agreement, the 10–15% pool) as operative.**
> This file is retained only for its **reasoning** and the **guerrilla-marketing plan** (still useful);
> ownership authority lives in the legal set + `CORPORATE-STRUCTURE.md`. ⚖ revisit only with counsel if the
> estate-planning HoldCo design is ever reconsidered.

The operator's plan for taking Goemon Global Finance live under a specific ownership design:
**your adult child owns the company anonymously, you control it and earn through a separate
management company you own, and you grow it with a low-budget guerrilla marketing engine** — all
inside the Phase-A non-custodial posture and the "never call it a bank" guardrail.

> **How to read this.** This document *layers on top of* — it does not replace — three existing docs:
> `CORPORATE-STRUCTURE.md` (the Wyoming-LLC → Delaware-C-corp ramp + the Phase A/B/C compliance
> ladder), `LAUNCH.md` (the launch readiness / go-no-go gate), and `PRODUCTION-STRATEGY.md` (cloud,
> ops, GTM positioning). Where those cover something, this cross-references rather than repeats.
> Every section is tagged **DO NOW**, **DEFER → Phase B/C**, or **⚖ see counsel**, matching the house
> style. Dollar/time figures are 2025–2026 planning estimates, not quotes.

> ⚖ **This is strategy, not legal or tax advice.** Gifting a company to your child, the
> management-company structure, the anonymity layering, and the equity grants each carry **gift-tax,
> valuation, asset-protection, securities, and control** consequences. **A fintech/securities attorney
> and a CPA must review this before you file, sign, or transfer anything.** Treat every ⚖ tag as a
> hard stop until counsel signs off. Gift-tax exemption and exclusion *amounts change every year* — this
> doc describes the **mechanics**, not the current-year numbers; your CPA supplies those.

---

## 1. Executive summary & the ownership thesis

You want three things at once that normally pull against each other: (a) your **child to own** the
company, (b) **you to keep control** and have a clean way to **bank and pay taxes**, and (c) the
ownership to be **anonymous**. The clean way to get all three is a **two-entity split**, formed on day
one and built to survive the future Delaware C-corp conversion:

```
        You (founder)                          Your adult child
              │ owns 100%                            │ owns 100% (anonymously)
              ▼                                       ▼
   ┌───────────────────────┐  Management   ┌───────────────────────────────┐
   │  Goemon Management LLC  │ Services Agr. │  Goemon Global Finance, LLC │
   │  (your home state)     │ ────────────▶ │  (Wyoming, manager-managed)   │
   │  • you bank here       │  fee for svc  │  • owns ALL IP + brand + code │
   │  • you draw income     │ ◀──────────── │  • the appreciating asset     │
   │  • you file taxes here │   the asset   │  • YOU are the named manager  │
   │  • you control it      │   stays put   │    → control without ownership │
   └───────────────────────┘                └───────────────────────────────┘
```

**The thesis — "freeze the value to the child now; keep control and income via the management
company."**

- The valuable, appreciating asset is the **IP**: the code in this repo, the architecture, the brand,
  the domains. It lives in the **IP HoldCo** (`Goemon Global Finance, LLC`, Wyoming), which your
  child owns 100%. Because the gift happens **now, pre-revenue**, the company is worth very little — the
  **most tax-efficient moment** to move ownership and future appreciation into your child's hands. ⚖
- **Ownership ≠ control.** A Wyoming LLC can be **manager-managed**: you are appointed **manager** in
  the operating agreement and run everything and sign for the company, while your child is the passive
  **member/owner**. You don't need to own it to control it.
- The **Management Company** (`Goemon Management LLC`) is owned by **you**. It contracts with the IP
  HoldCo under a **Management Services Agreement** and is paid a fee. This is the entity where **you
  open bank accounts, draw income, and file taxes** — and it owns no IP and does no regulated activity,
  so it carries no appreciating value and no licensing exposure.
- **Anonymity** comes from Wyoming (members are not on the public record) plus a manager-managed
  filing and a registered agent, optionally hardened with a holding-LLC/trust layer (§2.3).

This is a recognized estate-planning / asset-protection pattern. Its sharp edges — gift-tax valuation,
keeping the management fee defensible to the IRS, and not piercing the liability shield by commingling
— are exactly the things §4, §3, and §9 flag for counsel.

**Decisions baked in (from your direction):** child is an **adult (18+)** → can hold units and sign
directly, **no trust/custodian required** (a trust is offered only as an optional anonymity wrapper);
your entity is a **management company you own**; **maximum anonymity**; equity grants are scoped for
**future hires, advisors, and a co-founder**.

---

## 2. Entity 1 — the IP HoldCo (`Goemon Global Finance, LLC`, Wyoming)

**DO NOW.** This is the same Wyoming LLC that `CORPORATE-STRUCTURE.md` §2 recommends — the lowest-cost,
most private, most crypto-forward US entity — with two modifications for your design: it is
**manager-managed** (you as manager) and **owned by your child** (not you).

### 2.1 Formation & governance

- **Articles of Organization** filed in Wyoming, **manager-managed**, naming only the **registered
  agent** publicly (~$50–125/yr; Wyoming Agents / Northwest / etc.).
- **Operating Agreement (manager-managed):** names **you as manager** with full operating authority
  (sign contracts, open the company's own operational accounts, hire, execute the IP assignment), and
  your **child as the sole member/owner**. This private document — not the state filing — is where
  ownership is recorded. It also contains the **admission rules** for later equity grants and the
  conversion mechanics (§6, §2.4).
- **EIN** from the IRS (free; a single-member LLC still gets its own EIN).
- **All IP assigned *into* this entity** (§5) — this is the box that must own the code, so that when
  your child receives the company, they receive the IP with it.

### 2.2 Why the asset lives here

This entity holds the thing that appreciates. Putting it in the child's hands **while it's worth almost
nothing** is the whole tax play (§4). Everything regulated-but-deferred (Phase B/C: partner bank, MSB,
licensing) eventually sits in *subsidiaries of this entity's successor*, never in your management
company — see the holdco/opco split in `CORPORATE-STRUCTURE.md` §2.2.

### 2.3 Anonymity mechanics (maximum) ⚖

- **Baseline (free):** Wyoming does not list LLC members publicly. Manager-managed means the public
  filing shows the registered agent and (optionally) the manager — **never the member/owner**. Your
  child's name appears only in the private operating agreement.
- **Optional hardening:** have your child hold their membership through **their own Wyoming holding
  LLC** or a **trust**, so even the manager/organizer line doesn't tie to a personal name, and use the
  registered agent as the organizer of record. A trust also adds asset-protection and a clean
  succession path. This is optional because your child is an adult; weigh it against the extra admin. ⚖
- **Honest limit:** anonymity is *privacy from casual public record*, not from the IRS, a bank's
  beneficial-ownership (KYC/BOI) process, or a court order. Banks and any future investor **will** see
  the real owner. Don't design around hiding from regulators — design around keeping it off the public
  internet. The "anonymity vs. fundability" tension resurfaces at the C-corp conversion (§9 risk
  register).

### 2.4 How it converts later (DEFER → Phase B/C)

When you raise or stand up a regulated subsidiary, convert the IP HoldCo to a **Delaware C-corp**
(`Goemon Global Finance, Inc.`) per `CORPORATE-STRUCTURE.md` §2.2: the child's units become
**founder stock**, profits interests convert to an **ISO/NSO option pool** (§6), and the holdco/opco
split insulates licenses from the IP. Papering the operating agreement cleanly now makes that
conversion tax-neutral and cheap. **Don't pay for any of this today.** ⚖

---

## 3. Entity 2 — the Management Company (`Goemon Management LLC`)

**DO NOW.** This is the entity you asked for — *your* vehicle for **taxes and bank accounts**.

### 3.1 What it is

- A **second LLC, owned 100% by you**, formed in **your home state** (where you actually work — no
  need for Wyoming here; you want it local and simple for banking and taxes). Single-member →
  disregarded for federal tax, so its income flows to your personal return.
- It is the entity where **you open the operating bank account** (Mercury or Brex — see
  `CORPORATE-STRUCTURE.md` §7), **draw your income**, and **file your taxes**.
- It **owns no IP and does no regulated activity.** That keeps it value-light (so it's not part of the
  estate you're freezing) and license-free.

### 3.2 The Management Services Agreement (the connective tissue) ⚖

A written **Management Services Agreement (MSA)** between `Goemon Management LLC` (provider) and
`Goemon Global Finance, LLC` (client):

- **Scope:** software development, product management, operations, marketing, and administration
  performed by you/your company **for** the IP HoldCo.
- **Fee:** a **defensible, arm's-length** fee (cost-plus or a market rate for the services) — this is
  the income you live on. ⚖ The fee must be *reasonable and documented*; an inflated or arbitrary fee
  invites the IRS to recharacterize it and can undercut both entities. Your CPA sets the basis.
- **IP stays put:** the MSA states explicitly that **all work product and IP belongs to the IP HoldCo**
  (reinforced by the contributor IP-assignment in §5) — the management company is paid for services and
  never accrues ownership of the asset.
- **Formalities:** keep the two entities' books and bank accounts **fully separate** (no commingling),
  invoice on a regular cadence, and observe the agreement in practice. This is what makes the structure
  respected rather than ignored. ⚖

### 3.3 Why this gives you what you asked for

You said you want "a separate LLC that gives me some way to do taxes, set up bank accounts, etc." This
is it: **you bank and pay taxes through a company you own outright**, you draw a real income via the
MSA, and yet **the appreciating asset and its future upside sit with your child** in the other entity.
Control (via the manager role) and income (via the MSA) are decoupled from ownership.

---

## 4. The gift / ownership transfer to your child ⚖ (heaviest counsel + CPA flag)

This is the step that makes your child the owner. Because they're an adult, it's mechanically simple —
but the **tax treatment is the part to get right with a CPA before you sign.**

- **The instrument:** an **Assignment of Membership Interest / Gift Agreement** transferring 100% of
  `Goemon Global Finance, LLC` to your child, recorded in the operating agreement's member schedule.
  Document **donative intent** (it's a gift, not a sale).
- **Do it pre-revenue, at low valuation.** The earlier and emptier the company, the lower the gift's
  value, the less of your lifetime exemption it consumes, and the more future appreciation lands
  **outside your estate** in your child's hands. This timing is the entire tax advantage — **gift
  before the company has measurable value.** ⚖
- **Form 709 + valuation.** A gift above the annual exclusion generally requires you to file a **federal
  gift-tax return (Form 709)** and apply your lifetime exemption (usually no tax *due*, but a filing).
  Support the reported value with a **defensible valuation memo** (a pre-revenue software entity is
  low, but show the work). Your CPA decides whether a formal appraisal is warranted. ⚖
- **Basis:** a gift generally carries over **your cost basis** to your child (unlike an inheritance's
  step-up) — your CPA will weigh this against the estate-freeze benefit. ⚖
- **No trust/custodian needed (adult child).** Because your child is 18+, they can own and sign
  directly. A **trust or a child-owned holding LLC** remains an *optional* wrapper purely for
  **anonymity (§2.3) and asset protection** — not a requirement. ⚖
- **Sequencing matters:** **assign the IP into the HoldCo *before* you gift the HoldCo** (§5 → §4), so
  your child receives the entity *with the IP already in it*. Gifting an empty shell and assigning IP
  afterward muddies who owned the IP at transfer.

---

## 5. The complete legal & corporate agreement set

The full paper trail you asked to have "completed." Tagged by timing; ⚖ = do not sign without counsel.
Items already detailed elsewhere are cross-referenced, not rewritten.

| # | Document | Entity | Who signs | When | Purpose |
|---|---|---|---|---|---|
| 1 | **Articles of Organization** | IP HoldCo (WY) + Mgmt Co (home state) | Organizer / registered agent | DO NOW | Forms each LLC; only the agent is public |
| 2 | **Operating Agreement — manager-managed** | IP HoldCo | You (mgr) + child (member) | DO NOW | Ownership, your control as manager, admission rules for §6 grants, conversion mechanics |
| 3 | **Operating Agreement** | Mgmt Co | You (sole member/mgr) | DO NOW | Your wholly-owned services vehicle |
| 4 | **EIN** (each entity) | Both | You | DO NOW | Gates each bank account |
| 5 | **IP / Technology Assignment** (you → IP HoldCo) | IP HoldCo | You | DO NOW ⚖ | Moves all repo code/designs/marks/domains into the HoldCo — the #1 diligence item (`CORPORATE-STRUCTURE.md` §5). **Before the gift (§4).** |
| 6 | **Membership-Interest Assignment / Gift Agreement** (you → child) | IP HoldCo | You + child | DO NOW ⚖ | Transfers 100% ownership to your child (§4) |
| 7 | **Form 709 + valuation memo** | — (your personal filing) | You (CPA-prepared) | DO NOW ⚖ | Reports the gift; applies lifetime exemption (§4) |
| 8 | **Management Services Agreement** | Mgmt Co ↔ IP HoldCo | You (both sides) | DO NOW ⚖ | Your income + the IP-stays-put + arm's-length-fee terms (§3.2) |
| 9 | **Member/Manager Consent Resolutions** | Both | You (mgr) + child (member) | DO NOW | Authorize the bank accounts, the IP assignment, the gift, the MSA |
| 10 | **Contributor / Contractor IP-Assignment + NDA** template | IP HoldCo | Any contributor | DO NOW | Anyone who ever touches the code assigns it to the HoldCo (work-for-hire alone is insufficient) |
| 11 | **ToS / Privacy / E-Sign / risk + "not advice" disclaimers** | IP HoldCo | — (publish) | DO NOW | Cross-ref `LAUNCH.md` §5; publish before any signup |
| 12 | **AML/KYC/BSA policy + named compliance officer + OFAC screening** | IP HoldCo | You (officer) | DO NOW | Cross-ref `CORPORATE-STRUCTURE.md` §8; the identity ladder + VC + append-only audit are ~70% of the evidence layer already |
| 13 | **Trademark application** (Goemon brand) | IP HoldCo | You | Soon | USPTO knockout search + file; marks company-owned via #5 |
| 14 | **Beneficial Ownership (BOI) status check** | Both | You | DO NOW ⚖ | FinCEN BOI rules have shifted; confirm current applicability for each entity |
| 15 | **Equity Incentive Framework** (profits-interest plan + pool) | IP HoldCo | You (mgr) | DO NOW | §6 — set up the framework even before the first grant |

> Items 11–13 and the Phase-A compliance posture are the same gate `LAUNCH.md` §5 already enforces —
> this plan just adds the **two-entity, gift, and MSA** rows (2–9) on top.

---

## 6. Equity & stock-option framework (future hires · advisors · co-founder)

You asked that "stock options" be completed. In an LLC there is no stock yet — the correct analog is
**profits interests** — so the framework is two-stage, matching the LLC → C-corp ramp
(`CORPORATE-STRUCTURE.md` §4).

### 6.1 Now (LLC stage) — profits interests

- Adopt an **Equity Incentive Framework** and **reserve a pool** (e.g., **10–15%** of fully-diluted
  interests) for grants. Grants are **profits interests** — a share of *future* upside only (not
  existing value), which is the tax-efficient LLC instrument when papered correctly. ⚖
- **83(b) election within 30 days** of any grant subject to vesting — for *every* recipient
  (co-founder, advisor, hire). Missing the 30-day window is **unfixable.** Put it on a checklist. ⚖
- **Child-owner interaction:** every grant **dilutes the child's 100%** per the operating agreement's
  admission rules (§2.1). Reserve the pool **up front** so dilution is planned, disclosed, and clean —
  not a surprise to the owner. The operating agreement should pre-authorize the manager to issue from
  the reserved pool.

### 6.2 The three recipient types

- **Co-founder / partner:** an equity split with **vesting + a 1-year cliff** (standard 4-year vest)
  and **83(b) within 30 days**. ⚠ Admitting a member **converts the single-member LLC tax treatment to a
  partnership** — this is a real trigger to consider **doing the Delaware C-corp conversion early**
  (`CORPORATE-STRUCTURE.md` §4) so you grant clean options instead. Decide co-founder timing with that
  in mind. ⚖
- **Advisors:** a standard **advisor agreement** (e.g., FAST-style) + a small profits-interest/option
  grant on a **1–2 year vest, no cliff**, sized by advisor tier.
- **Future hires / employees:** grant profits interests from the reserved pool now; these become
  **ISO/NSO options** at conversion (§6.3).

### 6.3 At the C-corp conversion (DEFER)

Profits interests convert to a normal **ISO/NSO option pool** under a Delaware **Equity Incentive
Plan**; the child's units become founder stock; adopt **Carta/Pulley** to manage the cap table (overkill
for the LLC, right at conversion). This is the moment "stock options" in the literal sense exist. ⚖

---

## 7. Guerrilla marketing plan — X, Instagram & beyond

The growth engine: maximum reach, minimum budget — operating **strictly inside** the `LAUNCH.md` §1
compliance guardrail. The product's genuine novelty (an **AI agent that moves your money under
cryptographic, scoped, revocable permission** + **tokenized real-world assets in a non-custodial
wallet**) is the wedge (`PRODUCTION-STRATEGY.md` §8).

### 7.1 Positioning & the compliance vocabulary gate ⚠

- **Narrative:** *"the first money app run by AI agents — that you actually control."* Lead with the
  agent + MCP + tokenized-RWA story, not feature parity with a bank.
- **Say:** "tokenized assets," "non-custodial wallet," "agentic finance," "you hold the keys,"
  "scoped, revocable permission."
- **Never say:** "bank," "banking," "your bank," "deposits," "FDIC," "bank account," or any
  investment-return promise. Every investment surface carries the "not advice / not an offering"
  disclaimer the product already models. **Every post, caption, and clip passes this gate before it
  ships.**

### 7.2 X (Twitter) — the primary build-in-public channel

- **Founder build-in-public cadence:** a recurring ship-log of the agent/MCP/DID/VC tech — real
  progress, real demos. Developer-credible content earns the early AI + crypto crowd.
- **Demo clips:** short screen-recordings of the wedge — *"watch an AI agent move money under a
  90-second permission it can't exceed"* — the single most shareable moment the product has.
- **Reply strategy:** thoughtful, value-first replies into AI-agent, MCP, crypto, and fintech
  timelines; engage the MCP/agent-dev community where the product is genuinely a platform they could
  build on.
- **Waitlist drops:** periodic invite waves to manufacture scarcity and control onboarding risk.

### 7.3 Instagram / Reels (+ TikTok) — the visual demo channel

- **Reels:** the same demo moments cut for vertical video — the agent permission flow, the tokenized
  asset UI, the Quiet-Premium design aesthetic. Visual, fast, looped.
- **Founder story:** a tasteful *"why I built this and put it in my kid's name"* angle — the ownership
  design itself is a differentiated, human story (handle with care; keep your child's privacy intact,
  consistent with §2.3).
- **Design-led brand clips:** lean on the monochrome + jade Quiet-Premium look as a recognizable
  visual signature.

### 7.4 Other low-cost / guerrilla channels

- **Invite-only waitlist + referral mechanics:** scarcity + a referral coefficient is the core growth
  loop; it also throttles onboarding risk in Phase A.
- **Build-in-public beyond X:** a public changelog, **Hacker News** / **dev.to** posts on the
  agent/MCP/DID tech, and a **Product Hunt** launch when the portal is demo-ready.
- **Communities:** value-first participation in crypto/AI **Discords** and relevant **Reddit** subs —
  contribute, don't spam.
- **Short YouTube explainers:** "how the agent actually works" — the credibility long-form.
- **Guerrilla tactics (zero/low budget):** light, defensible hot takes on "agentic finance,"
  meme-able demo moments, cross-promo with AI-tool creators, and **stunt demos** (an AI agent doing
  something legitimately novel, on camera). Tie the **teen/family angle** to the Phase-22 *Goemon
  Starter* product for a distinct audience.

### 7.5 Cadence, funnel & metrics

| Channel | Cadence | Primary asset |
|---|---|---|
| X | 3–5×/week + daily replies | Ship-log, demo clips, waitlist drops |
| Instagram/TikTok | 2–3 Reels/week | Demo moments, founder story, brand aesthetic |
| Long-form (HN/dev.to/YouTube) | 1–2×/month | "How the agent works" deep dives |
| Community (Discord/Reddit) | Ongoing, value-first | Helpful presence, no spam |
| Product Hunt | One launch | Coordinated with portal readiness |

- **Funnel:** content → **waitlist signup** → invite wave → **activation** (passkey + first
  agent/tokenized action).
- **Metrics that matter:** waitlist signups, **referral coefficient (K)**, demo-clip reach/saves,
  activation rate, and qualitative dev-community signal. Keep it lightweight; optimize the loop, not
  vanity counts.
- **Guardrail:** **all** claims route past the §7.1 vocabulary gate before publishing.

---

## 8. The go-live timeline (corporate + compliance + marketing)

Mirrors the `CORPORATE-STRUCTURE.md` §10 90-day cadence, extended with the two-entity formation, the
gift, the MSA, the equity framework, and the marketing ramp. Order matters — note the dependencies.

**Days 1–14 — exist as the structure**
1. Clear the names (Wyoming name check + USPTO knockout for the brand).
2. File **both LLCs** — IP HoldCo (WY, manager-managed) + Management Co (home state).
3. Get **EINs** for both.
4. Adopt both **operating agreements** (HoldCo manager-managed: you = manager).
5. Execute the **IP / Technology Assignment** into the IP HoldCo *(must precede the gift)*.
6. **Gift the IP HoldCo to your child** (Assignment of Membership Interest) + capture Form 709 posture
   with your CPA.

**Days 15–45 — be controlled, bankable & papered**
7. Sign the **Management Services Agreement** (Mgmt Co ↔ HoldCo).
8. Open the **Management Company** bank account (Mercury/Brex); keep books fully separate.
9. **Foreign-qualify** where you operate.
10. Engage a **startup CPA + fintech/securities attorney** — scope them specifically to the **gift +
    valuation/709**, the **management fee**, the **anonymity layer**, and the **equity framework**.
11. Stand up the **Equity Incentive Framework + reserved pool** (§6); template the advisor/co-founder
    docs and the 83(b) checklist.

**Days 46–90 — launch posture + marketing ramp**
12. Publish **ToS / Privacy / E-Sign / "not advice" disclaimers** before any signup.
13. Write the **AML/KYC policy**; name yourself compliance officer; wire **OFAC screening**.
14. File the **trademark**; confirm **BOI** status for both entities.
15. **Lock the Phase-A scope** (non-custodial / no customer funds) and tie into the `LAUNCH.md`
    go/no-go gate — this plan's corporate rows feed gate **B6** there.
16. **Start the guerrilla marketing ramp:** waitlist live, build-in-public cadence on X/IG, first demo
    clips — all through the §7.1 vocabulary gate.

> The engineering go/no-go gates (iOS verification, E2E green, Hedera testnet vs. mainnet KMS) are
> owned by `LAUNCH.md` §3–6 and are unchanged by this plan.

---

## 9. Cost envelope & risk register

### Year-1 cost (extends `CORPORATE-STRUCTURE.md`'s appendix)

| Line | Estimate |
|---|---|
| *(all of `CORPORATE-STRUCTURE.md`'s Year-1 LLC/agent/legal/CPA/ToS lines)* | ~$5–18k |
| **Second LLC** (Management Co) formation + home-state fees | $100–500 + annual |
| **Management Services Agreement** drafting | $0.5–2k |
| **Gift: valuation memo + Form 709** prep (CPA) | $0.5–3k |
| **Equity plan** (profits-interest framework + templates) | $1–4k |
| Optional anonymity wrapper (trust / child holding-LLC) | $0.5–3k |
| **Added realistic Year-1** | **~$2.5–12.5k on top of the base** |

Still a small fraction of Phase-C licensing ($50–150k+ for MTLs) — the lean-now logic holds.

### Risk register ⚖

| Risk | What goes wrong | Mitigation / owner |
|---|---|---|
| **Gift-tax / valuation** | Over-valued gift burns exemption or triggers tax; under-documented gift is challenged | Gift pre-revenue; CPA valuation memo + Form 709 (§4) — **CPA** |
| **Management fee not respected** | IRS recharacterizes an arbitrary/inflated fee; structure ignored | Arm's-length, documented, regularly invoiced fee; separate books (§3.2) — **CPA/Counsel** |
| **Pierced liability shield** | Commingling the two entities' funds collapses the separation | Separate accounts, observe formalities, never commingle — **You** |
| **"Bank" naming trap** | Marketing implies a charter → cease-and-desist | §7.1 vocabulary gate on every post — **Product/Legal** |
| **83(b) missed** | A grant recipient owes tax on vesting; unfixable | 30-day checklist on every vesting grant (§6) — **Counsel** |
| **Anonymity vs. fundability** | Investors/banks require ownership disclosure at conversion | Accept privacy = public-record only; plan disclosure at the C-corp raise (§2.3) — **You/Counsel** |
| **Co-founder converts LLC to partnership** | Tax treatment changes on adding a member | Consider early C-corp conversion when adding a co-founder (§6.2) — **Counsel** |

---

*Companion documents: `CORPORATE-STRUCTURE.md` (the entity ramp + Phase A/B/C compliance ladder this
plan sits inside), `LAUNCH.md` (the launch readiness / go-no-go gate this plan's corporate rows feed),
and `PRODUCTION-STRATEGY.md` (cloud, ops, and the GTM positioning §7 builds on).*
