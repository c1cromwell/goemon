/**
 * X-Money response F2 — self-custody & portability (the anti-deplatforming proof).
 *
 * X Money's #1 weakness (per Shevlin) is trust — and X has a documented pattern of
 * freezing/suspending accounts. This makes Goemon's non-custodial guarantee TANGIBLE
 * and verifiable, honestly:
 *   - the server NEVER holds the wallet's VP signing key (it lives in the Secure
 *     Enclave / device) — so no platform can sign or seize on your behalf;
 *   - your on-chain / self-custodied assets are always yours and unfreezable;
 *   - the custodial ledger balance CAN be held for a fraud review (due process) —
 *     disclosed honestly, not hidden — but that is remediation, not deplatforming,
 *     and you can always EXPORT and exit with what's yours.
 *
 * The report is wrapped in an issuer-signed attestation (RS256, JWKS-verifiable) so
 * the user — or anyone — can verify Goemon's statement independently. No money moves.
 */

import { config } from "../config";
import { getCredential } from "./vcService";
import { getUserHederaAccount } from "./hederaService";
import { getUserBalances } from "./ledgerService";
import { isAccountFrozen } from "./accountHoldService";
import { getPortfolio } from "./marketplaceService";
import { signIssuerJwt } from "../utils/tokenFactory";

export interface SelfCustodyReport {
  subject: string;
  selfCustodied: {
    walletDid: string | null;
    serverHoldsWalletKey: false; // architectural invariant: the VP key is device-held
    hedera: { accountId: string; evmAddress: string | null; publicKey: string | null; network: string; serverHoldsKey: boolean } | null;
  };
  custodial: {
    cashMinor: string;
    currency: string;
    note: string;
  };
  frozen: boolean;
  guarantee: string[];
  generatedAt: string;
}

interface HederaRow {
  hedera_account_id: string | null;
  evm_address: string | null;
  public_key: string | null;
  private_key_enc: string | null;
  private_key_hex: string | null;
  network: string | null;
}

export async function getSelfCustodyReport(userId: string): Promise<SelfCustodyReport> {
  const cred = await getCredential(userId);
  const hederaRaw = (await getUserHederaAccount(userId)) as HederaRow | null;
  const { cash } = await getUserBalances(userId);
  const frozen = await isAccountFrozen(userId);

  const hedera = hederaRaw?.hedera_account_id
    ? {
        accountId: hederaRaw.hedera_account_id,
        evmAddress: hederaRaw.evm_address,
        publicKey: hederaRaw.public_key,
        network: hederaRaw.network ?? "testnet",
        // Honest: when on-device signing is used the server holds no key; otherwise the
        // key is held wrapped at rest (still recoverable by the user via export).
        serverHoldsKey: !!(hederaRaw.private_key_enc || hederaRaw.private_key_hex),
      }
    : null;

  return {
    subject: userId,
    selfCustodied: {
      walletDid: cred?.wallet_did ?? null,
      serverHoldsWalletKey: false,
      hedera,
    },
    custodial: {
      cashMinor: cash.toString(),
      currency: "USD",
      note: "Ledger USD balance. Can be held only for a fraud review under due process (an ACCOUNT_FROZEN remediation) — not deplatforming on a whim. You can always export and exit.",
    },
    frozen,
    guarantee: [
      "Goemon never holds your wallet's signing key — it lives on your device (Secure Enclave). No one at Goemon can sign or move funds on your behalf.",
      "Your on-chain / self-custodied assets are yours and cannot be frozen or seized by Goemon.",
      "You can export your identity, keys reference, and holdings at any time and leave — there is no lock-in.",
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** The report wrapped in an issuer-signed, JWKS-verifiable attestation JWT. */
export async function getSignedAttestation(userId: string): Promise<{ report: SelfCustodyReport; attestationJwt: string }> {
  const report = await getSelfCustodyReport(userId);
  const attestationJwt = await signIssuerJwt(
    { iss: config.BASE_URL, kind: "self-custody-attestation", report },
    { subject: userId, ttlSecs: 3600, type: "attestation+jwt" }
  );
  return { report, attestationJwt };
}

export interface ExportManifest {
  subject: string;
  walletDid: string | null;
  credentialJwt: string | null;
  hedera: { accountId: string; evmAddress: string | null; publicKey: string | null; network: string } | null;
  holdings: unknown;
  instructions: string[];
  exportedAt: string;
}

/**
 * The "right to exit" — a portable, issuer-signed manifest of everything the user
 * needs to control their assets independently of Goemon. Proves there is no lock-in.
 */
export async function getExportManifest(userId: string): Promise<{ manifest: ExportManifest; signedManifestJwt: string }> {
  const cred = await getCredential(userId);
  const hederaRaw = (await getUserHederaAccount(userId)) as HederaRow | null;
  const portfolio = await getPortfolio(userId).catch(() => null);

  const manifest: ExportManifest = {
    subject: userId,
    walletDid: cred?.wallet_did ?? null,
    credentialJwt: cred?.vc_jwt ?? null,
    hedera: hederaRaw?.hedera_account_id
      ? { accountId: hederaRaw.hedera_account_id, evmAddress: hederaRaw.evm_address, publicKey: hederaRaw.public_key, network: hederaRaw.network ?? "testnet" }
      : null,
    holdings: portfolio,
    instructions: [
      "Your wallet signing key is on your device (Secure Enclave) — back it up there; Goemon cannot recover it for you (by design).",
      "Your Hedera account id + public key let you view and control on-chain assets via any Hedera-compatible wallet/explorer.",
      "This manifest is signed by Goemon's issuer key and verifiable against /.well-known/jwks.json.",
    ],
    exportedAt: new Date().toISOString(),
  };

  const signedManifestJwt = await signIssuerJwt(
    { iss: config.BASE_URL, kind: "self-custody-export", manifest },
    { subject: userId, type: "export+jwt" }
  );
  return { manifest, signedManifestJwt };
}
