# Three Families of Tokenized Money → Goemon: Which Can I Compete In?

**Date:** 2026-07-22 · **Audience:** founder · **Prompted by:** a bank-vantage thesis on the three
structural options for serving tokenized money flows (tokenized deposits · first-party stablecoins ·
third-party stablecoins). **Method:** codebase map (services + config gates) + the four prior stablecoin/rails
assessments.
**Companions:** `docs/business/OUSD-STABLECOIN-ASSESSMENT.md`, `docs/business/SWIFT-SHARED-LEDGER-ASSESSMENT.md`,
`docs/business/PAYMENT-NETWORK-STRATEGY.md`, `docs/business/STABLECOIN-LATAM-REPORT-IMPLICATIONS.md`,
`docs/business/RAILS-CURRENCY-STRATEGY.md`.

> ⚖️ This is a strategy analysis, not legal advice. Any stablecoin issuance, money-transmission, or
> tokenized-deposit custody decision must be cleared by fintech/securities counsel before acting.

---

## The answer in two lines

- **You are set up for 2 of the 3 — as a distributor, not an issuer.** Third-party stablecoins are your
  **live, fully-built rail** (USDC on Hedera). Tokenized deposits are a **built-but-dormant readiness seam**
  waiting on a partner bank. First-party issuance you have **zero** capability for — **by deliberate design.**
- **The thesis is written from a *bank's* seat; you don't sit in it.** All three options are balance-sheet
  choices a *chartered bank* makes. Goemon is the **non-bank front-end** that rides whichever a partner
  supplies. Your competitive seat is the same across all three: the **wallet + agent + distribution layer** —
  and the winning move is to **distribute all three, issue none.**

---

## 1. The thesis in one screen

| Family | Whose books hold the money | Customer's claim | Reach | Cost to the bank |
|---|---|---|---|---|
| **Tokenized deposit** | The bank (deposit franchise intact) | A deposit, wrapped in a token | **Narrow** — only bank-approved counterparties | Cheapest Basel category; **pays interest** |
| **First-party stablecoin** | The bank (segregated reserve pool) | A redemption contract vs. reserves | Medium — venues the issuer reaches | **Most expensive** liability; a 24/7 currency it controls |
| **Third-party stablecoin** | *Leaves* the bank; funds someone else's coin | A claim on the *other* issuer (e.g. Circle) | **Widest** — public venues, weekend derivatives flow | Off-balance-sheet; the bank keeps only the relationship |

