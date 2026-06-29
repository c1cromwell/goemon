/**
 * X-Money response F3 — non-custodial P2P money requests (request-to-pay).
 *
 * "Request $X from @user" (or an open request link), settled on GOEMAN'S OWN RAIL:
 * the existing transfer path (executeTransfer → the double-entry ledger / USDC on
 * Hedera), idempotent at the ledger. No Visa, no partner bank, no escrow — the payer
 * holds their funds until they choose to fulfill, then it settles as a direct peer
 * transfer. This is the native, self-contained rail (the own-rail North Star) and the
 * differentiator vs. X Money: instant, non-custodial, your rail not a network's.
 *
 * A request is a lightweight state machine; money moves ONLY on fulfill, and only as
 * a balanced, idempotent journal. Fraud/freeze gates ride the underlying transfer.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { executeTransfer } from "../money/moneyEngine";

const DEFAULT_TTL_SECS = 7 * 24 * 60 * 60; // 7 days
const MAX_REQUEST_MINOR = 10_000_000n;

export type RequestStatus = "requested" | "fulfilled" | "declined" | "canceled" | "expired";

export interface PaymentRequestRow {
  id: string;
  requesterUserId: string;
  fromUserId: string | null;
  amountMinor: string;
  currency: string;
  memo: string | null;
  status: RequestStatus;
  fulfilledBy: string | null;
  journalId: string | null;
  expiresAt: string;
  createdAt: string;
}

interface Raw {
  id: string;
  requester_user_id: string;
  from_user_id: string | null;
  amount_minor: string | number;
  currency: string;
  memo: string | null;
  status: RequestStatus;
  fulfilled_by: string | null;
  journal_id: string | null;
  expires_at: string;
  created_at: string;
}

function map(r: Raw): PaymentRequestRow {
  return {
    id: r.id,
    requesterUserId: r.requester_user_id,
    fromUserId: r.from_user_id,
    amountMinor: BigInt(r.amount_minor).toString(),
    currency: r.currency,
    memo: r.memo,
    status: effectiveStatus(r),
    fulfilledBy: r.fulfilled_by,
    journalId: r.journal_id,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

/** A still-open request past its TTL reads as expired (no money ever moved). */
function effectiveStatus(r: Raw): RequestStatus {
  if (r.status === "requested" && new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return r.status;
}

export async function createRequest(input: {
  requesterUserId: string;
  fromUserId?: string;
  amountMinor: bigint;
  currency?: string;
  memo?: string;
  ttlSecs?: number;
}): Promise<PaymentRequestRow> {
  if (input.amountMinor <= 0n) throw new AppError(ErrorCode.VALIDATION, "Amount must be positive");
  if (input.amountMinor > MAX_REQUEST_MINOR) throw new AppError(ErrorCode.VALIDATION, "Amount exceeds maximum");
  if (input.fromUserId && input.fromUserId === input.requesterUserId) {
    throw new AppError(ErrorCode.VALIDATION, "Cannot request money from yourself");
  }
  const ttl = input.ttlSecs ?? DEFAULT_TTL_SECS;
  const id = uuidv4();
  const now = new Date();
  await getDb().execute(
    `INSERT INTO payment_requests (id, requester_user_id, from_user_id, amount_minor, currency, memo, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`,
    [id, input.requesterUserId, input.fromUserId ?? null, input.amountMinor.toString(), input.currency ?? "USD", input.memo ?? null,
     new Date(now.getTime() + ttl * 1000).toISOString(), now.toISOString(), now.toISOString()]
  );
  await logAudit({ userId: input.requesterUserId, action: "p2p.request.create", resource: id, details: { fromUserId: input.fromUserId ?? null, amountMinor: input.amountMinor.toString() } });
  return (await getRequest(id))!;
}

export async function getRequest(id: string): Promise<PaymentRequestRow | null> {
  const r = await getDb().queryOne<Raw>("SELECT * FROM payment_requests WHERE id = ?", [id]);
  return r ? map(r) : null;
}

/** Requests the user sent (as requester) or received (as the asked payer). */
export async function listRequests(userId: string, role: "sent" | "received", limit = 50): Promise<PaymentRequestRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const where = role === "sent" ? "requester_user_id = ?" : "from_user_id = ?";
  const rows = await getDb().query<Raw>(`SELECT * FROM payment_requests WHERE ${where} ORDER BY created_at DESC LIMIT ?`, [userId, capped]);
  return rows.map(map);
}

