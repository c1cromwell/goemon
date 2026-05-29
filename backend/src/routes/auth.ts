/**
 * Phase 3 — Auth routes.
 *
 * POST /api/auth/register                       — dev-only password registration
 * POST /api/auth/login/password                 — dev-only password login
 * POST /api/auth/webauthn/register/start        — begin passkey registration
 * POST /api/auth/webauthn/register/finish       — complete passkey registration
 * POST /api/auth/webauthn/authenticate/start    — begin passkey authentication
 * POST /api/auth/webauthn/authenticate/finish   — complete passkey authentication
 * GET  /api/auth/passkeys                       — list passkeys (authenticated)
 * DELETE /api/auth/passkeys/:id                 — delete passkey (authenticated)
 * GET  /api/auth/me                             — current user info (authenticated)
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { requireAuth, signSession, getClientIp, type AuthRequest } from "../middleware/auth";
import { authLimiter, recordAuthFailure, clearAuthFailures } from "../middleware/rateLimit";
import { AppError, ErrorCode } from "../errors";
import * as authService from "../services/authService";

export const authRouter = Router();

authRouter.post("/register", authLimiter(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.ALLOW_PASSWORD_AUTH) {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Password auth not enabled");
    }
    const { email, fullName, password } = req.body as { email?: string; fullName?: string; password?: string };
    if (!email || !password) throw new AppError(ErrorCode.VALIDATION, "email and password required");

    const existing = await authService.getUserByEmail(email);
    if (existing) throw new AppError(ErrorCode.CONFLICT, "Email already registered");

    const hash = await authService.hashPassword(password);
    const user = await authService.createUser(email, fullName ?? email.split("@")[0]!, hash);
    const token = signSession(user.id);
    res.status(201).json({ userId: user.id, token });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login/password", authLimiter(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!config.ALLOW_PASSWORD_AUTH) {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, "Password auth not enabled");
    }
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) throw new AppError(ErrorCode.VALIDATION, "email and password required");

    const ip = getClientIp(req);
    const user = await authService.getUserByEmail(email);

    if (!user || !user.password_hash || !(await authService.verifyPassword(password, user.password_hash))) {
      await recordAuthFailure(email, ip);
      throw new AppError(ErrorCode.UNAUTHENTICATED, "Invalid credentials");
    }

    await clearAuthFailures(email);
    const token = signSession(user.id);
    res.json({ userId: user.id, token });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/webauthn/register/start", requireAuth, authLimiter(), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getUserById(req.userId!);
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found");

    const options = await authService.generatePasskeyRegistrationOptions(
      user.id,
      user.email,
      user.full_name ?? user.email
    );
    res.json(options);
  } catch (e) {
    next(e);
  }
});

authRouter.post("/webauthn/register/finish", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { response, deviceName } = req.body as { response: unknown; deviceName?: string };
    if (!response) throw new AppError(ErrorCode.VALIDATION, "response required");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await authService.verifyPasskeyRegistration(req.userId!, response as any, deviceName);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

authRouter.post("/webauthn/authenticate/start", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email) throw new AppError(ErrorCode.VALIDATION, "email required");
    const { options, challengeId } = await authService.generatePasskeyAuthenticationOptions(email);
    res.json({ ...options, challengeId });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/webauthn/authenticate/finish", authLimiter(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { challengeId, response } = req.body as { challengeId?: string; response?: unknown };
    if (!challengeId || !response) {
      throw new AppError(ErrorCode.VALIDATION, "challengeId and response required");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = await authService.verifyPasskeyAuthentication(challengeId, response as any);
    const token = signSession(userId);
    res.json({ userId, token });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/passkeys", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const passkeys = await authService.listPasskeys(req.userId!);
    res.json(passkeys.map((pk) => ({
      id: pk.id,
      credentialId: pk.credential_id,
      deviceName: pk.device_name,
      createdAt: pk.created_at,
      lastUsedAt: pk.last_used_at ?? null,
    })));
  } catch (e) {
    next(e);
  }
});

authRouter.delete("/passkeys/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await authService.deletePasskey(req.userId!, req.params.id!);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getUserById(req.userId!);
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "User not found");
    res.json({ id: user.id, email: user.email, fullName: user.full_name });
  } catch (e) {
    next(e);
  }
});
