/**
 * Phase 5 — Hedera integration service.
 *
 * Architecture notes:
 *   - The operator account (HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY) is the
 *     paymaster: it sponsors all HBAR fees for account creation and transfers.
 *   - Each user gets a unique ED25519 key pair at account creation time.
 *     The private key is stored in hedera_accounts.private_key_hex for the
 *     TypeScript prototype only. Production uses on-device keys (Phase 9).
 *   - USDC is an HTS token. setMaxAutomaticTokenAssociations(10) on creation
 *     handles USDC auto-association without a separate transaction.
 *   - Every on-chain USDC transfer also posts a matching double-entry ledger
 *     journal (USDC currency) to keep the internal ledger in sync.
 *
 * All functions are no-ops / throw NOT_IMPLEMENTED when HEDERA_ENABLED=false.
 */

import { v4 as uuidv4 } from "uuid";
import {
  Client,
  PrivateKey,
  AccountId,
  TokenId,
  Hbar,
  AccountCreateTransaction,
  AccountBalanceQuery,
  TransferTransaction,
} from "@hashgraph/sdk";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { hederaTxTotal } from "../observability/metrics";
import { getOrCreateUserAccount, getSystemAccount, postJournal } from "./ledgerService";
import { getUserById } from "./authService";
import { assertSettlementUngated } from "./reconciliationService";
import { getKeyVault, isWrapped } from "./keyVaultService";
import { hasSignerKey, getHederaSigner } from "./signerService";

/** AAD binding the paymaster/operator key to its purpose in the key vault. */
const OPERATOR_KEY_AAD = "hedera:operator";

export interface HederaAccountRow {
  id: string;
  user_id: string;
  hedera_account_id: string | null;
  evm_address: string | null;
  public_key: string | null;
  /** Legacy plaintext DER key. Null for accounts created after Phase-20 key wrapping. */
  private_key_hex: string | null;
  /** Wrapped DER key (keyVaultService). The custody-safe store going forward. */
  private_key_enc: string | null;
  usdc_associated: number;
  network: string;
  created_at: string;
}

// Per-user key custody + signing live in signerService (keyvault / hsm / ondevice).
// hasSignerKey + getHederaSigner are imported above.

let hederaClient: Client | null = null;
let operatorKey: PrivateKey | null = null;

export function isHederaEnabled(): boolean {
  return config.HEDERA_ENABLED;
}

/**
 * Phase 20 — resolve the paymaster/operator key. HEDERA_OPERATOR_KEY may be either a
 * raw DER string (dev) or a vault-wrapped blob (gcm.v1., the production posture — see
 * config.productionFatals). Unwrapped once at boot and cached.
 */
export async function resolveOperatorKey(): Promise<PrivateKey> {
  const raw = config.HEDERA_OPERATOR_KEY;
  if (!raw) throw new AppError(ErrorCode.VALIDATION, "HEDERA_OPERATOR_KEY is not configured");
  const der = isWrapped(raw) ? await getKeyVault().unwrap(raw, { aad: OPERATOR_KEY_AAD }) : raw;
  return PrivateKey.fromStringDer(der);
}

function getOperatorKey(): PrivateKey {
  if (!operatorKey) throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Hedera operator key not initialized");
  return operatorKey;
}

function assertEnabled(): Client {
  if (!hederaClient) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Hedera integration is not enabled on this server");
  }
  return hederaClient;
}

/** Call once during server bootstrap when HEDERA_ENABLED=true. */
export async function initHedera(): Promise<void> {
  if (!config.HEDERA_ENABLED) return;

  const operatorId = AccountId.fromString(config.HEDERA_OPERATOR_ID!);
  operatorKey = await resolveOperatorKey();

  switch (config.HEDERA_NETWORK) {
    case "mainnet":
      hederaClient = Client.forMainnet();
      break;
    case "previewnet":
      hederaClient = Client.forPreviewnet();
      break;
    default:
      hederaClient = Client.forTestnet();
  }

  hederaClient.setOperator(operatorId, operatorKey);
}

/** Fetch the user's Hedera account row from the DB, or null if none. */
export async function getUserHederaAccount(userId: string): Promise<HederaAccountRow | null> {
  return getDb().queryOne<HederaAccountRow>(
    "SELECT * FROM hedera_accounts WHERE user_id = ?",
    [userId]
  );
}

