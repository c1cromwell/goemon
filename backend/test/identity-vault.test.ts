/**
 * Identity Vault — edge upsert + ledger sync.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unlinkSync } from "fs";
import { v4 as uuidv4 } from "uuid";

const TMP_DB = `./data/test-identity-vault-${Date.now()}.db`;

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

describe("identity vault", () => {
  it("upserts TRANSACTED_WITH edges and returns neighborhood", async () => {
    const { upsertEdge, getNeighborhood, graphFeaturesForUser } = await import("../src/services/identityVaultService");
    const a = uuidv4();
    const b = uuidv4();
    await upsertEdge({ fromUserId: a, toUserId: b, relationship: "TRANSACTED_WITH", weightDeltaMinor: 1000n });
    await upsertEdge({ fromUserId: a, toUserId: b, relationship: "TRANSACTED_WITH", weightDeltaMinor: 500n });

    const hood = await getNeighborhood(a);
    expect(hood.edges.length).toBeGreaterThan(0);
    expect(hood.edges[0]!.weightMinor).toBe("1500");

    const feats = await graphFeaturesForUser(a);
    expect(feats.outboundCount).toBe(1);
    expect(feats.transactedWeightMinor).toBe("1500");
  });
});