**The reframe for a non-bank.** Strip the balance-sheet column and the three collapse into a single question
for Goemon: *whose token am I helping the customer hold, and do I issue it?* Goemon never wants the issuer
seat (that's the regulated, capital-heavy part). It wants the **distribution seat**, which is identical
whether the underlying is a deposit token, a bank's stablecoin, or Circle's USDC. That single insight drives
the whole verdict below.

---

## 2. Family 3 — Third-party stablecoin — **LIVE (this is you today)**

The only fully-architected rail in the codebase. You onramp the customer into **USDC on Hedera** and settle
there; the money is Circle's liability, not yours.

| Piece | What you have | Where |
|---|---|---|
| On-ramp | quote → order → idempotent delivery → `completeOrder` webhook | `onRampService.ts` |
| Off-ramp | symmetric, with freeze + fraud-screen + in-tx balance check | `offRampService.ts` |
| Settlement | on-chain HTS USDC transfer + matching ledger journal, reconciliation-gated | `hederaService.ts` (`transferUsdcOnChain`) |
| Non-custodial send | server never signs; on-device key build/submit | `hederaService.ts` |

**Posture (why it's Phase-A-safe):** the licensed provider *"take[s] the user's fiat AND run[s] KYC/AML under
THEIR own license, then deliver[s] USDC… Goemon never custodies the fiat"* (`onRampService.ts:5-9`). No MSB
needed for Goemon. USDC/USD-pinned throughout (`const ASSET = "USDC"`, `onRampService.ts:31`,
`offRampService.ts:29`).

**Verdict: already competing — as the distribution/wallet/agent layer.** This is the widest-reach family and
the literal expression of your "distribute, don't issue" thesis. **Gaps:** (a) the real providers
(`moonpay|stripe|coinbase`) are `NOT_IMPLEMENTED` stubs — a commercial-wiring task, not an architecture one;
(b) reach is Hedera-only today (CCTP/multi-chain is simulated), so the "widest venues, weekend derivatives
flow" part of the thesis needs multi-chain settlement to fully land.

---

## 3. Family 1 — Tokenized deposit — **READINESS SEAM (built, dormant, needs a bank)**

You already built the customer-side of this — as a **custodian/mirror**, never the issuer.

- `tokenizedDepositService.ts` — currency **`USDD`** (kind `tokenized_deposit`), with `issue`, `redeem`, and
  crucially **`accrueInterest`** (APY from `TOKENIZED_DEPOSIT_APY_BPS`, default **4%**). Value mirrors on the
  same `external_clearing` seam that carries USDC — a balanced per-currency journal, **no on-chain issuance,
  no FDIC reality** (it's a readiness prototype).
- The header is unambiguous: *"A tokenized deposit is a chartered bank's insured, yield-bearing liability
  represented on-chain. Goemon is NOT the issuer — a partner bank is"* (`tokenizedDepositService.ts:4-6`).
- `TOKENIZED_DEPOSITS_ENABLED` is off by default and **prod-fatal** until a real bank issuer is wired.
  Rationale in `SWIFT-SHARED-LEDGER-ASSESSMENT.md` §5.

**Verdict: you can *front* a partner bank's deposit token; you cannot *issue* one.** This is strategically the
most interesting seat, because a tokenized deposit is **the one thing USDC can't be — insured *and*
yield-bearing**. If a chartered partner ever mints a deposit token (the JPMD-on-Base pattern), your wallet can
custody it, pay the accrued interest through, and surface it next to USDC on day one. **Gaps:** a chartered
partner-bank issuer (the whole point), plus the real on-chain leg (today it's a ledger mirror).

---

## 4. Family 2 — First-party stablecoin — **ABSTAIN (no capability, by design)**

- **No reserve or redemption primitive exists** anywhere in the backend. There is no reserve-pool service, no
  proof-of-reserve, no peg mechanism, no redemption contract.
- The issuance engine (`issuanceService` + `assetTypeRegistry` + `tokenizationService`) mints **securities/RWA
  tokens** (simulated HTS), not redeemable money — its `AssetKind` union has no `stablecoin`/`currency` member.
  The "1:1-backed" kinds (equity, commodity) back *securities/goods*, not spendable dollars.
- The `SETTLEMENT_STABLECOIN` seam chooses *which third-party coin you settle in* (`usdc|ousd|usdt`) — it does
  **not** describe a coin you issue, and non-usdc is prod-fatal + intentionally unwired.
- Every strategy doc states the posture explicitly: *"distribute stablecoins, don't issue… Goemon would never
  be the issuer"* (`OUSD-STABLECOIN-ASSESSMENT.md`); *"for a non-bank you can't issue tokenized deposits, so
  USDC stays the primitive you control"* (`SWIFT-SHARED-LEDGER-ASSESSMENT.md`).

**Why abstaining is correct, not a gap.** Issuing your own reserve-backed coin triggers a **money-transmitter /
GENIUS-Act stablecoin-issuer regime + reserve custody + peg maintenance + a redemption desk** — a net-new
money path that directly contradicts the non-custodial, not-a-transmitter Phase-A launch you committed to. It's
the heaviest regulated thing available and the exact opposite of "software, not a bank."

**Don't confuse this with "Goemon Pay."** `PAYMENT-NETWORK-STRATEGY.md` proposes an *own settlement rail* — but
that rail still **settles in USDC**. An own *rail* is not an own *stablecoin*; the rail is fine, the coin is not.

---

## 5. The reframe that matters (and the moat)

**From a non-bank's vantage, a bank's first-party stablecoin *is* a third-party stablecoin to you.** JPMorgan's
deposit token or a peer-bank consortium coin arrives at your wallet through the exact same distribution rail as
USDC — you custody it and route it without ever being its issuer. So for Goemon, **Family 2 collapses into
Family 3**: you can distribute a bank's first-party coin the same day it ships, using the machinery you already
have. The *only* version of Family 2 you truly can't do is **issue your own** — the one move to avoid anyway.

That collapse is the strategic point: **the neutral front-end is the moat.** A bank picking Family 1 vs 2 vs 3
is picking which liability to carry; you don't carry any of them. You can present a customer *all three* —
deposit token (insured + yield), a partner's stablecoin, and USDC (widest reach) — side by side in one
non-custodial wallet with agent access. No single bank can offer that neutrality, because each is committed to
its own balance sheet.

---

## 6. What to do / what not to do

**DO**
- Keep **third-party (USDC)** as the live rail; wire a licensed on/off-ramp provider when the commercial deal
  is ready (the stubs are pre-built).
- Pursue **multi-chain/venue reach** (CCTP, EVM) to capture the "widest venues / weekend derivatives flow"
  that is the thesis's whole argument for Family 3 — today you're Hedera-only.
- Keep the **tokenized-deposit seam warm** as a partner-bank business-development artifact: "we can custody and
  pass-through your deposit token today" is a concrete ask that differentiates you from a plain USDC wallet.
- When a real partner **first-party stablecoin** appears, onboard it as a **disabled `currencyRegistry` entry**
  (distribute-only, à la the OUSD entry) — position, don't adopt.

**DON'T**
- **Don't self-issue** a reserve-backed stablecoin — it flips you custodial and into the GENIUS-Act/MT regime,
  contradicting the launch posture.
- **Don't conflate** "own settlement rail" (Goemon Pay, USDC-settled — fine) with "own stablecoin" (avoid).
- **Don't treat the tokenized-deposit seam as live** — it's a mirror with no FDIC reality until a chartered
  issuer is wired; keep it prod-fatal.

---

## 7. The one-liner

*The thesis's three families are a bank's balance-sheet choices; you're the non-bank front-end that rides all
three. You already compete in third-party (USDC, live) and can front a partner's tokenized deposit (seam built)
— and because a bank's first-party coin is just a third-party coin to you, the only thing to refuse is issuing
your own. Distribute all three, issue none.*

---

## Sources & confidence

- **Codebase (high confidence on what is/ isn't built):** `onRampService.ts`, `offRampService.ts`,
  `hederaService.ts` (Family 3, live); `tokenizedDepositService.ts` + `currencyRegistry.ts` (`USDD`, Family 1,
  dormant); `issuanceService.ts` / `assetTypeRegistry.ts` / `tokenizationService.ts` + a `*reserve*` search
  returning nothing (Family 2 absent). Kill-switches/prod-fatals in `config.ts`.
- **Prior assessments:** `OUSD-STABLECOIN-ASSESSMENT.md` (distribute-not-issue; OUSD as a settlement option),
  `SWIFT-SHARED-LEDGER-ASSESSMENT.md` (the tokenized-deposit readiness seam rationale),
  `PAYMENT-NETWORK-STRATEGY.md` (own rail ≠ own coin), `STABLECOIN-LATAM-REPORT-IMPLICATIONS.md` (stablecoin =
  settled plumbing; value in distribution/FX/agent-personhood), `RAILS-CURRENCY-STRATEGY.md`.
- **External thesis** (JPMD-on-Base as the live tokenized-deposit example; Basel liability weights; GENIUS-Act
  issuer regime): well-grounded **interpretation**, not adjudicated to Goemon's exact facts — **confirm with
  fintech/securities counsel** before any issuance or custody decision.
