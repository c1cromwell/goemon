/**
 * Migration runner. Applies schema.sql, then SQLite append-only triggers on the
 * immutable tables (decisions, case_events) — UPDATE/DELETE are blocked, the same
 * invariant the Goeman ledger/audit tables enforce.
 *
 * Idempotent: schema.sql is all CREATE ... IF NOT EXISTS, and triggers use
 * CREATE TRIGGER IF NOT EXISTS. Safe to run on every boot.
 */

import fs from "fs";
import path from "path";
import { getDb, closeDb, type Db } from "./index";

const APPEND_ONLY_TABLES = ["decisions", "case_events"];

async function applyAppendOnlyTriggers(db: Db): Promise<void> {
  for (const t of APPEND_ONLY_TABLES) {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${t}_no_update
        BEFORE UPDATE ON ${t}
        BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS ${t}_no_delete
        BEFORE DELETE ON ${t}
        BEGIN SELECT RAISE(ABORT, '${t} is append-only'); END;
    `);
  }
}

export async function runMigrations(db: Db = getDb()): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await db.exec(sql);
  await applyAppendOnlyTriggers(db);

  // Seed the single routing_config row if absent.
  const cfg = await db.queryOne<{ id: string }>("SELECT id FROM routing_config WHERE id = 'default'");
  if (!cfg) {
    await db.execute("INSERT INTO routing_config (id) VALUES ('default')");
  }
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      // eslint-disable-next-line no-console
      console.log("[migrate] done");
      await closeDb();
      process.exit(0);
    })
    .catch(async (e) => {
      // eslint-disable-next-line no-console
      console.error("[migrate] failed:", e);
      await closeDb();
      process.exit(1);
    });
}
