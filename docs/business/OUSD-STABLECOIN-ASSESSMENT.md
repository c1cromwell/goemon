# Open USD (OUSD) — Stablecoin Assessment for Goemon Global Finance

> **Decision memo.** Question posed: *should Goemon pivot to Open USD (OUSD)?* Short answer:
> **No — and it isn't a "pivot."** OUSD is a *settlement-stablecoin option* that fits Goemon's
> existing "distribute, don't issue" thesis. Recommendation: **prepare & position** — stay on
> Hedera + USDC today, build OUSD-readiness, **apply to Open Standard's partner program now**,
> and adopt when OUSD is live *and* its openness/yield-share terms are confirmed.
>
> Prepared 2026-07-01. OUSD was announced 2026-06-30 (one day prior) — treat everything below as
> an **announcement of a design**, not an operating product. Facts adversarially verified via a
> multi-source deep-research pass (21 confirmed / 4 refuted claims). Not legal or investment
> advice. ⚖ counsel for any regulated step.

---

## 1. TL;DR / recommendation

- **Do not pivot.** Goemon is tokenization-first with a **swappable stablecoin settlement layer**
  (currently USDC-on-Hedera). OUSD is a candidate settlement asset, not a change of strategy.
- **It aligns with the brand.** OUSD returns **most reserve yield to the businesses that
  distribute it** (vs Circle/Tether, who keep it). That is literally Goemon's
  "resist-extractive-intermediaries" ethos — and a potential **new revenue line** (reserve-yield
  as a distributor).
- **But it's not investable yet:** OUSD is **not live** (launches "later in 2026"), and the
  single most decision-relevant fact — **can a small non-consortium fintech actually integrate,
  mint/redeem, and earn the yield-share, or is it gated to the 140 members?** — is **unverified**
  (sources say "approved businesses," which *hints* at gating).
- **Action:** (a) **apply to Open Standard's partner / early-access program now** to resolve the
  open questions in §5; (b) keep **Hedera + USDC** as the shipping default; (c) land the
  readiness code (§6) — done in this change; (d) revisit the Base/Solana **multi-chain settlement
  refactor** only when OUSD is live and terms are confirmed favorable.

---

## 2. Verified facts (cited)

Confidence and adversarial vote noted per item; primary source is the consortium's own site
(self-interested) plus reputable trade/financial press.

| # | Claim | Confidence | Vote |
|---|---|---|---|
| 1 | Operated by **Open Standard**, an independent company with **consortium/partner-board governance**; **CEO Zach Abrams** (co-founder of Bridge, acquired by Stripe ~$1.1B). ("founding" vs "interim" CEO varies by outlet.) | High | 3-0 |
| 2 | **140+ partners.** All ten from the original brief **confirmed**: Visa, Mastercard, Stripe, BlackRock, Google, Shopify, Coinbase, Ripple, BNY, Western Union — plus Solana, DoorDash, Amex, Discover, Adyen, Fiserv, Standard Chartered, Klarna, Chime, MetaMask, Aave, Fireblocks, and more. | High | 3-0 |
| 3 | **Economics:** zero-fee mint/redeem at **1:1, no volume caps** ("even at scale"); **nearly all reserve yield shared with adoption/distribution partners**, minus a **small (undisclosed) management fee** to Open Standard (the issuer of record). *Stated design, not operationally proven.* | High | 3-0 |
| 4 | **Blockchain-agnostic, multi-chain.** **Base + Solana** appear across nearly all reports; Ethereum / Tempo / Stellar / Polygon vary by outlet. Goes **live "later in 2026"** — an announcement, not a product. | Medium | 2-1 |
| 5 | **Circle (USDC), Tether (USDT), and PayPal are NOT participating.** OUSD is explicitly positioned as a rival that redirects reserve profits away from Circle/Tether; **Circle stock fell ~8–15%** on the news. | High | 3-0 |

**Refuted / excluded (adversarially killed):** a "150+ companies" figure (1-2); a claim that
**PayPal** is a partner (0-3 — it is not); a "Solana-only, no Base" chain list (0-3); a
"Solana/Stellar/Base/Polygon" definitive list (1-2). Treat any single article's partner roster
or chain list as incomplete.

**Key sources:** joinopenstandard.com (primary) · americanbanker.com · fortune.com ·
bloomberg.com · theblock.co · coindesk.com · cryptobriefing.com · fxstreet.com. (Full source set
in the research run; lower-tier crypto outlets used only for corroboration.)

---

## 3. Why this is not a "pivot"

- **Goemon already is a stablecoin-settled, non-custodial platform.** It settles in **USDC on
  Hedera** and its double-entry ledger is **multi-currency at the core** — currencies are
  registry-driven (`backend/src/services/currencyRegistry.ts`); adding a stablecoin on Hedera is
  a ~2-line change.
- **Goemon's stated posture is already "distribute stablecoins, don't issue"**
  (`RAILS-CURRENCY-STRATEGY.md`, `RWA-NEOBANK-COMPETITIVE-REVIEW.md` §3). OUSD is simply another —
  arguably better-aligned — stablecoin to *distribute*. Goemon would **never be the issuer**;
  Open Standard is the issuer of record and bears the stablecoin regime (GENIUS Act, reserves).
