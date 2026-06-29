import { test, expect } from "@playwright/test";
import { DEMO, loginWithPassword } from "./helpers/users";

/**
 * Dashboard (web channel) — money is rendered only from integer minor units via
 * the shared formatter. We assert the UI invariant: cash shows as a grouped,
 * two-decimal currency string, never a bare/float number.
 */
test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithPassword(page, DEMO.alex.email);
  });

  test("renders cash from minor units as formatted currency", async ({ page }) => {
    const cashCard = page.locator(".card.accent").filter({ hasText: "Available cash" });
    await expect(cashCard).toBeVisible();
    // e.g. "$12,500.00" — grouped thousands, exactly two decimals.
    await expect(cashCard.locator(".value.lg")).toHaveText(/^\$[\d,]+\.\d{2}$/);
  });

  test("shows the savings card and recent-activity panel", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Savings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  });

  test("a Tier-2 member sees the agent CTA, not the verify CTA", async ({ page }) => {
    // alex is Tier 2, so the primary action is "Send or ask Goeman Global Finance".
    await expect(page.getByRole("button", { name: "Send or ask Goeman Global Finance" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify your identity" })).toHaveCount(0);
  });
});
