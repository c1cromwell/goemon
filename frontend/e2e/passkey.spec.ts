import { test, expect } from "@playwright/test";
import { field, registerUser, logout } from "./helpers/users";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

/**
 * Journey J1 (web channel) — the passkey-first promise, automated end to end
 * with a CDP virtual authenticator: register → enroll a passkey → sign out →
 * sign back in with the passkey alone (no password). This is the flow that's
 * "manual until a browser-driver is added" in the runbook; now it isn't.
 */
test.describe("Passkey", () => {
  test("enroll a passkey, then sign in with it (no password)", async ({ page }) => {
    await enableVirtualAuthenticator(page);

    // Create the account (dev password path), then enroll a passkey.
    const email = await registerUser(page, { name: "Passkey User" });
    await page.getByRole("button", { name: "Set up passkey" }).click();
    // On success the Register page routes to onboarding.
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });

    // Sign out, then authenticate with the passkey only.
    await logout(page);
    await field(page, "Email").fill(email);
    await page.getByRole("button", { name: "Continue with passkey" }).click();

    // Back in, authenticated — the virtual authenticator satisfied the ceremony.
    await expect(page).toHaveURL("/", { timeout: 15_000 });
    await expect(page.getByText("Available cash")).toBeVisible();
  });
});
