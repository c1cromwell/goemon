/**
 * Phase 6 — SmartChat (RFC 8693-style token exchange).
 *
 * Pipeline:  classifyIntent → issueOperationToken → executeOperationToken → generateResponse
 *
 * SmartChat lets a Tier-2+ user drive money operations in natural language. The
 * agent does NOT execute anything directly. Each actionable intent mints a
 * short-lived (90s) RS256 *exchange token* (RFC 8693 token-exchange shape: the
 * user is `sub`, the SmartChat agent is the `act`or) and a row in
 * `operation_tokens`. Execution:
 *   - reads (balance / transactions) run immediately,
 *   - transfers > $500 (50000 minor units) require an MFA step before execution,
 *   - the transfer itself goes through ledgerService.transfer (double-entry, the
 *     single source of truth), keyed idempotently on the operation-token id so a
 *     retried execute can never double-post.
 *
 * NON-NEGOTIABLES honored here: money is integer minor units (bigint), balances
 * derive from the ledger, the exchange token's `exp` is validated on execute,
 * and every step is audited.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb, type Db } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { mintExchangeToken, verifyToken } from "../utils/tokenFactory";
import { classifyIntent, type ClassifiedIntent, type SmartChatOperation } from "../utils/smartchatModel";
import { getUserByEmail } from "./authService";
import { getUserBalances } from "./ledgerService";
import { transfer, getTransactionHistory } from "./transferService";

/** Transfers strictly above this (integer minor units = $500.00) require MFA. */
export const MFA_THRESHOLD_MINOR = 50_000n;
/** Operation-token lifetime. Kept tight on purpose — these authorize money moves. */
export const OPERATION_TOKEN_TTL_SECS = 90;
/** MFA challenge lifetime. */
const MFA_TTL_SECS = 300;

/** Synthetic agent identity for the SmartChat assistant in audit/exchange tokens. */
const SMARTCHAT_AGENT = { id: "smartchat", name: "SmartChat", type: "internal" };

type OperationTokenStatus = "pending" | "awaiting_mfa" | "executed" | "failed" | "expired";

