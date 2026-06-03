/**
 * Phase 13 — Demo user seed (first-run setup).
 *
 * Creates five password-loginable demo users (ALLOW_PASSWORD_AUTH must be on,
 * i.e. dev) at varying identity tiers with varying integer-minor opening balances,
 * so the customer portal has realistic data to show. Three lower-tier users are
 * pre-assigned a rejection document number (1=expired, 2=tampered, 3=low quality)
 * — submit that number in the onboarding document step to demo each rejection.
 *
 * Idempotent: existing demo users (by email) are skipped, never overwritten.
 *
 * Run: npm run seed:users   (or via `npm run setup` for the full first-run wire-up)
 */

import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts, getOrCreateUserAccount, getUserBalances } from "../services/ledgerService";
import { createUser, getUserByEmail, hashPassword } from "../services/authService";

export const DEMO_PASSWORD = "Demo1234!";

interface DemoSpec {
  email: string;
  name: string;
  tier: number;
  balanceMinor: bigint;
  status: string; // identity_status (mirrors identityService strings)
  /** Doc number that triggers a rejection in the onboarding document step. */
  rejectionDoc?: "1" | "2" | "3";
  note: string;
}

export const DEMO_USERS: DemoSpec[] = [
  { email: "alex@demo.com", name: "Alex Rivera", tier: 2, balanceMinor: 1_250_000n, status: "kyc_passed", note: "Verified member — transfers + SmartChat" },
  { email: "blair@demo.com", name: "Blair Chen", tier: 2, balanceMinor: 4_000_000n, status: "kyc_passed", note: "Verified — marketplace Invest (accredited)" },
  { email: "casey@demo.com", name: "Casey Morgan", tier: 1, balanceMinor: 300_000n, status: "tier1_verified", rejectionDoc: "1", note: "Phone-verified; rejection demo (expired doc)" },
  { email: "drew@demo.com", name: "Drew Patel", tier: 0, balanceMinor: 75_000n, status: "pending", rejectionDoc: "2", note: "Fresh signup; rejection demo (tampered doc)" },
  { email: "erin@demo.com", name: "Erin Walsh", tier: 0, balanceMinor: 25_000n, status: "pending", rejectionDoc: "3", note: "Fresh signup; rejection demo (low-quality doc)" },
];

export async function seedDemoUsers(): Promise<void> {
  const db = getDb();
  const hash = await hashPassword(DEMO_PASSWORD);
  const now = new Date().toISOString();

  for (const spec of DEMO_USERS) {
    if (await getUserByEmail(spec.email)) {
      console.log(`[users] ${spec.email} already exists — skipping`);
      continue;
    }

    const user = await createUser(spec.email, spec.name, hash);

    // createUser opens a legacy accounts row at $10,000; set the desired opening
    // balance BEFORE the ledger account materialises its opening journal.
    await db.execute("UPDATE accounts SET balance_minor = ? WHERE user_id = ?", [spec.balanceMinor.toString(), user.id]);
    await getOrCreateUserAccount(user.id, "user_cash", "USD");

    const sanctionsClear = spec.tier >= 2 ? 1 : null;
    const riskTier = spec.tier >= 2 ? "low" : "unknown";
    await db.execute(
      `UPDATE identity_profiles
         SET tier = ?, identity_status = ?, risk_tier = ?, sanctions_clear = ?, jurisdiction = 'US', updated_at = ?
       WHERE user_id = ?`,
      [spec.tier, spec.status, riskTier, sanctionsClear, now, user.id]
    );

    const { cash } = await getUserBalances(user.id);
    const doc = spec.rejectionDoc ? ` · rejection-doc=${spec.rejectionDoc}` : "";
    console.log(`[users] ${spec.email} → Tier ${spec.tier}, cash ${cash} minor${doc}  (${spec.note})`);
  }
}

/** Pretty manifest printed after seeding. */
export function printDemoManifest(): void {
  console.log("\nDemo users (password for all): " + DEMO_PASSWORD);
  for (const u of DEMO_USERS) {
    const doc = u.rejectionDoc ? `   rejection doc#: ${u.rejectionDoc}` : "";
    console.log(`  ${u.email.padEnd(16)} Tier ${u.tier}  $${(Number(u.balanceMinor) / 100).toFixed(2).padStart(10)}${doc}`);
  }
  console.log("\nRejection demo: log in as casey/drew/erin, start onboarding, and submit the");
  console.log("assigned document number in the document step (1=expired, 2=tampered, 3=low quality).");
}

// Run standalone (skipped when imported by first-run-setup).
if (require.main === module) {
  (async () => {
    await runMigrations();
    await initTokenFactory();
    await bootstrapSystemAccounts();
    await seedDemoUsers();
    printDemoManifest();
  })()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error("[seed:users] failed:", e);
      await closeDb();
      process.exit(1);
    });
}
