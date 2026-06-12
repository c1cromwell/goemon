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

export interface HederaAccountRow {
  id: string;
  user_id: string;
  hedera_account_id: string | null;
  evm_address: string | null;
  public_key: string | null;
  private_key_hex: string | null;
  usdc_associated: number;
  network: string;
  created_at: string;
}

let hederaClient: Client | null = null;

export function isHederaEnabled(): boolean {
  return config.HEDERA_ENABLED;
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
  const operatorKey = PrivateKey.fromStringDer(config.HEDERA_OPERATOR_KEY!);

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

/**
 * Return the user's existing Hedera account, or create one via the paymaster.
 * Idempotent: calling twice returns the same account.
 */
export async function getOrCreateUserHederaAccount(userId: string): Promise<HederaAccountRow> {
  const existing = await getUserHederaAccount(userId);
  if (existing?.hedera_account_id) return existing;

  const client = assertEnabled();

  const privateKey = PrivateKey.generateED25519();
  const publicKey = privateKey.publicKey;

  // Paymaster (operator) funds initial HBAR and pays transaction fees.
  const txResponse = await new AccountCreateTransaction()
    .setKey(publicKey)
    .setInitialBalance(new Hbar(1))
    .setMaxAutomaticTokenAssociations(10)
    .execute(client);

  const receipt = await txResponse.getReceipt(client);
  const hederaAccountId = receipt.accountId!.toString();
  const privateKeyHex = privateKey.toStringDer();
  const publicKeyHex = publicKey.toStringDer();

  const db = getDb();
  if (existing) {
    await db.execute(
      `UPDATE hedera_accounts
       SET hedera_account_id = ?, public_key = ?, private_key_hex = ?, network = ?, usdc_associated = 0
       WHERE user_id = ?`,
      [hederaAccountId, publicKeyHex, privateKeyHex, config.HEDERA_NETWORK, userId]
    );
  } else {
    await db.execute(
      `INSERT INTO hedera_accounts (id, user_id, hedera_account_id, public_key, private_key_hex, usdc_associated, network)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [uuidv4(), userId, hederaAccountId, publicKeyHex, privateKeyHex, config.HEDERA_NETWORK]
    );
  }

  await logAudit({
    userId,
    action: "hedera.account.create",
    resource: hederaAccountId,
    details: { network: config.HEDERA_NETWORK },
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
  // Phase 20: drift in the last reconciliation run gates all on-chain settlement.
  await assertSettlementUngated();

  const senderAccount = await getUserHederaAccount(input.fromUserId);
  if (!senderAccount?.hedera_account_id || !senderAccount.private_key_hex) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "Sender has no Hedera account — call POST /api/hedera/account first"
    );
  }

  const client = assertEnabled();
  const tokenId = TokenId.fromString(config.HEDERA_USDC_TOKEN_ID);
  const senderKey = PrivateKey.fromStringDer(senderAccount.private_key_hex);
  // Safe cast: USDC micro-units fit in Number for any realistic transfer amount.
  const amount = Number(input.amountMicro);

  const signedTx = await new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(senderAccount.hedera_account_id), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(input.toHederaAccountId), amount)
    .freezeWith(client)
    .sign(senderKey);

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

  // Mirror in double-entry ledger
  const senderLedgerId = await getOrCreateUserAccount(input.fromUserId, "user_cash", "USDC");
  const receiverLedgerId = input.toUserId
    ? await getOrCreateUserAccount(input.toUserId, "user_cash", "USDC")
    : await getSystemAccount("external_clearing", "USDC");

  const journalId = await postJournal(
    [
      { ledgerAccountId: senderLedgerId, direction: "debit", amountMinor: input.amountMicro, currency: "USDC" },
      { ledgerAccountId: receiverLedgerId, direction: "credit", amountMinor: input.amountMicro, currency: "USDC" },
    ],
    `USDC on-chain transfer: ${transactionId}`,
    { idempotencyKey: input.idempotencyKey, externalRef: transactionId }
  );

  await logAudit({
    userId: input.fromUserId,
    action: "hedera.usdc.transfer",
    resource: transactionId,
    details: { to: input.toHederaAccountId, amountMicro: input.amountMicro.toString() },
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
  if (!payer?.hedera_account_id || !payer.private_key_hex) {
    throw new AppError(ErrorCode.NOT_FOUND, "Payer has no Hedera account — provision one first");
  }
  const payerKey = PrivateKey.fromStringDer(payer.private_key_hex);
  const amount = Number(amountMicro);
  const signed = await new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(payer.hedera_account_id), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(config.HEDERA_OPERATOR_ID!), amount)
    .freezeWith(client)
    .sign(payerKey);
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
  const operatorKey = PrivateKey.fromStringDer(config.HEDERA_OPERATOR_KEY!);
  const amount = Number(amountMicro);
  const signed = await new TransferTransaction()
    .addTokenTransfer(tokenId, AccountId.fromString(config.HEDERA_OPERATOR_ID!), -amount)
    .addTokenTransfer(tokenId, AccountId.fromString(recipient.hedera_account_id!), amount)
    .freezeWith(client)
    .sign(operatorKey);
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
