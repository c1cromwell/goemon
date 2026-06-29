import { defineConfig, devices } from "@playwright/test";

/**
 * Goemon Global Finance web E2E (browser-driven). Closes the gap the validation runbook flags:
 * "UI smoke is manual until a browser-driver is added" (docs/E2E-VALIDATION.md §2).
 *
 * Drives the real React portal in Chromium against a real backend on :3001.
 * `globalSetup` seeds the dev DB directly (the seed scripts talk to SQLite, not
 * HTTP) BEFORE the web servers boot, so both servers come up already-seeded.
 *
 * Auth: dev `ALLOW_PASSWORD_AUTH=true` lets read-only journeys log in as the
 * seeded demo users; the passkey journey uses a CDP virtual authenticator
 * (RP_ID defaults to `localhost`, matching the :5173 origin).
 */

const FRONTEND_PORT = 5173;
const BACKEND_PORT = 3001;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Money/ledger mutations through the UI must run serially — parallel workers
  // would race on shared demo-user balances and the SQLite dev DB.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  // Boot the backend (dev auto-migrates) and the Vite frontend. The dev DB is
  // already seeded by globalSetup, so these just serve it.
  webServer: [
    {
      command: "npm run dev",
      cwd: "../backend",
      port: BACKEND_PORT,
      // Always boot our own backend so the rate-limit override below is in
      // effect (a reused dev server would keep the default 100/min and 429 the
      // suite's burst of anonymous login/probe traffic, all keyed by one test IP).
      reuseExistingServer: false,
      // Headroom for the whole serial run; the limiter is still exercised by the
      // dedicated per-agent limiter tests in the backend vitest suite.
      env: { ...process.env, API_RATE_LIMIT_PER_MIN: "100000" },
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev",
      cwd: ".",
      port: FRONTEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
