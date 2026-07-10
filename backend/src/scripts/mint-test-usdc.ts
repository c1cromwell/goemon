/**
 * Phase 1 step 4 — mint a self-issued TEST HTS token to prove the money path end-to-end on a
 * real network BEFORE wiring real Circle USDC. Creates a 6-dp fungible token (matching USDC
 * micro-units), treasury = the operator, on the configured HEDERA_NETWORK, and prints the token
 * id to set as HEDERA_USDC_TOKEN_ID.
 *
 * Run (testnet first):
 *   HEDERA_ENABLED=true HEDERA_NETWORK=testnet \
 *   HEDERA_OPERATOR_ID=0.0.xxxx HEDERA_OPERATOR_KEY=<der-or-gcm.v1.-wrapped> \
 *     npm run hedera:mint-test-usdc
 *
 * With a KMS-signing operator, set HEDERA_OPERATOR_KMS_KEY + HEDERA_OPERATOR_PUBLIC_KEY instead —
 * the client signs the create via the operator (treasury) automatically.
 */
import { AccountId, TokenCreateTransaction, TokenType } from "@hashgraph/sdk";
import { config } from "../config";
import { initKeyVault } from "../services/keyVaultService";
import { initHedera, getHederaClient } from "../services/hederaService";

async function main(): Promise<void> {
  if (!config.HEDERA_ENABLED) throw new Error("HEDERA_ENABLED must be true to mint a test token");
  if (!config.HEDERA_OPERATOR_ID) throw new Error("HEDERA_OPERATOR_ID is required");

  initKeyVault(); // needed to unwrap a gcm.v1.-wrapped operator key
  await initHedera();
  const client = getHederaClient();
  const operatorId = AccountId.fromString(config.HEDERA_OPERATOR_ID);

  const DECIMALS = 6;
  const supplyBase = 1_000_000_000_000; // 1,000,000 tUSDC at 6 dp

  console.log(`Creating test token on ${config.HEDERA_NETWORK} (treasury ${operatorId.toString()})…`);
  const resp = await new TokenCreateTransaction()
    .setTokenName("Goemon Test USDC")
    .setTokenSymbol("tUSDC")
    .setDecimals(DECIMALS)
    .setInitialSupply(supplyBase)
    .setTreasuryAccountId(operatorId)
    .setTokenType(TokenType.FungibleCommon)
    .freezeWith(client)
    .execute(client);
  const receipt = await resp.getReceipt(client);
  const tokenId = receipt.tokenId?.toString();
  if (!tokenId) throw new Error("Token create returned no token id");

  console.log("");
  console.log(`  ✅ Test token created: ${tokenId}`);
  console.log(`  Treasury (operator) holds ${supplyBase} base units = 1,000,000 tUSDC @ ${DECIMALS}dp.`);
  console.log(`  Set  HEDERA_USDC_TOKEN_ID=${tokenId}  to route the money path through it,`);
  console.log(`  then swap to real Circle USDC-HTS once flows are green.`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("mint-test-usdc failed:", e);
    process.exit(1);
  });
