/**
 * Phase 22.5 — custodial investing (UGMA/UTMA) seam for minors.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import { assertGuardianOfTeen } from "./householdService";
import { placeOrder } from "./marketplaceService";
import { custodialOrderTotal } from "../observability/metrics";

export interface CustodialAccountRow {
  id: string;
  teen_user_id: string;
  guardian_user_id: string;
  account_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CustodialOrderRow {
  id: string;
  custodial_account_id: string;
  teen_user_id: string;
  guardian_user_id: string;
  asset_id: string;
  side: string;
  qty_base: string;
  review_id: string | null;
  marketplace_order_id: string | null;
  status: string;
  idempotency_key: string | null;
  created_at: string;
  decided_at: string | null;
  settled_at: string | null;
}

export interface CustodialBroker {
  name: string;
  attestAccount(accountId: string): Promise<{ externalRef: string; status: string }>;
}

function assertCustodialEnabled(): void {
  if (!config.TEEN_ENABLED) throw new AppError(ErrorCode.TEEN_DISABLED, "Argus Starter is currently unavailable");
  if (!config.TEEN_CUSTODIAL_ENABLED) {
    throw new AppError(ErrorCode.TEEN_CUSTODIAL_DISABLED, "Custodial investing is currently unavailable");
  }
}

function simulatedBroker(): CustodialBroker {
  return {
    name: "simulated",
    async attestAccount(accountId) {
      return { externalRef: `sim-custodial-${accountId.slice(0, 8)}`, status: "active" };
    },
  };
}

function notImplementedBroker(name: string): CustodialBroker {
  return {
    name,
    async attestAccount(): Promise<never> {
      throw new AppError(
        ErrorCode.NOT_IMPLEMENTED,
        `CUSTODIAL_BROKER=${name} is not wired — integrate a custodial broker-dealer + transfer agent + counsel`
      );
    },
  };
}

export function getCustodialBroker(): CustodialBroker {
  switch (config.CUSTODIAL_BROKER) {
    case "alpaca":
      return notImplementedBroker("alpaca");
    case "drivewealth":
      return notImplementedBroker("drivewealth");
    default:
      return simulatedBroker();
  }
}

export async function openCustodialAccount(input: {
  guardianUserId: string;
  teenUserId: string;
  accountType?: "ugma" | "utma";
}): Promise<CustodialAccountRow> {
  assertCustodialEnabled();
  await assertGuardianOfTeen(input.guardianUserId, input.teenUserId);

  const existing = await getDb().queryOne<CustodialAccountRow>(
    "SELECT * FROM custodial_accounts WHERE teen_user_id = ?",
    [input.teenUserId]
  );
  if (existing) return existing;

  const id = uuidv4();
  const now = new Date().toISOString();
  const accountType = input.accountType ?? "ugma";
  await getDb().execute(
    `INSERT INTO custodial_accounts (id, teen_user_id, guardian_user_id, account_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    [id, input.teenUserId, input.guardianUserId, accountType, now, now]
  );

  const attestation = await getCustodialBroker().attestAccount(id);
  custodialOrderTotal.inc({ action: "account_opened" });
  await logAudit({
    userId: input.guardianUserId,
    action: "starter.custodial.open",
    resource: id,
    details: { teenUserId: input.teenUserId, accountType, brokerRef: attestation.externalRef },
  });
  return (await getDb().queryOne<CustodialAccountRow>("SELECT * FROM custodial_accounts WHERE id = ?", [id]))!;
}

export async function proposeCustodialOrder(input: {
  teenUserId: string;
  assetId: string;
  side: "buy" | "sell";
  qtyBase: bigint;
  idempotencyKey: string;
}): Promise<CustodialOrderRow> {
  assertCustodialEnabled();
  if (input.qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "Quantity must be positive");

  const account = await getDb().queryOne<CustodialAccountRow>(
    "SELECT * FROM custodial_accounts WHERE teen_user_id = ? AND status = 'active'",
    [input.teenUserId]
  );
  if (!account) throw new AppError(ErrorCode.NOT_FOUND, "Open a custodial account first");

  const prior = await getDb().queryOne<CustodialOrderRow>(
    "SELECT * FROM custodial_orders WHERE idempotency_key = ?",
    [input.idempotencyKey]
  );
  if (prior) return prior;

  const reviewId = uuidv4();
  const orderId = uuidv4();
  const workflowRun = uuidv4();
  const now = new Date().toISOString();
  const recommendation = JSON.stringify({
    guardianUserId: account.guardian_user_id,
    teenUserId: input.teenUserId,
    custodialOrderId: orderId,
    assetId: input.assetId,
    side: input.side,
    qtyBase: input.qtyBase.toString(),
    idempotencyKey: input.idempotencyKey,
  });

  await getDb().transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO agent_reviews
         (id, run_id, workflow_run, skill, subject_user_id, status, requires_role, recommendation, reason, created_at)
       VALUES (?, ?, ?, 'custodial-order', ?, 'pending', 'guardian', ?, ?, ?)`,
      [reviewId, uuidv4(), workflowRun, input.teenUserId, recommendation, "custodial_order_pending", now]
    );
    await tx.execute(
      `INSERT INTO custodial_orders
         (id, custodial_account_id, teen_user_id, guardian_user_id, asset_id, side, qty_base, review_id, status, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        orderId,
        account.id,
        input.teenUserId,
        account.guardian_user_id,
        input.assetId,
        input.side,
        input.qtyBase.toString(),
        reviewId,
        input.idempotencyKey,
        now,
      ]
    );
  });

  custodialOrderTotal.inc({ action: "proposed" });
  await logAudit({
    userId: input.teenUserId,
    action: "starter.custodial.propose",
    resource: orderId,
    details: { assetId: input.assetId, side: input.side, qtyBase: input.qtyBase.toString() },
  });
  return (await getDb().queryOne<CustodialOrderRow>("SELECT * FROM custodial_orders WHERE id = ?", [orderId]))!;
}

export async function resolveCustodialOrder(
  guardianUserId: string,
  reviewId: string,
  decision: "approve" | "reject",
  reason?: string
): Promise<{ status: string; order?: CustodialOrderRow }> {
  assertCustodialEnabled();
  const review = await getDb().queryOne<{ id: string; skill: string; status: string }>(
    "SELECT id, skill, status FROM agent_reviews WHERE id = ?",
    [reviewId]
  );
  if (!review) throw new AppError(ErrorCode.NOT_FOUND, "Review not found");
  if (review.skill !== "custodial-order") throw new AppError(ErrorCode.FORBIDDEN, "Not a custodial order review");
  if (review.status !== "pending") throw new AppError(ErrorCode.CONFLICT, "Review already resolved");

  const order = await getDb().queryOne<CustodialOrderRow>("SELECT * FROM custodial_orders WHERE review_id = ?", [reviewId]);
  if (!order || order.guardian_user_id !== guardianUserId) throw new AppError(ErrorCode.FORBIDDEN, "Not your order");

  const now = new Date().toISOString();
  if (decision === "reject") {
    await getDb().execute(
      "UPDATE agent_reviews SET status = 'rejected', decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?",
      [guardianUserId, reason ?? "guardian_denied", now, reviewId]
    );
    await getDb().execute("UPDATE custodial_orders SET status = 'rejected', decided_at = ? WHERE id = ?", [now, order.id]);
    custodialOrderTotal.inc({ action: "rejected" });
    return { status: "rejected" };
  }

  const result = await placeOrder(
    order.teen_user_id,
    order.asset_id,
    order.side as "buy" | "sell",
    BigInt(order.qty_base),
    order.idempotency_key ?? `custodial:${order.id}`
  );

  await getDb().execute(
    "UPDATE agent_reviews SET status = 'approved', decided_by = ?, decision_reason = ?, decided_at = ? WHERE id = ?",
    [guardianUserId, reason ?? "guardian_approved", now, reviewId]
  );
  await getDb().execute(
    "UPDATE custodial_orders SET status = 'settled', marketplace_order_id = ?, decided_at = ?, settled_at = ? WHERE id = ?",
    [result.orderId, now, now, order.id]
  );
  custodialOrderTotal.inc({ action: "settled" });
  await logAudit({
    userId: guardianUserId,
    action: "starter.custodial.settled",
    resource: order.id,
    details: { marketplaceOrderId: result.orderId },
  });
  return { status: "settled", order: (await getDb().queryOne<CustodialOrderRow>("SELECT * FROM custodial_orders WHERE id = ?", [order.id]))! };
}

export async function listCustodialOrders(teenUserId: string): Promise<CustodialOrderRow[]> {
  return getDb().query<CustodialOrderRow>(
    "SELECT * FROM custodial_orders WHERE teen_user_id = ? ORDER BY created_at DESC LIMIT 50",
    [teenUserId]
  );
}

export async function listGuardianCustodialReviews(guardianUserId: string): Promise<Array<{ reviewId: string; order: CustodialOrderRow }>> {
  assertCustodialEnabled();
  const orders = await getDb().query<CustodialOrderRow>(
    "SELECT * FROM custodial_orders WHERE guardian_user_id = ? AND status = 'pending' ORDER BY created_at ASC",
    [guardianUserId]
  );
  return orders.filter((o) => o.review_id).map((o) => ({ reviewId: o.review_id!, order: o }));
}

export async function getCustodialAccount(teenUserId: string): Promise<CustodialAccountRow | null> {
  return getDb().queryOne<CustodialAccountRow>("SELECT * FROM custodial_accounts WHERE teen_user_id = ?", [teenUserId]);
}
