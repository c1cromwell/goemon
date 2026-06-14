/**
 * Phase 1 — Migration runner.
 *
 * Runs the portable table DDL from migrations/*.sql, then applies dialect-specific
 * append-only triggers (UPDATE/DELETE blocked) on audit/ledger tables.
 *
 * A `schema_migrations` ledger records each applied file so runMigrations is
 * idempotent — safe to re-run on boot or via `npm run migrate` against an
 * already-migrated database. A pre-ledger database (migrated before the ledger
 * existed) is baselined: a migration whose objects already exist is recorded as
 * applied rather than re-run (see isAlreadyAppliedError).
 *
 * Run with: npm run migrate
 * Also exported as runMigrations() so the server can apply migrations on boot in dev.
 */

import fs from "fs";
import path from "path";
import { getDb, closeDb, type Db } from "./index";

const APPEND_ONLY_TABLES = ["audit_logs", "ledger_entries", "ledger_journals", "mcp_audit_logs", "fraud_decisions", "fills", "escrow_events", "payment_events", "reconciliation_runs", "reconciliation_findings", "account_holds", "transaction_flags", "agent_runs"];

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
      CREATE OR REPLACE FUNCTION argus_block_modification() RETURNS trigger AS $$
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
          FOR EACH ROW EXECUTE FUNCTION argus_block_modification();
      `);
    }
  }
}

/**
 * Ledger of applied migrations so each file runs exactly once. This makes
 * runMigrations idempotent — safe to re-run on boot or via `npm run migrate`
 * against an already-migrated database (additive ALTERs in 003+ would otherwise
 * error on a second run).
 */
async function ensureMigrationsLedger(db: Db): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function appliedMigrations(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(rows.map((r) => r.filename));
}

async function recordMigration(db: Db, filename: string): Promise<void> {
  const sql =
    db.dialect === "sqlite"
      ? "INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)"
      : "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?) ON CONFLICT (filename) DO NOTHING";
  await db.execute(sql, [filename, new Date().toISOString()]);
}

/**
 * True when an error means the migration's objects already exist — i.e. a
 * pre-ledger database that was migrated before this ledger existed. Such a
 * migration is "baselined" (recorded as applied) rather than re-run. Any other
 * error is a real failure and is re-thrown.
 */
function isAlreadyAppliedError(db: Db, e: unknown): boolean {
  const msg = (e as Error)?.message?.toLowerCase() ?? "";
  if (db.dialect === "sqlite") {
    return msg.includes("duplicate column name") || msg.includes("already exists");
  }
  // Postgres: duplicate_column 42701, duplicate_table 42P07, duplicate_object 42710.
  const code = (e as { code?: string })?.code ?? "";
  return ["42701", "42P07", "42710"].includes(code) || msg.includes("already exists");
}

export async function runMigrations(): Promise<void> {
  const db = getDb();
  await ensureMigrationsLedger(db);
  const applied = await appliedMigrations(db);

  const dir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    if (applied.has(f)) {
      // eslint-disable-next-line no-console
      console.log(`[migrate] skip ${f} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    try {
      await db.exec(sql);
      await recordMigration(db, f);
      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${f}`);
    } catch (e) {
      if (isAlreadyAppliedError(db, e)) {
        // Pre-ledger DB already has this migration's objects — baseline it.
        await recordMigration(db, f);
        // eslint-disable-next-line no-console
        console.log(`[migrate] baselined ${f} (objects already present)`);
      } else {
        throw e;
      }
    }
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
