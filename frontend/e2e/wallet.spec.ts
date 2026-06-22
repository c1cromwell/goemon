import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./helpers/users";

/**
 * Wallet UI smoke — Receive surface, HIP-583 EVM alias when Hedera enabled.
 * Does not move money (backend invariants own execution).
 */
test.describe("wallet", () => {
  test("wallet page loads for demo user when Hedera enabled", async ({ page }) => {
    await loginAsDemoUser(page, "alex@demo.com");
    await page.goto("/wallet");

    const disabled = page.getByRole("heading", { name: "Not enabled" });
    const provision = page.getByRole("heading", { name: "Provision your account" });
    const ready = page.getByRole("heading", { name: "Receive" });

    await expect(disabled.or(provision).or(ready)).toBeVisible({ timeout: 15_000 });

    if (await ready.isVisible()) {
      await expect(page.getByText("Account id")).toBeVisible();
      // EVM alias shown when account provisioned with HIP-583 backfill
      const evm = page.getByText("EVM alias (HIP-583)");
      if (await evm.isVisible()) {
        await expect(page.locator(".code").filter({ hasText: /^0x[0-9a-f]{40}$/ })).toBeVisible();
      }
    }
  });
});
