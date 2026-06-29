/**
 * Phase 21 — login-less merchant checkout via Verifiable Presentation.
 *
 * Proves a customer can pay a merchant's payment intent by presenting a VC-backed
 * VP from their device, with NO session login and NO redirect — and that the
 * security invariants of the Phase-7 VP gate still hold on this path:
 *
 *   1. Happy path: a valid VP pays the intent; the payer (derived from the VC,
 *      never supplied) is debited and the intent goes to `held`.
 *   2. Replay: re-presenting the same VP is REJECTED (REPLAY_DETECTED).
 *   3. Wrong key: a VP signed by an attacker (claiming the holder's DID) is
 *      REJECTED (VP_INVALID) — signature verified before any access.
 *   4. Intent binding: a VP whose nonce was issued for intent A cannot pay
 *      intent B (NONCE_INVALID).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";
import { config } from "../src/config";
import { publicJwkToDidKey } from "../src/utils/didKey";
import { ErrorCode } from "../src/errors";

const TMP_DB = `./data/test-checkout-vp-${Date.now()}.db`;

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
  (config as { GOEMON_PAY_ENABLED: boolean }).GOEMON_PAY_ENABLED = true;
  (config as { CHECKOUT_VP_ENABLED: boolean }).CHECKOUT_VP_ENABLED = true;
});

afterAll(async () => {
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

// --- device wallet stand-in (Secure-Enclave equivalent: jose ES256) ---------

interface Wallet {
  walletDid: string;
  privateKey: KeyLike;
}

async function makeWallet(): Promise<Wallet> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  return { walletDid: publicJwkToDidKey(await exportJWK(publicKey)), privateKey };
}

let seq = 0;
async function setupCustomer(): Promise<{ userId: string; wallet: Wallet; vcJwt: string }> {
  const { createUser } = await import("../src/services/authService");
  const { issueCredential, bindWalletDid, getCredential } = await import("../src/services/vcService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const u = await createUser(`shopper-${seq++}-${Date.now()}@test.com`, "Shopper");
  await getOrCreateUserAccount(u.id, "user_cash", "USD"); // opening balance
  await issueCredential(u.id, 2, ["pay:merchant"], "PASSED");
  const wallet = await makeWallet();
  await bindWalletDid(u.id, wallet.walletDid);
  const cred = await getCredential(u.id);
  return { userId: u.id, wallet, vcJwt: cred!.vc_jwt! };
}

async function setupMerchantIntent(amountMinor: bigint): Promise<string> {
  const { createUser } = await import("../src/services/authService");
  const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
  const { createMerchant, createPaymentIntent } = await import("../src/services/paymentService");
  const owner = await createUser(`merch-${seq++}-${Date.now()}@test.com`, "Merchant");
  await getOrCreateUserAccount(owner.id, "user_cash", "USD");
  const m = await createMerchant(owner.id, "Quiet Coffee Co");
  const intent = await createPaymentIntent({
    merchantId: m.id,
    actorUserId: owner.id,
    amountMinor,
    currency: "USD",
    idempotencyKey: `checkout-${uuidv4()}`, // unique per run (the suite shares one DB)
  });
  return intent.id;
}

/** The device builds a Verifiable Presentation over the checkout nonce. */
async function buildVp(opts: { wallet: Wallet; vcJwt: string; nonce: string; signKey?: KeyLike; jti?: string }): Promise<string> {
  return new SignJWT({
    nonce: opts.nonce,
    vp: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiablePresentation"],
      holder: opts.wallet.walletDid,
      verifiableCredential: [opts.vcJwt],
    },
  })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(opts.wallet.walletDid)
    .setAudience(config.BASE_URL)
    .setJti(opts.jti ?? uuidv4())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(opts.signKey ?? opts.wallet.privateKey);
}

// --- tests -----------------------------------------------------------------

describe("Phase 21: login-less checkout via Verifiable Presentation", () => {
  it("pays a merchant intent from a device VP with NO login; payer is derived from the VC", async () => {
    const { issueCheckoutChallenge, verifyCheckoutPresentation } = await import("../src/services/presentationService");
    const { payIntent, getIntent } = await import("../src/services/paymentService");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");

    const customer = await setupCustomer();
    const intentId = await setupMerchantIntent(1_200n);

    const acct = await getOrCreateUserAccount(customer.userId, "user_cash", "USD");
    const before = await getBalance(acct);

    // 1) checkout asks for a challenge (no auth), 2) device signs a VP over the nonce
    const { nonce } = await issueCheckoutChallenge(intentId);
    const vp = await buildVp({ wallet: customer.wallet, vcJwt: customer.vcJwt, nonce });

    // 3) present → resolves the paying user with no caller-supplied id
    const pres = await verifyCheckoutPresentation({ vpJwt: vp, intentId });
    expect(pres.userId).toBe(customer.userId);

    // 4) pay the intent as that user
    const paid = await payIntent({ intentId, payerUserId: pres.userId, authorizedVia: "vp" });
    expect(paid.status).toBe("held");
    expect(paid.authorizedVia).toBe("vp");
    expect(await getBalance(acct)).toBe(before - 1_200n); // debited into escrow
  });

  it("rejects a replayed VP (REPLAY_DETECTED)", async () => {
    const { issueCheckoutChallenge, verifyCheckoutPresentation } = await import("../src/services/presentationService");
    const customer = await setupCustomer();
    const intentId = await setupMerchantIntent(900n);
    const { nonce } = await issueCheckoutChallenge(intentId);
    const vp = await buildVp({ wallet: customer.wallet, vcJwt: customer.vcJwt, nonce });

    await verifyCheckoutPresentation({ vpJwt: vp, intentId }); // first use succeeds
    await expect(verifyCheckoutPresentation({ vpJwt: vp, intentId })).rejects.toMatchObject({
      code: ErrorCode.REPLAY_DETECTED,
    });
  });

  it("rejects a VP signed by the WRONG key (VP_INVALID — signature verified before access)", async () => {
    const { issueCheckoutChallenge, verifyCheckoutPresentation } = await import("../src/services/presentationService");
    const customer = await setupCustomer();
    const intentId = await setupMerchantIntent(900n);
    const { nonce } = await issueCheckoutChallenge(intentId);

    const attacker = await makeWallet(); // claims the holder's DID but signs with its own key
    const vp = await buildVp({ wallet: customer.wallet, vcJwt: customer.vcJwt, nonce, signKey: attacker.privateKey });

    await expect(verifyCheckoutPresentation({ vpJwt: vp, intentId })).rejects.toMatchObject({
      code: ErrorCode.VP_INVALID,
    });
  });

  it("rejects a VP whose nonce was issued for a DIFFERENT intent (NONCE_INVALID)", async () => {
    const { issueCheckoutChallenge, verifyCheckoutPresentation } = await import("../src/services/presentationService");
    const customer = await setupCustomer();
    const intentA = await setupMerchantIntent(900n);
    const intentB = await setupMerchantIntent(900n);

    const { nonce } = await issueCheckoutChallenge(intentA); // challenge bound to A
    const vp = await buildVp({ wallet: customer.wallet, vcJwt: customer.vcJwt, nonce });

    // Try to use A's presentation to pay B.
    await expect(verifyCheckoutPresentation({ vpJwt: vp, intentId: intentB })).rejects.toMatchObject({
      code: ErrorCode.NONCE_INVALID,
    });
  });
});
