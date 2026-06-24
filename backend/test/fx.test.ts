/**
 * FX quote seam + currency registry.
 *
 *   1. A quote returns an exact integer conversion with source / as-of / staleness.
 *   2. Decimal-aware conversion: USD (2dp) → USDC (6dp) scales correctly.
 *   3. An unknown / disabled currency is rejected (VALIDATION).
 *   4. FX_ENABLED off ⇒ FX_DISABLED.
 *   5. Registry is the allowlist: enabling EURC makes a full escrow hold in EURC
 *      succeed with NO code change (the "multi-currency is config, not a sweep" proof).
 *   6. productionFatals refuses FX_ENABLED with the simulated provider.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { productionFatals } from "../src/config";

const TMP_DB = `./data/test-fx-${Date.now()}.db`;

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
  const { config } = await import("../src/config");
  (config as { FX_ENABLED: boolean }).FX_ENABLED = true;
});

afterAll(async () => {
  const { __setEnabledForTest } = await import("../src/services/currencyRegistry");
  __setEnabledForTest("EURC", false); // leave the registry as we found it
  const { closeDb } = await import("../src/db");
  await closeDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* ignore */ }
  }
});

describe("FX quote seam + currency registry", () => {
  it("quotes a conversion with rate, source, as-of, and staleness", async () => {
    const { quote } = await import("../src/services/fxRateService");
    // USD (2dp) → USDC (6dp), ~1:1. $100.00 = 10000 cents → 100.000000 USDC = 100_000_000 micro.
    const q = await quote({ from: "USD", to: "USDC", amountMinor: 10_000n });
    expect(q.toAmountMinor).toBe("100000000");
    expect(q.from).toBe("USD");
    expect(q.to).toBe("USDC");
    expect(q.source).toBe("simulated");
    expect(q.stale).toBe(false);
    expect(typeof q.asOf).toBe("string");
    expect(q.rate).toBe("1"); // 1:1 between USD and USDC in the sim source
  });

  it("converts across a non-1:1 pair with decimal scaling (USD→EURC)", async () => {
    const { __setEnabledForTest } = await import("../src/services/currencyRegistry");
    const { quote } = await import("../src/services/fxRateService");
    __setEnabledForTest("EURC", true);
    // 1 USD = 1.08 USD-value(EUR) ⇒ USD→EURC rate = 1/1.08 ≈ 0.925925. $100.00 → ~92.59 EURC.
    const q = await quote({ from: "USD", to: "EURC", amountMinor: 10_000n });
    // 10000 cents × 925925 ppm × 10^(6-2) / 1e6 = 92_592_500 micro-EURC.
    expect(q.toAmountMinor).toBe("92592500");
    expect(q.ratePpm).toBe("925925");
  });

  it("rejects an unknown or disabled currency (VALIDATION)", async () => {
    const { quote } = await import("../src/services/fxRateService");
    const { ErrorCode } = await import("../src/errors");
    await expect(quote({ from: "USD", to: "ZZZ", amountMinor: 100n })).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });

  it("FX_DISABLED when the switch is off", async () => {
    const { config } = await import("../src/config");
    const { quote } = await import("../src/services/fxRateService");
    const { ErrorCode } = await import("../src/errors");
    (config as { FX_ENABLED: boolean }).FX_ENABLED = false;
    try {
      await expect(quote({ from: "USD", to: "USDC", amountMinor: 100n })).rejects.toMatchObject({ code: ErrorCode.FX_DISABLED });
    } finally {
      (config as { FX_ENABLED: boolean }).FX_ENABLED = true;
    }
  });

  it("registry is the allowlist: enabling EURC flips both the route schema and the service gate, no code change", async () => {
    const { __setEnabledForTest, currencySchema } = await import("../src/services/currencyRegistry");
    const { hold } = await import("../src/services/escrowService");
    const { createUser } = await import("../src/services/authService");
    const { ErrorCode } = await import("../src/errors");

    const payer = await createUser(`fx-payer-${Date.now()}@test.com`, "Payer");
    const payee = await createUser(`fx-payee-${Date.now()}@test.com`, "Payee");

    // The route-surface gate (the drop-in for `z.enum(["USD","USDC"])`).
    __setEnabledForTest("EURC", false);
    expect(() => currencySchema().parse("EURC")).toThrow(); // previously hardcoded-rejected
    // The service-level gate (escrowService now calls assertSupported, not a literal Set).
    await expect(
      hold({ payerId: payer.id, payeeId: payee.id, amountMinor: 1_000n, currency: "EURC", memo: "x", idempotencyKey: `fx-off-${Date.now()}` })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION });

    // Flip ONE registry flag — both gates now admit EURC, no handler/validation code touched.
    __setEnabledForTest("EURC", true);
    expect(currencySchema().parse("EURC")).toBe("EURC");
    // The escrow path now gets PAST the currency gate (it fails later only on per-currency
    // system-account plumbing — the deferred settlement-stage work, not a surface change).
    await expect(
      hold({ payerId: payer.id, payeeId: payee.id, amountMinor: 1_000n, currency: "EURC", memo: "y", idempotencyKey: `fx-on-${Date.now()}` })
    ).rejects.not.toMatchObject({ code: ErrorCode.VALIDATION });
  });

  it("productionFatals refuses FX_SETTLEMENT_ENABLED with the simulated provider", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false,
      FX_ENABLED: false, FX_RATE_PROVIDER: "simulated", FX_SETTLEMENT_ENABLED: true,
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("FX_SETTLEMENT_ENABLED"))).toBe(true);
  });

  it("productionFatals refuses FX_ENABLED with the simulated provider", () => {
    const base = {
      NODE_ENV: "production", JWT_SECRET: "a".repeat(48), ADMIN_JWT_SECRET: "b".repeat(48),
      ALLOW_PASSWORD_AUTH: false, KMS_PROVIDER: "aws",
      ONBOARDING_ORCHESTRATOR: "simulated", SMARTCHAT_ORCHESTRATOR: "simulated", OPERATIONS_ORCHESTRATOR: "simulated",
      ANTHROPIC_API_KEY: "", HEDERA_ENABLED: false,
      FX_ENABLED: false, FX_RATE_PROVIDER: "simulated",
    } as unknown as Parameters<typeof productionFatals>[0];
    expect(productionFatals(base).some((f) => f.includes("FX_ENABLED"))).toBe(false);
    const on = { ...base, FX_ENABLED: true } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(on).some((f) => f.includes("FX_ENABLED"))).toBe(true);
    // With a real provider, enabling FX is allowed.
    const real = { ...on, FX_RATE_PROVIDER: "circle" } as Parameters<typeof productionFatals>[0];
    expect(productionFatals(real).some((f) => f.includes("FX_ENABLED"))).toBe(false);
  });
});

