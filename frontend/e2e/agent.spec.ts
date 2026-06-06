import { test, expect } from "@playwright/test";
import { DEMO, loginWithPassword } from "./helpers/users";

/**
 * SmartChat / Agent (web channel) — natural-language money ops. The control is
 * the short-lived operation token plus the MFA gate above $500: the agent never
 * moves money on its own. We verify the gate fires and DON'T confirm, so no
 * money moves and the suite stays repeatable.
 */
test.describe("Agent · SmartChat", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithPassword(page, DEMO.alex.email);
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: "Agent" })).toBeVisible();
  });

  test("a balance question gets a reply", async ({ page }) => {
    const agentBubbles = page.locator(".bubble.agent");
    await expect(agentBubbles).toHaveCount(1); // the intro
    await page.getByPlaceholder("Message BankAI…").fill("what's my balance?");
    await page.getByRole("button", { name: "Send" }).click();
    // The user's message and a fresh agent reply both render.
    await expect(page.locator(".bubble.user").filter({ hasText: "what's my balance?" })).toBeVisible();
    await expect(agentBubbles).toHaveCount(2, { timeout: 15_000 });
  });

  test("a transfer over $500 triggers the MFA gate", async ({ page }) => {
    await page.getByPlaceholder("Message BankAI…").fill("send $600 to blair@demo.com");
    await page.getByRole("button", { name: "Send" }).click();
    // The >$500 gate: an MFA confirmation card appears before anything executes.
    await expect(page.getByRole("heading", { name: "Confirm with MFA" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
    // The operation token chip shows a live countdown.
    await expect(page.locator(".countdown")).toBeVisible();
    // Intentionally do not confirm — the transfer must not execute.
  });
});
