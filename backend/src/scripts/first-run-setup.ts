/**
 * Phase 13 — First-run setup (one command).
 *
 * Idempotent wire-up of a fresh dev environment:
 *   1. migrations + token factory + system ledger accounts
 *   2. seed the default RBAC admin (admin@bankai.com / Admin1234!, role 'admin')
 *   3. register the simulator external agent as an MCP client
 *   4. seed the five demo users (varying tiers + balances)
 *
 * Safe to re-run: each step skips work that already exists.
 *
 * Run: npm run setup
 */

import { closeDb, getDb } from "../db";
import { runMigrations } from "../db/migrate";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts } from "../services/ledgerService";
import { seedAdmin } from "../services/adminService";
import { getClient, registerClient } from "../services/mcpClientRegistry";
import { seedDemoUsers, printDemoManifest } from "./seed-demo-users";

// NOTE on `allowedFunctions`: presentationService computes the effective scope as
// VC ∩ client ∩ requested ∩ grant — so a client's allowedFunctions must be SCOPE
// strings (balance:read, transfer:low, …), NOT MCP tool names. (The plan's Phase
// 13 example listed tool names, which would make every intersection empty.) The
// MCP tools map their own requiredScope, so these scopes unlock the matching tools.
const SIMULATOR_AGENT = {
  clientDid: "did:simulator:agent-app",
  displayName: "BankAI Simulator Agent",
  allowedFunctions: ["balance:read", "statement:read", "profile:read", "transfer:low"],
  maxTransferMinor: 50_000n, // $500.00 ceiling
  currency: "USD" as const,
  requireUserApproval: true,
};

async function main(): Promise<void> {
  console.log("== BankAI first-run setup ==");

  await runMigrations();
  await initTokenFactory();
  await bootstrapSystemAccounts();
  console.log("[1/4] migrations + token factory + system accounts ✓");

  // 2. RBAC admin (idempotent).
  const admin = await seedAdmin();
  console.log(`[2/4] admin ${admin.email} ${admin.created ? "created" : "already present"} (password: Admin1234!)`);

  // 3. Simulator MCP client (idempotent; repairs stale allowedFunctions on re-run).
  const existing = await getClient(SIMULATOR_AGENT.clientDid);
  if (!existing) {
    await registerClient(SIMULATOR_AGENT);
    console.log(`[3/4] MCP client ${SIMULATOR_AGENT.clientDid} registered (scopes, $500 ceiling)`);
  } else {
    await getDb().execute(
      "UPDATE mcp_clients SET allowed_functions = ?, max_transfer_minor = ?, active = 1 WHERE client_did = ?",
      [JSON.stringify(SIMULATOR_AGENT.allowedFunctions), SIMULATOR_AGENT.maxTransferMinor.toString(), SIMULATOR_AGENT.clientDid]
    );
    console.log(`[3/4] MCP client ${SIMULATOR_AGENT.clientDid} updated to scope vocabulary`);
  }

  // 4. Demo users.
  console.log("[4/4] seeding demo users…");
  await seedDemoUsers();
  printDemoManifest();

  console.log("\nFirst-run setup complete. Start the backend with `npm run dev`.");
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[setup] failed:", e);
    await closeDb();
    process.exit(1);
  });
