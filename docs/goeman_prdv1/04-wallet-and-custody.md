# 04 — Wallet & Custody

## Custody model

Goeman Global Finance is **non-custodial** for all on-chain assets (USDC, USDT, RWA tokens, NFTs). The user's Hedera account holds their assets; Goeman Global Finance operates the infrastructure that lets them use that account through the app.

For US dollars (real bank-rail dollars, distinct from USDC), Goeman Global Finance is **custodial-via-partner-bank** at Tier 2+. The partner bank holds the USD in a pooled or FBO ("for benefit of") account; user balances are tracked in our ledger and reconciled with the bank daily. Tier 0 and Tier 1 users do not have USD balances — only USDC.

## Wallet stack — v1

### Native build on Hedera SDKs

Goeman Global Finance builds the wallet infrastructure directly on Hedera's first-party SDKs rather than integrating a third-party embedded wallet provider. This decision was made deliberately to maximize control, eliminate vendor lock-in, and take advantage of Hedera's protocol-level account abstraction (which makes the build substantially simpler than the equivalent on EVM, where smart-contract wallets and ERC-4337 paymasters would add material complexity).

**Why native:**
- **Hedera's protocol-level AA eliminates the smart contract wallet pattern.** Account IDs are decoupled from keys; rotating keys, adding multi-signature thresholds, and gating transactions on policy all happen at the network layer without a deployed contract per user.
- **Cost structure scales linearly with our infrastructure, not per-MAU vendor fees.** At 1M users, an embedded wallet vendor typically costs $0.10-1.00/MAU/month; our infrastructure cost is closer to $0.01-0.05/MAU/month.
- **No conflict with future partners.** Privy is owned by Stripe (which owns Bridge, our intended international rails partner); Dynamic is owned by Fireblocks (which serves direct competitors). Independent infrastructure means we don't need to negotiate around either.
- **Full audit trail.** Every signing operation is in code we own, reviewed by audit firms we choose, with no opaque vendor-side cryptographic operations.

**Trade-offs accepted:**
- 3-5 months of dedicated wallet engineering team work during Phase 0 and Phase 1
- We carry full responsibility for key management security
- Recovery flow design and operation become our problem (this is the hardest part)
- v1 marketing cannot leverage third-party security branding (Fireblocks, etc.); we lean on external audit firms and SOC 2 instead
- v2 review point: if institutional issuers demand vendor-backed custody provenance, we can swap the key-custody layer behind our internal abstraction without changing the user surface

### Architecture

```
User device                              Goeman Global Finance backend                   Hedera network
─────────────                            ──────────────                   ──────────────
┌────────────────────┐                  ┌──────────────────┐              ┌────────────┐
│  Goeman Global Finance app        │                  │  Wallet Service  │              │   Hedera   │
│  ┌──────────────┐  │   transaction    │  ┌─────────────┐ │   submit tx  │   network  │
│  │  Signing UX  │  │   construction   │  │ Tx Builder  │ │              │            │
│  │  + passkey   │  │ ────────────────►│  │             │ │ ────────────►│  consensus │
│  │  prompt      │  │                  │  └─────────────┘ │              │            │
│  └──────┬───────┘  │                  │  ┌─────────────┐ │              │            │
│         │          │                  │  │  Paymaster  │ │  pay HBAR    │            │
│  ┌──────▼───────┐  │                  │  │   signer    │ │  fees        │            │
│  │  Hedera Key  │  │  signed bytes    │  │  (KMS-held) │ │              │            │
│  │  in Secure   │◄─┼──────────────────┤  └─────────────┘ │              │            │
│  │  Enclave     │  │                  │  ┌─────────────┐ │              │            │
│  └──────────────┘  │                  │  │   Backup    │ │              │            │
└────────────────────┘                  │  │  Custodian  │ │              │            │
                                        │  └─────────────┘ │              │            │
                                        └──────────────────┘              └────────────┘
```

### Key management

