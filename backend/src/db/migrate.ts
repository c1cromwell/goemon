/**
 * Phase 1 — Migration runner.
 *
 * Runs the portable table DDL from migrations/*.sql, then applies dialect-specific
 * append-only triggers (UPDATE/DELETE blocked) on audit/ledger tables.
 *
 * Run with: npm run migrate
 * Also exported as runMigrations() so the server can apply migrations on boot in dev.
 */

import fs from "fs";
import path from "path";
import { getDb, closeDb, type Db } from "./index";

const APPEND_ONLY_TABLES = ["audit_logs", "ledger_entries", "ledger_journals", "mcp_audit_logs"];

async function applyAppendOnlyTriggers(db: Db): Promise<void> {
  if (db.dialect === "sqlite") {
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
  } else {
    // Postgres: a shared trigger function, then per-table triggers (drop-then-create for idempotency).
    await db.exec(`
      CREATE OR REPLACE FUNCTION bankai_block_modification() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `);
    for (const t of APPEND_ONLY_TABLES) {
      await db.exec(`
        DROP TRIGGER IF EXISTS ${t}_no_modify ON ${t};
        CREATE TRIGGER ${t}_no_modify
          BEFORE UPDATE OR DELETE ON ${t}
          FOR EACH ROW EXECUTE FUNCTION bankai_block_modification();
      `);
    }
  }
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  const dir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.exec(sql);
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied ${f}`);
  }

  await applyAppendOnlyTriggers(db);
  // eslint-disable-next-line no-console
  console.log(`[migrate] append-only triggers applied (${db.dialect})`);
}

// Allow running directly: `npm run migrate`
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
