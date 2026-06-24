/**
 * DEMO — login-less merchant checkout with a Verifiable Credential.
 *
 * The story: a customer at a merchant's checkout pays WITHOUT logging into any
 * provider and WITHOUT a redirect. Their device holds a VC; it signs a Verifiable
 * Presentation over a one-time challenge, and the payment authorizes off that.
 *
 * This drives the REAL Express routes (payRouter + presentRouter) over real HTTP
 * with plain fetch and NO session cookie — so it proves the checkout button itself
 * works login-less, not just the service layer. Seeding (a customer with a VC, a
 * merchant, a payment intent) uses the services directly, exactly like the tests.
 *
 * Run: npm run demo:checkout-vp
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test"; // avoid prod-fatal config
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "demo_checkout_vp_secret_at_least_32_chars_long";
// The DB path + feature flags are set on the loaded config object inside main()
// (imports are hoisted above these assignments, so env-after-import wouldn't take).

import express from "express";
import type { AddressInfo } from "node:net";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { runMigrations } from "../db/migrate";
import { closeDb } from "../db";
import { initTokenFactory } from "../utils/tokenFactory";
import { bootstrapSystemAccounts, getOrCreateUserAccount, getBalance } from "../services/ledgerService";
import { createUser } from "../services/authService";
import { issueCredential, bindWalletDid, getCredential } from "../services/vcService";
import { createMerchant, createPaymentIntent } from "../services/paymentService";
import { issueCard, listCards } from "../services/cardService";
import { publicJwkToDidKey } from "../utils/didKey";
import { presentRouter } from "../routes/present";
import { payRouter } from "../routes/pay";
import { errorHandler } from "../errors";

const usd = (minor: bigint) => `$${(Number(minor) / 100).toFixed(2)}`;
const log = (s: string) => console.log(s);

const DEMO_DB = `./data/demo-checkout-vp-${Date.now()}.db`;

async function main(): Promise<void> {
  // Imports are hoisted above the top-of-file env assignments, so set everything on
  // the loaded config object directly (the same approach the tests use). config.SQLITE_PATH
  // is read at the first getDb() call, so set it here (before runMigrations) to keep the
  // demo hermetic — its own throwaway DB, never the dev argus.db.
  (config as { SQLITE_PATH: string }).SQLITE_PATH = DEMO_DB;
  (config as { ARGUS_PAY_ENABLED: boolean }).ARGUS_PAY_ENABLED = true;
  (config as { CHECKOUT_VP_ENABLED: boolean }).CHECKOUT_VP_ENABLED = true;
  (config as { CARDS_ENABLED: boolean }).CARDS_ENABLED = true; // issue real (cash-backed) Argus cards

  await runMigrations();
  await initTokenFactory();
  await bootstrapSystemAccounts();

  // --- A tiny app mounting the REAL routers (the actual checkout endpoints) ---
  const app = express();
  app.use(express.json());
  app.use("/api/present", presentRouter);
  app.use("/api/pay", payRouter);
  app.use(errorHandler);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const BASE = `http://127.0.0.1:${port}`;
  // BASE_URL is the VP audience — point it at this ephemeral server for the demo.
  (config as { BASE_URL: string }).BASE_URL = BASE;

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // NOTE: no Cookie, no Authorization
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  try {
    // --- Seed: a customer device (VC + bound wallet + funding cards) ------------
    const customer = await createUser(`shopper-${Date.now()}@demo.com`, "Sam Shopper");
    const acct = await getOrCreateUserAccount(customer.id, "user_cash", "USD"); // opening balance
    await issueCredential(customer.id, 2, ["pay:merchant"], "PASSED");
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const walletDid = publicJwkToDidKey(await exportJWK(publicKey));
    await bindWalletDid(customer.id, walletDid);
    const vcJwt = (await getCredential(customer.id))!.vc_jwt!;
    // The customer's funding instruments (real, cash-backed Argus cards — Phase 19.4).
    await issueCard(customer.id, "USD");
    await issueCard(customer.id, "USD");
    const cards = await listCards(customer.id);

    // --- Seed: a merchant + a CART (line items) → one intent for the total ------
    const ownerUser = await createUser(`market-${Date.now()}@demo.com`, "Quiet Market");
    await getOrCreateUserAccount(ownerUser.id, "user_cash", "USD");
    const merchant = await createMerchant(ownerUser.id, "Quiet Market");
    const cart = [
      { item: "Flat white", minor: 525n },
      { item: "Croissant", minor: 450n },
      { item: "Bag of beans", minor: 1_800n },
    ];
    const cartTotal = cart.reduce((s, l) => s + l.minor, 0n);
    const intent = await createPaymentIntent({
      merchantId: merchant.id,
      actorUserId: ownerUser.id,
      amountMinor: cartTotal,
      currency: "USD",
      memo: `Cart: ${cart.map((l) => l.item).join(", ")}`,
      idempotencyKey: `demo-${uuidv4()}`,
    });

    log("\n=== Login-less checkout with a Verifiable Credential ===\n");
    log(`Customer device holds a VC bound to wallet ${walletDid.slice(0, 24)}…`);
    log(`Merchant "${merchant.name}" — cart:`);
    for (const l of cart) log(`     • ${l.item.padEnd(16)} ${usd(l.minor)}`);
    log(`     ${"".padEnd(16)} ─────────`);
    log(`     ${"Total".padEnd(16)} ${usd(cartTotal)}   ← one intent ${intent.id.slice(0, 8)}…`);
    const before = await getBalance(acct);
    log(`Customer cash before: ${usd(before)}\n`);

    // --- Step 1: customer PICKS a payment method (no issuer login / redirect) ---
    // At a card-network checkout this is where you'd be bounced to the issuer's
    // login. Here the methods come straight from the device wallet — no redirect.
    log(`1. Choose a payment method (from the device wallet, no issuer login):`);
    cards.forEach((c, i) => log(`     ${i === 0 ? "›" : " "} ${c.network.toUpperCase()} ${c.masked_number}${i === 0 ? "   ← selected" : ""}`));
    const chosen = cards[0]!;

    // --- Step 2: checkout asks for a challenge (NO login, NO redirect) ----------
    const ch = await post(`/api/pay/intents/${intent.id}/checkout/challenge`, {});
    log(`2. POST /checkout/challenge        → ${ch.status} (no cookie sent)`);
    log(`   wallet is asked to authorize ${usd(BigInt(ch.json.amountMinor as string))} to "${ch.json.merchantName}" on ${chosen.masked_number}`);
    const nonce = ch.json.nonce as string;

    // --- Step 2: the DEVICE signs a Verifiable Presentation over the nonce ------
    const buildVp = (signKey: KeyLike, jti?: string) =>
      new SignJWT({
        nonce,
        vp: {
          "@context": ["https://www.w3.org/2018/credentials/v1"],
          type: ["VerifiablePresentation"],
          holder: walletDid,
          verifiableCredential: [vcJwt],
        },
      })
        .setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer(walletDid)
        .setAudience(BASE)
        .setJti(jti ?? uuidv4())
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(signKey);

    const vpJwt = await buildVp(privateKey);
    log(`3. Device signs ONE VP (Face ID / Secure Enclave) — authorizes ${chosen.masked_number} for this cart`);

    // --- Step 4: present the VP → pay the whole cart. Still NO session. ---------
    const pay = await post(`/api/pay/intents/${intent.id}/pay-with-presentation`, { vpJwt });
    const paidIntent = pay.json.intent as Record<string, unknown>;
    log(`4. POST /pay-with-presentation     → ${pay.status} (no cookie sent) — pays all ${cart.length} items at once`);
    log(`   intent status: ${paidIntent.status}   authorizedVia: ${pay.json.authorizedVia}`);
    log(`   payer resolved from the VC: ${(pay.json.payer as Record<string, string>).userId === customer.id ? "✓ matches the credential holder" : "✗ MISMATCH"}`);
    const after = await getBalance(acct);
    log(`   Customer cash after:  ${usd(after)}  (whole cart debited into escrow — zero rail fee)\n`);

    // --- Step 5: replaying the same VP is rejected -----------------------------
    const replay = await post(`/api/pay/intents/${intent.id}/pay-with-presentation`, { vpJwt });
    const replayCode = (replay.json.error as Record<string, string> | undefined)?.code;
    log(`5. Replay the same VP              → ${replay.status} ${replayCode} (single-use enforced)\n`);

    const spent = before - after;
    const ok =
      pay.status === 200 &&
      paidIntent.status === "held" &&
      pay.json.authorizedVia === "vp" &&
      spent === cartTotal &&
      replayCode === "REPLAY_DETECTED";
    log(ok ? `RESULT: ✓ picked a card, authorized + paid the whole ${usd(cartTotal)} cart with a VC — no login; replay blocked.`
          : "RESULT: ✗ unexpected — see output above.");
    if (!ok) process.exitCode = 1;
  } finally {
    server.close();
    await closeDb();
    const fs = await import("node:fs");
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(DEMO_DB + suffix); } catch { /* ignore */ }
    }
  }
}

main().catch((err) => {
  console.error("[demo:checkout-vp] FAILED:", err);
  process.exit(1);
});
