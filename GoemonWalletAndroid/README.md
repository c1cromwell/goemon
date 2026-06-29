# Goemon Wallet — Android (fast-follow)

Kotlin/Compose scaffold for PRD parity with the iOS wallet (`GoemonWallet/`). Phase A
launch can ship iOS-first; this module tracks the Android fast-follow.

## Stack

- Kotlin 1.9+, Jetpack Compose
- Android Keystore (Ed25519 for VP signing; Hedera key in Keystore)
- OID4VP consent flow + Hiero SDK for Hedera build/sign/submit

## Setup

1. Open `GoemonWalletAndroid/` in Android Studio (Giraffe+).
2. Sync Gradle; set `API_BASE_URL` in `local.properties` (default `http://10.0.2.2:3001` for emulator).
3. Run on emulator or device with `HEDERA_ENABLED=true` backend.

## Parity checklist (mirror iOS)

- [ ] Passkey / WebAuthn via Credential Manager API
- [ ] `did:key` P-256 VP signer (Keystore)
- [ ] Hedera non-custodial: `POST /api/hedera/transfer/build` → sign → `submit` with `signatureHex`
- [ ] Receive: Hedera account id + HIP-583 EVM alias + QR
- [ ] OID4VP deep link consent

## Build

```bash
cd GoemonWalletAndroid
./gradlew assembleDebug
```

See `docs/LAUNCH.md` blocker B1 — Android is fast-follow, not a Phase A hard blocker.
