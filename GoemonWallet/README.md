# Goemon Wallet (iOS) — Phase 10

A native SwiftUI wallet: it holds the user's keys on-device, stores their
Verifiable Credential in the Keychain, signs Verifiable Presentations with a
Secure-Enclave key (Face ID), and manages an on-chain (Hedera) USDC balance.

> **Status: compile-verified, not App Store ready.** `scripts/verify-ios-wallet.sh`
> passes (simulator build). On-device smoke, production auth, privacy manifests, and
> account-deletion flows are still open — see **App Store submission checklist** below.
> Trail of Bits audit is planned (`docs/security/TRAIL-OF-BITS-AUDIT.md`).

## Source layout

```
GoemonWallet/
  GoemonWalletApp.swift        TabView (Setup · Credential · Wallet · Activity) + deep links
  Config.swift                 API base (from Info.plist), client DID
  Info.plist                   Bundle metadata (production keys still TODO — see checklist)
  Crypto/
    DIDKey.swift               P-256 public key → did:key:z… (base58btc + p256 multicodec)
    Base64URL.swift            JOSE base64url
    VPSigner.swift             builds + signs the VP JWT (ES256)
  Storage/Keychain.swift       Keychain wrapper (kSecClassGenericPassword)
  Services/
    KeyService.swift           Secure-Enclave VP key + Ed25519 Hedera key; Face-ID signing
    CredentialService.swift    VC JWT in Keychain; issue + holder-binding (bind-wallet)
    PresentationService.swift  OID4VP consent → /api/present → 90s scoped token
    HederaService.swift        provision account, balance, send (USDC)
    SessionStore.swift         setup-time user session (dev password login)
    APIClient.swift            async JSON client (surfaces error.code)
  Views/
    Theme.swift, SetupView, CredentialView, WalletView, ActivityView, ConsentView
```

## App Store submission checklist

**Verdict (June 2026): not ready for public submission.** Simulator compile passes;
TestFlight internal beta is achievable after P0 items. Public App Store release is
gated on auth, account deletion, privacy/legal, and financial licensing.

Track progress by checking boxes. Severity: **P0** = App Review blocker,
**P1** = required before external TestFlight, **P2** = polish / launch readiness.

### 1. Payment & IAP compliance

| | Item | Sev | Notes |
|---|---|---|---|
| [ ] | Remove demo credentials from UI | P0 | `SetupView` pre-fills `alex@demo.com` / `Demo1234!` |
| [ ] | Production HTTPS API base only | P0 | `Config.apiBase` defaults to `http://localhost:3001` |
| [ ] | Financial / crypto licensing posture documented | P0 | Guideline 3.1.5 — MSB/partner-bank licensing per `docs/legal/B6-phase-a-compliance-pack.md` |
| [ ] | App Review notes for crypto wallet scope | P1 | Explain non-custodial signing companion to licensed service |
| [ ] | Regional availability restrictions | P1 | Geo-gate if required by counsel |
| [x] | No StoreKit / IAP needed | — | App does not sell digital goods or subscriptions |

### 2. Privacy manifests & data declarations

| | Item | Sev | Notes |
|---|---|---|---|
| [ ] | Add `PrivacyInfo.xcprivacy` to app target | P0 | Required; merge Hiero SPM dependency manifests |
| [ ] | `NSFaceIDUsageDescription` in Info.plist | P0 | `LocalAuthentication` used in `KeyService`, `WalletView` |
| [ ] | Register URL schemes in `CFBundleURLTypes` | P0 | `goemon-wallet://`, `openid-credential-offer://` |
| [ ] | Privacy policy URL (in-app link + App Store Connect) | P0 | Email, session token, VC JWT, keys, transaction history |
| [ ] | App Privacy nutrition labels (Connect) | P1 | Contact info, financial info, identifiers; tracking = No |
| [ ] | `ITSAppUsesNonExemptEncryption` in Info.plist | P1 | Secure Enclave + Ed25519 + TLS — declare in Connect export compliance |
| [x] | Sensitive data in Keychain (not UserDefaults) | — | VC JWT, keys, session token |

### 3. Sign-in & account deletion

| | Item | Sev | Notes |
|---|---|---|---|
| [ ] | Replace dev password login with passkeys (WebAuthn) | P0 | Backend has `/api/auth/webauthn/*`; wallet does not |
| [ ] | Sign in with Apple | P0 | Guideline 4.8 — required alongside email/password |
| [ ] | Sign-out UI | P0 | `SessionStore.signOut()` exists but no button in any view |
| [ ] | In-app account deletion flow | P0 | Guideline 5.1.1(v) — local wipe ≠ server account deletion |
| [ ] | Backend `DELETE` account endpoint | P0 | No account-deletion API in backend yet |
| [x] | OID4VP consent before agent access | — | `ConsentView` shows agent DID + scopes; Face ID gates VP sign |

### 4. Metadata & completeness

