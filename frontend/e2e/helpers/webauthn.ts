import { type Page } from "@playwright/test";

/**
 * Install a CDP virtual WebAuthn authenticator on the page so passkey ceremonies
 * (register + authenticate) complete headlessly — no OS biometric prompt.
 *
 * Mirrors a platform authenticator with user verification, which is what the
 * backend expects (`RP_ID=localhost`, `RP_ORIGIN=http://localhost:5173`).
 * Returns the authenticatorId for later inspection if needed.
 */
export async function enableVirtualAuthenticator(page: Page): Promise<string> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}
