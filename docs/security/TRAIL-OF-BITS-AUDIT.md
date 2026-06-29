# Trail of Bits — wallet security audit (Q-WALLET-001)

**Status:** ENGAGEMENT PLANNED — not yet scheduled.

## Decision

| Field | Value |
|---|---|
| **Firm** | Trail of Bits |
| **Rationale** | Prior Hedera ecosystem work; strong mobile + cryptography practice |
| **Scope** | Phase 10 iOS wallet (`ArgusWallet/`), Android fast-follow (`ArgusWalletAndroid/`), Hedera build/sign/submit, OID4VP VP signing, key backup posture |
| **Second opinion** | Cure53 or NCC Group (optional second pass before broad beta) |

## In-scope artifacts

- `ArgusWallet/` — Secure Enclave P-256, VP JWT, Hedera non-custodial send
- `backend/src/routes/hedera.ts` — transfer build/submit, device pubkey acceptance
- `backend/src/services/keyVaultService.ts` — operator key wrap (not user keys)
- `ArgusWalletAndroid/` — Keystore signing scaffold

## Out of scope (Phase A)

- Smart contract audits (no production ERC-3643 deploy)
- Partner bank / card PCI scope
- Full backend penetration test (separate engagement at Phase B)

## Deliverables requested

1. Threat model: non-custodial wallet + server-assisted Hedera paymaster
2. Code review of signing paths (no private key in server process for user txs)
3. OID4VP / deep-link consent review
4. Remediation ticket list with severity
5. Re-test of critical fixes before App Store beta

## Timeline (target)

| Milestone | Target |
|---|---|
| Engage ToB | After iOS `verify-ios-wallet.sh` compile PASS |
| Report | Before TestFlight external beta |
| Re-test | Before public launch |

## Checklist

- [ ] SOW signed
- [ ] Source access granted (private repo read)
- [ ] Testnet credentials for reproduction
- [ ] Findings tracked in issue tracker
- [ ] B7 sign-off in `docs/LAUNCH.md`

## Related

- `docs/goeman_prdv1/11-open-questions-and-risks.md` — Q-WALLET-001
- `docs/LAUNCH.md` — blocker B1, B7
- `scripts/verify-ios-wallet.sh`