| | Item | Sev | Notes |
|---|---|---|---|
| [ ] | App icon asset catalog (`AppIcon`, all sizes) | P0 | `ASSETCATALOG_COMPILER_APPICON_NAME` set but no `Assets.xcassets` |
| [ ] | Launch screen | P1 | Empty `UILaunchScreen` dict only |
| [ ] | `CFBundleDisplayName` ("Goemon Wallet") | P1 | Currently shows internal name `GoemonWallet` |
| [ ] | Support URL | P1 | App Store Connect required field |
| [ ] | Screenshots & App Preview | P1 | Connect assets — not in repo |
| [ ] | Age rating (likely 17+ financial/crypto) | P1 | Configure in Connect |
| [ ] | Entitlements file | P1 | Keychain Sharing, Associated Domains if using universal links |
| [ ] | Unit / UI test target | P2 | No test target in Xcode project |
| [x] | Deep link scheme documented | — | Code uses `goemon-wallet://` (not legacy `argus-wallet://`) |
| [x] | Xcode project + Hiero SPM wired | — | `project.yml` → `GoemonWallet.xcodeproj` |

### 5. Binary validation

| | Item | Sev | Notes |
|---|---|---|---|
| [x] | Simulator compile (`verify-ios-wallet.sh`) | — | `xcodebuild` generic iOS Simulator — BUILD SUCCEEDED |
| [ ] | Release archive + distribution signing | P0 | Verify script uses `CODE_SIGNING_ALLOWED=NO` |
| [ ] | TestFlight internal beta upload | P1 | After P0 plist, auth, privacy items |
| [ ] | App Store validation (Transporter / `altool`) | P1 | Run before public submission |
| [ ] | On-device smoke | P1 | Secure Enclave, Hedera build→sign→submit, OID4VP deep link, Receive QR |
| [ ] | Trail of Bits wallet audit complete | P1 | Planned — `docs/security/TRAIL-OF-BITS-AUDIT.md` (B7) |

### Priority order (implementation)

1. Info.plist — Face ID string, URL types, encryption declaration, HTTPS `GOEMON_API_BASE`
2. `PrivacyInfo.xcprivacy` + App Privacy labels
3. Remove demo defaults; production auth (passkeys + Sign in with Apple)
4. Sign-out + account deletion (backend endpoint + in-app UI)
5. App icon + launch screen + Connect metadata
6. Signed Release archive → TestFlight → ToB audit → external beta

### Related docs

- `docs/security/TRAIL-OF-BITS-AUDIT.md` — wallet security audit (B7)
- `docs/LAUNCH.md` — launch gate B1 (iOS verify)
- `docs/legal/B6-phase-a-compliance-pack.md` — Phase A compliance
- `scripts/verify-ios-wallet.sh` — compile verification

## Build (in Xcode, on macOS)

The Xcode project is generated from `project.yml` (XcodeGen). Regenerate after
source changes with:

```bash
cd GoemonWallet && xcodegen generate
```

Then open **`GoemonWallet.xcodeproj`** (not Package.swift). The target uses
`GoemonWallet/Info.plist` with **GENERATE_INFOPLIST_FILE = NO** (Phase 14
invariant p) and links the **Hiero** package (`hiero-sdk-swift` ≥ 0.49.0) for
non-custodial Hedera send (`/transfer/build` → sign → `/transfer/submit`).

1. Open `GoemonWallet.xcodeproj` in Xcode.
2. Signing & Capabilities: pick a development team (Secure Enclave needs a real
   device; the simulator falls back to a software key, clearly flagged in the UI).
3. Run the backend (`cd backend && npm run dev`) with `HEDERA_ENABLED=true` and
   `HEDERA_SIGNER=ondevice`. On a simulator, `localhost` resolves to the host; on a
   device, set `GOEMON_API_BASE` in `Info.plist` to your Mac's LAN IP.

## How it maps to the backend security model

- **Setup** authenticates (dev password), creates the **Secure-Enclave P-256 VP
  key** on first use, issues the VC (`POST /api/credentials/issue`), stores it in
  the **Keychain**, and binds the wallet did:key (`POST /api/credentials/bind-wallet`).
- **Consent** (deep link `goemon-wallet://present?nonce=…&aud=…&client_did=…&scope=…`)
  shows the requesting agent + scopes, signs a VP with Face ID, and posts it to
  `POST /api/present`, which mints a **90s scoped token** (the same path the Phase 11
  agent app verifies).
- **Wallet** provisions a Hedera account, shows the USDC balance, Receive (QR), Send.

## Known gaps / honest deviations

- **App Store readiness** — see checklist above; compile verified, submission blockers remain.
- **Hedera key custody.** The Secure Enclave only supports P-256, not Ed25519 or
  secp256k1, so the Hedera key cannot live in the Enclave. It is an Ed25519
  software key in the Keychain. (The **VP signing key is** in the Enclave.)
- **On-device Hedera signing.** Wired: `HederaService.send` calls
  `/api/hedera/transfer/build` → Hiero `signTransaction` on-device →
  `/api/hedera/transfer/submit` with `signatureHex`. Requires the **Hiero** SPM
  package and backend `HEDERA_SIGNER=ondevice`.
- **OID4VP token relay — IMPLEMENTED (server side).** `/api/present` now also parks the
  scoped token keyed by the single-use nonce; the requesting agent fetches it once via
  `GET /api/present/token/:nonce` (single-use + 120s TTL). The wallet flow is unchanged
  (it still just POSTs the signed VP), so a real native-wallet→agent handoff now works
  without the embedded bridge the browser demo uses. (Backend: `present_relay_tokens`,
  migration 025, `present-relay.test.ts`.)
- **OID4VCI** is simplified: the credential-offer deep link issues the VC directly
  for a signed-in user rather than running the full pre-authorized-code exchange.
- **Auth** uses dev password login; production would use passkeys (WebAuthn).
