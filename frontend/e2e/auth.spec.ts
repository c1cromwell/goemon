import { test, expect } from "@playwright/test";
import { DEMO, field, loginWithPassword, logout, registerUser } from "./helpers/users";

/**
 * Journey J1 (web channel): the auth surface — passkey-first login page,
 * the dev password fallback, registration, bad-credential handling, logout.
 */
test.describe("Auth", () => {
  test("login page is passkey-first", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with passkey" })).toBeVisible();
    // The password form is hidden until explicitly revealed (passkey-first).
    await expect(field(page, "Password")).toBeHidden();
    await expect(page.getByRole("button", { name: "Use a password instead" })).toBeVisible();
  });

  test("demo user signs in with the dev password fallback", async ({ page }) => {
    await loginWithPassword(page, DEMO.alex.email);
    // Lands on the dashboard, authenticated.
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
    await expect(page.getByText("Available cash")).toBeVisible();
  });

  test("wrong password surfaces an error and stays on /login", async ({ page }) => {
    await page.goto("/login");
    await field(page, "Email").fill(DEMO.alex.email);
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await field(page, "Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in with password" }).click();
    await expect(page.locator(".error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a new user can register and reach the passkey step", async ({ page }) => {
    const email = await registerUser(page, { name: "E2E Tester" });
    expect(email).toContain("@e2e.test");
    // The "skip for now" path drops into onboarding, authenticated.
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: "Verification" })).toBeVisible();
  });

  test("logout clears the session and returns to /login", async ({ page }) => {
    await loginWithPassword(page, DEMO.alex.email);
    await logout(page);
    // Hitting a guarded route now bounces back to login.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("guarded routes redirect anonymous visitors to /login", async ({ page }) => {
    await page.goto("/activity");
    await expect(page).toHaveURL(/\/login$/);
  });
});
