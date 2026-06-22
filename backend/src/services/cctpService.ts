/**
 * Circle CCTP bridge seam — USDC cross-chain in/out (Module 04).
 *
 * Swappable CctpProvider: simulated default; circle is the prod swap requiring
 * Circle API keys + attestation service. Off unless CCTP_ENABLED=true.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";

export type CctpChain = "ethereum" | "base" | "polygon" | "hedera";

export interface CctpProvider {
  name: string;
  initiateTransfer(input: {
    userId: string;
    direction: "in" | "out";
    sourceChain: CctpChain;
    destChain: CctpChain;
    amountMicro: bigint;
  }): Promise<{ externalRef: string; status: "pending" | "completed" }>;
}

function assertEnabled(): void {
  if (!config.CCTP_ENABLED) {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "CCTP bridge is not enabled on this server");
  }
}

function simulatedProvider(): CctpProvider {
  return {
    name: "simulated",
    async initiateTransfer(input) {
      return {
        externalRef: `sim-cctp-${input.direction}-${uuidv4().slice(0, 8)}`,
        status: "completed",
      };
    },
  };
}

function notImplemented(name: string): CctpProvider {
  const fail = async (): Promise<never> => {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `CCTP_PROVIDER=${name} is not wired — integrate Circle CCTP API + attestation`
    );
  };
  return { name, initiateTransfer: fail };
}

let provider: CctpProvider | null = null;
export function setCctpProvider(p: CctpProvider | null): void {
  provider = p;
}

export function getCctpProvider(): CctpProvider {
  if (provider) return provider;
  switch (config.CCTP_PROVIDER) {
    case "circle":
      return notImplemented("circle");
    default:
      return simulatedProvider();
  }
}

export async function initiateCctpTransfer(input: {
  userId: string;
  direction: "in" | "out";
  sourceChain: CctpChain;
  destChain?: CctpChain;
  amountMicro: bigint;
  idempotencyKey?: string;
}): Promise<{ transferId: string; externalRef: string; status: string }> {
  assertEnabled();
  if (input.amountMicro <= 0n) throw new AppError(ErrorCode.VALIDATION, "amountMicro must be positive");

  const db = getDb();
  if (input.idempotencyKey) {
    const existing = await db.queryOne<{ id: string; external_ref: string; status: string }>(
      "SELECT id, external_ref, status FROM cctp_transfers WHERE idempotency_key = ?",
      [input.idempotencyKey]
    );
    if (existing) {
      return { transferId: existing.id, externalRef: existing.external_ref ?? "", status: existing.status };
    }
  }

  const destChain = input.destChain ?? "hedera";
  const result = await getCctpProvider().initiateTransfer({
    userId: input.userId,
    direction: input.direction,
    sourceChain: input.sourceChain,
    destChain,
    amountMicro: input.amountMicro,
  });

  const id = uuidv4();
  await db.execute(
    `INSERT INTO cctp_transfers
       (id, user_id, direction, source_chain, dest_chain, amount_micro, status, external_ref, idempotency_key, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      input.direction,
      input.sourceChain,
      destChain,
      input.amountMicro.toString(),
      result.status,
      result.externalRef,
      input.idempotencyKey ?? null,
      result.status === "completed" ? new Date().toISOString() : null,
    ]
  );

  await logAudit({
    userId: input.userId,
    action: "cctp.transfer",
    resource: id,
    details: { direction: input.direction, sourceChain: input.sourceChain, destChain, amountMicro: input.amountMicro.toString() },
  });

  return { transferId: id, externalRef: result.externalRef, status: result.status };
}

export async function listCctpTransfers(userId: string): Promise<unknown[]> {
  return getDb().query("SELECT * FROM cctp_transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [userId]);
}