async function rawOrThrow(id: string): Promise<Raw> {
  const r = await getDb().queryOne<Raw>("SELECT * FROM payment_requests WHERE id = ?", [id]);
  if (!r) throw new AppError(ErrorCode.NOT_FOUND, "Payment request not found");
  return r;
}

/**
 * Fulfill a request: the payer sends the requester the funds on the native rail.
 * Idempotent per request (the transfer + the status flip both key on the request id),
 * so a retry never double-pays. Directed requests can only be paid by the named payer.
 */
export async function fulfillRequest(input: { requestId: string; payerUserId: string }): Promise<PaymentRequestRow> {
  const raw = await rawOrThrow(input.requestId);
  const status = effectiveStatus(raw);

  if (status !== "requested") {
    // Idempotent re-fulfill by the same payer returns the settled request.
    if (raw.status === "fulfilled" && raw.fulfilled_by === input.payerUserId) return map(raw);
    throw new AppError(ErrorCode.CONFLICT, `Request is ${status}, not payable`);
  }
  if (input.payerUserId === raw.requester_user_id) throw new AppError(ErrorCode.VALIDATION, "Cannot pay your own request");
  if (raw.from_user_id && raw.from_user_id !== input.payerUserId) throw new AppError(ErrorCode.FORBIDDEN, "This request is directed to another user");

  // Settle on the native rail (idempotent at the ledger on the request id).
  const result = await executeTransfer({
    fromUserId: input.payerUserId,
    toUserId: raw.requester_user_id,
    amountMinor: BigInt(raw.amount_minor),
    currency: raw.currency,
    description: `P2P request: ${raw.memo ?? raw.id}`,
    idempotencyKey: `p2p:req:${raw.id}`,
    channel: "p2p",
  });

  await getDb().execute(
    "UPDATE payment_requests SET status = 'fulfilled', fulfilled_by = ?, journal_id = ?, updated_at = ? WHERE id = ? AND status = 'requested'",
    [input.payerUserId, result.journalId, new Date().toISOString(), raw.id]
  );
  await logAudit({ userId: input.payerUserId, action: "p2p.request.fulfill", resource: raw.id, details: { requesterUserId: raw.requester_user_id, amountMinor: BigInt(raw.amount_minor).toString(), journalId: result.journalId } });
  return (await getRequest(raw.id))!;
}

/** The asked payer declines (no money moves). */
export async function declineRequest(input: { requestId: string; userId: string }): Promise<PaymentRequestRow> {
  const raw = await rawOrThrow(input.requestId);
  if (effectiveStatus(raw) !== "requested") throw new AppError(ErrorCode.CONFLICT, `Request is ${effectiveStatus(raw)}`);
  if (raw.from_user_id && raw.from_user_id !== input.userId) throw new AppError(ErrorCode.FORBIDDEN, "Not your request to decline");
  await getDb().execute("UPDATE payment_requests SET status = 'declined', updated_at = ? WHERE id = ? AND status = 'requested'", [new Date().toISOString(), raw.id]);
  return (await getRequest(raw.id))!;
}

/** The requester cancels their own request. */
export async function cancelRequest(input: { requestId: string; userId: string }): Promise<PaymentRequestRow> {
  const raw = await rawOrThrow(input.requestId);
  if (raw.requester_user_id !== input.userId) throw new AppError(ErrorCode.FORBIDDEN, "Only the requester can cancel");
  const status = effectiveStatus(raw);
  if (status === "canceled") return map(raw);
  if (status !== "requested" && status !== "expired") throw new AppError(ErrorCode.CONFLICT, `Cannot cancel a ${status} request`);
  await getDb().execute("UPDATE payment_requests SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('requested')", [new Date().toISOString(), raw.id]);
  return (await getRequest(raw.id))!;
}