const BUILD_TTL_MS = 5 * 60 * 1000;

interface TransferTarget {
  toHederaAccountId: string;
  toUserId?: string;
}

async function resolveTransferTarget(input: {
  toUserId?: string;
  toHederaAccountId?: string;
}): Promise<TransferTarget> {
  if (!input.toUserId && !input.toHederaAccountId) {
    throw new AppError(ErrorCode.VALIDATION, "Provide either toUserId or toHederaAccountId");
  }
  if (input.toUserId && input.toHederaAccountId) {
    throw new AppError(ErrorCode.VALIDATION, "Provide toUserId or toHederaAccountId, not both");
  }

  if (input.toUserId) {
    const toUser = await getUserById(input.toUserId);
    if (!toUser) throw new AppError(ErrorCode.NOT_FOUND, "Recipient user not found");
    const recipientAccount = await getUserHederaAccount(input.toUserId);
    if (!recipientAccount?.hedera_account_id) {
      throw new AppError(ErrorCode.NOT_FOUND, "Recipient has no Hedera account");
    }
    return { toHederaAccountId: recipientAccount.hedera_account_id, toUserId: input.toUserId };
  }

  return { toHederaAccountId: input.toHederaAccountId! };
}

async function postUsdcTransferJournal(input: {
  fromUserId: string;
  toUserId?: string;
  amountMicro: bigint;
  transactionId: string;
  idempotencyKey?: string;
}): Promise<string> {
  const senderLedgerId = await getOrCreateUserAccount(input.fromUserId, "user_cash", "USDC");
  const receiverLedgerId = input.toUserId
    ? await getOrCreateUserAccount(input.toUserId, "user_cash", "USDC")
    : await getSystemAccount("external_clearing", "USDC");

  return postJournal(
    [
      { ledgerAccountId: senderLedgerId, direction: "debit", amountMinor: input.amountMicro, currency: "USDC" },
      { ledgerAccountId: receiverLedgerId, direction: "credit", amountMinor: input.amountMicro, currency: "USDC" },
    ],
    `USDC on-chain transfer: ${input.transactionId}`,
    { idempotencyKey: input.idempotencyKey, externalRef: input.transactionId }
  );
}

interface TransferBuildRow {
  id: string;
  user_id: string;
  to_hedera_account_id: string;
  to_user_id: string | null;
  amount_micro: string | number;
  frozen_tx_bytes: string;
  idempotency_key: string | null;
  status: string;
  transaction_id: string | null;
  journal_id: string | null;
  expires_at: string;
}

/**
 * Return the user's existing Hedera account, or create one via the paymaster.
 * When `publicKeyDer` is supplied (non-custodial wallet), the account is keyed to
 * the device public key and no server-side private key is stored.
 */
