import { type Page, type Locator, expect } from "@playwright/test";

/**
 * The portal's form labels aren't `for`/`id`-associated with their inputs — both
 * are siblings inside a `.field` wrapper — so `getByLabel` can't see them. Scope
 * to the `.field` that contains the label text and grab its control instead.
 */
export function field(page: Page, label: string): Locator {
  return page.locator(".field", { hasText: label }).locator("input, textarea, select");
}

/**
 * Seeded demo accounts (from `npm run seed:users`, password `Demo1234!`).
 * Read-only journeys use these; anything that moves money or changes tier
 * registers a throwaway user instead (see `registerUser`).
 */
export const DEMO_PASSWORD = "Demo1234!";
export const DEMO = {
  /** Tier 2, ~$12,500 cash — transfers + SmartChat unlocked. */
  alex: { email: "alex@demo.com", name: "Alex Rivera", tier: 2 },
  /** Tier 2, ~$40,000 cash — marketplace Invest. */
  blair: { email: "blair@demo.com", name: "Blair Chen", tier: 2 },
  /** Tier 1, phone-verified. */
  casey: { email: "casey@demo.com", name: "Casey Morgan", tier: 1 },
  /** Tier 0, fresh signup. */
  drew: { email: "drew@demo.com", name: "Drew Patel", tier: 0 },
} as const;

export const ADMIN = { email: "admin@goemanglobal.com", password: "Admin1234!" };

/** Log in through the real Login page via the dev password fallback. */
export async function loginWithPassword(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await field(page, "Email").fill(email);
  // The password form is gated behind a feature probe; reveal it.
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page).toHaveURL("/", { timeout: 10_000 });
}

/**
 * Sign out via the /more secondary menu, returning to /login. (We avoid the wide
 * sidebar's profile popup on purpose: it opens below a bottom-pinned button and
 * renders off-screen on desktop — see e2e/README.md "Known UI issue".)
 */
export async function logout(page: Page) {
  await page.goto("/more");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login", { timeout: 10_000 });
}

/** A unique, collision-proof email for throwaway accounts. */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.test`;
}

/**
 * Register a brand-new account through the real Register page. Lands on the
 * "Add a passkey" step authenticated; callers can enroll a passkey or skip.
 * Returns the email used.
 */
export async function registerUser(
  page: Page,
  opts: { email?: string; name?: string; password?: string } = {}
): Promise<string> {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? "Passw0rd!123";
  await page.goto("/register");
  if (opts.name) await field(page, "Full name").fill(opts.name);
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Add a passkey" })).toBeVisible({ timeout: 10_000 });
  return email;
}
