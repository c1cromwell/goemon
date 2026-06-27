/**
 * M2 — CEO milestone deploy sign-offs (M1, M2, …).
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import type { AdminRole } from "../middleware/rbac";

export interface MilestoneDef {
  id: string;
  title: string;
  description: string;
}

export const MILESTONES: MilestoneDef[] = [
  { id: "M1", title: "Design + branding + webview", description: "Agentic OS design doc and local webview (no backend code)." },
  { id: "M2", title: "Governance core", description: "CEO/CS RBAC, gate policy, Approvals admin surface." },
  { id: "M3", title: "Decision knowledge graph", description: "kg_nodes/kg_edges + decisionGraph service." },
  { id: "M4", title: "Model router", description: "Registry, routing policy, model_invocations telemetry." },
  { id: "M5", title: "Corporate agent fleet", description: "CFO/CLO/CISO/CPO/CMO/Compliance/SRE skills." },
  { id: "M6", title: "Product squad + PDLC", description: "PDLC orchestrator + product KG + Agentic Builder loop." },
];

const SIGNOFF_ROLES: AdminRole[] = ["ceo", "chief_of_staff", "admin"];

export interface MilestoneStatus extends MilestoneDef {
  signed: boolean;
  signedAt: string | null;
  approverRole: string | null;
  note: string | null;
}

export async function listMilestoneStatuses(): Promise<MilestoneStatus[]> {
  const db = getDb();
  const rows = await db.query<{ milestone_id: string; signed_at: string; approver_role: string; note: string | null }>(
    "SELECT milestone_id, signed_at, approver_role, note FROM ceo_milestone_signoffs"
  );
  const byId = new Map(rows.map((r) => [r.milestone_id, r]));
  return MILESTONES.map((m) => {
    const s = byId.get(m.id);
    return {
      ...m,
      signed: !!s,
      signedAt: s?.signed_at ?? null,
      approverRole: s?.approver_role ?? null,
      note: s?.note ?? null,
    };
  });
}

export async function signMilestone(
  milestoneId: string,
  actor: { adminId: string; role: AdminRole },
  note?: string
): Promise<MilestoneStatus> {
  if (!SIGNOFF_ROLES.includes(actor.role)) {
    throw new AppError(ErrorCode.FORBIDDEN, "Requires role: ceo, chief_of_staff, or admin");
  }
  const def = MILESTONES.find((m) => m.id === milestoneId);
  if (!def) throw new AppError(ErrorCode.NOT_FOUND, `Unknown milestone ${milestoneId}`);

  const db = getDb();
  const existing = await db.queryOne<{ milestone_id: string }>(
    "SELECT milestone_id FROM ceo_milestone_signoffs WHERE milestone_id = ?",
    [milestoneId]
  );
  if (existing) throw new AppError(ErrorCode.CONFLICT, `Milestone ${milestoneId} already signed`);

  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO ceo_milestone_signoffs (id, milestone_id, title, approver_admin_id, approver_role, note, signed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), milestoneId, def.title, actor.adminId, actor.role, note ?? null, now]
  );
  await logAudit({
    action: "ceo.milestone.signoff",
    resource: milestoneId,
    details: { approverAdminId: actor.adminId, role: actor.role, note: note ?? null },
  });

  const statuses = await listMilestoneStatuses();
  return statuses.find((s) => s.id === milestoneId)!;
}
