/**
 * Phase 24 — product catalog, x401, x402, borderless savings (standalone-first).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";
import { config } from "../src/config";
import { publicJwkToDidKey } from "../src/utils/didKey";

const TMP_DB = `./data/test-phase24-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  (config as { X401_ENABLED: boolean }).X401_ENABLED = true;
  (config as { X402_ENABLED: boolean }).X402_ENABLED = true;
  (config as { ARGUS_PAY_ENABLED: boolean }).ARGUS_PAY_ENABLED = true;
  (config as { CHECKOUT_VP_ENABLED: boolean }).CHECKOUT_VP_ENABLED = true;
  (config as { BORDERLESS_SAVINGS_ENABLED: boolean }).BORDERLESS_SAVINGS_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("fs").unlinkSync(TMP_DB + suffix);
    } catch {
      /* ignore */
    }
  }
});

interface Wallet {
  walletDid: string;
  privateKey: KeyLike;
}

async function makeWallet(): Promise<Wallet> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { walletDid: publicJwkToDidKey(await exportJWK(publicKey)), privateKey };
}

describe("Phase 24 product catalog", () => {
  it("lists standalone-ready SKUs when core flags are on", async () => {
    const { listSupportedProducts, catalogSummary } = await import("../src/services/productCatalogService");
    const summary = catalogSummary();
    expect(summary.enabled).toBeGreaterThanOrEqual(5);
    const standalone = listSupportedProducts({ enabledOnly: true }).filter((p) => p.standaloneReady);
    expect(standalone.some((p) => p.sku === "agent.x401.identity")).toBe(true);
    expect(standalone.some((p) => p.sku === "wallet.usdc.p2p")).toBe(true);
  });
});

describe("Phase 24 x401", () => {
  it("issues PROOF-REQUIRED and verifies PROOF-PRESENTATION", async () => {
    const { registerClient } = await import("../src/services/mcpClientRegistry");
    const { grantAgent } = await import("../src/services/userAgentGrantService");
    const { createUser } = await import("../src/services/authService");
    const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");
    const { issueProofRequirement, verifyProofPresentation, encodeProofPresentation } = await import(
      "../src/services/x401Service"
    );

    const clientDid = `did:simulator:x401-${uuidv4()}`;
    await registerClient({ clientDid, displayName: "x401 test", allowedFunctions: ["balance:read"], maxTransferMinor: 50000n });
    const u = await createUser(`x401-${Date.now()}@test.com`, "User");
    await issueCredential(u.id, 2, ["balance:read"], "PASSED");
    const wallet = await makeWallet();
    await bindWalletDid(u.id, wallet.walletDid);
    await grantAgent({ userId: u.id, agentDid: clientDid, displayName: "x401", allowedFunctions: ["balance:read"], maxTransferMinor: 50000n });

    const req = await issueProofRequirement(clientDid, ["balance:read"]);
    expect(req.header.length).toBeGreaterThan(10);

    const cred = (await getCredential(u.id))!;
    const vpJwt = await new SignJWT({
      nonce: req.challenge.nonce,
      vp: {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        type: ["VerifiablePresentation"],
        holder: wallet.walletDid,
        verifiableCredential: [cred.vc_jwt],
      },
    })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer(wallet.walletDid)
      .setAudience(config.BASE_URL)
      .setJti(uuidv4())
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(wallet.privateKey);

    const header = encodeProofPresentation({ vp_jwt: vpJwt });
    const result = await verifyProofPresentation({ presentationHeader: header });
    expect(result.scoped.userId).toBe(u.id);
    expect(result.verification.token.length).toBeGreaterThan(10);
  });
});

