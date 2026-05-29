/**
 * Phase 1 — Audit service.
 *
 * Append-only audit writes. The audit_logs table is protected by DB triggers that
 * block UPDATE/DELETE (see migrate.ts), so this service can only INSERT and SELECT.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";

export interface AuditInput {
  userId?: string | null;
  agentId?: string | null;
  agentName?: string | null;
  action: string;
  resource?: string;
  details?: Record<string, unknown>;
  status?: "success" | "failure" | "blocked";
  ipAddress?: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  action: string;
  resource: string;
  details: string;
  status: string;
  ip_address: string;
  created_at: string;
}

export async function logAudit(input: AuditInput): Promise<void> {
  await getDb().execute(
    `INSERT INTO audit_logs (id, user_id, agent_id, agent_name, action, resource, details, status, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      input.userId ?? null,
      input.agentId ?? null,
      input.agentName ?? null,
      input.action,
      input.resource ?? "",
      JSON.stringify(input.details ?? {}),
      input.status ?? "success",
      input.ipAddress ?? "",
      new Date().toISOString(),
    ]
  );
}

export async function getAuditLogs(userId: string, limit = 100): Promise<AuditLog[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  return getDb().query<AuditLog>(
    "SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, capped]
  );
}
