/**
 * Hedera non-custodial build → sign (device) → submit split.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

const MOCK_TX_ID = "0.0.9999@1234567890.000000000";
const MOCK_PRIVATE_KEY_HEX = "mock-private-key-der";
const MOCK_PUBLIC_KEY_HEX = "mock-public-key-der";
const MOCK_FROZEN_BYTES = Uint8Array.from([9, 8, 7, 6]);

let accountCounter = 20000;

const mockPrivateKey = {
  publicKey: { toStringDer: () => MOCK_PUBLIC_KEY_HEX },
  toStringDer: () => MOCK_PRIVATE_KEY_HEX,
};

const mockClient = { setOperator: vi.fn() };

function createTransferTx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {
    addTokenTransfer: vi.fn(() => tx),
    addSignature: vi.fn(() => tx),
    freezeWith: vi.fn(() => tx),
    sign: vi.fn(async () => tx),
    signWith: vi.fn(async () => tx),
    toBytes: vi.fn(() => MOCK_FROZEN_BYTES),
    execute: vi.fn().mockResolvedValue({
      getReceipt: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
      transactionId: { toString: () => MOCK_TX_ID },
    }),
  };
  return tx;
}

vi.mock("@hashgraph/sdk", () => ({
  Client: {
    forTestnet: vi.fn(() => mockClient),
    forMainnet: vi.fn(() => mockClient),
    forPreviewnet: vi.fn(() => mockClient),
  },
  PrivateKey: {
    generateED25519: vi.fn(() => mockPrivateKey),
    fromStringDer: vi.fn(() => mockPrivateKey),
  },
  PublicKey: {
    fromString: vi.fn(() => ({ toStringDer: () => MOCK_PUBLIC_KEY_HEX })),
    fromStringED25519: vi.fn(() => ({ toStringDer: () => MOCK_PUBLIC_KEY_HEX, toStringRaw: () => "aa".repeat(32) })),
  },
  AccountId: {
    fromString: vi.fn((s: string) => ({ toString: () => s })),
  },
  TokenId: {
    fromString: vi.fn((s: string) => ({ toString: () => s })),
  },
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
  AccountBalanceQuery: vi.fn().mockImplementation(() => ({
    setAccountId: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({
      hbars: { toTinybars: () => ({ toString: () => "100000000" }) },
      tokens: { get: vi.fn(() => ({ toString: () => "1000000" })) },
    }),
  })),
  TransferTransaction: Object.assign(vi.fn().mockImplementation(createTransferTx), {
    fromBytes: vi.fn(() => createTransferTx()),
  }),
}));

const TMP_DB = `./data/test-hedera-build-${Date.now()}.db`;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.SQLITE_PATH = TMP_DB;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_at_least_long_enough_for_tests";
  process.env.HEDERA_ENABLED = "true";
  process.env.HEDERA_NETWORK = "testnet";
  process.env.HEDERA_OPERATOR_ID = "0.0.9999";
  process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.HEDERA_USDC_TOKEN_ID = "0.0.456858";
  process.env.HEDERA_SIGNER = "ondevice";

  const { runMigrations } = await import("../src/db/migrate");
  await runMigrations();
  const { initTokenFactory } = await import("../src/utils/tokenFactory");
  await initTokenFactory();
  const { bootstrapSystemAccounts } = await import("../src/services/ledgerService");
  await bootstrapSystemAccounts();
  const { initHedera } = await import("../src/services/hederaService");
  await initHedera();
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

describe("Hedera non-custodial build/submit", () => {
  let senderId: string;
  let recipientId: string;
  let recipientHederaId: string;

  beforeAll(async () => {
    const { createUser } = await import("../src/services/authService");
    const { getOrCreateUserHederaAccount } = await import("../src/services/hederaService");

    const sender = await createUser(`hedera-build-${Date.now()}@test.com`, "Sender");
    senderId = sender.id;
    await getOrCreateUserHederaAccount(senderId, { publicKeyDer: MOCK_PUBLIC_KEY_HEX });

    const recipient = await createUser(`hedera-recv-${Date.now()}@test.com`, "Recipient");
    recipientId = recipient.id;
    const rAcct = await getOrCreateUserHederaAccount(recipientId, { publicKeyDer: MOCK_PUBLIC_KEY_HEX });
    recipientHederaId = rAcct.hedera_account_id!;
  });

  it("non-custodial account stores public key only (no server private key)", async () => {
    const { getUserHederaAccount } = await import("../src/services/hederaService");
    const acct = await getUserHederaAccount(senderId);
    expect(acct?.public_key).toBe(MOCK_PUBLIC_KEY_HEX);
    expect(acct?.private_key_enc).toBeNull();
    expect(acct?.private_key_hex).toBeNull();
  });

  it("transferUsdcOnChain refuses on-device mode (directs to build/submit)", async () => {
    const { transferUsdcOnChain } = await import("../src/services/hederaService");
    const { ErrorCode } = await import("../src/errors");
    await expect(
      transferUsdcOnChain({
        fromUserId: senderId,
        toHederaAccountId: recipientHederaId,
        toUserId: recipientId,
        amountMicro: 100_000n,
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_IMPLEMENTED });
  });

  it("build returns frozen bytes; submit posts ledger journal", async () => {
    const { buildUsdcTransfer, submitUsdcTransfer } = await import("../src/services/hederaService");
    const { getOrCreateUserAccount, getBalance } = await import("../src/services/ledgerService");

    const build = await buildUsdcTransfer({
      fromUserId: senderId,
      toUserId: recipientId,
      amountMicro: 250_000n,
      idempotencyKey: "build-submit-1",
    });
    expect(build.buildId).toBeTruthy();
    expect(build.transactionBytesBase64).toBe(Buffer.from(MOCK_FROZEN_BYTES).toString("base64"));
    expect(build.expiresAt).toBeTruthy();

    const recipientLedger = await getOrCreateUserAccount(recipientId, "user_cash", "USDC");
    const before = await getBalance(recipientLedger);

    const signed = Buffer.from(MOCK_FROZEN_BYTES).toString("base64");
    const result = await submitUsdcTransfer({
      fromUserId: senderId,
      buildId: build.buildId,
      signedTransactionBytesBase64: signed,
    });
    expect(result.transactionId).toBe(MOCK_TX_ID);
    expect(result.journalId).toBeTruthy();
    expect(await getBalance(recipientLedger)).toBe(before + 250_000n);
  });

  it("build is idempotent on the same Idempotency-Key", async () => {
    const { buildUsdcTransfer } = await import("../src/services/hederaService");
    const key = "build-idem-1";
    const a = await buildUsdcTransfer({
      fromUserId: senderId,
      toHederaAccountId: recipientHederaId,
      amountMicro: 10_000n,
      idempotencyKey: key,
    });
    const b = await buildUsdcTransfer({
      fromUserId: senderId,
      toHederaAccountId: recipientHederaId,
      amountMicro: 10_000n,
      idempotencyKey: key,
    });
    expect(b.buildId).toBe(a.buildId);
  });

  it("submit is idempotent after first success", async () => {
    const { buildUsdcTransfer, submitUsdcTransfer } = await import("../src/services/hederaService");
    const build = await buildUsdcTransfer({
      fromUserId: senderId,
      toHederaAccountId: recipientHederaId,
      amountMicro: 5_000n,
      idempotencyKey: "build-submit-idem",
    });
    const signed = Buffer.from(MOCK_FROZEN_BYTES).toString("base64");
    const first = await submitUsdcTransfer({
      fromUserId: senderId,
      buildId: build.buildId,
      signedTransactionBytesBase64: signed,
    });
    const second = await submitUsdcTransfer({
      fromUserId: senderId,
      buildId: build.buildId,
      signedTransactionBytesBase64: signed,
    });
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.journalId).toBe(first.journalId);
  });

  it("submit accepts signatureHex from on-device signing", async () => {
    const { buildUsdcTransfer, submitUsdcTransfer } = await import("../src/services/hederaService");
    const build = await buildUsdcTransfer({
      fromUserId: senderId,
      toHederaAccountId: recipientHederaId,
      amountMicro: 3_000n,
      idempotencyKey: "build-submit-sig",
    });
    const result = await submitUsdcTransfer({
      fromUserId: senderId,
      buildId: build.buildId,
      signatureHex: "deadbeef",
    });
    expect(result.transactionId).toBe(MOCK_TX_ID);
    expect(result.journalId).toBeTruthy();
  });
});
