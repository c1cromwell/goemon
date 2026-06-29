# 02 — Product Overview

## Surfaces

Goemon Global Finance ships three client surfaces and one internal surface at launch:

| Surface | Platform | Primary purpose |
|---|---|---|
| Mobile app | iOS (Swift/SwiftUI), Android (Kotlin/Compose) | Primary consumer surface — wallet, marketplace, transfer, support |
| Web app | Next.js 15 (App Router) | Same product surface as mobile; passkey-first; better for portfolio review and tax export |
| Headless API | Go services exposing gRPC + REST | Used by all clients; also exposed to partners under contract |
| Internal admin console | Repurposed Goemon Global Finance CLI (Python) | Used by compliance reviewers, customer support escalations, ops |

The mobile and web apps are at feature parity at launch with the exception of biometric authentication flow (Face ID / Touch ID on mobile; passkey-via-browser on web). There is no feature gated to a single client surface.

## Top-level navigation (mobile)

The primary tab bar is four entries:

1. **Home** — balances, activity feed, quick actions (send, receive, browse marketplace)
2. **Market** — the tokenization marketplace, with two sub-surfaces (Invest, Collect)
3. **Move** — send/receive USDC, cross-border transfer, fiat on/off ramp
4. **Account** — identity verification status, security settings, support, payment methods

The web app uses a left sidebar for the same four entries plus an additional "Portfolio" deep-view that is reachable from Home on mobile but gets its own surface on a larger screen.

## Core user flows

### Onboarding (Tier 0)

Target time-to-first-transaction: **45 seconds from app open**.

1. App open → "Sign in or create account" with a single primary button using passkey or email
2. If passkey: device prompts for biometric → account created → user is in Home tab
3. If email: enter email, receive OTP, confirm OTP, create passkey on the spot → user is in Home tab
4. First-run education appears as a 3-card carousel on Home (dismissible): "Receive dollars," "Browse the market," "Move money worldwide"

No KYC. No phone number required. No address. No SSN/national ID. The user has a Hedera account with a USDC balance of zero and can immediately receive USDC.

**Requirements:**
- `[REQ-OB-001]` Tier 0 signup completes without collecting any personally identifiable information beyond email (which is optional if passkey is used)
- `[REQ-OB-002]` New users land in a Home state with a clear "Receive USDC" entry point as the most prominent action
- `[REQ-OB-003]` First-run education is dismissible and does not reappear; analytics tracks completion rate
- `[REQ-OB-004]` Time-to-first-screen-after-tap target: P50 ≤ 30s, P95 ≤ 90s

### Receiving USDC

The first action a new Tier 0 user takes. The flow has to be obvious and shareable.

1. Home → "Receive" → modal shows the user's Hedera account address with QR code
2. User can copy address, share via system share sheet, or generate a payment request link (deep link that opens to a pre-filled send screen if recipient also has Goemon Global Finance)
3. Incoming transfers appear in the activity feed within ~5 seconds of on-chain confirmation
4. Push notification on receipt (if notifications enabled)

**Requirements:**
- `[REQ-RX-001]` Display both the Hedera account address and an EVM-compatible address alias (HIP-583) so users can receive from either ecosystem
- `[REQ-RX-002]` Show estimated confirmation time and disclaimer that only USDC on Hedera is supported in v1
- `[REQ-RX-003]` Detect inbound transfers via Mirror Node subscription and notify user within 5s P95

### Browsing the marketplace (Market tab)

Two sub-surfaces accessible via a segmented control at the top of the Market tab:

- **Invest** — securities-style RWAs (treasuries, real estate, private credit). Each listing shows asset name, issuer, yield/return information, minimum investment, lock-up period if any, KYC tier required, and a regulatory disclosure.
- **Collect** — physical collectibles (graded TCG, watches, sports memorabilia) and Web3-native gaming items. Each listing shows asset image(s), provenance, custody details (which vault, whether physical redemption is possible), current ask/floor, KYC tier required.

Listings are filterable by category, yield/return, minimum, and KYC required. Users can sort by most popular, highest yield, newest listing, or alphabetical.

**Requirements:**
- `[REQ-MK-001]` Market tab displays both surfaces (Invest and Collect) regardless of user KYC tier; gated assets show "Verify identity to invest" overlay rather than being hidden
- `[REQ-MK-002]` Each listing has a dedicated detail screen with full disclosures, recent trade history, holder count where available, and contract address for verification
- `[REQ-MK-003]` Marketplace search supports text query across asset name, issuer, and category
- `[REQ-MK-004]` Marketplace listings are reviewed by compliance before going live (workflow defined in Module 09)

### Buying a listing

The flow varies by KYC tier required:

