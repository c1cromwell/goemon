# 01 — Vision & Positioning

## Vision

A bank account that holds dollars without paperwork, lets you own a piece of a Manhattan apartment or a graded first-edition Charizard with the same tap, and runs itself well enough that we can offer better rates than the incumbents because our cost-per-user is a fraction of theirs.

## Strategic thesis

Three trends form the foundation of the bet:

**The asset surface available to retail is exploding.** Five years ago, a retail investor could buy stocks, bonds, mutual funds, and crypto. Today, tokenization makes private credit, real estate, music royalties, fine art, and graded collectibles all addressable as small-denomination tradable instruments. Robinhood made stocks feel like an app; the next billion-dollar consumer financial product is the one that makes *everything else* feel like an app.

**Self-custody is becoming the default for digital dollars.** Stablecoins have crossed $300B in circulation. Wallets like Arca, Kast, and Plasma One are pulling millions of users in emerging markets who never had access to US dollar denominated savings. The bank account of the future for a meaningful share of the world is a self-custodial smart wallet with USD-stable assets in it, not a checking account at a regional bank.

**The cost structure of running a bank is artificially high.** A typical neobank spends a substantial fraction of revenue on customer support, compliance review, and back-office operations. AI agents — properly scoped, properly supervised, properly orchestrated — can take ~60-80% of that work, and the founder who designs the company around that from day one will have a permanent cost advantage over competitors who bolt agents on later.

Goemon Global Finance sits at the intersection of these three trends. The wedge is the tokenization marketplace. The retention is the wallet. The cost advantage is the agent-operated back office.

## Positioning statement

> **For** people who want their money to work harder than a checking account allows but who don't want to learn options trading or crypto, **Goemon Global Finance** is a mobile-first bank that lets them hold dollars, own tokenized real-world assets and collectibles, and move money globally — all in one app, with no paperwork until they actually need it.

## Competitive landscape

### Direct competitors

**Robinhood** owns retail equities and crypto in the US, has aggressive product velocity, and recently entered prediction markets. Their tokenization play is nascent (they tokenized OpenAI shares for EU users and have hinted at more). They are the most likely to copy our marketplace if it works. Our advantage: we are tokenization-native; they are bolt-on.

**Revolut** owns multi-currency banking in Europe, with growing US presence. Excellent execution, strong card product, weak on tokenization and US distribution. Our advantage: we are US + international from day one, and tokenization is core not peripheral.

**Chase, Wells Fargo, Bank of America** own US retail banking trust and branch presence. Slow on product, strong on lending, irrelevant on tokenization for the foreseeable future. They are not direct competitors in v1 but become so once we add cards and lending.

### Adjacent competitors (the wedge layer)

**Arca, Kast, Plasma One, Bridge wallet** are no-KYC USD wallets focused on emerging markets. Strong product, narrow surface (no marketplace, no lending). Our advantage: we have the same Tier 0 experience plus everything above it.

**Securitize Markets, tZERO, Archax** are institutional RWA marketplaces. Excellent compliance posture, terrible consumer UX, narrow asset surface. Our advantage: consumer-grade product over the same plumbing.

**Courtyard, Collector Crypt, PWCC Vault** are tokenized-collectibles marketplaces. Strong in single category. Our advantage: collectibles sit alongside dollars and other RWAs in one app.

**MetaMask, Phantom, Trust Wallet** are crypto wallets that have added some marketplace functionality. Their users skew crypto-native. Our advantage: we are designed for people whose mental model is "bank app" not "crypto wallet."

### Indirect competitors (longer horizon)

**Stripe, PayPal, Cash App, Wise** all touch some part of what we do (payments, holding balances, cross-border). None has the marketplace wedge or the agent-operated thesis. Stripe in particular is interesting because their Bridge acquisition gives them stablecoin infrastructure that could become competitive.

## What "winning" looks like

We're not competing for "best banking app of 2027." We're competing to be the **default consumer surface for tokenized assets** by 2028, with a credible wallet and rails product attached. If we own that, lending and cards and everything else follows naturally because we own the highest-intent user behavior (investing) on the most engaging asset surface (everything-tokenized).

Concretely, we measure winning along three axes:

1. **Marketplace depth** — number of tokenized assets supported, with at least one credible asset in each major category (treasuries, private credit, real estate, art, sports/TCG collectibles, gaming, music)
2. **Wallet retention** — 30-day, 90-day, and 12-month retention of users who completed onboarding, segmented by KYC tier
3. **Cost per user served** — operating cost (excluding R&D and S&M) per monthly active user, target <$0.50/MAU at scale via agent operations

## Brand and naming

The working name is "Goemon Global Finance." It draws from Japanese (the term means "release" or "final form"), which lends itself to a clean visual brand and is uncrowded in trademark databases. Final brand decision is open in Module 11.

The product surface positions us as a *bank*, not a *crypto company*. Marketing language emphasizes outcomes (own a piece of a building, hold dollars that earn yield, send money to family in Lagos) rather than infrastructure (blockchain, tokens, DeFi).

## Anti-positioning

What we are explicitly **not** building:

- **An investing app.** We do not give investment advice, do not provide buy/sell recommendations, do not run robo-advisor portfolios. Users browse and decide.
- **A crypto exchange.** We do not list speculative tokens. The marketplace is RWAs and collectibles with real-world utility or scarcity backing them. USDC and USDT are held as cash, not traded as assets.
- **A trading platform.** No charts, no day-trading UX, no options or derivatives in v1. The aesthetic is "marketplace" not "exchange."
- **A DeFi protocol.** We may interface with DeFi (Aave for lending collateral, for example) but we are not building one. The user never sees a DeFi UI.
- **A custody platform for institutions.** B2B custody is a different business with different go-to-market. We are consumer.

## Risks to the thesis

The honest list:

- **RWA tokenization may not reach consumer scale.** If the only people buying tokenized treasuries through 2028 are institutions and crypto-natives, our wedge doesn't pull enough users.
- **Stablecoin regulation could harden.** A reversal of the GENIUS Act framework, or aggressive state-level action, could make the no-KYC tier untenable in the US.
- **A large competitor copies the marketplace.** Robinhood or PayPal launching a comparable tokenization marketplace with their existing user base would be a serious threat.
- **Agent operations don't actually work at the quality bar required for finance.** If we can't get agent-handled support and compliance review to >95% accuracy with appropriate human escalation, our cost-structure advantage disappears.
- **Multi-region complexity sinks us.** Trying to launch US and international in parallel is genuinely hard and the modal outcome of "ambitious dual launches" in fintech is one or both regions executing poorly.

Each of these is mitigated explicitly in subsequent modules; the marketplace risk in particular is mitigated by leading with collectibles (which have proven consumer pull) as well as RWAs.

## Cross-references

- For the actual product surface, see [02 — Product Overview](./02-product-overview.md)
- For phasing and what comes when, see [10 — Roadmap & Phasing](./10-roadmap-and-phasing.md)
- For the agent operations advantage in detail, see [08 — Agent Operations](./08-agent-operations.md)
