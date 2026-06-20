# Argus Wallet (iOS) — Phase 10

A native SwiftUI wallet: it holds the user's keys on-device, stores their
Verifiable Credential in the Keychain, signs Verifiable Presentations with a
Secure-Enclave key (Face ID), and manages an on-chain (Hedera) USDC balance.

> **Status: reviewed-but-unverified source.** This was authored without macOS/Xcode
> available in the build environment, so it has **not been compiled or run**. Treat
> it as a faithful implementation of the Phase 10 spec to be opened in Xcode,
> wired into a project, and iterated. The security-critical logic (Secure-Enclave
> key, Keychain VC storage, did:key encoding, VP JWT structure) mirrors the
> backend contract that the Phase 11 agent app already verifies end-to-end.

## Source layout

```
ArgusWallet/
  ArgusWalletApp.swift        TabView (Setup · Credential · Wallet · Activity) + deep links
  Config.swift                 API base (from Info.plist), client DID
  Info.plist                   URL schemes, Face ID string, localhost ATS, ARGUS_API_BASE
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

## Build (in Xcode, on macOS)

1. New Xcode project → iOS App → SwiftUI, name `ArgusWallet`, bundle id
   `com.argusfinancial.wallet`. Delete the generated `ContentView.swift` and the
   auto-generated Info.plist.
2. Add all files under `ArgusWallet/` to the target (keep the folder groups).
3. Build settings: set **INFOPLIST_FILE** to `ArgusWallet/Info.plist` and turn
   **GENERATE_INFOPLIST_FILE = NO** (Phase 14 invariant p — no generated plist).
4. Signing & Capabilities: a development team (Secure Enclave needs a real device;
   the simulator falls back to a software key, clearly flagged in the UI).
5. Run the backend (`cd backend && npm run dev`) and seed (`npm run setup`). On a
   simulator, `localhost` resolves to the host; on a device, set `ARGUS_API_BASE`
   to your Mac's LAN IP.

## How it maps to the backend security model

- **Setup** authenticates (dev password), creates the **Secure-Enclave P-256 VP
  key** on first use, issues the VC (`POST /api/credentials/issue`), stores it in
  the **Keychain**, and binds the wallet did:key (`POST /api/credentials/bind-wallet`).
- **Consent** (deep link `argus-wallet://present?nonce=…&aud=…&client_did=…&scope=…`)
  shows the requesting agent + scopes, signs a VP with Face ID, and posts it to
  `POST /api/present`, which mints a **90s scoped token** (the same path the Phase 11
  agent app verifies).
- **Wallet** provisions a Hedera account, shows the USDC balance, Receive (QR), Send.

## Known gaps / honest deviations

- **Unverified build** — see the status note above.
- **Hedera key custody.** The Secure Enclave only supports P-256, not Ed25519 or
  secp256k1, so the Hedera key cannot live in the Enclave. It is an Ed25519
  software key in the Keychain. (The **VP signing key is** in the Enclave.)
- **On-device Hedera signing.** The non-custodial `build → sign → submit` split is
  implemented server-side: `POST /api/hedera/transfer/build` and `/submit` (migration
  026, `hedera-build-submit.test.ts`). `HederaService.send` still falls back to the
  server-signed `POST /api/hedera/transfer` until the Swift client is wired to build/submit.
- **OID4VP token relay — IMPLEMENTED (server side).** `/api/present` now also parks the
  scoped token keyed by the single-use nonce; the requesting agent fetches it once via
  `GET /api/present/token/:nonce` (single-use + 120s TTL). The wallet flow is unchanged
  (it still just POSTs the signed VP), so a real native-wallet→agent handoff now works
  without the embedded bridge the browser demo uses. (Backend: `present_relay_tokens`,
  migration 025, `present-relay.test.ts`.)
- **OID4VCI** is simplified: the credential-offer deep link issues the VC directly
  for a signed-in user rather than running the full pre-authorized-code exchange.
- **Auth** uses dev password login; production would use passkeys (WebAuthn).
