# RWA & Neobank Competitive Review — Goemon Global Finance

> Sources are cited inline; figures current as of **July 2026** (research pass). RWA AUM/TVL figures move fast and often disagree across sources — where they conflict this document reports a range and flags it. Claims that could not be verified against a primary source are marked **UNVERIFIED**.

Goemon is a tokenization-first, non-custodial neobank: Hedera settlement, a native (Secure-Enclave) wallet, a double-entry ledger as the source of truth, W3C Verifiable Credentials + OID4VP + MCP for agent access, and tokenized real-world assets. This review teardowns the consumer/SMB neobank incumbents, maps the 14 RWA/tokenization players Goemon must position against, and synthesizes a prioritized product menu tied to a Phase A→B→C compliance ramp.

- **Phase A** = non-custodial software only (no license needed; the user's own wallet holds keys; Goemon is UX + ledger mirror).
- **Phase B** = partnered / MSB (BaaS partner bank, FinCEN MSB, licensed on/off-ramp and fund-distribution partners bear the regulated function).
- **Phase C** = licensed / broker-dealer / transfer-agent / ATS (Goemon or a "Corp C" holds the securities licenses; the hard, slow, expensive tier).

---

## §1 — Neobank Teardown (Robinhood · Revolut · Chime)

### Feature matrix

| | Banking / HYSA | Cards | Trading / Crypto | Teens | SMB / Business | Agentic / AI |
|---|---|---|---|---|---|---|
| **Robinhood** | Yes — Robinhood Banking (checking + savings) for Gold, ~3.5% APY, via Coastal Community Bank (not a chartered bank) | Yes — Gold Card (credit), 300k+ holders | Yes (core) — stocks/ETFs/options, crypto, staking, EU perpetual futures, **tokenized stocks (EU/MiCA)** | Partial — custodial UGMA/UTMA; no standalone teen product | No — retail investing focus | Yes — **Cortex** AI investing assistant + Digests; chat-to-trade rolling out to Gold |
| **Revolut** | Yes — full **UK banking licence (Mar 2026)**, FSCS-protected; EU bank via Lithuania; savings/interest | Yes — debit + credit, multi-currency | Yes — crypto (250+ tokens, Revolut X, MiCA CASP), stocks, commodities; **self-custody via Trust Wallet** | Yes — Kids & Teens (6–15) + 16–17 account | Yes — Revolut Business, 767k accounts, ~30k companies/mo onboarding | Yes — in-app AI assistant; AI fraud platform (10x case throughput) |
| **Chime** | Yes — no-fee checking/savings via The Bancorp Bank & Stride Bank (not a chartered bank); early direct deposit | Yes — debit; **Chime Card** secured credit-builder (Sept 2025) | No — no trading, no crypto | No — 18+ only | No — consumer only | Limited — ML for underwriting/risk; no marketed consumer AI agent |

### Robinhood
US-listed (HOOD) broker-dealer that has grown into a financial super-app: commission-free stocks/ETFs/options/crypto, a Gold subscription (record 3.5M subscribers Q2 2025), the Gold Card, wealth "Strategies," and **Robinhood Banking** delivered through Coastal Community Bank (Robinhood is a fintech, not a chartered bank). Its standout tokenization move: **tokenized US equities** launched June 30, 2025 in Cannes for EU/EEA users under a MiCA license, expanding toward 2,000+ "Classic Stock Tokens," alongside a revealed 3-phase tokenization plan and its own L2 ("Robinhood Chain") ([Robinhood newsroom](https://robinhood.com/us/en/newsroom/robinhood-launches-stock-tokens-reveals-layer-2-blockchain-and-expands-crypto-suite-in-eu-and-us-with-perpetual-futures-and-staking/); [3-phase plan, CoinDesk Nov 2025](https://www.coindesk.com/business/2025/11/18/permissionless-assets-robinhood-s-3-phase-tokenization-plan-to-disrupt-tradfi)). AI: **Cortex** investing assistant with chat-to-trade rolling out to Gold ([Robinhood newsroom](https://robinhood.com/us/en/newsroom/introducing-strategies-banking-and-cortex/)).
- **Lesson for Goemon:** Robinhood is the closest analog to the tokenization-first vision and validates that tokenized equities + an own chain + agentic trading is a real market, and that **launching in the EU under MiCA first is the practical regulatory-arbitrage path**. But its tokens are custodial and issuer-permissioned — Goemon's **non-custodial, wallet-native** angle is the differentiator Robinhood does not offer.

### Revolut
The largest and most diversified incumbent: **68.3M retail customers, $6B revenue (+46%), $2.3B profit (+57%) in FY2025** ([Revolut FY25 results](https://www.revolut.com/en-US/news/revolut_reports_record_profit_of_2_3bn_for_2025_as_revenue_surges_to_6bn/); [CoinDesk Mar 2026](https://www.coindesk.com/business/2026/03/24/crypto-friendly-fintech-revolut-sees-profit-soar-57-to-usd2-3-billion-in-2025)). A genuine multi-product bank/super-app: everyday banking, multi-currency cards, FX/remittance, savings, trading, one of the deepest crypto stacks (250+ tokens, Revolut X, EU MiCA CASP), real teens and business franchises. Regulated as a bank in 30+ markets (EU license via Lithuania since 2021), **received its full UK banking license March 2026**, and has filed for a US banking license. In Dec 2025 it partnered with **Trust Wallet for instant self-custody crypto buys** in the EEA ([CoinDesk](https://www.coindesk.com/business/2025/12/11/revolut-and-trust-wallet-launch-instant-crypto-buys-in-eu-with-self-custody-focus)).
- **Lesson for Goemon:** Revolut proves the super-app breadth playbook and that a licensed-bank posture unlocks scale/trust — but breadth + real licenses is *its* moat. A tokenization-first entrant must **pick a wedge, not match all 11 revenue lines**. Its Trust Wallet self-custody integration signals even incumbents see non-custodial demand; Goemon can lead there rather than bolt it on.

### Chime
US mass-market consumer neobank positioned on fee avoidance: no-fee checking/savings, no overdraft (SpotMe), early direct deposit. Crucially **not a chartered bank** — runs through The Bancorp Bank and Stride Bank, staying Durbin-exempt so ~67% of revenue is debit interchange. **IPO'd June 11, 2025 (~$11.6B valuation, $864M raised)**, reporting **FY revenue +31% to $2.2B, 9.5M active members** ([2025 shareholder letter](https://www.chime.com/newsroom/news/2025-letter-to-shareholders/)). Launched the **Chime Card** secured credit-builder in Sept 2025 ([Chime](https://www.chime.com/credit/credit-builder/)). No trading, no crypto, no teens, no business — deliberately narrow.
- **Lesson for Goemon:** Chime shows a focused single-segment neobank can reach 9.5M users and a public listing **without a charter, trading, or crypto** — the BaaS + interchange model works at scale (validates Goemon's Phase B posture). But interchange-dependence and the total absence of crypto/tokenization is exactly the ceiling Goemon aims past. Takeaway: discipline (nail one wedge, own the fee narrative), not product mimicry.

---

## §2 — RWA Landscape (14 firms by archetype)

### Master comparison table

| Firm | Archetype | What they offer | Model | Chains / standards | Regulated posture | Segment | Traction (cited, dated) |
|---|---|---|---|---|---|---|---|
| **Ondo Finance** | Tokenized treasuries | OUSG, USDY yieldcoin, Ondo Global Markets, Ondo Chain (L1) | Issuer + B2B infra + regulated venue | Ethereum, Solana, BNB, Aptos, Polygon; own L1 | OUSG = Reg D 506(c)/3(c)(7); USDY = Reg S + FinCEN MSB; **bought Oasis Pro → SEC BD + ATS + TA** | Institutions/accredited; non-US retail; devs | ~$1.6B tokenized AUM (Oasis Pro close, Oct 2025); some cite $1.8–2.75B (varies) |
| **Franklin Templeton BENJI / FOBXX** | Tokenized MMF | FOBXX '40-Act govt MMF; BENJI onchain share token; Benji app | Fund issuer + own transfer agent; B2C app + B2B | Stellar, Polygon, Arbitrum, Aptos, Avalanche, Base, Solana, Ethereum (8 chains) | US-registered **'40-Act MMF**; blockchain = transfer-agent record, reconciled daily; allowlist only | US retail + institutions | ~$828M AUM Q1 2026 (secondary source); first US-registered fund on public chain (2021) |
| **Libeara** (SC Ventures) | Tokenized treasuries | Delta platform; SGD Delta bond fund, Delta Wellington ULTRA, tokenized gold | B2B tokenization infra + fund-enablement | Ethereum, Stellar; ULTRA → Arbitrum, Avalanche, Solana | Singapore-centric; funds issued by licensed mgrs (FundBridge); **Standard Chartered custody**; whitelist | Institutional / professional | >$1B tokenized AUM powered (late 2025); ULTRA $100M+ (Dec 2025), AAA (Particula) |
| **Centrifuge** | Private credit / infra | Tokenization infra, deRWA wrappers, Anemoy funds; SPXA tokenized S&P 500 | B2B infra + asset-mgmt arm | Ethereum, Base, Arbitrum, Avalanche, BNB; deRWA on Solana/Stellar; ERC-20 | Funds off-chain (Cayman SPs via Anemoy/Janus Henderson); S&P DJI license; not a US BD | Institutions, asset mgrs, DeFi | ~$1.34–1.8B TVL (source-dependent); JAAA >$1B; partners S&P DJI, Janus Henderson, Apollo |
| **Maple Finance** | Private credit | Institutional lending; **syrupUSDC/USDT** yield stablecoins; BTC-backed loans | Lending protocol / on-chain credit manager | Ethereum + Solana (Chainlink CCIP); Arbitrum, Base, Plasma; ERC-20/SPL | Permissioned KYC-gated borrower pools; syrupUSDC permissionless; no stated US BD | Institutions/funds; retail holds syrupUSDC | TVL ~$2.1B (May 2026); $4B+ deposits / $4.6B+ AUM; $20B+ cumulative originations |
| **RealT (RealToken)** | Real estate | Fractional tokenized US rental homes ($50+); rent in stablecoin; RMM lending | B2C issuer / marketplace (LLC-per-property) | Ethereum + **Gnosis Chain** (primary); ERC-20 = LLC membership | **Reg D** (US accredited) + **Reg S**; Delaware/Wyoming LLC per property; FINRA placement agent | Global retail; US must be accredited | 700+ properties, ~$130M asset value; Gnosis TVL ~$146M (Jun 2025) |
| **Securitize** | Security-token infra | End-to-end tokenization + transfer agency + ATS + fund admin; DS Protocol; sToken | B2B infra + agent-of-record + venue operator | Ethereum + 8 networks (Avalanche, Solana, BNB, TRON); DS Protocol; sToken = ERC-4626 | SEC-registered **BD, transfer agent, fund admin, ATS** (subsidiaries) | Institutional + accredited | **>$4B AUM** (May 2026); BUIDL ~$3.07B; going public NYSE "SECZ" (Jul 2026) |
| **Tokeny Solutions** | Security-token infra | T-REX platform; open **ERC-3643** standard; ONCHAINID; T-REX Ledger | B2B software toolkit (white-label) | EVM (Ethereum, Polygon, Avalanche); **ERC-3643 / T-REX**; ONCHAINID | Software vendor (not BD/TA); compliance in-contract; **Apex-owned** (May 2025) | Issuers, TAs, fund admins, devs | Origin of ERC-3643; Apex ($3T+ AUA) targets $100B tokenized by 2027 |
| **SG-Forge** | Security-token infra / stablecoin | **EURCV** & **USDCV** MiCA stablecoins (CoinVertible) | Bank-subsidiary settlement-asset issuer | Ethereum, Solana, Stellar, XRP Ledger; 100% cash-backed | SocGen subsidiary; **MiFID2 firm, EMI under MiCA, French DASP** | Institutions, exchanges, MMs | EURCV MiCA-compliant since Jul 2024; USDCV launched Jun 2025 |
| **Kinexys (ex-Onyx, J.P. Morgan)** | Security-token infra / bank platform | Kinexys Digital Payments (ex-JPM Coin), Digital Assets; **JPMD** deposit token | Bank-operated permissioned platform | Permissioned chain; **JPMD on Base**; intent on Canton | Regulated bank; deposit token = bank liability, not stablecoin | Large institutions, corporates | **Onyx→Kinexys rebrand confirmed Nov 2024**; >$1.5–2T notional; JPMD live on Base |
| **Blockchain App Factory** | Build-shop | RWA tokenization *development services* | Dev shop / white-label builder (not an issuer) | ETH, BSC, Polygon, Avalanche, Algorand, NEAR, Hedera; ERC-20/721/1155, 1400, 3643, SPL | Builds for clients; no regulated status itself | Clients wanting a build | **Confirmed dev-shop**; scale claims (800+ projects) **unverified** |
| **Vottun** | Emerging infra | Blockchain infra/API-SDK; VTN token | Infra / API provider | Multi-chain (ETH, Stellar, Algorand, Bitcoin, BSC per site) | Spanish regulatory sandbox (PwC + Stellar) | Developers | **Partial** — ~$440K raised credible; **HQ conflicting** (Spain vs LA) |
| **BlockRidge** | Emerging infra | Tokenization SaaS + cap-table + advisory (Valuit Technology LLC) | SaaS + consulting (explicitly "SaaS only") | Claims ERC-3643 + KYC/AML/GDPR | **Explicitly disclaims** being adviser/broker/dealer/bank | Family offices, VC/PE, individuals | **Partial** — Delaware entity + site real; traction claims **unverified** |
| **Verta** | Uncertain | No distinct RWA firm confirmed under this exact name | — | — | — | — | **UNVERIFIED** — likely a name collision (Vertalo / VERT Capital) |

*(That is the 14: Ondo, Franklin/BENJI, Libeara, Centrifuge, Maple, RealT, Securitize, Tokeny, SG-Forge, Kinexys/Onyx, Blockchain App Factory, Vottun, BlockRidge, Verta.)*

### Tokenized treasuries / MMF — Ondo · Franklin BENJI · Libeara

**Ondo Finance** is the largest pure-play tokenized-treasury issuer and is vertically integrating into a regulated stack. **OUSG** (short-term Treasuries) is a Reg D 506(c) / 3(c)(7) private fund for accredited investors + QPs, largely custodying via BlackRock's BUIDL; **USDY** (a yield-bearing note) is offered under Reg S to non-US persons with the issuer registered as a FinCEN MSB ([legal-framework analysis](https://bitcoinethereumnews.com/tech/inside-ondo-finance-how-ousg-and-usdy-tokenize-us-treasuries-through-distinct-legal-frameworks/)). Ondo announced **Ondo Chain**, a permissioned-validator L1 for institutional RWAs, in Feb 2025 ([CoinDesk](https://www.coindesk.com/business/2025/02/06/ondo-finance-unveils-layer-1-network-for-tokenized-assets)), and completed the **acquisition of Oasis Pro** (an SEC-registered broker-dealer, ATS, and transfer agent) in Oct 2025 — buying, rather than building, the compliant US securities path ([Blockworks](https://blockworks.co/news/ondo-finance-finalizes-oasis-pro-acquisition); [The Block](https://www.theblock.co/post/361120/ondo-finance-to-acquire-us-regulated-broker-oasis-pro-for-tokenized-securities-expansion)). AUM is cited ~$1.6B (best-anchored, at the Oasis Pro close) up to $1.8–2.75B in promotional late-2025/early-2026 numbers — treat the higher figures as unverified.

**Franklin Templeton BENJI / FOBXX** is the gold standard for a *retail-eligible* tokenized MMF. BENJI is the onchain share token of **FOBXX**, a genuine US-registered **'40-Act** government money market fund — the first US-registered mutual fund to use a public blockchain as its system of record (Stellar, 2021) ([Stellar press](https://stellar.org/press/franklin-templeton-stellar-development-foundation-mark-five-years-of-benji-the-first-u-s-registered-tokenized-money-market-fund); [SEC 485BPOS](https://www.sec.gov/Archives/edgar/data/1786958/000174177325000031/c485bpos.htm)). The blockchain is a **transfer-agent record, not custody** — reconciled daily to the official register, with only allowlisted wallets able to hold BENJI ([BENJI deep dive](https://eco.com/support/en/articles/15254016-benji-deep-dive-2026-franklin-templeton-s-tokenized-money-market)). It spans 8 chains and reported ~$828M AUM in Q1 2026 (secondary source; the fund's own page is the primary check).

**Libeara** is a **B2B tokenization platform** incubated by **SC Ventures** (Standard Chartered's venture arm), launched Nov 2023 ([SC Ventures](https://scventures.io/sc-ventures-launches-libeara-to-provide-tokenisation-platform/)). Its **Delta** platform runs subscription/issuance/transfer/redemption; licensed managers (notably **FundBridge Capital**) are issuers of record and **Standard Chartered provides custody**. First fund: a tokenized SGD government bond fund rated **AA by Moody's** ([Ledger Insights](https://www.ledgerinsights.com/moodys-rates-fund-tokenization-libeara-stanchart/)). In Dec 2025 the **Delta Wellington ULTRA** short-Treasury fund drew **$100M+** commitments (Stable + Theo) and an AAA rating from Particula ([CoinDesk](https://www.coindesk.com/markets/2025/12/03/stable-theo-anchor-usd100m-in-libeara-backed-tokenized-treasury-fund-ultra)). **UNVERIFIED:** a briefed **Libeara–DBS partnership** could not be confirmed — all sources attribute custody/backing to Standard Chartered, not DBS.

### Private credit — Centrifuge · Maple

**Centrifuge** is the clearest "picks-and-shovels" RWA play: whitelabel tokenization infra, **deRWA** wrappers that turn permissioned institutional fund tokens (deJTRSY, deJAAA) into freely-transferable DeFi-composable ERC-20s, and **Anemoy**, its in-house fund-structuring arm. Its marquee 2025 move was the **S&P Dow Jones Indices collaboration** producing **SPXA**, the first S&P-licensed tokenized S&P 500 index fund, live on Base in Sept 2025 ([Centrifuge blog](https://centrifuge.io/blog/centrifuge-launches-spxa); [S&P DJI](https://www.spglobal.com/spdji/en/education/article/the-sp-500-onchain/)). TVL diverges by source — Centrifuge's own site shows ~$1.8B / 1,768 assets while late-2025/2026 press cites ~$1.34B ("third-largest RWA issuer"), JAAA crossing $1B; partners include Janus Henderson, Apollo, New York Life, Coinbase.

**Maple Finance** is an on-chain **institutional credit marketplace** where professional "delegates" (Maple Direct, Room40, AQRU) underwrite USDC loans to KYC'd borrowers. Its most Goemon-relevant primitive is **syrupUSDC / syrupUSDT**: a permissionless, composable yield-bearing stablecoin packaging the yield of the *permissioned* loan book (~8% APY) so retail holders get institutional credit yield without passing the pool's KYC gate. In 2025 Maple went cross-chain to Solana via Chainlink CCIP (plus Arbitrum, Base, Plasma) and integrated with Aave, Pendle, Kamino ([Maple 2025 review](https://maple.finance/insights/2025-data-review); [Solana expansion](https://crypto.news/maple-finance-expands-solana-with-chainlink-ccip-2025/)). Scale (source/date-dependent, distinct metrics): TVL ~$2.1B (May 2026), $4B+ deposits / $4.6B+ AUM, $20B+ cumulative originations since 2019.

### Real estate — RealT

**RealT (RealToken)** is the pioneer B2C tokenized-real-estate issuer (2019), selling fractional shares of US rental homes from ~$50 with rent paid in stablecoin. The legal spine is **one LLC per property** (Delaware/Wyoming) holding the deed, with the ERC-20 token representing an LLC membership interest. Posture: **Reg D** (US accredited) + **Reg S** (offshore), KYC/AML, a FINRA-member placement agent; tokens run on Ethereum and primarily **Gnosis Chain** (low-fee rent distribution + the RMM lending market) ([legal/compliance overview](https://tokenizedliving.com/index.php/2024/07/07/realt-legal-compliance-with-u-s-law-in-real-estate-tokenization/); [RealT FAQ](https://faq.realt.co/en/article/what-is-realt-who-can-invest-how-do-i-invest-1yyc5h5/)). Traction: 700+ properties, ~$130M asset value, Gnosis TVL ~$146M (Jun 2025). The **LLC-per-property + rent-in-stablecoin** model is the proven template, but the property-ops/title/per-entity legal overhead is enormous.

### Security-token issuance infra / ERC-3643 — Securitize · Tokeny · SG-Forge · Kinexys(Onyx)

**Securitize** is the US market leader precisely because it owns the full **regulated stack** through subsidiaries — SEC-registered broker-dealer, digital transfer agent, fund administrator, and an SEC-regulated **ATS**. It is the tokenization platform + transfer agent for BlackRock's **BUIDL** (~$3.07B, the largest tokenized MMF) and serves Apollo, KKR, Hamilton Lane, VanEck, BNY, with **>$4B total AUM** (May 2026). Its **sToken** (ERC-4626 wrapper) produced sBUIDL — RWA yield that becomes DeFi collateral. Securitize is going public on the NYSE under ticker **SECZ** (~$400M raise, July 2026) ([Securitize press](https://securitize.io/learn/press/Securitize-To-Become-Public-Company); [BUIDL collateral](https://www.prnewswire.com/news-releases/blackrocks-buidl-tokenized-by-securitize-now-accepted-as-collateral-for-trading-on-binance-and-launches-on-bnb-chain-302613374.html)).

**Tokeny Solutions** (Luxembourg, 2017) is the creator and maintainer of **ERC-3643** (the T-REX protocol) — the exact permissioned-token standard Goemon's PRD names — plus **ONCHAINID** on-chain identity. It is B2B software (not a licensed BD/TA); compliance is enforced at the contract level. In **May 2025 Apex Group** (fund admin, $3T+ AUA, targeting $100B tokenized by June 2027) took a majority stake, and Tokeny/Apex unveiled the **T-REX Ledger** (a Polygon-stack reference chain) ([ERC-3643](https://tokeny.com/erc3643/); [Apex/T-REX Ledger](https://www.theblock.co/post/394284/apex-group-taps-polygon-trex-ledger)). Closest architectural fit to Goemon's stack.

**SG-Forge** (Société Générale-FORGE) is a bank subsidiary and one of the first regulated banks to issue **MiCA-compliant stablecoins**: **EURCV** (compliant since MiCA's stablecoin rules took effect Jul 1, 2024) and **USDCV** (launched Jun 25, 2025), both 100% cash-backed and 1:1 redeemable, deployed on Ethereum, Solana, Stellar, and XRP Ledger. It is regulated as a **MiFID2 investment firm, an EMI under MiCA, and a French DASP** ([CoinVertible](https://www.sgforge.com/product/coinvertible/); [USDCV, CoinDesk](https://www.coindesk.com/business/2025/06/10/socgen-s-crypto-arm-unveils-dollar-stablecoin-on-ethereum-and-solana)). It is a settlement-asset issuer, not a tokenization platform.

**Kinexys (ex-Onyx by J.P. Morgan).** **Confirmed: Onyx was rebranded to Kinexys in November 2024** ([J.P. Morgan](https://www.jpmorgan.com/insights/payments/blockchain-digital-assets/introducing-kinexys); [Ledger Insights](https://www.ledgerinsights.com/jp-morgan-rebrands-blockchain-unit-to-kinexys/)). Product lines: **Kinexys Digital Payments** (renamed JPM Coin — >$1.5–2T notional since inception, ~$2–3B average daily), **Kinexys Digital Assets** (tokenization/collateral), and **Kinexys Labs**. In June 2025 it piloted **JPMD**, a permissioned **USD deposit token** — explicitly a *bank deposit liability, not a stablecoin* — on **Base** (Coinbase's public L2), with intent to issue natively on the Canton Network ([JPMD](https://www.jpmorgan.com/payments/newsroom/jpm-coin-usd-deposit-token-institutional-clients)). Closed, bank-owned — not infrastructure Goemon can build on; the transferable idea is the **deposit-token vs stablecoin** distinction.

### Build-shops / emerging / uncertain — Blockchain App Factory · Vottun · BlockRidge · Verta

**Blockchain App Factory (Confirmed as a dev shop, not a platform).** A blockchain-development agency (India — Appstars Applications Pvt Ltd, Chennai + Singapore) that builds tokenization platforms, smart contracts, KYC/AML integration, and white-label products *for clients* across real estate, private credit, funds, equity, and royalties, advertising ~8 chains and ERC-3643/ERC-1400 support ([RWA services page](https://www.blockchainappfactory.com/real-world-asset-tokenization)). The *nature* of the business is verifiable; the self-reported scale metrics (12+ years, 800+ projects, 250+ experts) are marketing figures with no independent corroboration. Not an issuer, custodian, or regulated entity.

**Vottun (Partial).** A genuine blockchain-infrastructure company offering REST APIs/SDKs so Web2 firms can build tokenization dApps, with concrete RWA examples (carbon-credit tokenization) and a VTN token ([site](https://vottun.com/)). Funding is small — Tracxn reports ~$440K across 3 rounds (seed, May 2023; investors incl. Draper B1, LLYC Venturing, Stellar) ([Tracxn](https://tracxn.com/d/companies/vottun/__R1_Lhv5TOPDTnOhGJm4ogXkPxUD65st6BeWL7nIJwHU)). **Discrepancy:** Tracxn lists Vottun in Los Angeles with a CEO "Rohan Hall," conflicting with strong Spain signals (Spanish regulatory sandbox with PwC + Stellar; Spanish investor LLYC) — treat HQ/leadership as unconfirmed.

**BlockRidge (Partial).** A real but small SaaS + advisory play (operated by Valuit Technology Delaware LLC) positioning as "tokenization infrastructure for the onchain economy" — tokenization, cap-table management, and consulting ([site](https://blockridge.com/); [rwa.io overview](https://www.rwa.io/post/blockridge-tokenized-asset-platform-overview)). Its own site is explicit that it provides **"SaaS technology solutions only"** and is **not** an adviser/broker/dealer/bank — compliance is pushed to the customer. Third-party summaries attribute ERC-3643 + KYC/AML/GDPR support. Traction claims (30+ companies, 100K+ users) are self-reported and **unverified**.

**Verta (UNVERIFIED).** No distinct, standalone RWA/tokenization firm could be confirmed under the exact name "Verta." A search snippet ("Verta simplifies the lifecycle of digital securities") could not be traced to a primary source. What actually exists under similar names: **Vertalo** (a real SEC-registered digital transfer agent / tokenization platform, Austin, 2017 — [vertalo.com](https://www.vertalo.com/)); **VERT Capital** (a Brazilian securitizer tokenizing structured credit on XRPL/XDC, planning up to $1B — [CoinDesk](https://www.coindesk.com/business/2025/07/29/brazil-s-vert-capital-to-tokenize-usd1b-in-real-world-assets-on-xdc-network)); and the unrelated **Verta.ai** ML company. Honest assessment: "Verta" as briefed is most plausibly a garbled reference to **Vertalo** or **VERT Capital**; flagged UNVERIFIED rather than invented.

---

## §3 — What Goemon Should Offer (prioritized RWA product menu)

Cross-cutting thesis, echoed by every archetype: **the winning move for a non-custodial, tokenization-first neobank is to be the distribution/wallet/UX/ledger layer over regulated issuers — not the issuer of record.** Ondo bought a broker-dealer rather than build one; Centrifuge and Maple are integrate-and-wrap partners; Franklin/Libeara pair infra with a licensed fund manager + custodian; RealT shows the real-estate legal cost. Goemon's non-custodial wallet + double-entry ledger + ledger⇄chain reconciliation invariant fits the **"hold the token, mirror the position, let a licensed partner be issuer"** model already in the repo's ERC-3643/compliance-module design.

| Priority | Product | Model to follow | Compliance gate | Phase |
|---|---|---|---|---|
| **1** | **Tokenized-treasury yield (retail wedge)** — distribute a yieldcoin / retail MMF token as the default "cash that earns" | USDY (Reg S) or BENJI ('40-Act) — *distribute, don't issue* | Non-US retail via a Reg S yieldcoin, or allowlisted '40-Act fund token via partner TA; copy Franklin's "blockchain = record, reconciled daily" (already Goemon's reconciliation invariant) | **A→B** |
| **2** | **Private-credit yield primitive** — wrap an institutional-credit yield token as a higher-yield option | Maple **syrupUSDC** — wrap the permissionless yield token, don't underwrite | None to *hold/distribute* a permissionless composable token; disclosure + suitability screening | **A** |
| **3** | **Security-token issuance-as-a-service** — let partners issue compliant tokens through Goemon's rails | **Tokeny ERC-3643 + ONCHAINID** (adopt the standard) + **Securitize-style** TA/BD/ATS (partner) | Standard is license-free to adopt (Phase A); primary issuance / secondary resale needs a partner BD/ATS + transfer agent | **A** (standard) → **C** (venue) |
| **4** | **Tokenized funds / equities** — tokenized S&P 500 / equity exposure | Centrifuge **SPXA** (index fund) / Dinari-style 1:1 tokenized equities (Goemon's Phase 18.6 seam) | Reg S / index-license for funds; 1:1 equity tokenization needs issuer + BD/TA/custodian/ATS | **B→C** |
| **5** | **Tokenized real estate** — fractional income-producing property | RealT **LLC-per-property + rent-in-stablecoin** — surface via an issuer partner, do NOT originate deeds | Reg D (accredited) / Reg S; LLC-per-property legal overhead; partner the issuer/placement agent | **B→C** |

**Design patterns to steal (Phase A, no license):**
- **Transfer-agent pattern, not custody claim** (Franklin): blockchain as the *record*, reconciled to an authoritative ledger — Goemon already has this.
- **Composable-but-compliant wrapper** (Securitize sToken / Centrifuge deRWA): keep issuance-level transfer restrictions while making the token usable — maps to Goemon's compliance-gated ledger-derived holdings and Phase 18.6.
- **Deposit-token vs stablecoin framing** (Kinexys): a design idea for how Goemon models its own cash liability on-chain.
- **EU/MiCA-first regulatory arbitrage** (Robinhood): launch the boldest tokenization features where a MiCA/CASP path exists before the US securities path is ready.

**What to avoid / partner rather than build:** the US securities stack (BD/ATS/transfer agent — Ondo *bought* one; partner a Securitize-like); a bank-grade fiat stablecoin (SG-Forge shows the EMI/MiCA cost — partner Circle/SG-Forge); underwriting institutional credit (wrap Maple, don't originate); originating real-estate deeds (RealT's per-entity overhead — partner the issuer). And the commoditized layer — generic "RWA tokenization development" (Blockchain App Factory, BlockRidge's SaaS-only disclaimer) — is *the opposite* of Goemon's thesis: the moat is being a **regulated-posture, non-custodial operator that takes on the compliance burden**, not a vendor that disclaims it.

**Update — the settlement stablecoin itself (Open USD / OUSD, announced 2026-06-30).** Beyond RWA
issuers, a new **consortium stablecoin** (Open Standard; Visa/Mastercard/Stripe/BlackRock/Coinbase +
140 partners) reframes the "partner Circle" call: OUSD promises zero-fee mint/redeem and **returns
most reserve yield to distributors** (vs Circle keeping it) — better-aligned with Goemon's
"distribute, don't issue" thesis *and* a potential revenue line. Still an announcement (live "later
in 2026"), and whether a small fintech can integrate + earn the yield-share is unverified. Treat OUSD
as a **settlement-stablecoin partner target**, not a build. Full analysis:
[`OUSD-STABLECOIN-ASSESSMENT.md`](./OUSD-STABLECOIN-ASSESSMENT.md).

---

## §4 — Consolidated Sources

**Neobanks**
- https://robinhood.com/us/en/newsroom/robinhood-launches-stock-tokens-reveals-layer-2-blockchain-and-expands-crypto-suite-in-eu-and-us-with-perpetual-futures-and-staking/
- https://robinhood.com/us/en/newsroom/introducing-strategies-banking-and-cortex/
- https://www.coindesk.com/business/2025/11/18/permissionless-assets-robinhood-s-3-phase-tokenization-plan-to-disrupt-tradfi
- https://www.revolut.com/en-US/news/revolut_reports_record_profit_of_2_3bn_for_2025_as_revenue_surges_to_6bn/
- https://www.coindesk.com/business/2026/03/24/crypto-friendly-fintech-revolut-sees-profit-soar-57-to-usd2-3-billion-in-2025
- https://www.coindesk.com/business/2025/12/11/revolut-and-trust-wallet-launch-instant-crypto-buys-in-eu-with-self-custody-focus
- https://www.chime.com/newsroom/news/2025-letter-to-shareholders/
- https://www.chime.com/credit/credit-builder/

**Tokenized treasuries / MMF**
- https://ondo.finance/ousg · https://ondo.finance/usdy · https://ondo.finance/ondo-chain
- https://bitcoinethereumnews.com/tech/inside-ondo-finance-how-ousg-and-usdy-tokenize-us-treasuries-through-distinct-legal-frameworks/
- https://www.coindesk.com/business/2025/02/06/ondo-finance-unveils-layer-1-network-for-tokenized-assets
- https://blockworks.co/news/ondo-finance-finalizes-oasis-pro-acquisition
- https://www.theblock.co/post/361120/ondo-finance-to-acquire-us-regulated-broker-oasis-pro-for-tokenized-securities-expansion
- https://eco.com/support/en/articles/15254016-benji-deep-dive-2026-franklin-templeton-s-tokenized-money-market
- https://stellar.org/press/franklin-templeton-stellar-development-foundation-mark-five-years-of-benji-the-first-u-s-registered-tokenized-money-market-fund
- https://www.sec.gov/Archives/edgar/data/1786958/000174177325000031/c485bpos.htm
- https://www.coindesk.com/markets/2025/12/03/stable-theo-anchor-usd100m-in-libeara-backed-tokenized-treasury-fund-ultra
- https://scventures.io/sc-ventures-launches-libeara-to-provide-tokenisation-platform/
- https://www.ledgerinsights.com/moodys-rates-fund-tokenization-libeara-stanchart/

**Private credit / real estate**
- https://centrifuge.io/ · https://centrifuge.io/blog/centrifuge-launches-spxa
- https://www.spglobal.com/spdji/en/education/article/the-sp-500-onchain/
- https://www.coindesk.com/business/2025/09/25/centrifuge-launches-tokenized-s-and-p-500-index-fund-on-coinbase-s-base-network
- https://maple.finance/ · https://maple.finance/insights/2025-data-review · https://maple.finance/insights/syrupusdc-and-syrupusdt-built-for-scale
- https://crypto.news/maple-finance-expands-solana-with-chainlink-ccip-2025/
- https://faq.realt.co/en/article/what-is-realt-who-can-invest-how-do-i-invest-1yyc5h5/
- https://tokenizedliving.com/index.php/2024/07/07/realt-legal-compliance-with-u-s-law-in-real-estate-tokenization/

**Security-token infra / ERC-3643**
- https://own.securitize.io/ · https://securitize.io/learn/press/Securitize-To-Become-Public-Company
- https://www.prnewswire.com/news-releases/blackrocks-buidl-tokenized-by-securitize-now-accepted-as-collateral-for-trading-on-binance-and-launches-on-bnb-chain-302613374.html
- https://tokeny.com/erc3643/ · https://www.erc3643.org/ · https://www.theblock.co/post/394284/apex-group-taps-polygon-trex-ledger
- https://www.sgforge.com/product/coinvertible/ · https://www.coindesk.com/business/2025/06/10/socgen-s-crypto-arm-unveils-dollar-stablecoin-on-ethereum-and-solana
- https://www.jpmorgan.com/insights/payments/blockchain-digital-assets/introducing-kinexys
- https://www.ledgerinsights.com/jp-morgan-rebrands-blockchain-unit-to-kinexys/
- https://www.jpmorgan.com/payments/newsroom/jpm-coin-usd-deposit-token-institutional-clients

**Niche / uncertain**
- https://www.blockchainappfactory.com/real-world-asset-tokenization
- https://vottun.com/ · https://tracxn.com/d/companies/vottun/__R1_Lhv5TOPDTnOhGJm4ogXkPxUD65st6BeWL7nIJwHU
- https://blockridge.com/ · https://www.rwa.io/post/blockridge-tokenized-asset-platform-overview
- https://www.vertalo.com/ · https://www.coindesk.com/business/2025/07/29/brazil-s-vert-capital-to-tokenize-usd1b-in-real-world-assets-on-xdc-network

### Key uncertainties (flagged for the decision-maker)
- **Ondo AUM** is cited $1.6B–$2.75B across late-2025/2026; ~$1.6B (Oasis Pro close) is best-anchored, higher figures are promotional.
- **Franklin FOBXX AUM** (~$828M, Q1 2026) is from a secondary source; the fund's own page is the primary check.
- **Libeara–DBS partnership: UNVERIFIED** — sources attribute custody to Standard Chartered, not DBS.
- **Centrifuge TVL** ($1.34B press vs $1.8B own site) and **Maple** TVL/deposits/AUM ($2.1B/$4B/$4.6B) are distinct metrics at different dates — treat as ranges.
- **RealT** property count / asset value are mid-2025 secondary figures.
- **Vottun** HQ (Spain vs LA) and leadership are unconfirmed.
- **BlockRidge** traction claims are self-reported and unverified.
- **Verta** is UNVERIFIED as a distinct RWA firm (likely a collision with Vertalo / VERT Capital).
