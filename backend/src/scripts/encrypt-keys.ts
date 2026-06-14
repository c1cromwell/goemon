/**
 * Phase 20 — backfill: wrap any legacy plaintext secrets at rest (closes
 * invariant m / audit C-1).
 *
 *   - hedera_accounts: plaintext private_key_hex → wrapped private_key_enc; the
 *     plaintext column is nulled.
 *   - did_keys:        raw-JSON private_jwk      → wrapped private_jwk (in place).
 *
 * Idempotent: rows already wrapped are skipped. Reads/writes also self-heal lazily
 * on access (hederaService.loadSignerKey / didService.loadPrivateJwk); this script
 * just forces the migration eagerly. Dev/staging hygiene — run after deploying the
 * key-vault seam and before retiring plaintext from backups.
 *
 * Run: npm run encrypt-keys
 */
import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";
import { initKeyVault, getKeyVault, isWrapped } from "../services/keyVaultService";

async function main(): Promise<void> {
  await runMigrations();
  initKeyVault();
  const db = getDb();
  const vault = getKeyVault();

  // hedera_accounts — plaintext DER → wrapped, plaintext nulled.
  const hederaRows = await db.query<{ id: string; user_id: string; private_key_hex: string | null }>(
    "SELECT id, user_id, private_key_hex FROM hedera_accounts WHERE private_key_hex IS NOT NULL"
  );
  let hederaWrapped = 0;
  for (const row of hederaRows) {
    if (!row.private_key_hex) continue;
    const enc = await vault.wrap(row.private_key_hex, { aad: row.user_id });
    await db.execute(
      "UPDATE hedera_accounts SET private_key_enc = ?, private_key_hex = NULL WHERE id = ?",
      [enc, row.id]
    );
    hederaWrapped++;
  }

  // did_keys — raw-JSON private_jwk → wrapped in place.
  const didRows = await db.query<{ kid: string; private_jwk: string }>(
    "SELECT kid, private_jwk FROM did_keys"
  );
  let didWrapped = 0;
  for (const row of didRows) {
    if (isWrapped(row.private_jwk)) continue;
    const enc = await vault.wrap(row.private_jwk, { aad: row.kid });
    await db.execute("UPDATE did_keys SET private_jwk = ? WHERE kid = ?", [enc, row.kid]);
    didWrapped++;
  }

  console.log(`[encrypt-keys] wrapped ${hederaWrapped} hedera key(s), ${didWrapped} did key(s)`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