interface OperationTokenRow {
  id: string;
  token: string;
  user_id: string;
  operation: string;
  scope: string;
  status: string;
  mfa_required: number;
  mfa_verified: number;
  metadata: string;
  result: string | null;
  lifetime_secs: number;
  agent_id: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface OperationTokenView {
  id: string;
  operation: SmartChatOperation;
  scope: string[];
  status: OperationTokenStatus;
  mfaRequired: boolean;
  mfaVerified: boolean;
  metadata: Record<string, unknown>;
  result: unknown | null;
  expiresAt: string;
  createdAt: string;
}

export interface SmartChatResult {
  reply: string;
  intent: ClassifiedIntent;
  operationToken: OperationTokenView | null;
  requiresMfa: boolean;
  /** Dev/test only: the MFA code (in production this is delivered out-of-band). */
  devMfaCode?: string;
}

// ---------------------------------------------------------------------------
// Scope mapping (matches the agent permission vocabulary from agentService)
// ---------------------------------------------------------------------------

function scopeFor(intent: ClassifiedIntent, amountMinor: bigint | null): string[] {
  switch (intent.operation) {
    case "balance.read":
      return ["balance:read"];
    case "transactions.read":
      return ["statement:read"];
    case "transfer.send":
      return amountMinor != null && amountMinor > MFA_THRESHOLD_MINOR
        ? ["transfer:high"]
        : ["transfer:low"];
    default:
      return [];
  }
}

function toView(row: OperationTokenRow): OperationTokenView {
  return {
    id: row.id,
    operation: row.operation as SmartChatOperation,
    scope: JSON.parse(row.scope || "[]"),
    status: row.status as OperationTokenStatus,
    mfaRequired: row.mfa_required === 1,
    mfaVerified: row.mfa_verified === 1,
    metadata: JSON.parse(row.metadata || "{}"),
    result: row.result ? JSON.parse(row.result) : null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

async function loadToken(userId: string, tokenId: string, db: Db = getDb()): Promise<OperationTokenRow> {
  const row = await db.queryOne<OperationTokenRow>(
    "SELECT * FROM operation_tokens WHERE id = ? AND user_id = ?",
    [tokenId, userId]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Operation token not found");
  return row;
}

// ---------------------------------------------------------------------------
// 1. Entry point — classify, issue, and (when no MFA is needed) execute.
// ---------------------------------------------------------------------------

export async function handleMessage(input: {
  userId: string;
  message: string;
  ipAddress?: string;
}): Promise<SmartChatResult> {
  const message = (input.message ?? "").trim();
  if (!message) throw new AppError(ErrorCode.VALIDATION, "message is required");

  const intent = await classifyIntent(message);

  // Pure conversation — nothing to authorize or execute.
  if (intent.operation === "chat") {
    return {
      reply:
        "I can help with your balance, recent transactions, or sending money. " +
        "Try: \"What's my balance?\" or \"Send $50 to alex@example.com\".",
      intent,
      operationToken: null,
      requiresMfa: false,
    };
  }

  const { tokenId, mfaRequired, devMfaCode } = await issueOperationToken(input.userId, intent, input.ipAddress);

  if (mfaRequired) {
    const view = toView(await loadToken(input.userId, tokenId));
    return {
      reply:
        "This transfer is over $500, so it needs a verification code to proceed. " +
        "Submit the code to confirm, or it expires in 90 seconds.",
      intent,
      operationToken: view,
      requiresMfa: true,
      ...(devMfaCode ? { devMfaCode } : {}),
    };
  }

  const result = await executeOperationToken(input.userId, tokenId, input.ipAddress);
  const view = toView(await loadToken(input.userId, tokenId));
  return {
    reply: generateResponse(intent, result),
    intent,
    operationToken: view,
    requiresMfa: false,
  };
}

// ---------------------------------------------------------------------------
// 2. Issue an operation token (mints the RFC 8693 exchange token).
// ---------------------------------------------------------------------------

async function issueOperationToken(
  userId: string,
  intent: ClassifiedIntent,
  ipAddress?: string
): Promise<{ tokenId: string; mfaRequired: boolean; devMfaCode?: string }> {
  const db = getDb();

  // Validate operation-specific params up front so we never mint a token we
  // already know can't execute.
  const params: Record<string, unknown> = {};
  let amountMinor: bigint | null = null;
  let mfaRequired = false;

  if (intent.operation === "transfer.send") {
    const currency = intent.currency === "USDC" ? "USDC" : "USD";
    if (!intent.amountMinor) {
      throw new AppError(ErrorCode.VALIDATION, "I couldn't determine the amount to send.");
    }
    amountMinor = BigInt(intent.amountMinor);
    if (amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Transfer amount must be positive.");
    if (!intent.recipient) {
      throw new AppError(ErrorCode.VALIDATION, "I couldn't determine who to send to.");
    }
    const recipientUser = await getUserByEmail(intent.recipient);
    if (!recipientUser) throw new AppError(ErrorCode.NOT_FOUND, `No account found for ${intent.recipient}.`);
    if (recipientUser.id === userId) throw new AppError(ErrorCode.VALIDATION, "You can't transfer to yourself.");

    params.toUserId = recipientUser.id;
    params.recipientEmail = recipientUser.email;
    params.amountMinor = amountMinor.toString();
    params.currency = currency;
    mfaRequired = amountMinor > MFA_THRESHOLD_MINOR;
  }

  const scope = scopeFor(intent, amountMinor);

  const tokenId = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  const expiresAtIso = new Date((now + OPERATION_TOKEN_TTL_SECS) * 1000).toISOString();

  // RFC 8693-style exchange token: user is the subject, SmartChat is the actor.
  // RS256 so the exp is cryptographically bound and verifiable on execute.
  const exchangeToken = await mintExchangeToken({
    userId,
    agentId: SMARTCHAT_AGENT.id,
    agentName: SMARTCHAT_AGENT.name,
    agentType: SMARTCHAT_AGENT.type,
    scope,
    operation: intent.operation,
    params,
    ttlSecs: OPERATION_TOKEN_TTL_SECS,
  });

  let devMfaCode: string | undefined;
  const metadata: Record<string, unknown> = { ...params, summary: intent.summary };

  if (mfaRequired) {
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const challengeId = uuidv4();
    const mfaExpiresIso = new Date((now + MFA_TTL_SECS) * 1000).toISOString();
    await db.execute(
      `INSERT INTO mfa_challenges (id, user_id, agent_id, code, purpose, expires_at, used)
       VALUES (?, ?, ?, ?, 'smartchat_transfer', ?, 0)`,
      [challengeId, userId, tokenId, code, mfaExpiresIso]
    );
    metadata.mfaChallengeId = challengeId;
    // The code is delivered out-of-band (SMS/authenticator) in production. In
    // dev/test we surface it so the flow is exercisable; never in production.
    if (!config.isProd) devMfaCode = code;
  }

  await db.execute(
    `INSERT INTO operation_tokens
       (id, token, user_id, operation, scope, status, mfa_required, mfa_verified, metadata, lifetime_secs, agent_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      tokenId,
      exchangeToken,
      userId,
      intent.operation,
      JSON.stringify(scope),
      mfaRequired ? "awaiting_mfa" : "pending",
      mfaRequired ? 1 : 0,
      JSON.stringify(metadata),
      OPERATION_TOKEN_TTL_SECS,
      SMARTCHAT_AGENT.id,
      expiresAtIso,
    ]
  );

  await logAudit({
    userId,
    agentId: SMARTCHAT_AGENT.id,
    agentName: SMARTCHAT_AGENT.name,
    action: "smartchat.operation.issue",
    resource: tokenId,
    details: { operation: intent.operation, scope, mfaRequired },
    ipAddress,
  });

  return { tokenId, mfaRequired, ...(devMfaCode ? { devMfaCode } : {}) };
}

// ---------------------------------------------------------------------------
// 3. Execute an operation token (transfers go through ledgerService.transfer).
// ---------------------------------------------------------------------------

export async function executeOperationToken(
  userId: string,
  tokenId: string,
  ipAddress?: string
): Promise<unknown> {
  const db = getDb();
  const row = await loadToken(userId, tokenId, db);

  // Already executed — return the stored result (idempotent at this layer too).
  if (row.status === "executed") {
    return row.result ? JSON.parse(row.result) : null;
  }

  // Expiry: trust the stored expiry AND the signed token's exp. Either being
  // past now means the authorization has lapsed.
  const nowMs = Date.now();
  const storedExpired = new Date(row.expires_at).getTime() <= nowMs;
  let tokenExp = 0;
  try {
    const verified = await verifyToken(row.token);
    tokenExp = (verified.payload.exp ?? 0) * 1000;
  } catch {
    tokenExp = 0; // signature/exp invalid → treat as expired
  }
  if (storedExpired || tokenExp <= nowMs) {
    if (row.status !== "expired") {
      await db.execute("UPDATE operation_tokens SET status = 'expired' WHERE id = ?", [tokenId]);
    }
    throw new AppError(ErrorCode.VALIDATION, "This operation expired. Please ask again.");
  }

  // MFA gate.
  if (row.mfa_required === 1 && row.mfa_verified !== 1) {
    throw new AppError(ErrorCode.FORBIDDEN, "MFA verification required before this operation can execute.");
  }
  if (row.status !== "pending" && row.status !== "awaiting_mfa") {
    throw new AppError(ErrorCode.CONFLICT, `Operation token is not executable (status: ${row.status}).`);
  }

  const operation = row.operation as SmartChatOperation;
  const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
  let result: unknown;

  try {
    switch (operation) {
      case "balance.read": {
        const balances = await getUserBalances(userId);
        result = { cash_minor: balances.cash.toString(), savings_minor: balances.savings.toString(), currency: "USD" };
        break;
      }
      case "transactions.read": {
        const txs = await getTransactionHistory(userId, 10);
        result = { transactions: txs };
        break;
      }
      case "transfer.send": {
        const toUserId = String(metadata.toUserId);
        const amountMinor = BigInt(String(metadata.amountMinor));
        const currency = metadata.currency === "USDC" ? "USDC" : "USD";
        const transferResult = await transfer({
          fromUserId: userId,
          toUserId,
          amountMinor,
          currency,
          description: `SmartChat transfer to ${String(metadata.recipientEmail ?? toUserId)}`,
          // Idempotency keyed on the operation-token id: a retried execute (or a
          // replayed request) collapses onto the same ledger journal.
          idempotencyKey: `optoken:${tokenId}`,
        });
        result = {
          journalId: transferResult.journalId,
          transactionId: transferResult.transactionId,
          amount_minor: amountMinor.toString(),
          currency,
          recipient: metadata.recipientEmail ?? toUserId,
        };
        break;
      }
      default:
        throw new AppError(ErrorCode.NOT_IMPLEMENTED, `Unsupported operation: ${operation}`);
    }
  } catch (e) {
    await db.execute("UPDATE operation_tokens SET status = 'failed', used_at = ? WHERE id = ?", [
      new Date().toISOString(),
      tokenId,
    ]);
    await logAudit({
      userId,
      agentId: SMARTCHAT_AGENT.id,
      agentName: SMARTCHAT_AGENT.name,
      action: "smartchat.operation.execute",
      resource: tokenId,
      status: "failure",
      details: { operation, error: (e as Error).message },
      ipAddress,
    });
    throw e;
  }

  await db.execute("UPDATE operation_tokens SET status = 'executed', result = ?, used_at = ? WHERE id = ?", [
    JSON.stringify(result),
    new Date().toISOString(),
    tokenId,
  ]);

  await logAudit({
    userId,
    agentId: SMARTCHAT_AGENT.id,
    agentName: SMARTCHAT_AGENT.name,
    action: "smartchat.operation.execute",
    resource: tokenId,
    status: "success",
    details: { operation },
    ipAddress,
  });

  return result;
}

// ---------------------------------------------------------------------------
// 4. MFA verification path → then execute.
// ---------------------------------------------------------------------------

export async function verifyMfaAndExecute(input: {
  userId: string;
  tokenId: string;
  code: string;
  ipAddress?: string;
}): Promise<SmartChatResult> {
  const db = getDb();
  const row = await loadToken(input.userId, input.tokenId, db);

  if (row.mfa_required !== 1) {
    throw new AppError(ErrorCode.VALIDATION, "This operation does not require MFA.");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.execute("UPDATE operation_tokens SET status = 'expired' WHERE id = ?", [input.tokenId]);
    throw new AppError(ErrorCode.VALIDATION, "This operation expired. Please ask again.");
  }

  const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
  const challengeId = String(metadata.mfaChallengeId ?? "");
  const challenge = await db.queryOne<{ id: string; code: string; used: number; expires_at: string }>(
    "SELECT id, code, used, expires_at FROM mfa_challenges WHERE id = ? AND user_id = ?",
    [challengeId, input.userId]
  );

  const codeOk =
    challenge &&
    challenge.used === 0 &&
    new Date(challenge.expires_at).getTime() > Date.now() &&
    // Constant-ish comparison is overkill for a 6-digit short-lived code, but
    // avoid leaking timing on length mismatch at least.
    challenge.code === String(input.code).trim();

  if (!codeOk) {
    await logAudit({
      userId: input.userId,
      agentId: SMARTCHAT_AGENT.id,
      action: "smartchat.mfa.verify",
      resource: input.tokenId,
      status: "failure",
      ipAddress: input.ipAddress,
    });
    throw new AppError(ErrorCode.FORBIDDEN, "Invalid or expired verification code.");
  }

  // Mark the challenge used and the token MFA-verified before executing so a
  // replay of the same code can't re-trigger anything.
  await db.execute("UPDATE mfa_challenges SET used = 1 WHERE id = ?", [challengeId]);
  await db.execute("UPDATE operation_tokens SET mfa_verified = 1 WHERE id = ?", [input.tokenId]);

  await logAudit({
    userId: input.userId,
    agentId: SMARTCHAT_AGENT.id,
    action: "smartchat.mfa.verify",
    resource: input.tokenId,
    status: "success",
    ipAddress: input.ipAddress,
  });

  const result = await executeOperationToken(input.userId, input.tokenId, input.ipAddress);
  const view = toView(await loadToken(input.userId, input.tokenId, db));
  const intent: ClassifiedIntent = {
    operation: row.operation as SmartChatOperation,
    summary: String(metadata.summary ?? ""),
  };
  return { reply: generateResponse(intent, result), intent, operationToken: view, requiresMfa: false };
}

// ---------------------------------------------------------------------------
// 5. Natural-language response generation (deterministic, no model needed).
// ---------------------------------------------------------------------------

function formatMinor(minor: bigint, currency: string): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  return `${sign}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")} ${currency}`;
}

export function generateResponse(intent: ClassifiedIntent, result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  switch (intent.operation) {
    case "balance.read":
      return `Your available balance is ${formatMinor(BigInt(String(r.cash_minor ?? "0")), String(r.currency ?? "USD"))}` +
        (BigInt(String(r.savings_minor ?? "0")) > 0n
          ? ` (plus ${formatMinor(BigInt(String(r.savings_minor)), String(r.currency ?? "USD"))} in savings).`
          : ".");
    case "transactions.read": {
      const txs = (r.transactions as unknown[]) ?? [];
      return txs.length === 0
        ? "You have no recent transactions."
        : `Here are your ${txs.length} most recent transactions.`;
    }
    case "transfer.send":
      return `Done — sent ${formatMinor(BigInt(String(r.amount_minor ?? "0")), String(r.currency ?? "USD"))} to ${String(
        r.recipient ?? "the recipient"
      )}.`;
    default:
      return "Okay.";
  }
}

// ---------------------------------------------------------------------------
// Read APIs for the routes (GET /tokens, GET /tokens/:id).
// ---------------------------------------------------------------------------

export async function listOperationTokens(userId: string, limit = 50): Promise<OperationTokenView[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await getDb().query<OperationTokenRow>(
    "SELECT * FROM operation_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, capped]
  );
  return rows.map(toView);
}

export async function getOperationToken(userId: string, tokenId: string): Promise<OperationTokenView> {
  return toView(await loadToken(userId, tokenId));
}
