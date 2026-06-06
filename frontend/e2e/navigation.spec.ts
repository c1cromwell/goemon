import { test, expect } from "@playwright/test";
import { DEMO, loginWithPassword, registerUser } from "./helpers/users";

/**
 * Navigation + tier gating (web channel). The flat primary nav (Home · Invest ·
 * Collect · Agent) routes correctly, and Agent is gated at Tier 2 by the router.
 */
test.describe("Navigation", () => {
  test("Tier-2 member moves across the primary nav", async ({ page }) => {
    await loginWithPassword(page, DEMO.alex.email);
    const sidebar = page.locator(".sidebar");

    await sidebar.getByRole("link", { name: "Invest" }).click();
    await expect(page).toHaveURL(/\/invest$/);
    await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Collect" }).click();
    await expect(page).toHaveURL(/\/collect$/);
    await expect(page.getByRole("heading", { name: "Collect" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Agent" }).click();
    await expect(page).toHaveURL(/\/agent$/);
    await expect(page.getByRole("heading", { name: "Agent" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL("/");
  });

  test("a below-Tier-2 user is redirected from Agent to onboarding", async ({ page }) => {
    // A freshly registered user is Tier 0; the RequireTier guard bounces /agent.
    await registerUser(page);
    await page.goto("/agent");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
  });
});
