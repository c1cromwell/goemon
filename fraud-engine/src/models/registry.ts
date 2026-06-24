/**
 * Model registry — the MLflow / Databricks Model Registry analog (Stage 4).
 *
 * Persists which model versions exist and their rollout status
 * (prod | shadow | canary | retired). The fraud team promotes/demotes versions
 * here (via /v1/models/:version/promote) and the router reads it live, so a model
 * can be shadow-tested then promoted to prod with a config change, no redeploy.
 */

import type { Db } from "../db";

export type ModelStatus = "prod" | "shadow" | "canary" | "retired";

export interface ModelRecord {
  version: string;
  kind: "rules" | "sequence";
  status: ModelStatus;
  canaryPct: number;
  /** Optional CEL predicate; when set, a canary is active only when it evals true. */
  cohortExpr: string | null;
  notes: string | null;
}

interface ModelRow {
  version: string;
  kind: "rules" | "sequence";
  status: ModelStatus;
  canary_pct: number;
  cohort_expr: string | null;
  notes: string | null;
}

export class ModelRegistry {
  constructor(private db: Db) {}

  async register(version: string, kind: "rules" | "sequence", status: ModelStatus, notes?: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO models (version, kind, status, notes, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(version) DO NOTHING`,
      [version, kind, status, notes ?? null, new Date().toISOString()]
    );
  }

  async list(): Promise<ModelRecord[]> {
    const rows = await this.db.query<ModelRow>("SELECT * FROM models ORDER BY created_at");
    return rows.map(toRecord);
  }

  async get(version: string): Promise<ModelRecord | null> {
    const row = await this.db.queryOne<ModelRow>("SELECT * FROM models WHERE version = ?", [version]);
    return row ? toRecord(row) : null;
  }

  async byStatus(status: ModelStatus): Promise<ModelRecord[]> {
    const rows = await this.db.query<ModelRow>("SELECT * FROM models WHERE status = ? ORDER BY created_at", [status]);
    return rows.map(toRecord);
  }

  /** Promote/demote a version. canaryPct only applies when status=canary. */
  async promote(version: string, status: ModelStatus, canaryPct = 0): Promise<void> {
    await this.db.execute(
      "UPDATE models SET status = ?, canary_pct = ?, updated_at = ? WHERE version = ?",
      [status, status === "canary" ? Math.max(0, Math.min(100, canaryPct)) : 0, new Date().toISOString(), version]
    );
  }
}

function toRecord(r: ModelRow): ModelRecord {
  return {
    version: r.version,
    kind: r.kind,
    status: r.status,
    canaryPct: Number(r.canary_pct),
    cohortExpr: r.cohort_expr ?? null,
    notes: r.notes,
  };
}
