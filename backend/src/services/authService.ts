/**
 * Phase 3 — Auth service.
 *
 * Handles user creation, password hashing (dev only), and the two-step
 * WebAuthn ceremony (registration and authentication). Passkeys are stored
 * in the `passkeys` table; challenges in `webauthn_challenges`.
 */

import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/types";
import { getDb } from "../db";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  full_name: string | null;
  phone: string;
  address: string;
  created_at: string;
}

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface ChallengeRow {
  id: string;
  user_id: string | null;
  challenge: string;
  purpose: string;
  expires_at: string;
}

export async function createUser(email: string, fullName: string, passwordHash?: string): Promise<UserRow> {
  const db = getDb();
  const userId = uuidv4();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)",
      [userId, email.toLowerCase(), passwordHash ?? null, fullName]
    );

    const accountId = uuidv4();
    await tx.execute(
      "INSERT INTO accounts (id, user_id, account_number, balance_minor, currency) VALUES (?, ?, ?, ?, ?)",
      [accountId, userId, accountId.slice(0, 8).toUpperCase(), 1000000n, "USD"]
    );

    const profileId = uuidv4();
    await tx.execute(
      "INSERT INTO identity_profiles (id, user_id, tier, identity_status, created_at, updated_at) VALUES (?, ?, 0, 'pending', ?, ?)",
      [profileId, userId, now, now]
    );
  });

  return {
    id: userId,
    email: email.toLowerCase(),
    password_hash: passwordHash ?? null,
    full_name: fullName,
    phone: "",
    address: "",
    created_at: now,
  };
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  return getDb().queryOne<UserRow>("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]);
}

export async function getUserById(id: string): Promise<UserRow | null> {
  return getDb().queryOne<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function generatePasskeyRegistrationOptions(userId: string, email: string, displayName: string) {
  const db = getDb();

  const existing = await db.query<PasskeyRow>("SELECT * FROM passkeys WHERE user_id = ?", [userId]);

  const options = await generateRegistrationOptions({
    rpName: config.RP_NAME,
    rpID: config.RP_ID,
    userID: Buffer.from(userId),
    userName: email,
    userDisplayName: displayName,
    attestationType: "none",
    excludeCredentials: existing.map((pk) => ({
      id: pk.credential_id,
      transports: JSON.parse(pk.transports ?? "[]"),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const challengeId = uuidv4();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  await db.execute(
    "DELETE FROM webauthn_challenges WHERE user_id = ? AND purpose = ?",
    [userId, "registration"]
  );
  await db.execute(
    "INSERT INTO webauthn_challenges (id, user_id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?, ?)",
    [challengeId, userId, options.challenge, "registration", expiresAt]
  );

  return options;
}

export async function verifyPasskeyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceName?: string
) {
  const db = getDb();

  const challengeRow = await db.queryOne<ChallengeRow>(
    "SELECT * FROM webauthn_challenges WHERE user_id = ? AND purpose = ? AND expires_at > ?",
    [userId, "registration", new Date().toISOString()]
  );
  if (!challengeRow) throw new AppError(ErrorCode.VALIDATION, "No valid registration challenge found");

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: config.RP_ORIGIN,
    expectedRPID: config.RP_ID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(ErrorCode.VALIDATION, "Passkey registration failed");
  }

  const { credential } = verification.registrationInfo;
  const publicKeyB64 = Buffer.from(credential.publicKey).toString("base64url");
  const transports = JSON.stringify(response.response.transports ?? []);
  const passkeyId = uuidv4();

  await db.execute(
    "INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [passkeyId, userId, credential.id, publicKeyB64, credential.counter, transports, deviceName ?? null]
  );

  await db.execute("DELETE FROM webauthn_challenges WHERE id = ?", [challengeRow.id]);
  await logAudit({ userId, action: "passkey.register", resource: passkeyId, details: { credentialId: credential.id } });

  return { passkeyId, credentialId: credential.id };
}

export async function generatePasskeyAuthenticationOptions(email: string) {
  const db = getDb();
  const user = await getUserByEmail(email);

  const passkeys = user
    ? await db.query<PasskeyRow>("SELECT * FROM passkeys WHERE user_id = ?", [user.id])
    : [];

  const options = await generateAuthenticationOptions({
    rpID: config.RP_ID,
    // Do not populate allowCredentials in the start response — it would reveal
    // whether the email is registered (H-2 user enumeration oracle).
    allowCredentials: [],
    userVerification: "required",
  });

  const challengeId = uuidv4();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  if (user) {
    await db.execute(
      "DELETE FROM webauthn_challenges WHERE user_id = ? AND purpose = ?",
      [user.id, "authentication"]
    );
  }
  await db.execute(
    "INSERT INTO webauthn_challenges (id, user_id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?, ?)",
    [challengeId, user?.id ?? null, options.challenge, "authentication", expiresAt]
  );

  return { options, challengeId };
}

export async function verifyPasskeyAuthentication(
  challengeId: string,
  response: AuthenticationResponseJSON
): Promise<string> {
  const db = getDb();

  const challengeRow = await db.queryOne<ChallengeRow>(
    "SELECT * FROM webauthn_challenges WHERE id = ? AND purpose = ? AND expires_at > ?",
    [challengeId, "authentication", new Date().toISOString()]
  );
  if (!challengeRow) throw new AppError(ErrorCode.VALIDATION, "No valid authentication challenge");

  const passkey = await db.queryOne<PasskeyRow>(
    "SELECT * FROM passkeys WHERE credential_id = ?",
    [response.id]
  );
  if (!passkey) throw new AppError(ErrorCode.NOT_FOUND, "Passkey not found");

  const publicKey = new Uint8Array(Buffer.from(passkey.public_key, "base64url"));

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengeRow.challenge,
    expectedOrigin: config.RP_ORIGIN,
    expectedRPID: config.RP_ID,
    credential: {
      id: passkey.credential_id,
      publicKey,
      counter: passkey.counter,
      transports: JSON.parse(passkey.transports ?? "[]"),
    },
    requireUserVerification: true,
  });

  if (!verification.verified) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Passkey authentication failed");
  }

  await db.execute(
    "UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?",
    [verification.authenticationInfo.newCounter, new Date().toISOString(), passkey.id]
  );

  await db.execute("DELETE FROM webauthn_challenges WHERE id = ?", [challengeRow.id]);
  await logAudit({ userId: passkey.user_id, action: "passkey.authenticate", resource: passkey.id });

  return passkey.user_id;
}

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  return getDb().query<PasskeyRow>("SELECT * FROM passkeys WHERE user_id = ?", [userId]);
}

export async function deletePasskey(userId: string, passkeyId: string): Promise<void> {
  const db = getDb();
  const row = await db.queryOne<PasskeyRow>(
    "SELECT * FROM passkeys WHERE id = ? AND user_id = ?",
    [passkeyId, userId]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Passkey not found");
  await db.execute("DELETE FROM passkeys WHERE id = ?", [passkeyId]);
  await logAudit({ userId, action: "passkey.delete", resource: passkeyId });
}