- **Tier 0 user buying a collectible:** Tap listing → "Buy" → confirm amount and USDC cost → biometric prompt → on-chain transaction → confirmation
- **Tier 0 user buying a security:** Tap listing → "Buy" → KYC upgrade flow inserted → upon completion, return to listing → biometric prompt → confirmation
- **Tier 2 user buying a Reg D security:** Tap listing → "Buy" → accredited investor verification flow inserted → upon completion, complete purchase

**Requirements:**
- `[REQ-BUY-001]` Purchase flow surfaces total cost including any platform/issuer fees before the biometric confirmation
- `[REQ-BUY-002]` If a KYC tier upgrade is required, the user's intended purchase is preserved across the upgrade flow and resumed automatically
- `[REQ-BUY-003]` Failed purchases (insufficient funds, on-chain error, compliance block) surface clear error messages with next-step guidance
- `[REQ-BUY-004]` Confirmed purchases show in the activity feed within 5s P95 of on-chain finality

### Sending USDC

The Move tab consolidates all outbound flows.

1. Move → "Send" → enter recipient (Goemon Global Finance handle, Hedera address, EVM address, or contact)
2. Enter amount
3. If amount exceeds Travel Rule threshold ($3K) and KYC tier insufficient: tier upgrade flow inserted
4. Confirmation screen with amount, recipient, fee (sponsored or shown), and estimated arrival
5. Biometric confirmation → submit transaction → confirmation

**Requirements:**
- `[REQ-SEND-001]` Address validation runs before submission; invalid Hedera/EVM addresses block submit
- `[REQ-SEND-002]` Travel Rule data collection (originator and beneficiary information) is automatic and based on KYC tier — user does not see Travel Rule form unless additional info is required
- `[REQ-SEND-003]` Sending to a known Goemon Global Finance handle short-circuits address entry and shows the recipient's name/avatar for confirmation

### Cross-border (international corridors)

For v1 international corridors (priority: Nigeria, Philippines, Brazil — see [Module 06](./06-payments-and-rails.md)):

1. Move → "Send abroad" → select destination country
2. Enter recipient's local payment method (M-Pesa number, GCash number, Pix key, bank account)
3. Enter amount in either USDC or local currency; FX rate is displayed live
4. Confirmation screen showing total cost, FX rate, estimated arrival
5. Biometric confirmation → off-ramp partner executes settlement

**Requirements:**
- `[REQ-XB-001]` Each corridor shows a real-time FX rate with markup disclosed
- `[REQ-XB-002]` Estimated arrival time is shown based on partner rail (some corridors settle in minutes, others next-day)
- `[REQ-XB-003]` Failed off-ramp transactions trigger automatic USDC refund within 1 hour

### Identity verification (upgrade flow)

Triggered when the user attempts an action gated by a higher tier than they currently have.

1. Modal explains what's required and why ("To invest in treasuries, US regulators require us to verify your identity. This takes about 30 seconds with Apple Wallet or 2 minutes with a driver's license.")
2. User picks verification method:
   - Apple Wallet ID / Google Wallet ID / mDL (fastest, ~5s)
   - Verifiable Credential from a trusted issuer (variable)
   - IDV (document + selfie + liveness, ~90s)
3. Verification completes → user returns to the intended action
4. New tier reflected in Account tab

**Requirements:**
- `[REQ-IDV-001]` Identity verification flow preserves the user's prior intent (the action that triggered the upgrade) and resumes it on success
- `[REQ-IDV-002]` Failed verification offers an alternative method
- `[REQ-IDV-003]` Verification status changes are reflected in real time in all client surfaces

## Notifications

In-app and push notifications are categorized; users can opt out per category.

| Category | Default | Examples |
|---|---|---|
| Transactional | On (always — required for security) | "$50 USDC received," "Purchase confirmed: 0.05 BUIDL" |
| Marketplace | On | "New listing in Treasuries," "Asset you watched is now available" |
| Account | On | "New device signed in," "Identity verification approved" |
| Marketing | Off (opt-in only) | Product announcements, educational content |

## Out of scope for v1

- Charts, technical indicators, or any analytical/trading UI
- Multi-asset portfolio allocation tools
- Tax-loss harvesting or any tax-optimization features
- Subscription tiers (Goemon Global Finance Plus, Pro, etc.) — single free tier at launch
- Card management UI (no card at launch)
- Lending UI (no lending at launch)
- Group accounts, joint accounts, business accounts
- Recurring transfers / DCA / auto-invest
- Notifications via SMS (email and push only; SMS reserved for security)

## Cross-references

- For identity tier definitions, see [03 — Identity & Onboarding](./03-identity-and-onboarding.md)
- For wallet mechanics, see [04 — Wallet & Custody](./04-wallet-and-custody.md)
- For marketplace internals, see [05 — Tokenization & Marketplace](./05-tokenization-and-marketplace.md)
- For payments, see [06 — Payments & Rails](./06-payments-and-rails.md)
