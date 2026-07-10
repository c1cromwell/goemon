# SWIFT's Blockchain Shared Ledger — What It Means for Goemon (Build vs Integrate)

**Date:** 2026-07-10 · **Audience:** founder / internal
**Prompted by:** SWIFT's blockchain "shared ledger" reaching a 17-bank pilot (Citi, HSBC, UBS, BNP Paribas,
BNY, Standard Chartered, Lloyds + 10 more), for 24/7 movement between banks offering tokenized deposits, with
final settlement still on RTGS. The question: *build this as my own ledger, or integrate with SWIFT?*

> **Bottom line:** Both literal options are wrong for a non-bank fintech. You **already have your own ledger**,
> and you **already deliver 24/7** on your own rails. SWIFT's ledger is a **bank-only, no-API orchestration
> layer** you can neither join nor usefully clone. The real levers are (1) enabling **instant fiat rails
> (FedNow/RTP)** at the deposit/withdrawal edge — a *sponsor* dependency, not a build — and (2) staying
> **interoperable and connectable** so you can ride bank-grade settlement without pretending to be a bank.

---

## 1. What SWIFT's shared ledger actually is (verified)

- **Stage — a pilot, not commercially live.** SWIFT's own language is "ready for use"; the 17 banks are
  *preparing to pilot* live transactions. As of the July 9, 2026 announcement, first live transactions were
  still pending. (Sept 2025 prototype → ~Mar 2026 MVP → Jul 2026 ready-to-pilot.) "It's live" is overstated.
- **What it is — an orchestration layer, not a settlement asset.** It records/sequences/validates banks'
  payment *commitments* and enforces rules via smart contracts. **Tokenized deposits are issued on each bank's
  own ledger;** the shared ledger coordinates the interbank workflow so client funds can move 24/7. **Final
  settlement still completes on existing RTGS rails** (your claim on this is correct). So "money truly 24/7" is
  the *coordination* feeling — not new settlement finality.
- **Tech/governance:** Hyperledger Besu (permissioned EVM, Linea-*style* — private, not public Linea);
  Consensys built the prototype; SWIFT operates it; **ISO 20022** is the messaging format. (A widely-repeated
  "Chainlink CCIP is the interop layer" claim is *not* confirmed by SWIFT primary sources — treat as ecosystem
  framing.)
- **Access — the decisive fact: bank-only, permissioned, closed.** No native token, no open participation, **no
  public API or developer surface.** A participant must be a regulated bank that can (a) issue tokenized
  deposits on its own ledger and (b) reach RTGS for final settlement. SWIFT even leaves open whether it will
  serve banks that *lack* tokenized-deposit capability. **A non-bank participates only indirectly, through a
  member/sponsor bank.**

This is not unique to SWIFT. **Every** bank tokenized-deposit network is structurally bank-only:
JPMorgan **Kinexys** (institutional clients only; JPMD on Base), **Citi Token Services** (Citi clients only),
**Fnality** (bank/FMI, central-bank money), the **Clearing House / RLN** shared network (member banks, H1 2027
target). A tokenized deposit is legally a **chartered bank's insured liability** — only a bank can mint one. The
*one* precedent for a non-bank plugging into a bank-grade DLT rail is **Partior admitting Nium as a PSP
participant** (Nov 2024).

---

## 2. What Goemon already has

- **Its own double-entry ledger** (`ledgerService.ts`): append-only, per-currency-balanced, balance-derived,
  idempotent; a `bank_settlement` system account already models "the partner bank's settlement pool," and the
  documented **`external_clearing` attach seam** is where off-platform value enters/leaves.
- **A 24/7 settlement primitive it controls:** USDC-on-Hedera, mirrored 1:1 into the ledger, gated by
  ledger⇄chain reconciliation.
- **A partner-bank rail seam:** `BankRailProvider` + `external_clearing` journals + `fboCoverage` (never-
  commingle 1:1). Instant rails (FedNow/RTP) are *already modeled* as disabled descriptor rows
  (`instantPaymentsService.ts:28-38`) that flip on when a real `BANK_RAIL_PROVIDER` is live.

So "build my own ledger" is **already done** — and it's arguably better-designed (append-only + reconciled)
than a bolt-on. Building a *SWIFT-style interbank tokenized-deposit ledger* is a non-starter: it needs a
banking license (tokenized deposits are bank liabilities), it has no counterparties without a bank network,
and it's redundant with your ledger + USDC settlement.

---

## 3. The recommendation — reject the false binary

**Don't build a SWIFT clone. Can't integrate with SWIFT directly.** Instead, a four-part posture:

1. **Deliver the 24/7 "feel" on your own stack — you already have ~90% of it.** Your ledger never closes
   (internal `user_cash` transfers settle instantly, any hour); USDC-on-Hedera settles 24/7 on-chain. The only
   non-24/7 boundary is the fiat on/off-ramp — and **SWIFT's ledger doesn't escape that either** (final
   settlement still lands on RTGS). The concrete "make money feel 24/7 for my users" lever is **instant fiat
   rails (FedNow/RTP)** at the edge — already modeled in `instantPaymentsService`, flipped on by a live
   `BANK_RAIL_PROVIDER`. **A partner dependency, not a code gap.**