describe("Phase 24 x402", () => {
  it("returns 402 payment requirement and fulfills via checkout VP", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount, postJournal, getOrCreateSystemAccount } = await import("../src/services/ledgerService");
    const { createMerchant, createPaymentIntent } = await import("../src/services/paymentService");
    const { issueCheckoutChallenge } = await import("../src/services/presentationService");
    const { buildPaymentRequiredForIntent, fulfillPayment, encodePaymentFulfillment } = await import("../src/services/x402Service");
    const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");

    const merchantOwner = await createUser(`merch-x402-${Date.now()}@test.com`, "Merchant");
    const payer = await createUser(`payer-x402-${Date.now()}@test.com`, "Payer");
    await issueCredential(payer.id, 2, ["pay:merchant"], "PASSED");
    const wallet = await makeWallet();
    await bindWalletDid(payer.id, wallet.walletDid);

    const payerCash = await getOrCreateUserAccount(payer.id, "user_cash", "USD");
    const ext = await getOrCreateSystemAccount("external_clearing", "USD");
    await postJournal(
      [
        { ledgerAccountId: ext, direction: "debit", amountMinor: 5000n, currency: "USD" },
        { ledgerAccountId: payerCash, direction: "credit", amountMinor: 5000n, currency: "USD" },
      ],
      "seed payer",
      { idempotencyKey: uuidv4() }
    );

    const merchant = await createMerchant(merchantOwner.id, "x402 Shop");
    const intent = await createPaymentIntent({
      merchantId: merchant.id,
      actorUserId: merchantOwner.id,
      amountMinor: 1000n,
      currency: "USD",
      idempotencyKey: uuidv4(),
    });

    const built = await buildPaymentRequiredForIntent(intent);
    expect(built.status).toBe(402);
    expect(built.payload.intent_id).toBe(intent.id);

    const challenge = await issueCheckoutChallenge(intent.id);
    const cred = (await getCredential(payer.id))!;
    const vpJwt = await new SignJWT({
      nonce: challenge.nonce,
      vp: {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        type: ["VerifiablePresentation"],
        holder: wallet.walletDid,
        verifiableCredential: [cred.vc_jwt],
      },
    })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer(wallet.walletDid)
      .setAudience(config.BASE_URL)
      .setJti(uuidv4())
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(wallet.privateKey);

    const fulfillment = encodePaymentFulfillment({ intent_id: intent.id, vp_jwt: vpJwt });
    const paid = await fulfillPayment({ fulfillmentHeader: fulfillment });
    expect(paid.intent.status).toBe("held");
    expect(paid.payerUserId).toBe(payer.id);
  });
});

describe("Phase 24 borderless savings", () => {
  it("enrolls, deposits USDC, and accrues interest idempotently", async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount, postJournal, getOrCreateSystemAccount } = await import("../src/services/ledgerService");
    const {
      enrollBorderlessSavings,
      depositToSavings,
      accrueBorderlessDaily,
      getBorderlessSummary,
    } = await import("../src/services/savingsProductService");

    const u = await createUser(`savings-${Date.now()}@test.com`, "Saver");
    const cash = await getOrCreateUserAccount(u.id, "user_cash", "USDC");
    const ext = await getOrCreateSystemAccount("external_clearing", "USDC");
    await postJournal(
      [
        { ledgerAccountId: ext, direction: "debit", amountMinor: 1_000_000n, currency: "USDC" },
        { ledgerAccountId: cash, direction: "credit", amountMinor: 1_000_000n, currency: "USDC" },
      ],
      "seed usdc",
      { idempotencyKey: uuidv4() }
    );

    await enrollBorderlessSavings(u.id);
    await depositToSavings(u.id, 500_000n, uuidv4());
    const period = "2099-01-01";
    const first = await accrueBorderlessDaily(u.id, period);
    expect(first).not.toBeNull();
    const second = await accrueBorderlessDaily(u.id, period);
    expect(second).toBeNull();
    const summary = await getBorderlessSummary(u.id);
    expect(summary.enrolled).toBe(true);
    expect(BigInt(summary.savingsMinor)).toBeGreaterThan(500_000n);
  });
});

