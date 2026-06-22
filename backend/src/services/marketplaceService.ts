/**
 * Phase 8 — Marketplace execution.
 *
 * Holdings are DERIVED from the ledger. Every money-and-asset movement settles
 * ATOMICALLY in ONE journal that balances per currency AND per asset, or it
 * reverts. Asset quantities are integer base units (bigint), never float.
 *
 *   - quote()           — fee disclosure BEFORE execution (no money moves).
 *   - subscribe()       — primary issuance via escrow (cash → escrow).
 *   - closeSubscription / refundSubscription — distribute or refund escrow.
 *   - placeOrder()      — secondary buy/sell, one atomic cash+asset+fee journal,
 *                         against the asset treasury (the prototype's market maker).
 *   - transferAsset()   — direct user→user asset move, compliance-gated for securities.
 *
 * Fees post to the existing `fee` ledger account as part of the same journal.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import {
  assetLedgerCode,
  getBalance,
  getOrCreateUserAccount,
  getOrCreateUserAssetAccount,
  getOrCreateAssetTreasury,
  getAssetBalance,
  getSystemAccount,
  postJournal,
} from "./ledgerService";
import { requireAsset, type Asset } from "./tokenizationService";
import { checkTransfer } from "./complianceService";
import { getCurrentPrice } from "./pricingService";

// Disclosed, uniform per asset class (REQ-MK-FEE-001): no hidden/post-trade fees.
const PRIMARY_FEE_BPS = 100n; // 1.0% spread/markup on primary issuance
const SECONDARY_FEE_BPS = 50n; // 0.5% trading fee on secondary

function feeOf(grossMinor: bigint, bps: bigint): bigint {
  return (grossMinor * bps) / 10_000n;
}

export type Side = "buy" | "sell" | "subscribe";

export interface Quote {
  side: Side;
  assetId: string;
  qtyBase: string;
  priceMinor: string;
  currency: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string; // magnitude of the user's cash delta (cost for buy/subscribe, proceeds for sell)
  priceSource: string;
  priceAsOf: string;
  stale: boolean;
}

interface PricedTrade {
  asset: Asset;
  priceMinor: bigint;
  currency: string;
  gross: bigint;
  fee: bigint;
  net: bigint;
  source: string;
  asOf: string;
  stale: boolean;
}

async function priceTrade(assetId: string, side: Side, qtyBase: bigint): Promise<PricedTrade> {
  if (qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be a positive integer");
  const asset = await requireAsset(assetId);
  const price = await getCurrentPrice(assetId);
  const gross = qtyBase * price.priceMinor;
  const bps = side === "sell" || side === "buy" ? SECONDARY_FEE_BPS : PRIMARY_FEE_BPS;
  const fee = feeOf(gross, bps);
  // Buyer/subscriber pays gross + fee; seller receives gross - fee.
  const net = side === "sell" ? gross - fee : gross + fee;
  return {
    asset,
    priceMinor: price.priceMinor,
    currency: price.currency,
    gross,
    fee,
    net,
    source: price.source,
    asOf: price.asOf,
    stale: price.stale,
  };
}

export async function quote(assetId: string, side: Side, qtyBase: bigint): Promise<Quote> {
  const t = await priceTrade(assetId, side, qtyBase);
  return {
    side,
    assetId,
    qtyBase: qtyBase.toString(),
    priceMinor: t.priceMinor.toString(),
    currency: t.currency,
    grossMinor: t.gross.toString(),
    feeMinor: t.fee.toString(),
    netMinor: t.net.toString(),
    priceSource: t.source,
    priceAsOf: t.asOf,
    stale: t.stale,
  };
}

// ---------------------------------------------------------------------------
// Holdings & portfolio (derived from the ledger)
// ---------------------------------------------------------------------------

export interface Holding {
  assetId: string;
  name: string;
  symbol: string | null;
  kind: string;
  qtyBase: string;
  priceMinor: string | null;
  valueMinor: string | null;
  currency: string | null;
}

export async function getPortfolio(userId: string): Promise<{
  cashMinor: string;
  holdings: Holding[];
  holdingsValueMinor: string;
  totalValueMinor: string;
}> {
  const db = getDb();
  const cashId = await getOrCreateUserAccount(userId, "user_cash", "USD");
  const cash = await getBalance(cashId);

  const rows = await db.query<{ currency: string }>(
    "SELECT currency FROM ledger_accounts WHERE user_id = ? AND kind = 'user_asset'",
    [userId]
  );

  const holdings: Holding[] = [];
  let holdingsValue = 0n;
  for (const r of rows) {
    const assetId = r.currency.replace(/^ASSET:/, "");
    const qty = await getAssetBalance(userId, assetId);
    if (qty <= 0n) continue;
    const asset = await requireAsset(assetId);
    let priceMinor: bigint | null = null;
    let valueMinor: bigint | null = null;
    let currency: string | null = null;
    try {
      const p = await getCurrentPrice(assetId);
      priceMinor = p.priceMinor;
      currency = p.currency;
      valueMinor = qty * p.priceMinor;
      holdingsValue += valueMinor;
    } catch {
      /* unlisted asset — held but unpriced */
    }
    holdings.push({
      assetId,
      name: asset.name,
      symbol: asset.symbol,
      kind: asset.kind,
      qtyBase: qty.toString(),
      priceMinor: priceMinor?.toString() ?? null,
      valueMinor: valueMinor?.toString() ?? null,
      currency,
    });
  }

  return {
    cashMinor: cash.toString(),
    holdings,
    holdingsValueMinor: holdingsValue.toString(),
    totalValueMinor: (cash + holdingsValue).toString(),
  };
}