**Primary key — Apple Secure Enclave (iOS) and Android Keystore (Android):**
- Generated on device at first sign-in
- Stored in hardware secure element; never leaves the device unencrypted
- Signing operations execute inside the secure element after biometric/passkey unlock
- Key material is not exportable through normal app flows; users wanting to leave the platform use an explicit "export key" flow with a 24-hour cooldown

**Web client — WebAuthn-bound key:**
- Web users authenticate via WebAuthn passkey, which gates access to a session-scoped signing key derived inside the browser's secure context
- Long-lived web key material is server-side encrypted at rest; ephemeral signing keys live only in the browser session
- Web is a secondary client; users are encouraged to use mobile for primary wallet operations

**Server-side encrypted backup — our "Backup Custodian" service:**
- An encrypted blob containing the user's key material is stored server-side
- Encryption is performed with a key derived from the user's passkey credentials + an HMAC factor held in KMS
- Backup is used only during cross-device recovery (see Recovery section below)
- Decryption requires the user's passkey signature, which Goeman Global Finance cannot produce on the user's behalf

**Paymaster signing — KMS / HSM:**
- The paymaster account that sponsors gas operates from a separate signer service
- Paymaster key material is stored in AWS KMS / CloudHSM; signing happens inside KMS, key never leaves
- Paymaster transactions are independent of user transactions and cannot move user funds

**Requirements:**
- `[REQ-WALLET-001]` User keys are generated on-device using the platform's hardware secure element (Secure Enclave on iOS, StrongBox-backed Keystore on Android where available; software Keystore otherwise with clear UX indicator)
- `[REQ-WALLET-002]` Key material never appears in the application's memory in plaintext form; signing requests are passed to the secure element, which returns signed bytes
- `[REQ-WALLET-003]` Server-side backup blobs are double-encrypted: outer layer with KMS-held HMAC, inner layer with passkey-derived key
- `[REQ-WALLET-004]` Backup blobs are stored with no association to plaintext user identifiers; lookup is via opaque token derived from passkey credential
- `[REQ-WALLET-005]` Loss of all device passkeys triggers the privileged recovery path (see Recovery section); this requires Tier 1+ verification minimum and applies a 24-hour withdrawal hold

### Hedera account structure

Each user gets a single Hedera account on signup. Hedera's protocol-level account abstraction lets us:

- Attach multiple keys to the account with threshold signing (e.g., 1-of-1 for normal use, 2-of-2 with server co-signer for step-up)
- Rotate keys without changing the account ID (so a user who gets a new phone keeps the same Hedera account)
- Express policy-based authorization via Hedera's native key list and threshold key constructs — no smart contract required

**Requirements:**
- `[REQ-WALLET-006]` Each Goeman Global Finance user account has exactly one Hedera account ID at any time
- `[REQ-WALLET-007]` New users' Hedera accounts are created on first sign-in with a single device-derived key; account creation cost is sponsored by Goeman Global Finance's paymaster
- `[REQ-WALLET-008]` Account key rotation is supported and triggered automatically when a user adds a new device; the prior device's key remains valid until explicitly revoked or until 90 days of inactivity, whichever is sooner
- `[REQ-WALLET-009]` Step-up auth (Module 03) uses a 2-of-2 threshold key list: user's device-derived signature + a server-side signature from the policy enforcement service
- `[REQ-WALLET-010]` Hedera accounts have an associated EVM-compatible address (HIP-583 ECDSA alias) so users can receive from EVM-side wallets
- `[REQ-WALLET-011]` Account creation, key rotation, and threshold-update operations are all logged to the audit service with the actor identity and reason

### Token associations

Hedera requires explicit account-to-token associations before an account can receive a token. We auto-associate the standard set on account creation:

- USDC (Hedera-native)
- USDT (Hedera-native, when available)
- Any token issued by Goeman Global Finance's first-party tokenization (v2+)

For third-party tokens the user purchases through the marketplace, we auto-associate at purchase time. For inbound transfers of unknown tokens, the system shows a "Pending association" state and prompts the user to accept before the asset appears in their balance.

