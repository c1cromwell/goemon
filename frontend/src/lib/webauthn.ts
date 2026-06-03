/**
 * Passkey (WebAuthn) helpers — passkey-first auth.
 *
 * Enrollment requires an authenticated session (the backend register/start route
 * is behind requireAuth): a user is created via password (dev) or onboarding,
 * then adds a passkey; subsequent logins are passkey-only. Browser ceremony runs
 * through @simplewebauthn/browser v11 (object-param API).
 */
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/types";
import { userApi, setUserToken } from "../api/client";

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

/** Enroll a passkey for the currently-authenticated user. */
export async function enrollPasskey(deviceName?: string): Promise<void> {
  const options = (await userApi.webauthnRegisterStart()) as unknown as PublicKeyCredentialCreationOptionsJSON;
  const response = await startRegistration({ optionsJSON: options });
  const result = await userApi.webauthnRegisterFinish(response, deviceName ?? defaultDeviceName());
  if (!result.verified) throw new Error("Passkey registration could not be verified");
}

/** Authenticate with a passkey; on success stores the session token. */
export async function loginWithPasskey(email: string): Promise<{ userId: string }> {
  const start = await userApi.webauthnAuthStart(email);
  const { challengeId, ...optionsJSON } = start;
  const response = await startAuthentication({
    optionsJSON: optionsJSON as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  const { userId, token } = await userApi.webauthnAuthFinish(challengeId, response);
  setUserToken(token);
  return { userId };
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iOS device";
  if (/Mac/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android device";
  if (/Windows/.test(ua)) return "Windows device";
  return "This device";
}
