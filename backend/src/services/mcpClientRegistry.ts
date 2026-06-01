/**
 * Phase 7 — MCP client registry.
 *
 * External AI-agent applications (the "clients") are registered here before they
 * can request access on a user's behalf. A client declares the functions it may
 * ever call and a hard per-transfer ceiling; these are one of the four sets that
 * the effective scope is intersected against in presentationService. Registration
 * and suspension are admin operations (gated in the admin routes).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";

export interface McpClientRow {
  id: string;
  client_did: string;
  display_name: string;
  description: string;
  allowed_functions: string; // JSON array of scope strings
  max_transfer_minor: number;
  currency: string;
  require_user_approval: number;
  active: number;
  registered_by: string | null;
  registered_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
}

export interface McpClient {
  id: string;
  clientDid: string;
  displayName: string;
  description: string;
  allowedFunctions: string[];
  maxTransferMinor: bigint;
  currency: string;
  requireUserApproval: boolean;
  active: boolean;
}

function toClient(row: McpClientRow): McpClient {
  return {
    id: row.id,
    clientDid: row.client_did,
    displayName: row.display_name,
    description: row.description,
    allowedFunctions: JSON.parse(row.allowed_functions || "[]"),
    maxTransferMinor: BigInt(row.max_transfer_minor ?? 0),
    currency: row.currency,
    requireUserApproval: row.require_user_approval === 1,
    active: row.active === 1,
  };
}

export interface RegisterClientInput {
  clientDid: string;
  displayName: string;
  description?: string;
  allowedFunctions: string[];
  maxTransferMinor: bigint;
  currency?: string;
  requireUserApproval?: boolean;
  registeredBy?: string;
}

export async function registerClient(input: RegisterClientInput): Promise<McpClient> {
  if (!input.clientDid) throw new AppError(ErrorCode.VALIDATION, "clientDid required");
  if (input.maxTransferMinor < 0n) throw new AppError(ErrorCode.VALIDATION, "maxTransferMinor must be >= 0");

  const db = getDb();
  const existing = await db.queryOne<McpClientRow>("SELECT * FROM mcp_clients WHERE client_did = ?", [input.clientDid]);
  if (existing) throw new AppError(ErrorCode.CONFLICT, "Client already registered");

  const id = uuidv4();
  await db.execute(
    `INSERT INTO mcp_clients
       (id, client_did, display_name, description, allowed_functions, max_transfer_minor,
        currency, require_user_approval, active, registered_by, registered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      input.clientDid,
      input.displayName,
      input.description ?? "",
      JSON.stringify(input.allowedFunctions),
      input.maxTransferMinor.toString(),
      input.currency ?? "USD",
      input.requireUserApproval === false ? 0 : 1,
      input.registeredBy ?? null,
      new Date().toISOString(),
    ]
  );
  await logAudit({
    action: "mcp.client.register",
    resource: input.clientDid,
    details: { displayName: input.displayName, allowedFunctions: input.allowedFunctions },
  });
  return (await getClient(input.clientDid))!;
}

export async function getClient(clientDid: string): Promise<McpClient | null> {
  const row = await getDb().queryOne<McpClientRow>("SELECT * FROM mcp_clients WHERE client_did = ?", [clientDid]);
  return row ? toClient(row) : null;
}

export async function listClients(): Promise<McpClient[]> {
  const rows = await getDb().query<McpClientRow>("SELECT * FROM mcp_clients ORDER BY registered_at DESC");
  return rows.map(toClient);
}

export async function suspendClient(clientDid: string, reason: string): Promise<void> {
  const db = getDb();
  const row = await db.queryOne<McpClientRow>("SELECT * FROM mcp_clients WHERE client_did = ?", [clientDid]);
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Client not found");
  await db.execute(
    "UPDATE mcp_clients SET active = 0, suspended_at = ?, suspended_reason = ? WHERE client_did = ?",
    [new Date().toISOString(), reason, clientDid]
  );
  await logAudit({ action: "mcp.client.suspend", resource: clientDid, details: { reason }, status: "blocked" });
}
