# 03 — Identity & Onboarding

## The tiered identity ladder

Bankai uses a progressive identity model where capability unlocks happen at each tier rather than at a single signup gate. Users tier up only when they hit a feature that requires it.

| Tier | Verification required | Time to complete | Capabilities unlocked |
|---|---|---|---|
| **0 — Anonymous** | Passkey or email | <30s | Receive USDC, view marketplace, hold non-security NFTs, P2P USDC up to $1K total/30d, browse all listings |
| **1 — Light verified** | Phone + email | ~1 min | P2P USDC up to $10K total/30d, collect (buy collectibles), receive a virtual card in supported regions (v2) |
| **2 — KYC verified** | mDL / Apple Wallet ID / VC, or document + selfie IDV | 5s-2min | Fiat on/off ramp, full marketplace (Reg A+ securities and below), debit card (v2), higher transfer limits |
| **3 — Accredited** | Net worth / income attestation | 1-5 days | Reg D and Reg S securities, private credit, accredited-only offerings |
| **4 — Lending qualified** | Full underwriting identity (soft pull then hard pull) | 2-7 days | Personal loans, lines of credit (v3) |

A user can hold multiple tiers simultaneously (you can be Tier 2 + Tier 3 at the same time). Each tier is independently re-verifiable on a schedule defined by the relevant regulation.

## Tier-by-tier requirements

### Tier 0 — Anonymous

The defining property of Tier 0 is **no PII collected**. The user is identified to the system by their passkey credential ID and (optionally) an email. No phone, no address, no government ID.

**Requirements:**
- `[REQ-ID-T0-001]` Tier 0 signup must succeed with only a passkey credential — email is optional
- `[REQ-ID-T0-002]` System must enforce the $1K/30-day P2P transfer cap and the no-securities restriction at the transaction layer, not the UI layer
- `[REQ-ID-T0-003]` Tier 0 users in restricted jurisdictions (sanctioned countries) are blocked at IP/device level pre-account-creation
- `[REQ-ID-T0-004]` Inbound USDC from sanctioned addresses (TRM Labs / Chainalysis screening) is rejected at the wallet layer

### Tier 1 — Light verified

Adds phone number (SMS OTP verified) and email (if not provided at Tier 0). Phone serves as one factor of recovery and as a uniqueness check (one Bankai account per verified phone, soft-enforced).

**Requirements:**
- `[REQ-ID-T1-001]` Phone verification via SMS OTP using a provider that supports global SMS delivery (Twilio Verify or equivalent)
- `[REQ-ID-T1-002]` Email verification via OTP or magic link
- `[REQ-ID-T1-003]` Phone numbers are stored hashed in the primary database; the raw number is held only in the auth service's encrypted store
- `[REQ-ID-T1-004]` Phone-based rate limiting: max 5 SMS sends to a number per hour, 20 per day

### Tier 2 — KYC verified

The full KYC tier. Four acceptance paths in order of UX quality:

