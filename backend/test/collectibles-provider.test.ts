/**
 * Collectibles provider — Courtyard / Collector Crypt inventory sync.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";

const TMP_DB = `./data/test-collectibles-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("collectibles provider seam", () => {
  it("syncs simulated Courtyard-style inventory into marketplace", async () => {
    const { syncCollectiblesInventory, setCollectiblesProvider } = await import("../src/services/collectiblesProvider");
    const { getDb } = await import("../src/db");
    setCollectiblesProvider(null);
    const result = await syncCollectiblesInventory();
    expect(result.fetched).toBeGreaterThan(0);
    expect(result.upserted).toBeGreaterThan(0);

    const rows = await getDb().query<{ provider: string }>(
      "SELECT provider FROM external_collectible_listings WHERE status = 'active'"
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.provider).toBe("simulated");
  });
});
