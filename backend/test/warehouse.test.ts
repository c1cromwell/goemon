/**
 * Phase 20 — Data warehouse export seam tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { productionFatals } from "../src/config";

const TMP_DB = `./data/test-warehouse-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

async function setup() {
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
}

describe("Phase 20: data warehouse export", () => {
  beforeAll(async () => {
    await setup();
    const { config } = await import("../src/config");
    (config as { DATA_WAREHOUSE_ENABLED: boolean }).DATA_WAREHOUSE_ENABLED = true;
  });

  it("DATA_WAREHOUSE_ENABLED=false ⇒ runWarehouseExport returns skipped", async () => {
    const { config } = await import("../src/config");
    const { runWarehouseExport } = await import("../src/services/warehouseExportService");
    (config as { DATA_WAREHOUSE_ENABLED: boolean }).DATA_WAREHOUSE_ENABLED = false;
    try {
      const run = await runWarehouseExport();
      expect(run.result).toBe("skipped");
    } finally {
      (config as { DATA_WAREHOUSE_ENABLED: boolean }).DATA_WAREHOUSE_ENABLED = true;
    }
  });

  it("export batch writes to simulated staging and advances cursors", async () => {
    const { logAudit } = await import("../src/services/auditService");
    const {
      runWarehouseExport,
      getStagingRecordCount,
      getExportCursors,
    } = await import("../src/services/warehouseExportService");

    await logAudit({ action: "warehouse_test_event", resource: "test", details: { ok: true } });

    const before = await getStagingRecordCount();
    const run = await runWarehouseExport({ batchSize: 100 });
    expect(run.result).toBe("ok");
    expect(run.recordsExported).toBeGreaterThan(0);

    const after = await getStagingRecordCount();
    expect(after).toBeGreaterThan(before);

    const cursors = await getExportCursors();
    expect(cursors.some((c) => c.stream === "audit_logs")).toBe(true);
  });

  it("cursors prevent re-export; new audit rows export exactly once", async () => {
    const { logAudit } = await import("../src/services/auditService");
    const { runWarehouseExport } = await import("../src/services/warehouseExportService");

    await runWarehouseExport({ batchSize: 5000, streams: ["audit_logs"] });
    const idle = await runWarehouseExport({ batchSize: 5000, streams: ["audit_logs"] });
    expect(idle.recordsExported).toBe(0);

    await logAudit({ action: "warehouse_cursor_marker", resource: "test", details: { seq: Date.now() } });
    const incremental = await runWarehouseExport({ batchSize: 5000, streams: ["audit_logs"] });
    expect(incremental.recordsExported).toBe(1);
  });

  it("productionFatals refuses DATA_WAREHOUSE_ENABLED with simulated sink in production", () => {
    const base = {
      NODE_ENV: "production",
      JWT_SECRET: "x".repeat(32),
      ADMIN_JWT_SECRET: "y".repeat(32),
      ALLOW_PASSWORD_AUTH: false,
      KMS_PROVIDER: "aws",
      TRADING_ENABLED: false,
      DATA_WAREHOUSE_ENABLED: false,
      WAREHOUSE_SINK: "simulated",
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("DATA_WAREHOUSE"))).toBe(false);
    const on = { ...base, DATA_WAREHOUSE_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("DATA_WAREHOUSE"))).toBe(true);
  });

  it("warehouse_export_runs are append-only", async () => {
    const { getDb } = await import("../src/db");
    await expect(
      getDb().execute("UPDATE warehouse_export_runs SET result = 'error' WHERE result = 'ok'")
    ).rejects.toThrow(/append-only/i);
  });
});