describe("Phase 24 production slices", () => {
  it("aggregates readiness across workstreams", async () => {
    const { getStablecoinProductionStatus } = await import("../src/services/stablecoinProductionService");
    const { getCollectiblesGoLiveStatus } = await import("../src/services/collectiblesGoLiveService");
    const { getInstantPaymentsStatus } = await import("../src/services/instantPaymentsService");
    const { getIdentityIssuerStatus } = await import("../src/services/identityIssuerService");
    const { getNeobankProductionStatus } = await import("../src/services/neobankProductionService");
    const { getEquityProductionStatus } = await import("../src/services/equityProductionService");

    const stablecoin = await getStablecoinProductionStatus();
    expect(stablecoin.network).toBeDefined();
    const collectibles = await getCollectiblesGoLiveStatus();
    expect(collectibles.standaloneReady).toBe(true);
    const instant = getInstantPaymentsStatus();
    expect(instant.nativeRailEnabled).toBe(true);
    const identity = getIdentityIssuerStatus();
    expect(identity.standaloneReady).toBe(true);
    const neobank = getNeobankProductionStatus();
    expect(neobank.blockers.length).toBeGreaterThan(0);
    const equities = getEquityProductionStatus();
    expect(equities.standaloneDemo).toBe(false);
  });

  it("agent commerce gate returns identity step first", async () => {
    const { createUser } = await import("../src/services/authService");
    const { createMerchant, createPaymentIntent } = await import("../src/services/paymentService");
    const { getAgentCommerceGate } = await import("../src/services/agentCommerceService");
    const { registerClient } = await import("../src/services/mcpClientRegistry");

    const owner = await createUser(`ac-${Date.now()}@test.com`, "Owner");
    const merchant = await createMerchant(owner.id, "Agent Shop");
    const intent = await createPaymentIntent({
      merchantId: merchant.id,
      actorUserId: owner.id,
      amountMinor: 500n,
      currency: "USD",
      idempotencyKey: uuidv4(),
    });
    const clientDid = `did:simulator:ac-${uuidv4()}`;
    await registerClient({ clientDid, displayName: "ac", allowedFunctions: ["pay:merchant"], maxTransferMinor: 50000n });

    const gate = await getAgentCommerceGate({
      clientDid,
      intentId: intent.id,
      resource: "/premium/report",
    });
    expect(gate.step).toBe("identity");
    expect(gate.x401Header.length).toBeGreaterThan(10);

    const payGate = await getAgentCommerceGate({
      clientDid,
      intentId: intent.id,
      resource: "/premium/report",
      identityProven: true,
    });
    expect(payGate.step).toBe("payment");
    expect(payGate.x402Header!.length).toBeGreaterThan(10);
  });

  it("records verifiable intent on x401 present", async () => {
    const { listVerifiableIntents } = await import("../src/services/verifiableIntentService");
    const { registerClient } = await import("../src/services/mcpClientRegistry");
    const { grantAgent } = await import("../src/services/userAgentGrantService");
    const { createUser } = await import("../src/services/authService");
    const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");
    const { issueProofRequirement, verifyProofPresentation, encodeProofPresentation } = await import(
      "../src/services/x401Service"
    );

    const clientDid = `did:simulator:vi-${uuidv4()}`;
    await registerClient({ clientDid, displayName: "vi", allowedFunctions: ["balance:read"], maxTransferMinor: 50000n });
    const u = await createUser(`vi-${Date.now()}@test.com`, "U");
    await issueCredential(u.id, 2, ["balance:read"], "PASSED");
    const wallet = await makeWallet();
    await bindWalletDid(u.id, wallet.walletDid);
    await grantAgent({ userId: u.id, agentDid: clientDid, displayName: "vi", allowedFunctions: ["balance:read"], maxTransferMinor: 50000n });

    const req = await issueProofRequirement(clientDid, ["balance:read"]);
    const cred = (await getCredential(u.id))!;
    const vpJwt = await new SignJWT({
      nonce: req.challenge.nonce,
      vp: {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        type: ["VerifiablePresentation"],
        holder: wallet.walletDid,
        verifiableCredential: [cred.vc_jwt],
      },
    })
      .setProtectedHeader({ alg: "ES256", typ: "JWT" })
      .setIssuer(wallet.walletDid)
      .setAudience(config.BASE_URL)
      .setJti(uuidv4())
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(wallet.privateKey);

    await verifyProofPresentation({ presentationHeader: encodeProofPresentation({ vp_jwt: vpJwt }) });
    const intents = await listVerifiableIntents(u.id);
    expect(intents.some((i) => i.intentHash.length === 64)).toBe(true);
  });
});