// ---------------------------------------------------------------------------
// Primary issuance / subscription (escrow)
// ---------------------------------------------------------------------------

export interface OrderResult {
  orderId: string;
  status: string;
  side: Side;
  assetId: string;
  qtyBase: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  currency: string;
  journalId: string | null;
}

async function existingOrder(idempotencyKey: string): Promise<OrderResult | null> {
  const row = await getDb().queryOne<{
    id: string;
    status: string;
    side: Side;
    asset_id: string;
    qty_base: number | string;
    gross_minor: number | string;
    fee_minor: number | string;
    net_minor: number | string;
    currency: string;
    journal_id: string | null;
  }>("SELECT * FROM orders WHERE idempotency_key = ?", [idempotencyKey]);
  if (!row) return null;
  return {
    orderId: row.id,
    status: row.status,
    side: row.side,
    assetId: row.asset_id,
    qtyBase: BigInt(row.qty_base).toString(),
    grossMinor: BigInt(row.gross_minor).toString(),
    feeMinor: BigInt(row.fee_minor).toString(),
    netMinor: BigInt(row.net_minor).toString(),
    currency: row.currency,
    journalId: row.journal_id,
  };
}

export async function subscribe(
  userId: string,
  assetId: string,
  qtyBase: bigint,
  idempotencyKey: string
): Promise<OrderResult> {
  const dup = await existingOrder(idempotencyKey);
  if (dup) return dup;

  const t = await priceTrade(assetId, "subscribe", qtyBase);

  // Compliance: the subscriber must be eligible to hold the asset.
  const compliance = await checkTransfer(t.asset, userId);
  if (!compliance.allowed) throw new AppError(ErrorCode.COMPLIANCE_BLOCKED, compliance.reason ?? "Not eligible");

  const db = getDb();
  const orderId = uuidv4();

  return db.transaction(async (tx) => {
    const userCash = await getOrCreateUserAccount(userId, "user_cash", t.currency, tx);
    const escrowId = await getSystemAccount("escrow", t.currency, tx);

    const bal = await getBalance(userCash, tx);
    if (bal < t.net) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds to subscribe");

    // Escrow-in: user_cash → escrow (gross + fee).
    const escrowJournal = await postJournal(
      [
        { ledgerAccountId: userCash, direction: "debit", amountMinor: t.net, currency: t.currency },
        { ledgerAccountId: escrowId, direction: "credit", amountMinor: t.net, currency: t.currency },
      ],
      `Subscription escrow for asset ${assetId}`,
      { idempotencyKey: `mkt:sub:${idempotencyKey}`, db: tx }
    );

    await tx.execute(
      `INSERT INTO orders (id, asset_id, user_id, side, qty_base, price_minor, currency, gross_minor, fee_minor, net_minor, status, escrow_journal_id, idempotency_key, created_at)
       VALUES (?, ?, ?, 'subscribe', ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [
        orderId,
        assetId,
        userId,
        qtyBase.toString(),
        t.priceMinor.toString(),
        t.currency,
        t.gross.toString(),
        t.fee.toString(),
        t.net.toString(),
        escrowJournal,
        idempotencyKey,
        new Date().toISOString(),
      ]
    );
    await logAudit({ userId, action: "marketplace.subscribe", resource: orderId, details: { assetId, qtyBase: qtyBase.toString() } });

    return {
      orderId,
      status: "open",
      side: "subscribe",
      assetId,
      qtyBase: qtyBase.toString(),
      grossMinor: t.gross.toString(),
      feeMinor: t.fee.toString(),
      netMinor: t.net.toString(),
      currency: t.currency,
      journalId: escrowJournal,
    };
  });
}

/** Close (fund) a subscription: distribute the asset and release escrow to issuer + fee. */
export async function closeSubscription(orderId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const order = await loadOpenSubscription(tx, orderId);
    const asset = await requireAsset(order.asset_id);
    const qty = BigInt(order.qty_base);
    const gross = BigInt(order.gross_minor);
    const fee = BigInt(order.fee_minor);
    const net = BigInt(order.net_minor);
    const currency = order.currency;
    const code = assetLedgerCode(order.asset_id);

    const treasury = await getOrCreateAssetTreasury(order.asset_id, tx);
    const treasuryBal = await getBalance(treasury, tx);
    if (treasuryBal < qty) throw new AppError(ErrorCode.CONFLICT, "Insufficient treasury supply to fund subscription");

    const escrowId = await getSystemAccount("escrow", currency, tx);
    const feeId = await getSystemAccount("fee", currency, tx);
    const userAsset = await getOrCreateUserAssetAccount(order.user_id, order.asset_id, tx);
    const issuerCash = asset.issuerUserId
      ? await getOrCreateUserAccount(asset.issuerUserId, "user_cash", currency, tx)
      : await getSystemAccount("bank_settlement", currency, tx);

    const journalId = await postJournal(
      [
        // Cash leg: escrow → issuer (gross) + fee (fee).
        { ledgerAccountId: escrowId, direction: "debit", amountMinor: net, currency },
        { ledgerAccountId: issuerCash, direction: "credit", amountMinor: gross, currency },
        { ledgerAccountId: feeId, direction: "credit", amountMinor: fee, currency },
        // Asset leg: treasury → holder (qty).
        { ledgerAccountId: treasury, direction: "debit", amountMinor: qty, currency: code },
        { ledgerAccountId: userAsset, direction: "credit", amountMinor: qty, currency: code },
      ],
      `Subscription settlement for asset ${order.asset_id}`,
      { idempotencyKey: `mkt:sub-close:${orderId}`, db: tx }
    );

    await tx.execute("UPDATE orders SET status = 'filled', journal_id = ? WHERE id = ?", [journalId, orderId]);
    await logAudit({ userId: order.user_id, action: "marketplace.subscribe.close", resource: orderId, details: { assetId: order.asset_id } });
  });
}

/** Refund an under-subscribed / cancelled subscription: escrow → user_cash. */
export async function refundSubscription(orderId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const order = await loadOpenSubscription(tx, orderId);
    const net = BigInt(order.net_minor);
    const currency = order.currency;
    const escrowId = await getSystemAccount("escrow", currency, tx);
    const userCash = await getOrCreateUserAccount(order.user_id, "user_cash", currency, tx);

    const journalId = await postJournal(
      [
        { ledgerAccountId: escrowId, direction: "debit", amountMinor: net, currency },
        { ledgerAccountId: userCash, direction: "credit", amountMinor: net, currency },
      ],
      `Subscription refund for asset ${order.asset_id}`,
      { idempotencyKey: `mkt:sub-refund:${orderId}`, db: tx }
    );
    await tx.execute("UPDATE orders SET status = 'refunded', journal_id = ? WHERE id = ?", [journalId, orderId]);
    await logAudit({ userId: order.user_id, action: "marketplace.subscribe.refund", resource: orderId, details: { assetId: order.asset_id } });
  });
}

interface OpenSubRow {
  id: string;
  asset_id: string;
  user_id: string;
  qty_base: number | string;
  gross_minor: number | string;
  fee_minor: number | string;
  net_minor: number | string;
  currency: string;
  status: string;
}

async function loadOpenSubscription(tx: import("../db").Db, orderId: string): Promise<OpenSubRow> {
  const order = await tx.queryOne<OpenSubRow>("SELECT * FROM orders WHERE id = ? AND side = 'subscribe'", [orderId]);
  if (!order) throw new AppError(ErrorCode.NOT_FOUND, "Subscription order not found");
  if (order.status !== "open") throw new AppError(ErrorCode.CONFLICT, `Subscription is already ${order.status}`);
  return order;
}

// ---------------------------------------------------------------------------
// Secondary trading (buy / sell against the treasury)
// ---------------------------------------------------------------------------

export async function placeOrder(
  userId: string,
  assetId: string,
  side: "buy" | "sell",
  qtyBase: bigint,
  idempotencyKey: string
): Promise<OrderResult> {
  const dup = await existingOrder(idempotencyKey);
  if (dup) return dup;

  const t = await priceTrade(assetId, side, qtyBase);
  if (t.asset.status !== "active") throw new AppError(ErrorCode.CONFLICT, "Asset is not active for trading");

  const listingType = (t.asset.metadata ?? {}).listingType;
  if (listingType === "seller_p2p") {
    throw new AppError(
      ErrorCode.VALIDATION,
      "Seller listings use in-app escrow — purchase via POST /api/collectibles/purchase"
    );
  }

  // Compliance gates the BUYER (the party acquiring a securities position).
  if (side === "buy") {
    const compliance = await checkTransfer(t.asset, userId);
    if (!compliance.allowed) throw new AppError(ErrorCode.COMPLIANCE_BLOCKED, compliance.reason ?? "Not eligible");
  }

  const db = getDb();
  const orderId = uuidv4();
  const code = assetLedgerCode(assetId);

  return db.transaction(async (tx) => {
    const userCash = await getOrCreateUserAccount(userId, "user_cash", t.currency, tx);
    const userAsset = await getOrCreateUserAssetAccount(userId, assetId, tx);
    const treasury = await getOrCreateAssetTreasury(assetId, tx);
    const feeId = await getSystemAccount("fee", t.currency, tx);
    const settlement = await getSystemAccount("bank_settlement", t.currency, tx);

    let entries;
    if (side === "buy") {
      const cashBal = await getBalance(userCash, tx);
      if (cashBal < t.net) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient funds");
      const treasuryBal = await getBalance(treasury, tx);
      if (treasuryBal < qtyBase) throw new AppError(ErrorCode.CONFLICT, "Insufficient market inventory");
      entries = [
        // Cash: buyer pays gross + fee; gross → settlement, fee → fee.
        { ledgerAccountId: userCash, direction: "debit" as const, amountMinor: t.net, currency: t.currency },
        { ledgerAccountId: settlement, direction: "credit" as const, amountMinor: t.gross, currency: t.currency },
        { ledgerAccountId: feeId, direction: "credit" as const, amountMinor: t.fee, currency: t.currency },
        // Asset: treasury → buyer.
        { ledgerAccountId: treasury, direction: "debit" as const, amountMinor: qtyBase, currency: code },
        { ledgerAccountId: userAsset, direction: "credit" as const, amountMinor: qtyBase, currency: code },
      ];
    } else {
      const assetBal = await getBalance(userAsset, tx);
      if (assetBal < qtyBase) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient asset balance to sell");
      entries = [
        // Cash: settlement pays gross; seller gets gross - fee; fee → fee.
        { ledgerAccountId: settlement, direction: "debit" as const, amountMinor: t.gross, currency: t.currency },
        { ledgerAccountId: userCash, direction: "credit" as const, amountMinor: t.net, currency: t.currency },
        { ledgerAccountId: feeId, direction: "credit" as const, amountMinor: t.fee, currency: t.currency },
        // Asset: seller → treasury.
        { ledgerAccountId: userAsset, direction: "debit" as const, amountMinor: qtyBase, currency: code },
        { ledgerAccountId: treasury, direction: "credit" as const, amountMinor: qtyBase, currency: code },
      ];
    }

    const journalId = await postJournal(entries, `Secondary ${side} of asset ${assetId}`, {
      idempotencyKey: `mkt:order:${idempotencyKey}`,
      db: tx,
    });

    await tx.execute(
      `INSERT INTO orders (id, asset_id, user_id, side, qty_base, price_minor, currency, gross_minor, fee_minor, net_minor, status, journal_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'filled', ?, ?, ?)`,
      [
        orderId,
        assetId,
        userId,
        side,
        qtyBase.toString(),
        t.priceMinor.toString(),
        t.currency,
        t.gross.toString(),
        t.fee.toString(),
        t.net.toString(),
        journalId,
        idempotencyKey,
        new Date().toISOString(),
      ]
    );
    await logAudit({ userId, action: `marketplace.${side}`, resource: orderId, details: { assetId, qtyBase: qtyBase.toString() } });

    return {
      orderId,
      status: "filled",
      side,
      assetId,
      qtyBase: qtyBase.toString(),
      grossMinor: t.gross.toString(),
      feeMinor: t.fee.toString(),
      netMinor: t.net.toString(),
      currency: t.currency,
      journalId,
    };
  });
}

// ---------------------------------------------------------------------------
// Treasury delivery (escrow-confirmed seller P2P collectibles)
// ---------------------------------------------------------------------------

/** Move asset units from the asset treasury to a buyer (no cash leg). Idempotent on idempotencyKey. */
export async function deliverFromTreasury(
  buyerUserId: string,
  assetId: string,
  qtyBase: bigint,
  idempotencyKey: string
): Promise<{ journalId: string }> {
  if (qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be a positive integer");
  await requireAsset(assetId);

  const code = assetLedgerCode(assetId);
  const ledgerKey = `mkt:deliver:${idempotencyKey}`;

  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx.queryOne<{ id: string }>("SELECT id FROM ledger_journals WHERE idempotency_key = ?", [ledgerKey]);
    if (existing) return { journalId: existing.id };

    const treasury = await getOrCreateAssetTreasury(assetId, tx);
    const buyerAcct = await getOrCreateUserAssetAccount(buyerUserId, assetId, tx);

    const treasuryBal = await getBalance(treasury, tx);
    if (treasuryBal < qtyBase) throw new AppError(ErrorCode.CONFLICT, "Insufficient treasury inventory");

    const journalId = await postJournal(
      [
        { ledgerAccountId: treasury, direction: "debit", amountMinor: qtyBase, currency: code },
        { ledgerAccountId: buyerAcct, direction: "credit", amountMinor: qtyBase, currency: code },
      ],
      `Treasury delivery of asset ${assetId}`,
      { idempotencyKey: ledgerKey, db: tx }
    );
    await logAudit({
      userId: buyerUserId,
      action: "marketplace.deliver",
      resource: journalId,
      details: { assetId, qtyBase: qtyBase.toString() },
    });
    return { journalId };
  });
}

// ---------------------------------------------------------------------------
// Direct asset transfer (user → user), compliance-gated for securities
// ---------------------------------------------------------------------------

export async function transferAsset(
  fromUserId: string,
  toUserId: string,
  assetId: string,
  qtyBase: bigint,
  idempotencyKey: string
): Promise<{ journalId: string }> {
  if (qtyBase <= 0n) throw new AppError(ErrorCode.VALIDATION, "qtyBase must be a positive integer");
  if (fromUserId === toUserId) throw new AppError(ErrorCode.VALIDATION, "Cannot transfer to yourself");

  const db = getDb();
  const asset = await requireAsset(assetId);

  const recipient = await db.queryOne<{ id: string }>("SELECT id FROM users WHERE id = ?", [toUserId]);
  if (!recipient) throw new AppError(ErrorCode.NOT_FOUND, "Recipient not found");

  // Securities path runs the Compliance Module first.
  if (asset.isSecurity) {
    const compliance = await checkTransfer(asset, toUserId);
    if (!compliance.allowed) throw new AppError(ErrorCode.COMPLIANCE_BLOCKED, compliance.reason ?? "Transfer not permitted");
  }

  const code = assetLedgerCode(assetId);
  const ledgerKey = `mkt:xfer:${idempotencyKey}`;

  return db.transaction(async (tx) => {
    const existing = await tx.queryOne<{ id: string }>("SELECT id FROM ledger_journals WHERE idempotency_key = ?", [ledgerKey]);
    if (existing) return { journalId: existing.id };

    const fromAcct = await getOrCreateUserAssetAccount(fromUserId, assetId, tx);
    const toAcct = await getOrCreateUserAssetAccount(toUserId, assetId, tx);

    const bal = await getBalance(fromAcct, tx);
    if (bal < qtyBase) throw new AppError(ErrorCode.INSUFFICIENT_FUNDS, "Insufficient asset balance");

    const journalId = await postJournal(
      [
        { ledgerAccountId: fromAcct, direction: "debit", amountMinor: qtyBase, currency: code },
        { ledgerAccountId: toAcct, direction: "credit", amountMinor: qtyBase, currency: code },
      ],
      `Asset transfer ${assetId}`,
      { idempotencyKey: ledgerKey, db: tx }
    );
    await logAudit({
      userId: fromUserId,
      action: "marketplace.transfer",
      resource: journalId,
      details: { toUserId, assetId, qtyBase: qtyBase.toString() },
    });
    return { journalId };
  });
}
