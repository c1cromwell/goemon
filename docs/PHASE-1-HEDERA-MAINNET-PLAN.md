# Phase 1 — Hedera Mainnet + Custody: Plan

Companion to `docs/business/TOKENIZATION-GO-LIVE-STRATEGY.md` §7.2/§7.3 and the Phase-0
runbook. Moves the money path from testnet-default to a real mainnet operator with
production key custody, real Mirror-Node reconciliation, and a tiny-amount end-to-end proof —
all behind the existing kill-switches (`HEDERA_ENABLED` default off).

## Decisions locked (2026-07-08)

| Decision | Choice | Consequence |
|---|---|---|
| Operator/paymaster key custody | **KMS asymmetric signing — key never in memory** | ECDSA secp256k1 key in GCP Cloud KMS; sign via `Client.setOperatorWith` + a KMS `HsmBackend`. Truly closes invariant *m* for the crown key. |
| Per-user key custody | **keyvault now → ondevice later** | Launch with KMS-encrypted server-side keys (`HEDERA_SIGNER=keyvault`); migrate to Secure-Enclave `ondevice` (build/submit) once the wallet is verified. |
| USDC token | **self-issued test HTS token first** | Prove transfer/escrow/reconciliation plumbing at ~$0.001/tx, then swap `HEDERA_USDC_TOKEN_ID` to native Circle USDC-HTS. |
| Mirror Node | **public now, self-host later** | Public `mirrornode.hedera.com` + backoff for launch volume; self-host on GKE when reconciliation approaches the ~50 req/s cap. |

## The load-bearing technical finding (de-risked locally)

**Hedera ECDSA secp256k1 signatures are over `keccak256(txBytes)`, not `sha256`.** Verified
empirically: `PrivateKey.generateECDSA().sign(msg)` produces a 64-byte compact `r‖s`
signature that verifies against `keccak256(msg)` (and fails against `sha256`).

GCP Cloud KMS secp256k1 keys are `EC_SIGN_SECP256K1_SHA256`, so KMS *appears* SHA-256-only —
**but** `asymmetricSign` accepts a pre-computed 32-byte digest in `digest.sha256`, and ECDSA
signs those 32 bytes regardless of how they were derived. So the signer:

1. receives the raw tx bytes from Hedera's `signWith(publicKey, signer)`;
2. computes `keccak256(bytes)` in-process (32 bytes);
3. calls KMS `asymmetricSign({ name, digest: { sha256: keccakDigest } })`;
4. gets a DER-encoded ECDSA signature back, converts **DER → 64-byte raw `r‖s`**, and
   **low-S-normalizes** it (secp256k1 requires canonical low-S; KMS may return high-S);
5. returns the 64 bytes — the private key never leaves KMS.

This is unit-testable end-to-end without touching real KMS: simulate KMS with a local
secp256k1 key that signs the keccak digest and emits DER; run it through the converter; then
assert Hedera's own `PublicKey.verify(bytes, rawSig)` accepts the result. That proves every
step except the literal network call.

## Build sequence (code touch-points)

**1 — KMS signer backend (buildable now).** New `src/services/kmsSignerBackend.ts`:
- `gcpKmsSignerBackend()` implementing the existing `HsmBackend` interface
  (`signerService.ts:32`) — lazy-requires `@google-cloud/kms`, signs the keccak digest via
  `asymmetricSign`, returns raw `r‖s`.
- Pure helpers: `keccak256`, `derToRawSignature`, `lowSNormalize` — each unit-tested.
- Wire at boot: when `HEDERA_SIGNER=hsm`, `setHsmBackend(gcpKmsSignerBackend())`. The
  per-user `hsm` path (`signerService.hsmSignerFor`) already calls it via `signWith`.