export async function getOrCreateUserHederaAccount(
  userId: string,
  opts?: { publicKeyDer?: string }
): Promise<HederaAccountRow> {
  const existing = await getUserHederaAccount(userId);
  if (existing?.hedera_account_id) return existing;

  const client = assertEnabled();

  let publicKeyHex: string;
  let privateKeyEnc: string | null = null;

  if (opts?.publicKeyDer) {
    publicKeyHex = PrivateKey.fromStringDer(opts.publicKeyDer).publicKey.toStringDer();
  } else {
    const privateKey = PrivateKey.generateED25519();
    publicKeyHex = privateKey.publicKey.toStringDer();
    privateKeyEnc = await getKeyVault().wrap(privateKey.toStringDer(), { aad: userId });
  }

  const accountPublicKey = PrivateKey.fromStringDer(publicKeyHex).publicKey;

  // Paymaster (operator) funds initial HBAR and pays transaction fees.
  const txResponse = await new AccountCreateTransaction()
    .setKey(accountPublicKey)
    .setInitialBalance(new Hbar(1))
    .setMaxAutomaticTokenAssociations(10)
    .execute(client);

  const receipt = await txResponse.getReceipt(client);
  const hederaAccountId = receipt.accountId!.toString();

  const db = getDb();
  if (existing) {
    await db.execute(
      `UPDATE hedera_accounts
       SET hedera_account_id = ?, public_key = ?, private_key_enc = ?, private_key_hex = NULL, network = ?, usdc_associated = 0
       WHERE user_id = ?`,
      [hederaAccountId, publicKeyHex, privateKeyEnc, config.HEDERA_NETWORK, userId]
    );
  } else {
    await db.execute(
      `INSERT INTO hedera_accounts (id, user_id, hedera_account_id, public_key, private_key_enc, usdc_associated, network)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [uuidv4(), userId, hederaAccountId, publicKeyHex, privateKeyEnc, config.HEDERA_NETWORK]
    );
  }

  await logAudit({
    userId,
    action: "hedera.account.create",
    resource: hederaAccountId,
    details: { network: config.HEDERA_NETWORK, nonCustodial: !!opts?.publicKeyDer },
  });

  return (await getUserHederaAccount(userId))!;
}

/**
 * Query on-chain balances (HBAR in tinybars + USDC in micro-units) for a
 * Hedera account address.
 */
export async function getOnChainBalances(
  hederaAccountId: string
): Promise<{ hbarTinybars: bigint; usdcMicro: bigint }> {
  const client = assertEnabled();

  const balances = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(hederaAccountId))
    .execute(client);

  const hbarTinybars = BigInt(balances.hbars.toTinybars().toString());
  let usdcMicro = 0n;

  if (config.HEDERA_USDC_TOKEN_ID) {
    const tokenId = TokenId.fromString(config.HEDERA_USDC_TOKEN_ID);
    const tokenBalance = balances.tokens?.get(tokenId);
    if (tokenBalance != null) {
      usdcMicro = BigInt(tokenBalance.toString());
    }
  }

  return { hbarTinybars, usdcMicro };
}

/**
 * Transfer USDC on-chain from a Argus Financial Partners user to any Hedera account address,
 * then post a matching ledger journal so the internal book balance stays in sync.
 *
 * @param input.toUserId  If set, the recipient is a Argus Financial Partners user: credit their
 *                        USDC ledger account. Otherwise credit external_clearing.
 * @returns transactionId (Hedera consensus) and journalId (internal ledger)
 */
export async function transferUsdcOnChain(input: {
  fromUserId: string;
  toHederaAccountId: string;
  toUserId?: string;
  amountMicro: bigint;
  idempotencyKey?: string;
}): Promise<{ transactionId: string; journalId: string }> {
  if (!config.HEDERA_USDC_TOKEN_ID) {
    throw new AppError(ErrorCode.VALIDATION, "HEDERA_USDC_TOKEN_ID is not configured");
  }
  if (config.HEDERA_SIGNER === "ondevice") {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      "HEDERA_SIGNER=ondevice: use POST /api/hedera/transfer/build then /submit for on-device signing"
    );
  }
  await assertSettlementUngated();

  const senderAccount = await getUserHederaAccount(input.fromUserId);
  if (!senderAccount?.hedera_account_id || !hasSignerKey(senderAccount)) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Sender has no Hedera account — call POST /api/hedera/account first"
    );
  }

  const client = assertEnabled();
  const tokenId = TokenId.fromString(config.HEDERA_USDC_TOKEN_ID);
  const amount = Number(input.amountMicro);

  const frozenTx = new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(senderAccount.hedera_account_id), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(input.toHederaAccountId), amount)
    .freezeWith(client);
  const signedTx = await getHederaSigner(senderAccount).signTransaction(frozenTx);

  let transactionId: string;
  try {
    const txResponse = await signedTx.execute(client);
    await txResponse.getReceipt(client);
    transactionId = txResponse.transactionId.toString();
    hederaTxTotal.inc({ result: "success" });
  } catch (e) {
    hederaTxTotal.inc({ result: "error" });
    throw e;
  }

  const journalId = await postUsdcTransferJournal({
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    amountMicro: input.amountMicro,
    transactionId,
    idempotencyKey: input.idempotencyKey,
  });

  await logAudit({
    userId: input.fromUserId,
    action: "hedera.usdc.transfer",
    resource: transactionId,
    details: { to: input.toHederaAccountId, amountMicro: input.amountMicro.toString() },
  });

  return { transactionId, journalId };
}

/**
 * Non-custodial send — step 1: build a frozen USDC transfer for the wallet to sign.
 * The server never signs; frozen bytes are returned for on-device Ed25519 signing.
 */
export async function buildUsdcTransfer(input: {
  fromUserId: string;
  toUserId?: string;
  toHederaAccountId?: string;
  amountMicro: bigint;
  idempotencyKey: string;
}): Promise<{ buildId: string; transactionBytesBase64: string; expiresAt: string }> {
  if (!config.HEDERA_USDC_TOKEN_ID) {
    throw new AppError(ErrorCode.VALIDATION, "HEDERA_USDC_TOKEN_ID is not configured");
  }
  if (input.amountMicro <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMicro must be positive");

  const senderAccount = await getUserHederaAccount(input.fromUserId);
  if (!senderAccount?.hedera_account_id || !senderAccount.public_key) {
    throw new AppError(ErrorCode.NOT_FOUND, "Sender has no Hedera account — call POST /api/hedera/account first");
  }

  const target = await resolveTransferTarget({
    toUserId: input.toUserId,
    toHederaAccountId: input.toHederaAccountId,
  });

  const db = getDb();
  const existing = await db.queryOne<TransferBuildRow>(
    "SELECT * FROM hedera_transfer_builds WHERE idempotency_key = ?",
    [input.idempotencyKey]
  );
  if (existing) {
    if (existing.status === "submitted") {
      throw new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, "Transfer already submitted for this idempotency key");
    }
    if (new Date(existing.expires_at).getTime() > Date.now()) {
      return {
        buildId: existing.id,
        transactionBytesBase64: existing.frozen_tx_bytes,
        expiresAt: existing.expires_at,
      };
    }
  }

  const client = assertEnabled();
  const tokenId = TokenId.fromString(config.HEDERA_USDC_TOKEN_ID);
  const amount = Number(input.amountMicro);
  const frozenTx = new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(senderAccount.hedera_account_id), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(target.toHederaAccountId), amount)
    .freezeWith(client);

  const txBytes = frozenTx.toBytes();
  const transactionBytesBase64 = Buffer.from(txBytes).toString("base64");
  const buildId = uuidv4();
  const expiresAt = new Date(Date.now() + BUILD_TTL_MS).toISOString();

  await db.execute(
    `INSERT INTO hedera_transfer_builds
       (id, user_id, to_hedera_account_id, to_user_id, amount_micro, frozen_tx_bytes, idempotency_key, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      buildId,
      input.fromUserId,
      target.toHederaAccountId,
      target.toUserId ?? null,
      input.amountMicro,
      transactionBytesBase64,
      input.idempotencyKey,
      expiresAt,
      new Date().toISOString(),
    ]
  );

  await logAudit({
    userId: input.fromUserId,
    action: "hedera.usdc.transfer.build",
    resource: buildId,
    details: { to: target.toHederaAccountId, amountMicro: input.amountMicro.toString() },
  });

  return { buildId, transactionBytesBase64, expiresAt };
}

/**
 * Non-custodial send — step 2: submit wallet-signed transaction bytes and post the ledger journal.
 */
export async function submitUsdcTransfer(input: {
  fromUserId: string;
  buildId: string;
  signedTransactionBytesBase64: string;
}): Promise<{ transactionId: string; journalId: string }> {
  await assertSettlementUngated();

  const build = await getDb().queryOne<TransferBuildRow>(
    "SELECT * FROM hedera_transfer_builds WHERE id = ? AND user_id = ?",
    [input.buildId, input.fromUserId]
  );
  if (!build) throw new AppError(ErrorCode.NOT_FOUND, "Transfer build not found");
  if (build.status === "submitted" && build.transaction_id && build.journal_id) {
    return { transactionId: build.transaction_id, journalId: build.journal_id };
  }
  if (new Date(build.expires_at).getTime() <= Date.now()) {
    throw new AppError(ErrorCode.VALIDATION, "Transfer build expired — call /transfer/build again");
  }

  const client = assertEnabled();
  const signedBytes = Buffer.from(input.signedTransactionBytesBase64, "base64");
  const signedTx = TransferTransaction.fromBytes(signedBytes);

  let transactionId: string;
  try {
    const txResponse = await signedTx.execute(client);
    await txResponse.getReceipt(client);
    transactionId = txResponse.transactionId.toString();
    hederaTxTotal.inc({ result: "success" });
  } catch (e) {
    hederaTxTotal.inc({ result: "error" });
    throw e;
  }

  const amountMicro = BigInt(build.amount_micro);
  const journalId = await postUsdcTransferJournal({
    fromUserId: input.fromUserId,
    toUserId: build.to_user_id ?? undefined,
    amountMicro,
    transactionId,
    idempotencyKey: build.idempotency_key ?? undefined,
  });

  await getDb().execute(
    "UPDATE hedera_transfer_builds SET status = 'submitted', transaction_id = ?, journal_id = ? WHERE id = ?",
    [transactionId, journalId, build.id]
  );

  await logAudit({
    userId: input.fromUserId,
    action: "hedera.usdc.transfer.submit",
    resource: transactionId,
    details: { buildId: build.id, amountMicro: amountMicro.toString() },
  });

  return { transactionId, journalId };
}

// ---------------------------------------------------------------------------
// Escrow on the USDC/Hedera rail (chain-only primitives — the caller owns the
// ledger). The operator account doubles as the on-chain escrow custodian: a hold
// moves USDC payer→operator; release/refund moves operator→recipient. These do
// NOT post a ledger journal — escrowService records the txId as the journal's
// externalRef. Gated by HEDERA_ENABLED via assertEnabled().
// ---------------------------------------------------------------------------

function usdcTokenId(): TokenId {
  if (!config.HEDERA_USDC_TOKEN_ID) throw new AppError(ErrorCode.VALIDATION, "HEDERA_USDC_TOKEN_ID is not configured");
  return TokenId.fromString(config.HEDERA_USDC_TOKEN_ID);
}

/** Hold: move USDC on-chain from the payer to the operator (escrow custodian). Payer-signed. */
export async function submitEscrowHoldOnChain(payerUserId: string, amountMicro: bigint): Promise<string> {
  await assertSettlementUngated();
  const client = assertEnabled();
  const tokenId = usdcTokenId();
  const payer = await getUserHederaAccount(payerUserId);
  if (!payer?.hedera_account_id || !hasSignerKey(payer)) {
    throw new AppError(ErrorCode.NOT_FOUND, "Payer has no Hedera account — provision one first");
  }
  const amount = Number(amountMicro);
  const frozen = new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(payer.hedera_account_id), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(config.HEDERA_OPERATOR_ID!), amount)
    .freezeWith(client);
  const signed = await getHederaSigner(payer).signTransaction(frozen);
  try {
    const resp = await signed.execute(client);
    await resp.getReceipt(client);
    hederaTxTotal.inc({ result: "success" });
    return resp.transactionId.toString();
  } catch (e) {
    hederaTxTotal.inc({ result: "error" });
    throw e;
  }
}

