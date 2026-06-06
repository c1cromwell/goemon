/**
 * Clear the durable auth-lockout state (`auth_failures`).
 *
 * The lockout counts failures by `identifier OR ip` within
 * AUTH_LOCKOUT_MINUTES (rateLimit.ts). In E2E runs every request shares one IP
 * (127.0.0.1), so failures from one test — or accumulated across repeated runs —
 * can lock out password login for *all* users. Clearing the table before a run
 * keeps the suite deterministic. Dev/test hygiene only; never run in production.
 *
 * Run: npm run reset:auth
 */
import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";

async function main(): Promise<void> {
  await runMigrations();
  await getDb().execute("DELETE FROM auth_failures");
  console.log("[reset:auth] cleared auth_failures (lockout state)");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
