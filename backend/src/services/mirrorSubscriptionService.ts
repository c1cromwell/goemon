/**
 * Hedera Mirror Node inbound transfer watcher (REQ-RX-003).
 * Polls recent transactions for user accounts; dedupes via mirror_inbound_events;
 * fires push notifications within the polling interval (5s target in prod with websockets).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { notifyUser } from "./notificationService";
import { getUserHederaAccount } from "./hederaService";

interface MirrorTx {
  transaction_id: string;
  consensus_timestamp: string;
  transfers?: Array<{ account: string; amount: number; token_id?: string }>;
}

function mirrorBaseUrl(): string {
  return config.HEDERA_NETWORK === "mainnet"
    ? "https://mainnet-public.mirrornode.hedera.com"
    : `https://${config.HEDERA_NETWORK}.mirrornode.hedera.com`;
}

async function fetchRecentTransactions(hederaAccountId: string): Promise<MirrorTx[]> {
  const url = `${mirrorBaseUrl()}/api/v1/transactions?account.id=${encodeURIComponent(hederaAccountId)}&limit=10&order=desc`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = (await res.json()) as { transactions?: MirrorTx[] };
  return body.transactions ?? [];
}

/** Process one user's account for inbound USDC (or HBAR) credits. */
export async function pollInboundForUser(userId: string): Promise<number> {
  if (!config.HEDERA_ENABLED) return 0;

  const account = await getUserHederaAccount(userId);
  if (!account?.hedera_account_id) return 0;

  const txs = await fetchRecentTransactions(account.hedera_account_id);
  const db = getDb();
  let newEvents = 0;

  for (const tx of txs) {
    const inbound = (tx.transfers ?? []).find(
      (t) => t.account === account.hedera_account_id && t.amount > 0
    );
    if (!inbound) continue;

    const existing = await db.queryOne<{ id: string }>(
      "SELECT id FROM mirror_inbound_events WHERE transaction_id = ?",
      [tx.transaction_id]
    );
    if (existing) continue;

    const eventId = uuidv4();
    const amountMicro = inbound.token_id ? String(inbound.amount) : String(inbound.amount);
    await db.execute(
      `INSERT INTO mirror_inbound_events
         (id, user_id, hedera_account_id, transaction_id, amount_micro, token_id, consensus_at, notified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        userId,
        account.hedera_account_id,
        tx.transaction_id,
        amountMicro,
        inbound.token_id ?? null,
        tx.consensus_timestamp,
        new Date().toISOString(),
      ]
    );

    await notifyUser({
      userId,
      category: "transactional",
      title: "Inbound transfer",
      body: inbound.token_id ? "USDC received on Hedera" : "HBAR received on Hedera",
      data: { transactionId: tx.transaction_id },
    });

    newEvents++;
  }

  return newEvents;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Start background polling when Hedera + mirror subscription enabled. */
export function startMirrorSubscriptionLoop(): void {
  if (!config.HEDERA_ENABLED || !config.MIRROR_SUBSCRIPTION_ENABLED) return;
  if (pollTimer) return;

  const intervalMs = config.MIRROR_POLL_INTERVAL_MS;
  pollTimer = setInterval(() => {
    void (async () => {
      const rows = await getDb().query<{ user_id: string }>(
        "SELECT user_id FROM hedera_accounts WHERE hedera_account_id IS NOT NULL"
      );
      for (const r of rows) {
        try {
          await pollInboundForUser(r.user_id);
        } catch {
          // degrade: one user failure must not stop the loop
        }
      }
    })();
  }, intervalMs);
}

export function stopMirrorSubscriptionLoop(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