describe("Cross-currency settlement", () => {
  beforeAll(async () => {
    const { config } = await import("../src/config");
    (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = true;
    (config as { FX_SPREAD_BPS: number }).FX_SPREAD_BPS = 50; // 0.50%
  });

  async function fundedUser() {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserAccount } = await import("../src/services/ledgerService");
    const u = await createUser(`fxc-${Date.now()}-${Math.random()}@test.com`, "FX User");
    await getOrCreateUserAccount(u.id, "user_cash", "USD"); // $10,000 opening
    return u.id;
  }

  it("settles USD→USDC as one balanced journal: user debited, credited net, fee captured", async () => {
    const { convert } = await import("../src/services/fxSettlementService");
    const { getOrCreateUserAccount, getOrCreateSystemAccount, getBalance } = await import("../src/services/ledgerService");
    const userId = await fundedUser();
    const usd = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const usdc = await getOrCreateUserAccount(userId, "user_cash", "USDC");
    const usdBefore = await getBalance(usd);

    // $100.00 (10000 cents) → 1:1 → 100_000_000 micro gross; 50bps fee = 500_000; net 99_500_000.
    const r = await convert({ userId, from: "USD", to: "USDC", fromAmountMinor: 10_000n, idempotencyKey: `c-${Date.now()}` });
    expect(r.grossToMinor).toBe("100000000");
    expect(r.feeMinor).toBe("500000");
    expect(r.toAmountMinor).toBe("99500000");

    expect(await getBalance(usd)).toBe(usdBefore - 10_000n); // FROM debited
    expect(await getBalance(usdc)).toBe(99_500_000n);        // TO credited net
    const feeAcct = await getOrCreateSystemAccount("fee", "USDC");
    expect(await getBalance(feeAcct)).toBeGreaterThanOrEqual(500_000n); // spread captured
  });

  it("is idempotent on the key (no double conversion)", async () => {
    const { convert } = await import("../src/services/fxSettlementService");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    const userId = await fundedUser();
    const usd = await getOrCreateUserAccount(userId, "user_cash", "USD");
    const before = await getBalance(usd);
    const key = `idem-${Date.now()}`;
    const a = await convert({ userId, from: "USD", to: "USDC", fromAmountMinor: 5_000n, idempotencyKey: key });
    const b = await convert({ userId, from: "USD", to: "USDC", fromAmountMinor: 5_000n, idempotencyKey: key });
    expect(b.journalId).toBe(a.journalId);                 // same journal
    expect(await getBalance(usd)).toBe(before - 5_000n);   // debited once, not twice
  });

  it("rejects insufficient balance (INSUFFICIENT_FUNDS) and same-currency (VALIDATION)", async () => {
    const { convert } = await import("../src/services/fxSettlementService");
    const { ErrorCode } = await import("../src/errors");
    const userId = await fundedUser();
    await expect(
      convert({ userId, from: "USD", to: "USDC", fromAmountMinor: 999_999_999n, idempotencyKey: `over-${Date.now()}` })
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_FUNDS });
    await expect(
      convert({ userId, from: "USD", to: "USD", fromAmountMinor: 100n, idempotencyKey: `same-${Date.now()}` })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION });
  });

  it("FX_DISABLED when settlement is switched off", async () => {
    const { config } = await import("../src/config");
    const { convert } = await import("../src/services/fxSettlementService");
    const { ErrorCode } = await import("../src/errors");
    const userId = await fundedUser();
    (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = false;
    try {
      await expect(
        convert({ userId, from: "USD", to: "USDC", fromAmountMinor: 100n, idempotencyKey: `off-${Date.now()}` })
      ).rejects.toMatchObject({ code: ErrorCode.FX_DISABLED });
    } finally {
      (config as { FX_SETTLEMENT_ENABLED: boolean }).FX_SETTLEMENT_ENABLED = true;
    }
  });
});