1. **Apple Wallet ID / Google Wallet ID** (where available — US driver's licenses from supported states, expanding internationally) — fastest path, ~5s
2. **ISO/IEC 18013-5 mDL** from any supported issuer — same UX as above where available
3. **Verifiable Credential** from a trusted issuer (employer, university, government) — variable
4. **Document + selfie + liveness IDV** via Persona, Onfido, or Stripe Identity — fallback, ~60-120s

Whichever path is used, the system extracts: full legal name, date of birth, address, government ID number, and a confidence-scored match to the user's selfie or device-attested identity.

**Requirements:**
- `[REQ-ID-T2-001]` System supports all four verification paths and routes the user to the best available based on their device, jurisdiction, and prior selection
- `[REQ-ID-T2-002]` Verification result includes a confidence score; scores below a configurable threshold trigger human review (agent-assisted, see Module 08)
- `[REQ-ID-T2-003]` PII collected at Tier 2 is encrypted at rest with field-level encryption; only the last-4 of government ID is stored in plaintext-indexed columns
- `[REQ-ID-T2-004]` Re-verification cadence is configurable per jurisdiction (US: every 5 years; some EU: every 3 years; some EM: every 2 years)
- `[REQ-ID-T2-005]` OFAC/sanctions screening runs on Tier 2 completion and on a daily rescreen of all Tier 2+ users

### Tier 3 — Accredited investor

Required for Reg D 506(c), Reg S, and certain private credit and real estate offerings. Verification through **Parallel Markets** or **VerifyInvestor**, both of which integrate with Securitize for institutional issuance.

Three accreditation paths under US Reg D:
1. Income ($200K solo / $300K joint, two years)
2. Net worth ($1M excluding primary residence)
3. Professional certifications (Series 7, 65, 82)

**Requirements:**
- `[REQ-ID-T3-001]` Accreditation status is verified at the platform layer, not self-attested
- `[REQ-ID-T3-002]` Accreditation expires per applicable regulation (typically annually) and re-verification is required to maintain
- `[REQ-ID-T3-003]` System supports non-US accredited frameworks (UK FCA, Singapore MAS, etc.) where we operate

### Tier 4 — Lending qualified

Out of scope for v1. Documented here for completeness; see [Module 10](./10-roadmap-and-phasing.md) for when this comes online.

## Authentication

### Primary auth: passkey-first

All client surfaces use WebAuthn passkeys as the primary credential. Apple, Google, and 1Password all sync passkeys across a user's devices, which solves the "I got a new phone" problem for the majority case.

**Requirements:**
- `[REQ-AUTH-001]` Mobile clients use platform passkey APIs (`ASAuthorizationController` on iOS, `CredentialManager` on Android)
- `[REQ-AUTH-002]` Web client uses standard WebAuthn with `navigator.credentials.create()` and `.get()`
- `[REQ-AUTH-003]` System supports multiple passkeys per account; users can register additional devices
- `[REQ-AUTH-004]` Passwords are never collected or stored — there is no password reset flow
- `[REQ-AUTH-005]` Failed authentication attempts are rate-limited per account (max 10/hour) and per IP

### Recovery

Three layers of progressively more constrained recovery:

1. **Passkey sync** (default) — user signs in on a new device using their existing passkey synced via iCloud Keychain, Google Password Manager, or 1Password. No special flow needed.
2. **Cross-device bootstrap via SMS OTP** — if user has lost access to their passkey but still has their verified phone, an SMS OTP allows them to register a new passkey. This flow triggers a **24-hour withdrawal hold** to mitigate SIM-swap attacks.
3. **Wallet key recovery (MetaMask Embedded Wallets / Web3Auth recovery)** — for users whose wallet key shares need to be reconstructed. This is a separate flow from auth recovery and is rate-limited and supervised.

**Requirements:**
- `[REQ-AUTH-006]` SMS OTP recovery requires (a) prior phone verification (Tier 1+), (b) device-attestation of the new device, (c) automatic 24-hour withdrawal hold
- `[REQ-AUTH-007]` Recovery flows are logged to the audit trail (Module 09) and notification is sent to user's email + any other registered device
- `[REQ-AUTH-008]` After recovery, all prior passkeys remain active until the user explicitly revokes them in Account settings
- `[REQ-AUTH-009]` Rate limit: max 3 SMS recovery attempts per phone per day

### Step-up authentication

Certain actions require step-up auth beyond the standard biometric/passkey signature for a transaction:

- Withdraw to external wallet over $10K
- Disable 2FA or remove a passkey
- Change linked phone number
- Transfer outside of recipient allowlist over $50K (Tier 3+)

Step-up is implemented as a second WebAuthn signature with a `userVerification: required` flag, ensuring the biometric is freshly checked.

## Sanctions and AML

Detailed in [Module 09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md). Summary here:

- All Tier 0+ accounts screened against OFAC SDN and consolidated sanctions lists on creation
- Daily rescreen of all accounts (Tier 0 by IP/device, Tier 1+ by phone, Tier 2+ by name + DOB + ID)
- Inbound and outbound on-chain transfers screened against TRM Labs or Chainalysis address risk database
- Transaction monitoring (Comply Advantage or similar) runs on all money movement above configurable thresholds
- SAR / STR filings handled by compliance team with agent-drafted narratives (Module 08)

## Onboarding metrics

What we measure to know whether the funnel is healthy:

| Metric | Target at v1 launch | Target at v2 |
|---|---|---|
| Tier 0 signup completion rate (app open → wallet created) | ≥85% | ≥90% |
| Tier 0 → first USDC receive | ≥40% within 7 days | ≥55% |
| Tier 0 → Tier 2 conversion (when prompted) | ≥60% | ≥75% |
| Tier 2 verification success rate | ≥92% (≤8% fall to manual review) | ≥95% |
| Median time from Tier 0 signup to Tier 2 (when user wants to upgrade) | ≤2 min | ≤45s |
| Recovery success rate (when user initiates) | ≥80% | ≥90% |

## Open questions

- `[Q-ID-001]` Do we support pseudonymous handles (e.g., `@alice`) that map to a Hedera address, and if so, are these visible across the network or only after a recipient has been "added"?
- `[Q-ID-002]` Final selection of IDV vendor — Persona, Onfido, or Stripe Identity. Persona is current frontrunner but Stripe Identity has tighter integration with potential card-issuer partner.
- `[Q-ID-003]` Should Tier 0 users in the US be able to buy non-security NFTs (Pokemon cards, gaming items) up to a dollar cap, or is this gated to Tier 1+?

## Cross-references

- For wallet key management mechanics, see [04 — Wallet & Custody](./04-wallet-and-custody.md)
- For the compliance matrix that drives these tier definitions, see [09 — Compliance & Jurisdictions](./09-compliance-and-jurisdictions.md)
