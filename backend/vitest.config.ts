import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // These are applied to process.env BEFORE `import "dotenv/config"` runs (dotenv does
    // not override already-set vars), so the test suite gets a deterministic baseline
    // regardless of the developer's local `.env`. In particular, the feature kill-switches
    // are forced OFF here so the demo `.env` (which may enable them for a live walkthrough)
    // never leaks into tests. A test that needs a switch ON patches `config` directly
    // (e.g. equities.test.ts sets `config.EQUITIES_ENABLED = true`).
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test_secret_at_least_long_enough_for_tests",
      BASE_URL: "http://localhost:3001",
      CREDENTIAL_BASE_URL: "http://localhost:3001",
      ALLOW_PASSWORD_AUTH: "true",
      RP_ID: "localhost",
      RP_ORIGIN: "http://localhost:5173",
      RP_NAME: "Goemon Test",
      // Feature kill-switches — force OFF for a clean, deterministic test baseline.
      EQUITIES_ENABLED: "false",
      TREASURY_ENABLED: "false",
      TRADING_ENABLED: "false",
      GOEMON_PAY_ENABLED: "false",
      CHECKOUT_VP_ENABLED: "false",
      BANK_RAILS_ENABLED: "false",
      CARDS_ENABLED: "false",
      BILLPAY_ENABLED: "false",
      ONRAMP_ENABLED: "false",
      OFFRAMP_ENABLED: "false",
      LENDING_ENABLED: "false",
      CREATOR_DROPS_ENABLED: "false",
      COLLECTIBLES_ESCROW_ENABLED: "false",
      FX_ENABLED: "false",
      FX_SETTLEMENT_ENABLED: "false",
      TEEN_ENABLED: "false",
      TEEN_CREDIT_BUILDER_ENABLED: "false",
      TEEN_CUSTODIAL_ENABLED: "false",
      ISSUANCE_CONSOLE_ENABLED: "false",
      SETTLEMENT_STABLECOIN: "usdc",
    },
  },
});
