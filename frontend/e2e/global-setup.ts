import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Seed the dev DB before the web servers boot.
 *
 * `npm run setup` is idempotent: migrate + RBAC admin (admin@bankai.com /
 * Admin1234!) + simulator MCP client + the five demo users (*@demo.com /
 * Demo1234!). `seed:marketplace` adds the Invest/Collect listings the portal
 * renders. Both talk to SQLite directly — no server needed yet.
 *
 * These scripts only ever create-if-absent, so re-running across test runs is
 * safe; tests that mutate state register their own throwaway users instead of
 * touching the demo accounts.
 */
export default async function globalSetup() {
  const backend = path.resolve(here, "../../backend");
  const run = (script: string) => {
    process.stdout.write(`\n[e2e setup] ${script}\n`);
    execSync(`npm run ${script}`, { cwd: backend, stdio: "inherit" });
  };

  run("setup");
  run("seed:marketplace");
  // Clear durable auth-lockout state: the limiter counts failures by shared test
  // IP, so stale failures would lock out password login for every demo user.
  run("reset:auth");
}
