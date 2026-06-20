/**
 * Escrow on the USDC/Hedera rail (docs/business/PAYMENT-NETWORK-STRATEGY.md §4).
 *
 * When currency=USDC and HEDERA_ENABLED, an escrow hold/release also moves USDC
 * on-chain (payer→operator custodian, then operator→recipient) and records the
 * tx id as the ledger journal's external_ref. Uses vi.mock to stub @hashgraph/sdk
 * (no live testnet), like phase5.test.ts. The ledger remains the source of truth.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

const MOCK_TX_ID = "0.0.9999@1234567890.000000000";
let accountCounter = 20000;

const mockPrivateKey = { publicKey: { toStringDer: () => "mock-pub" }, toStringDer: () => "mock-priv" };
const mockClient = { setOperator: vi.fn() };

vi.mock("@hashgraph/sdk", () => ({
  Client: { forTestnet: vi.fn(() => mockClient), forMainnet: vi.fn(() => mockClient), forPreviewnet: vi.fn(() => mockClient) },
  PrivateKey: { generateED25519: vi.fn(() => mockPrivateKey), fromStringDer: vi.fn(() => mockPrivateKey) },
  PublicKey: {
    fromString: vi.fn(() => mockPrivateKey.publicKey),
    fromStringED25519: vi.fn(() => mockPrivateKey.publicKey),
  },
  AccountId: { fromString: vi.fn((s: string) => ({ toString: () => s })) },
  TokenId: { fromString: vi.fn((s: string) => ({ toString: () => s })) },
  Hbar: vi.fn((n: number) => ({ amount: n })),
  AccountCreateTransaction: vi.fn().mockImplementation(() => {
    const acctId = `0.0.${++accountCounter}`;
    return {
      setKey: vi.fn().mockReturnThis(),
      setInitialBalance: vi.fn().mockReturnThis(),
      setMaxAutomaticTokenAssociations: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({
        getReceipt: vi.fn().mockResolvedValue({ accountId: { toString: () => acctId } }),
        transactionId: { toString: () => MOCK_TX_ID },
      }),
    };
  }),
  AccountBalanceQuery: vi.fn(),
  TransferTransaction: vi.fn().mockImplementation(() => {
    // Mirror the real SDK: sign/signWith return the same tx (this), which has execute().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = {
      addTokenTransfer: vi.fn(() => tx),
      freezeWith: vi.fn(() => tx),
      sign: vi.fn(async () => tx),
      signWith: vi.fn(async () => tx),
      execute: vi.fn().mockResolvedValue({
        getReceipt: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
        transactionId: { toString: () => MOCK_TX_ID },
      }),
    };
    return tx;
  }),
}));

const TMP_DB = `./data/test-escrow-hedera-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.HEDERA_ENABLED = "true";
  process.env.HEDERA_NETWORK = "testnet";
  process.env.HEDERA_OPERATOR_ID = "0.0.9999";
  process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.HEDERA_USDC_TOKEN_ID = "0.0.456858";
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

describe("Escrow on the USDC/Hedera rail", () => {
  let payer: string;
  let payee: string;

  async function usdcLedger(userId: string) {
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");
    return getBalance(await getOrCreateUserAccount(userId, "user_cash", "USDC"));
  }
  async function externalRefOf(journalId: string) {
    const { getDb } = await import("../src/db");
    const r = await getDb().queryOne<{ external_ref: string | null }>("SELECT external_ref FROM ledger_journals WHERE id = ?", [journalId]);
    return r?.external_ref ?? null;
  }

  beforeAll(async () => {
    const { runMigrations } = await import("../src/db/migrate");
    await runMigrations();
    const { initTokenFactory } = await import("../src/utils/tokenFactory");
    await initTokenFactory();
    const { bootstrapSystemAccounts, getOrCreateUserAccount, getSystemAccount, postJournal } = await import("../src/services/ledgerService");
    await bootstrapSystemAccounts();
    const { initHedera, getOrCreateUserHederaAccount } = await import("../src/services/hederaService");
    await initHedera();

    const { createUser } = await import("../src/services/authService");
    payer = (await createUser("hpayer@es.test", "HPayer")).id;
    payee = (await createUser("hpayee@es.test", "HPayee")).id;

    // On-chain accounts (mocked) + seed payer USDC on the ledger (5 USDC).
    await getOrCreateUserHederaAccount(payer);
    await getOrCreateUserHederaAccount(payee);
    const sys = await getSystemAccount("bank_settlement", "USDC");
    const payerUsdc = await getOrCreateUserAccount(payer, "user_cash", "USDC");
    await postJournal(
      [
        { ledgerAccountId: sys, direction: "debit", amountMinor: 5_000_000n, currency: "USDC" },
        { ledgerAccountId: payerUsdc, direction: "credit", amountMinor: 5_000_000n, currency: "USDC" },
      ],
      "Seed USDC",
      { idempotencyKey: "seed-usdc-payer" }
    );
  });

  it("USDC hold moves on-chain (txid as external_ref) and debits the ledger", async () => {
    const { hold, getEscrow } = await import("../src/services/escrowService");
    const { getDb } = await import("../src/db");

    const before = await usdcLedger(payer);
    const e = await hold({ payerId: payer, payeeId: payee, amountMinor: 1_000_000n, currency: "USDC", idempotencyKey: "h-usdc-1" });
    expect(e.status).toBe("held");
    expect(e.currency).toBe("USDC");

    const after = await usdcLedger(payer);
    expect(before - after).toBe(1_000_000n); // 1 USDC held out of payer's ledger balance

    const row = await getDb().queryOne<{ hold_journal_id: string }>("SELECT hold_journal_id FROM escrow_payments WHERE id = ?", [e.id]);
    expect(await externalRefOf(row!.hold_journal_id)).toBe(MOCK_TX_ID); // on-chain leg recorded
  });

  it("USDC release moves on-chain and credits the payee ledger", async () => {
    const { getDb } = await import("../src/db");
    const { release } = await import("../src/services/escrowService");

    const id = (await getDb().queryOne<{ id: string }>("SELECT id FROM escrow_payments WHERE idempotency_key = 'h-usdc-1'"))!.id;
    const before = await usdcLedger(payee);
    const r = await release(id);
    expect(r.status).toBe("released");
    const after = await usdcLedger(payee);
    expect(after - before).toBe(1_000_000n); // payee credited 1 USDC

    const row = await getDb().queryOne<{ settle_journal_id: string }>("SELECT settle_journal_id FROM escrow_payments WHERE id = ?", [id]);
    expect(await externalRefOf(row!.settle_journal_id)).toBe(MOCK_TX_ID);
  });
});