**2 — Operator via KMS (buildable now, money-path careful).** In `hederaService.initHedera()`:
- New config `HEDERA_OPERATOR_KMS_KEY` (KMS key resource name) + `HEDERA_OPERATOR_PUBLIC_KEY`
  (compressed ECDSA pubkey). When set, call
  `client.setOperatorWith(operatorId, publicKey, (bytes) => kmsBackend.sign(keyRef, bytes))`
  instead of `setOperator(id, privKey)` — the operator key never enters the process.
- Keep `resolveOperatorKey` (KMS envelope) as the fallback path for dev/testnet.
- Config: prod-fatal if `HEDERA_ENABLED` on mainnet with neither a wrapped key nor a KMS
  signing key configured.

**3 — Reconciliation against the public Mirror Node.** `reconciliationService` already takes
an injectable chain-balance provider. Add a real `mirrorNodeBalanceProvider` (fetch
`/api/v1/accounts/{id}/tokens?token.id=...`) with exponential backoff + a low request rate;
wire it when `HEDERA_ENABLED`. Self-hosting is a later swap (same interface).

**4 — Test HTS token bootstrap.** A script `npm run hedera:mint-test-usdc` that creates an
HTS fungible token on mainnet (6 dp, matching USDC micro-units) and prints the token id to set
as `HEDERA_USDC_TOKEN_ID`. Swap to Circle native USDC-HTS once flows are green.

**5 — Threshold KeyList (invariant m, belt-and-suspenders).** For the treasury/issuer
accounts, use a native Hedera **m-of-n KeyList** (no contract) so no single key compromise
moves funds. Document the key ceremony; this is operational, not much code.

**6 — Tiny-amount mainnet acceptance test.** `npm run hedera:live-check` (mirrors the
`temporal:live-check` pattern): provision a throwaway account, associate the token, transfer a
few micro-units operator→account and back, confirm the ledger journal balances, and confirm
`reconciliationService` sees zero drift against the Mirror Node.

## Prerequisites (you provide)

- Phase-0 Terraform applied to a real GCP project (Cloud KMS key exists).
- A **funded Hedera mainnet operator account** (HBAR for fees; ~$0.05 to create).
- An **ECDSA secp256k1 key in Cloud KMS** for the operator, and the operator account's
  key set to that public key (or created with it). *Note: this is a different KMS key from the
  Phase-0 symmetric ENCRYPT_DECRYPT key — it's an asymmetric `EC_SIGN_SECP256K1_SHA256` key.*
- ADC credentials with `roles/cloudkms.signerVerifier` on that signing key.

## Custody model after Phase 1

```
Operator/paymaster key  → Cloud KMS asymmetric (EC_SIGN_SECP256K1_SHA256), never in memory
                          + optional Hedera threshold KeyList on treasury/issuer accounts
Per-user keys (launch)  → Cloud KMS symmetric envelope at rest (Phase-0 gcpKmsProvider)
Per-user keys (later)   → ondevice: Secure Enclave, server holds nothing (build/submit)
Issuer JWK              → Cloud KMS symmetric envelope at rest (Phase-0)
```

## Buildable now vs gated on external resources

- **Now (no GCP/mainnet needed):** the KMS signer backend + keccak/DER/low-S helpers + tests;
  the `setOperatorWith` wiring + config (behind flags, unit-tested with a fake backend); the
  Mirror-Node provider (tested against recorded fixtures); the test-token + live-check scripts.
- **Gated on you:** applying Terraform, creating the funded mainnet account + the asymmetric
  KMS key, running `hedera:live-check` on mainnet (the only step that proves KMS-produced
  signatures are accepted by consensus — the acceptance gate).

## Risks

- **DER→raw / low-S correctness** — mitigated by the local test that round-trips through
  Hedera's own verifier. If mainnet rejects a signature, it's almost certainly the digest or
  S-normalization; the live-check isolates it on tiny amounts.
- **KMS latency per signature** — every operator-signed tx is a KMS round-trip (~10–30ms).
  Fine at launch volume; cache nothing secret. Watch p99 on the money path.
- **Operator = paymaster = single hot key** — the threshold KeyList (step 5) is the real
  mitigation; do it before any material treasury balance sits on the account.
