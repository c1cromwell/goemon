import { test, expect } from "@playwright/test";
import { DEMO, loginWithPassword } from "./helpers/users";

/**
 * Theme (web channel) — Quiet Premium ships dark-default with a light mode via
 * `data-theme`, persisted across reloads in localStorage.
 */
test.describe("Theme", () => {
  test("toggles dark ↔ light and persists across reload", async ({ page }) => {
    await loginWithPassword(page, DEMO.alex.email);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");

    // Toggle via the /more secondary menu (the wide sidebar popup renders
    // off-screen — see e2e/README.md "Known UI issue").
    await page.goto("/more");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");

    // Survives a reload (persisted in localStorage).
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
  });
});