2. **Tokenized deposits — don't first-class them (yet).** Your `user_cash` balance already *is* a deposit claim
   (FBO-backed 1:1). A tokenized deposit only adds cross-bank transferability (the interbank layer you can't
   access) + FDIC-insurance/interest (which USDC lacks). The one interesting future product — **"insured,
   yield-bearing on-chain dollars"** by mirroring a partner bank's tokenized deposit the way you mirror USDC —
   is gated on a bank partner issuing one. We ship a *readiness custody seam* for it (see §5), not a real
   product.
3. **ISO 20022 — be *aware*, not *built*.** In the passthrough model this is your *sponsor bank's* job (the
   sponsor speaks ISO 20022 to Fedwire/RTP/SWIFT; you speak the sponsor's REST API, which `BankRailProvider`
   abstracts). Cheap insurance: keep your ledger/payment metadata able to carry the structured fields
   (parties/agents/purpose/remittance) so translation isn't lossy. A direct ISO 20022 engine is a
   closer-to-the-metal / post-license move.
4. **Reach interbank settlement *indirectly* — and do the free diligence now.** Sponsor-only for launch (you
   inherit its rail memberships). A **Partior-style PSP connection** (Nium precedent) is a *post-scale* option
   for settlement independence, not a launch move.

**The one-liner:** *you already built the ledger and you already deliver 24/7; the "SWIFT upgrade" is a
bank-consortium orchestration layer you can't join and don't need to clone — the real levers are instant fiat
rails via your sponsor and staying interoperable, not a new ledger.*

### Stablecoins vs tokenized deposits — context
They're **converging into a layered coexistence**, not winner-take-all: stablecoins = "money in motion" (fast,
cross-border, public-chain), tokenized deposits = "money at rest" (insured bank money, treasury balances),
tokenized central-bank money = "settlement money." For a non-bank you *can't issue* tokenized deposits, so USDC
stays the primitive you control — and you interoperate/custody upward. (The US big-bank TCH network is
explicitly a defensive move to blunt stablecoin deposit-drain — i.e., tokenized deposits are the banks' *answer
to* stablecoins.)

---

## 4. Sponsor-bank diligence checklist (the actual free action)

When selecting / reviewing your BaaS sponsor bank, confirm its roadmap on:
- [ ] **Instant rails:** live **FedNow** and **RTP** support (this is your real 24/7 lever). Which, when, limits.
- [ ] **24/7 availability** of deposits/withdrawals and internal book transfers (not just weekday ACH windows).
- [ ] **The SWIFT shared ledger:** is the sponsor (or its correspondent) a participant / on the roadmap? What
      would a passthrough look like?
- [ ] **The Clearing House tokenized-deposit network** (H1 2027): is the sponsor a member? Could it issue a
      tokenized deposit you could custody/mirror (§5)?
- [ ] **ISO 20022:** does the sponsor's API preserve structured ISO 20022 fields end-to-end (so you're not lossy)?
- [ ] **Cross-border:** corridors, cutoffs, and whether 24/7 cross-border (Partior-style) is on their roadmap.

---

## 5. What we're shipping now — a tokenized-deposit *readiness* seam

To be ready the day a sponsor bank issues a tokenized deposit, we add a **custody/mirror seam** (behind a
prod-fatal kill-switch), NOT a real tokenized deposit (Goemon is not the issuer):
- A `tokenized_deposit` currency **kind** and a demo token `USDd` in the currency registry — so it transfers on
  the ledger like USDC/MXNe via the already-shipped registry-driven transfer gate.
- `tokenizedDepositService`: `issue` (mirror a bank-minted deposit in via `external_clearing → user_cash`),
  `redeem` (reverse), `accrueInterest` (the yield differentiator — `interest_source → user_cash`), `getPosition`.
- Gated by `TOKENIZED_DEPOSITS_ENABLED` (off by default, prod-fatal while simulated). No on-chain issuance, no
  FDIC reality — it demonstrates Goemon can custody/mirror/yield a bank-issued deposit token when a partner
  provides one, unlocking "insured, yield-bearing on-chain dollars" as a future product.

## 6. Deferred (documented backlog)

- **R1 — `SettlementNetwork` provider abstraction:** generalize the Hedera-hardwired settlement into a pluggable
  seam (like `BankRailProvider`), so a future bank/Partior/other-chain rail attaches without touching money
  code; wire the existing-but-unwired `settlementStablecoin()` seam. Small, high architectural leverage.
- **R3 — ISO 20022 adapter (prototype):** ledger journal ↔ `pacs.008`/`camt.05x` mapping behind a flag. The
  interoperability layer to eventually own — but a 12–24 month, partner-tested effort for real compliance;
  premature while passthrough.

---

## Sources
SWIFT press releases (Sept 2025 prototype, Jul 9 2026 ready-to-pilot); Ledger Insights and CoinDesk (the two
most careful secondary sources on the 17-bank pilot and tech stack); Kinexys/Citi Token Services/Fnality/
Partior/RLN coverage; McKinsey "on-chain money architecture"; BIS 2025–26 on the tokenized unified ledger.
Figures and participant lists were still settling as of mid-2026; treat volumes and go-live dates as
point-in-time. The Chainlink-CCIP-as-interop-layer claim is unverified against SWIFT primary sources.
