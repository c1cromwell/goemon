import { test, expect } from "@playwright/test";
import { field, registerUser } from "./helpers/users";

/**
 * Onboarding / tiered identity ladder (web channel). A fresh user climbs
 * 0 → 1 → 2 through the deterministic phone → KYC flow; Tier 2 unlocks SmartChat.
 * Runs entirely on a throwaway account, so it's repeatable.
 */
test.describe("Onboarding ladder", () => {
  test("a new user advances Tier 0 → 1 → 2 and unlocks the agent", async ({ page }) => {
    await registerUser(page, { name: "Ladder Climber" });
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // Tier 0 → 1: phone verification.
    await expect(page.getByRole("heading", { name: /Step 1 · Add your phone/ })).toBeVisible();
    await field(page, "Phone number").fill("+1 555 123 4567");
    await page.getByRole("button", { name: /Verify phone/ }).click();

    // Tier 1 → 2: identity / KYC.
    await expect(page.getByRole("heading", { name: /Step 2 · Identity check/ })).toBeVisible({ timeout: 10_000 });
    await field(page, "Full legal name").fill("Ladder Climber");
    await field(page, "Date of birth").fill("1990-01-01");
    await page.getByRole("button", { name: /Complete KYC/ }).click();

    // Verified — SmartChat is now reachable.
    await expect(page.getByRole("heading", { name: "You're verified" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Open Agent" }).click();
    await expect(page).toHaveURL(/\/agent$/);
    await expect(page.getByRole("heading", { name: "Agent" })).toBeVisible();
  });
});
