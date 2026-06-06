import { test, expect } from "@playwright/test";
import { DEMO, loginWithPassword } from "./helpers/users";

/**
 * Marketplace (web channel) — Invest/Collect listings render with prices from
 * minor units, and the trade sheet discloses the full fee breakdown BEFORE any
 * money moves. We stop at the quote (read-only) — confirming is exercised by the
 * deterministic backend suite, so this stays repeatable.
 */
test.describe("Marketplace", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithPassword(page, DEMO.blair.email);
  });

  test("Collect surface lists a seeded asset with a formatted price", async ({ page }) => {
    await page.goto("/collect");
    // The demo seed isn't idempotent, so multiple FLEER57 cards can exist; any
    // one proves the surface renders a priced listing.
    const card = page.locator(".card.tappable").filter({ hasText: "1986 Fleer #57" }).first();
    await expect(card).toBeVisible();
    await expect(card.locator(".amount")).toHaveText(/^\$[\d,]+\.\d{2}$/);
  });

  test("Invest surface renders without error", async ({ page }) => {
    await page.goto("/invest");
    await expect(page.getByRole("heading", { name: "Invest" })).toBeVisible();
    await expect(page.locator(".error")).toHaveCount(0);
  });

  test("trade sheet discloses gross, fee and net before confirming", async ({ page }) => {
    await page.goto("/collect");
    await page.locator(".card.tappable").filter({ hasText: "1986 Fleer #57" }).first().click();
    await expect(page).toHaveURL(/\/asset\//);

    // Open the trade sheet via the primary action (Buy if the asset is active,
    // else Subscribe) — both render the same fee-disclosure breakdown.
    await page.locator(".row.wrap button.lg").first().click();
    const sheet = page.locator(".sheet");
    await expect(sheet).toBeVisible();

    // Quote resolves (debounced) and shows the full breakdown.
    await expect(sheet.getByText("Gross")).toBeVisible();
    await expect(sheet.getByText("Fee")).toBeVisible();
    await expect(sheet.getByText("You pay")).toBeVisible();
    // Every disclosed amount is currency-formatted from minor units.
    const amounts = sheet.locator(".kv .amount");
    await expect(amounts.first()).toHaveText(/^\$[\d,]+\.\d{2}( \/ unit)?$/);

    // Leave without confirming — no money moves, suite stays repeatable.
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });
});
