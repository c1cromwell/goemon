/**
 * Phase 20 — wrap a secret with the configured key vault and print the blob.
 *
 * Used to produce the KMS-wrapped form of an env secret (e.g. HEDERA_OPERATOR_KEY,
 * which must be wrapped in production — see config.productionFatals). The AAD must
 * match what the reader uses (hederaService binds the operator key to "hedera:operator").
 *
 * Run: npm run wrap-secret -- <aad> <plaintext>
 *   e.g. npm run wrap-secret -- hedera:operator 302e0201...
 */
import { initKeyVault, getKeyVault } from "../services/keyVaultService";

async function main(): Promise<void> {
  const [aad, plaintext] = process.argv.slice(2);
  if (!aad || !plaintext) {
    console.error("usage: npm run wrap-secret -- <aad> <plaintext>");
    process.exit(2);
  }
  initKeyVault();
  const wrapped = await getKeyVault().wrap(plaintext, { aad });
  // Print only the wrapped blob so it can be piped into a secrets manager.
  console.log(wrapped);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