**Requirements:**
- `[REQ-WALLET-012]` USDC association happens automatically at account creation; cost (currently ~$0.05 of HBAR equivalent) is sponsored by Goeman Global Finance
- `[REQ-WALLET-013]` Maximum auto-associated tokens per account: 100 (Hedera's network limit). Above that, users must explicitly manage associations
- `[REQ-WALLET-014]` Unknown inbound tokens require manual user acceptance to avoid spam token issues

## Gas sponsorship

Users never see HBAR. Goeman Global Finance pays all transaction fees on the user's behalf using Hedera's transaction fee delegation model.

**Mechanism:**
- Goeman Global Finance operates a "paymaster" account funded with HBAR
- Transactions are constructed with the paymaster as the `payerAccountId` and signed by both the user's key and the paymaster
- Fee policy enforced server-side: certain transaction types are sponsored, others not (e.g., spamming Hedera with HCS submissions outside of audit flow is not sponsored)

**Requirements:**
- `[REQ-WALLET-015]` Gas sponsorship covers: token transfers up to a daily quota per user, marketplace purchases, smart contract calls to whitelisted Goeman Global Finance contracts
- `[REQ-WALLET-016]` Daily HBAR spend per user is capped (configurable; v1 default $0.10/user/day equivalent)
- `[REQ-WALLET-017]` Paymaster account balance is monitored; alerts fire below 30 days runway at current usage rate
- `[REQ-WALLET-018]` Failed transactions due to paymaster issues are retried automatically up to 3 times with exponential backoff

## Wallet recovery

Three recovery paths, with progressively more friction and more security:

### Path 1: Passkey sync (default, ~95% of cases)

User signs in on a new device using their passkey that's already synced via iCloud Keychain, Google Password Manager, or 1Password. New device generates a fresh hardware-bound key, which is added to the user's Hedera account via the existing passkey-signed authorization. The old device's key remains valid until the user explicitly revokes it or 90 days of inactivity pass.

No special UX flow — same as initial sign-in, with one additional confirmation screen for the new device.

### Path 2: Encrypted backup recovery

If the user has lost device access but retains other verification factors:
- User initiates recovery from a fresh device via email or phone (Tier 1+)
- System verifies email + phone (SMS OTP) + (optionally) prior device push approval
- After successful multi-factor verification, the server returns the encrypted backup blob to the new device
- New device decrypts the backup using the recovered passkey credentials (synced via the platform credential manager) and the KMS-held HMAC factor delivered to the device after verification
- Recovered key material lives in the new device's secure element going forward
- 24-hour withdrawal hold applies; notifications sent to all known contact methods

### Path 3: Manual escalation

If all automated paths fail (lost email access, lost phone, no synced passkey):
- User contacts support
- Agent-handled flow gathers proof-of-identity (KYC tier 2+ required); see Module 08 for the agent skill that handles this
- Compliance team reviews and approves
- Recovery executed via privileged server flow that generates a new key and rotates the Hedera account to it
- 7-day withdrawal hold + notification to all previously registered contact methods + step-up requirements re-applied to all subsequent operations for 30 days

**Requirements:**
- `[REQ-WALLET-019]` Recovery paths 2 and 3 are logged to the audit trail with the human reviewer's identity where applicable
- `[REQ-WALLET-020]` Recovery completion always triggers an email + push notification to all known user contact methods
- `[REQ-WALLET-021]` Users can configure additional recovery factors in Account settings (e.g., add a hardware security key for fallback, configure trusted contact recovery)
- `[REQ-WALLET-022]` Rate limit: max 3 recovery attempts per user per 24 hours; after 3 failures, the account enters a manual-review-only state for 7 days
- `[REQ-WALLET-023]` The encrypted backup blob is rotated whenever the user adds or removes a device, ensuring stale device keys are invalidated in the recovery path
- `[REQ-WALLET-024]` External security audit of the recovery flow is mandatory before any Phase 2 (open beta) traffic; re-audited annually

## What we do NOT do

- **Seed phrases.** Users never see a 12- or 24-word recovery phrase. Hardware-bound keys plus encrypted backup remove the need for the worst footgun in consumer crypto.
- **Wallet export to third parties from within Goeman Global Finance by default.** Users can export their Hedera private key via a clearly-labeled "Advanced" flow that includes a security warning, step-up auth, and a 24-hour cooldown, but we don't make it a primary action. Export is for users leaving the platform.
- **Custodial holding of crypto for any user.** Even Tier 4 users with lending products retain custody; the lending mechanism uses smart-contract escrow, not custodial transfer.
- **Recovery shortcuts via "knowledge factors" alone.** No security questions, no email-only resets, no SMS-only resets. Recovery always requires multiple factors and applies a withdrawal hold.

## USDC handling specifics

USDC on Hedera is issued by Circle and is fully reserved 1:1 with USD held at regulated US banks. Users hold USDC in their Hedera account directly.

**Cross-chain USDC** (sending or receiving USDC on Ethereum, Solana, Base, etc.) uses **Circle's CCTP V2** as the bridge protocol. CCTP burns USDC on the source chain and mints natively on the destination chain — no wrapped tokens, no liquidity-pool slippage. v1 supports inbound CCTP from Ethereum, Base, and Polygon; outbound CCTP to the same chains.

**Requirements:**
- `[REQ-WALLET-025]` Inbound CCTP transfers are credited to the user's Hedera USDC balance after Circle's finality requirements (typically 13-19 minutes for Ethereum mainnet)
- `[REQ-WALLET-026]` Outbound CCTP requires the user to specify destination chain and address; system validates the address format for the chosen chain
- `[REQ-WALLET-027]` CCTP transfers above $10K trigger step-up auth
- `[REQ-WALLET-028]` USDC freezing (by Circle, in response to law enforcement requests) is detected and reflected in the user's balance as "frozen" with explanatory messaging

## USD handling (Tier 2+)

USD balances are held at the partner bank. Each Tier 2+ user has a tracked USD balance in our ledger that corresponds to a portion of the pooled FBO account at the partner bank.

**Requirements:**
- `[REQ-WALLET-029]` USD balances are stored as integer cents in the ledger
- `[REQ-WALLET-030]` Daily reconciliation between our ledger and the partner bank's statement is automated; mismatches trigger immediate alert and a compliance hold on affected accounts
- `[REQ-WALLET-031]` Conversion between USD and USDC inside the app is supported with a single-tap flow; the partner bank executes the conversion using Bridge or a similar partner
- `[REQ-WALLET-032]` USD pass-through fees (ACH, wire) are disclosed before the user confirms a conversion

## RWA and NFT custody

Tokenized assets purchased through the marketplace land in the user's Hedera account.

- **ERC-3643 tokens** (securities) on HSCS: held in the user's account; transfer is gated by the token contract's compliance logic (the contract checks the recipient's identity registry status before allowing transfer)
- **HTS native tokens** (collectibles, gaming, first-party): held in the user's account; transfer rules are enforced at the application layer

For physical-backed collectibles (graded Pokemon cards, sneakers, etc.), the **physical asset is custodied by the partner platform** (Courtyard's insured vault, PWCC's facility) — the token is a digital claim. Users can redeem the physical asset through the partner's redemption flow.

**Requirements:**
- `[REQ-WALLET-033]` All purchased RWA and NFT tokens display in the user's Portfolio view with current valuation where available
- `[REQ-WALLET-034]` Physical redemption requests are routed to the appropriate custody partner via API; status updates flow back into the activity feed
- `[REQ-WALLET-035]` Lost or destroyed physical assets (per partner attestation) result in token burn + insurance payout in USDC to the user

## Out of scope for v1

- Multi-signature wallets for joint accounts or business use
- Hardware wallet integration (Ledger, Trezor) for the primary Goeman Global Finance wallet
- Cross-chain support beyond Ethereum/Base/Polygon via CCTP (Solana via CCTP coming v2)
- Custom smart-contract wallets per user (Hedera's protocol-level AA makes this unnecessary)

## Cross-references

- For how the wallet integrates with payments and rails, see [06 — Payments & Rails](./06-payments-and-rails.md)
- For how the wallet integrates with the marketplace, see [05 — Tokenization & Marketplace](./05-tokenization-and-marketplace.md)
- For wallet security audit and compliance considerations, see [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
