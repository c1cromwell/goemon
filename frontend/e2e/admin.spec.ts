import { test, expect } from "@playwright/test";
import { ADMIN } from "./helpers/users";

/**
 * Admin console (web channel, Phase 5A) — the RBAC-gated risk-adaptive
 * onboarding console. It uses a separate admin token; an anonymous visit to
 * /admin bounces to the admin login, and a valid login reaches the console.
 */
test.describe("Admin console", () => {
  test("anonymous /admin redirects to the admin login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole("heading", { name: "BankAI Admin" })).toBeVisible();
  });

  test("seeded admin signs in and sees the identities console", async ({ page }) => {
    await page.goto("/admin/login");
    // Fields are pre-filled with the seeded admin; confirm and submit.
    await expect(page.locator('input').first()).toHaveValue(ADMIN.email);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /BankAI Admin · Identities/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /All registered identities/ })).toBeVisible();
  });
});