- So the real decision is narrow: **which settlement stablecoin(s) does Goemon distribute, and
  when** — not "should we become something else."

---

## 4. Strategic fit / upside

- **Yield-share = revenue + brand fit.** As a distributor, Goemon could capture a share of
  reserve yield it cannot get from USDC (Circle keeps it). This both adds a revenue line and
  embodies the Goemon ethos (return economics to the ecosystem, not the intermediary).
- **The consortium *is* Goemon's Phase-B partner set.** Stripe, Visa, Coinbase, Western Union,
  Adyen, Standard Chartered, Chime — many are exactly the on-ramp / rail / BaaS partners Goemon's
  compliance ramp already depends on. If mainstream payments standardize on OUSD, settling in
  OUSD buys **ecosystem interoperability**.
- **Concentration hedge.** A second, credibly-backed settlement stablecoin reduces single-issuer
  (USDC/Circle) dependence — consistent with the existing "monitor de-peg / diversify" note in
  `RAILS-CURRENCY-STRATEGY.md`.

---

## 5. Risks & open questions (must resolve before adopting)

- **Not live.** Everything is an announced design; none of the zero-fee / no-cap / yield-share
  terms are operational or audited. Day-one hype ≠ execution.
- **⚑ Openness is the make-or-break unknown (verified unknown, 3-0).** No primary source
  confirms a small non-consortium fintech can permissionlessly integrate/mint/redeem or earn the
  yield-share. "Approved businesses" language hints at **gating**. If gated to the 140 members,
  Goemon can only distribute *delivered* OUSD via on-ramp partners (Phase-A posture) — **no
  direct yield-share**, which removes much of the upside.
- **Undisclosed economics.** The "small" management fee % and the yield-split formula are not
  public. "Nearly all" ≠ 100%; Open Standard still extracts a cut.
- **Chain mismatch → real cost.** OUSD is **Base/Solana**; Goemon is **Hedera-locked for v1**.
  Native OUSD settlement would need the deferred **multi-chain refactor** (chain-agnostic
  settlement seam over `hederaService.ts`, real CCTP in `cctpService.ts`, multi-chain
  reconciliation) — roughly a **4–6 week** effort plus per-chain compliance. Interim reach is
  possible via CCTP once wired.
- **Regulatory posture unverified.** Reserve custody, issuer-of-record specifics, and GENIUS-Act
  / US charter status are unaddressed in current sources.

**Questions to put to Open Standard (via the partner program):**
1. Can a non-consortium fintech integrate, and mint/redeem, permissionlessly — or is it gated /
   "approved" / membership- or equity-tiered? What is the application process?
2. Does **reserve-yield sharing extend to non-founding distributors**, and on what formula? What
   is the management-fee %?
3. Who is the **issuer of record**, who **custodies reserves**, and what is the **GENIUS-Act / US
   regulatory** posture (bank / trust / MSB; state vs federal)?
4. Definitive **initial chain set** and **go-live date** (Base + Solana confirmed; others vary);
   any **Hedera** support on the roadmap?
5. KYC/AML, reserve, and capital requirements to become a **minting/redeeming or distributing**
   partner.

---

## 6. What we did now (readiness, not integration)

Non-breaking prep so Goemon can move fast *if* the terms check out — runtime behavior unchanged
(USDC-on-Hedera remains the only live settlement rail; verified by typecheck + tests):

- **`currencyRegistry.ts`** — added an **`OUSD` entry, `enabled: false`** (ready to flip) and a
  **`settlementStablecoin()`** helper (the single seam future settlement code should read instead
  of the hardcoded `const ASSET = "USDC"` in `onRampService.ts` / `offRampService.ts`) — exported
  but intentionally **not yet wired**.
- **`config.ts`** — added **`SETTLEMENT_STABLECOIN`** (`usdc` | `ousd` | `usdt`, default `usdc`);
  any non-`usdc` value is **prod-fatal** today (settlement of non-USDC isn't implemented).
- **`db/money.ts`** — added `OUSD: 6` to `KNOWN_DECIMALS` for consistency.

**Explicit future step (NOT done, gated on §5 answers + OUSD live):** wire `settlementStablecoin()`
into the on/off-ramp and pay paths, enable the registry entry, and — if native OUSD on Base/Solana
is required — do the multi-chain settlement refactor.

---

## 7. Recommendation (restated)

**Prepare & position.** Keep shipping on Hedera + USDC. Apply to Open Standard's partner program
now to resolve openness and yield-share eligibility — that answer, more than anything else,
determines whether OUSD is a revenue-positive alignment or merely another stablecoin Goemon
passively distributes. Re-evaluate the multi-chain refactor only when OUSD is live and the terms
are confirmed favorable. Track here; revisit when Open Standard responds or at OUSD go-live.

*Companion docs: `RAILS-CURRENCY-STRATEGY.md` (settlement currency), `PAYMENT-NETWORK-STRATEGY.md`
(Goemon Pay), `RWA-NEOBANK-COMPETITIVE-REVIEW.md` (stablecoin partner posture),
`GOEMON-NEOBANK-ROADMAP.md` (waves).*