/** Settle: move USDC on-chain from the operator (escrow custodian) to a recipient. Operator-signed. */
export async function submitEscrowSettleOnChain(recipientUserId: string, amountMicro: bigint): Promise<string> {
  await assertSettlementUngated();
  const client = assertEnabled();
  const tokenId = usdcTokenId();
  const recipient = await getOrCreateUserHederaAccount(recipientUserId); // ensure they can receive USDC
  const amount = Number(amountMicro);
  const signed = await new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(config.HEDERA_OPERATOR_ID!), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(recipient.hedera_account_id!), amount)
    .freezeWith(client)
    .sign(getOperatorKey());
  try {
    const resp = await signed.execute(client);
    await resp.getReceipt(client);
    hederaTxTotal.inc({ result: "success" });
    return resp.transactionId.toString();
  } catch (e) {
    hederaTxTotal.inc({ result: "error" });
    throw e;
  }
}

/** Look up a Argus Financial Partners user's Hedera account ID. Throws NOT_FOUND if they have none. */
export async function requireUserHederaAccountId(userId: string): Promise<string> {
  const user = await getUserById(userId);
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found");
  const account = await getUserHederaAccount(userId);
  if (!account?.hedera_account_id) {
    throw new AppError(ErrorCode.NOT_FOUND, "User has no Hedera account");
  }
  return account.hedera_account_id;
}
