/**
 * Push notification seam — device token registry + transactional notify.
 * Production swaps: APNs (iOS), FCM (Android), Web Push.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { config } from "../config";
import { logAudit } from "./auditService";

export type PushPlatform = "ios" | "android" | "web";

export interface PushProvider {
  name: string;
  send(input: { token: string; platform: PushPlatform; title: string; body: string; data?: Record<string, string> }): Promise<void>;
}

function simulatedProvider(): PushProvider {
  return {
    name: "simulated",
    async send(input) {
      if (!config.isTest) {
        // eslint-disable-next-line no-console
        console.info("[push:simulated]", input.platform, input.title, input.body);
      }
    },
  };
}

let provider: PushProvider | null = null;
export function setPushProvider(p: PushProvider | null): void {
  provider = p;
}

export function getPushProvider(): PushProvider {
  return provider ?? simulatedProvider();
}

export async function registerDeviceToken(input: {
  userId: string;
  platform: PushPlatform;
  token: string;
}): Promise<void> {
  const db = getDb();
  const existing = await db.queryOne<{ id: string }>(
    "SELECT id FROM push_device_tokens WHERE user_id = ? AND token = ? AND revoked_at IS NULL",
    [input.userId, input.token]
  );
  if (existing) return;

  await db.execute(
    "INSERT INTO push_device_tokens (id, user_id, platform, token) VALUES (?, ?, ?, ?)",
    [uuidv4(), input.userId, input.platform, input.token]
  );
}

export async function notifyUser(input: {
  userId: string;
  category: "transactional" | "marketplace" | "account";
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<number> {
  const tokens = await getDb().query<{ token: string; platform: PushPlatform }>(
    "SELECT token, platform FROM push_device_tokens WHERE user_id = ? AND revoked_at IS NULL",
    [input.userId]
  );
  const push = getPushProvider();
  for (const t of tokens) {
    await push.send({ token: t.token, platform: t.platform, title: input.title, body: input.body, data: input.data });
  }
  if (tokens.length > 0) {
    await logAudit({
      userId: input.userId,
      action: "push.notify",
      resource: input.category,
      details: { title: input.title, deviceCount: tokens.length },
    });
  }
  return tokens.length;
}
