# DeFi Vaults → Goemon: Are We Set Up To Be a Vault, and Should We?

**Date:** 2026-07-13 · **Audience:** founder · **Prompted by:** S&P Global's primer *"Digital Assets Primer:
How Vaults Can Shape The Capital Markets Of Tomorrow"* (S&P Global Ratings, May 27, 2026).
**Method:** codebase map + sourced landscape research + sourced US-regulatory research.
**Companions:** `docs/business/SEPT-2026-LAUNCH-PLAN.md`, `docs/business/TOKENIZATION-GO-LIVE-STRATEGY.md`,
`docs/business/STABLECOIN-LATAM-REPORT-IMPLICATIONS.md`.

> ⚖️ This is a strategy analysis, not legal advice. Any vault issuance must be cleared by securities/fund
> counsel before acting.

---

## The answer in two lines

- **Are you set up to be a vault?** *Partly.* You have most of the vault **rails** but not the vault **engine**,
  and you're the **wrong architecture** (off-chain ledger, not an on-chain ERC-4626 protocol).
- **Should you be the vault?** *No — not as the product, not now.* Being the vault is a
  securities + investment-company + investment-adviser + custody/MSB + state-lending stack that **directly
  contradicts the non-custodial, not-a-transmitter, invite-only launch you just committed to** (Sept-1 plan).
  **Do this instead:** own the **agent-native access/curation layer on top of *other people's* non-custodial
  vaults** — your "distribute, don't issue" thesis.

---

## 1. What S&P actually said (why the direction is real)

- S&P defines vaults as **"on-chain pooled investment vehicles that issue share tokens and deploy capital
  according to a defined strategy"** — depositors supply capital for shares; capital users (borrowers/traders/
  RWA originators) access the liquidity. It's the on-chain managed fund.
- **Scale:** total vault deposits **~$131B (Apr 2026)**, up from ~$24B (Apr 2023) — **but ~94% is still
  crypto-native.** The tokenized-RWA / institutional-vault thesis (the part that would matter to you) is
  **forward-looking, not yet realized.**
- **The curator model is central:** a professional curator (Steakhouse, Gauntlet, MEV Capital…) sets strategy,
  picks collateral/oracles, and **earns fees on the yield.** Concentration is real — on Morpho, **~2 curators
  held ~77% of deposits.**
- **S&P's flagged risks:** leverage/looping, technical/oracle failures, disclosure gaps, and — the barrier it
  calls out most for institutions — **regulatory ambiguity over whether vault tokens are securities.** The
  2025–26 curator blowups make it concrete: **Stream Finance ~$285–700M** at risk, **Fluid** absorbed >$10M
  bad debt, a **hardcoded-oracle bug recurred 4× in 14 months.**

**Takeaway:** the *direction* (vaults become core infra for tokenized RWA + institutional capital) is aligned
with Goemon. The *form* S&P describes — being the on-chain fund — is the crypto-native, heavily-regulated end
you want to **distribute to, not become.**

---

## 2. Are you set up? (the codebase reality)

**Rails you already have (reusable):**

| Vault primitive | What you have | Where |
|---|---|---|
| Issue shares | mint a tokenized asset | `issuanceService.createAsset` |
| Distribute yield pro-rata | holder-derived, idempotent dividend engine | `corporateActionService.distributeDividend` |
| Trade shares | P2P limit-order book, escrowed, compliance-gated | `secondaryMarketService` |
| Gate who can hold | composable compliance dimensions | `complianceProfiles` + `secondaryMarketService.checkTransfer` |
| Holder reporting | positions, distributions, tax | `portfolioService` |
| Capital-user (borrow) | over-collateralized loans | `lendingService` |

**The engine you're missing (the capital-formation core):**
- **No share-price / NAV.** Everything is **par-valued** (`treasuryService` PAR_MINOR = $1; positions valued at
  `qty × par`). There is no assets-per-share / `convertToShares` / `convertToAssets` anywhere — the opposite of
  an ERC-4626 share whose price rises as yield accrues.
- **No supply→loan link.** `lending_pool` is an **unfunded system sink** that simply goes negative on
  disbursement (no non-negativity guard on any account). Depositor capital never funds it. The file says so:
  *"real lending needs … a real liquidity source — out of scope for the prototype."*
- **No yield routing to depositors.** Borrower interest books to a `fee` account, not to shareholders.
- **Wrong form.** Goemon is an **off-chain double-entry ledger** that settles USDC on Hedera. **No Solidity, no
  ERC-4626, no vault contract** exists (`erc4626`/`erc3643` appear only as metadata string labels).

**So:** you can *represent* a vault in the ledger, but you don't have the economic engine (NAV, funded pool,
yield-to-depositors), and you are not an on-chain protocol. You're ~60% of the *bookkeeping*, ~0% of the
*economics and the form.*

---

## 3. Should you? (the US regulatory reality — the decisive part)

**Being the vault triggers a five-headed regulatory stack.** Each is confirmed with precedent:

| Role | Why it triggers | Precedent |
|---|---|---|
| **Securities issuer** | A pooled-yield share where depositors expect return from your allocation efforts is a security | **BlockFi** ($100M settlement, 2022): pooled crypto lending = an investment contract (Howey) *and* a note (Reves). The Mar-2026 SEC/CFTC release narrowed Howey but **did not exempt pooled/vault/DeFi-lending products.** |
| **Investment company** | Pooling outsiders' capital to invest/lend for them = an ICA "investment company" | Needs a **private-fund exemption (3(c)(1) ≤100 holders / 3(c)(7) qualified purchasers)** → *private placement only*, incompatible with a retail neobank surface. |
| **Investment adviser** | Managing pooled assets for a fee = advice; the **"curator" role = discretionary manager** | Advisers Act → RIA registration + fiduciary duty. The <$150M "exempt reporting adviser" still files. |
| **Custody + MSB** | Holding pooled depositor capital = custody + likely money transmission | FinCEN's "**total independent control**" test (FIN-2019-G001). **This is the direct clash** with "non-custodial, not-a-transmitter." |
| **State lending** | Deploying pooled capital to borrowers = lender-of-record | Multi-state lending licenses + usury + "true lender" laws (CT/NE/OH expanded who needs one). |

**Verdict:** being the vault is **not compatible** with the non-custodial launch. It is a deliberately
**custodial, securities/fund/adviser-counsel-gated Phase-C product** — the heaviest regulated thing on the
entire roadmap, and the exact opposite of the "software, not a bank; distribute, don't issue" posture.

---

## 4. What to do instead (the posture-compatible play)

**Own the access/curation/agent layer — not the vault.**

1. **Distribute/route to third-party *non-custodial* vaults** (Morpho-style), where the **user self-custodies**
   and **someone else's smart contract holds the funds** ("curators can never take direct custody"). You are a
   **front-end/router**, not the issuer, custodian, or fund → you stay on the right side of the FinCEN control
   test. This is your "distribute, don't issue" thesis, and it **answers your lending "no supply side" gap**:
   don't build the pool — route to someone else's liquidity (the "why build your own? use Morpho" insight,
   now confirmed by the regulatory analysis).
   - *Caveat:* if you route to a **security** (a tokenized treasury like Ondo OUSG — qualified-purchaser-gated),
     you're distributing a security → broker/finder rules + hard US-retail eligibility walls apply. Permissionless
     DeFi-lending-vault access (user self-custodies) is the lightest version.
2. **The agent-native differentiator:** an AI agent that allocates a user's **self-custodied** funds across
   third-party vaults under scoped permission — this is the S&P "vaults are core RWA infra" thesis captured
   *without* the issuer/fund/custody/lending stack. It rides your existing **MCP + operation-token + MFA-gate +
   agent-personhood** pipeline.
   - **The one bright line:** keep the agent **non-discretionary** (it *recommends*, the user *signs each
     action*). A **discretionary** "financial autopilot" that reallocates automatically = an **RIA** (robo-adviser
     treatment). Non-discretionary + self-custody is the lightest defensible posture.
3. **Prerequisite you don't have yet:** routing to Morpho/EVM vaults needs **EVM / multi-chain** reach; today
   you're Hedera/ledger-only. So this is a **design-forward direction, not a this-week build** — sequence it
   after the Sept-1 non-custodial launch, alongside the multi-chain settlement work.

**Being the vault is a deliberate Phase-C decision** (post-GA, with securities/fund/adviser counsel, and it
flips you custodial). Don't drift into it.

---

## 5. The one-liner

*S&P is right that vaults become core infrastructure — so be the **agent-native access and curation layer on
top of other people's vaults**, not the pooled fund that has to register as one.* It's the same wedge as the
rest of your strategy: **distribute + agent-permission + self-custody**, not issue + pool + custody.

---

## Sources & confidence
- **S&P primer** (May 27, 2026, S101684331 — spglobal.com page is paywalled; figures via secondary coverage
  incl. cryptobreaking.com). Scale/curator/risk facts: **high confidence** (corroborated). The RWA/institutional
  vault thesis is **explicitly forward-looking** (S&P: ~94% still crypto-native).
- **ERC-4626** (tokenized vault standard, finalized Mar 2022); **Morpho** (~$10B TVL, curator model, Coinbase
  routing), **Maple** (~$3.9B), **Veda** (~$4.3B infra), **Lorenzo OTFs**; tokenized treasuries **BUIDL/OUSG/USTB**
  live. TVL figures are point-in-time (they move) — **medium confidence**.
- **Regulatory** (BlockFi/Howey/Reves; ICA 3(c)(1)/(7); Advisers Act / robo-adviser RIA; FinCEN FIN-2019-G001
  control test; state true-lender expansion; Mar-2026 SEC/CFTC release). Well-grounded **interpretation**, not
  adjudicated to Goemon's exact facts — **validate with securities/fund counsel** before any vault issuance.
