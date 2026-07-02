/**
 * Holder portfolio / investment-management tools (Phase 29 P3 — the holder cockpit).
 *
 * Read-only projections over the ledger + corporate actions:
 *   - positions       → reuse marketplaceService.getPortfolio (holdings valued at price)
 *   - distributions   → dividends/yield the holder received (corporate-action payouts)
 *   - tax summary      → per-year, per-asset distribution totals (informational, 1099-DIV-style)
 *
 * No money path — everything derives from the append-only ledger. Distributions post as
 * balanced journals with a `Dividend <symbol> (<caId>)` memo crediting the holder's cash
 * (both equity dividends and treasury yield route through distributeDividend), so a single
 * query captures them all. See docs/TOKENIZATION-MASTER-PLAN.md (P3).
 */

import { getDb } from "../db";

export interface Distribution {
  journalId: string;
  label: string; // the paying asset's symbol (or id)
  description: string;
  amountMinor: string;
  currency: string;
  createdAt: string;
}

/** Dividends / yield credited to the holder, newest first. */
export async function getDistributions(userId: string, limit = 100): Promise<Distribution[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = await getDb().query<{
    journal_id: string;
    description: string;
    amount_minor: string | number;
    currency: string;
    created_at: string;
  }>(
    `SELECT j.id AS journal_id, j.description AS description, e.amount_minor AS amount_minor,
            e.currency AS currency, j.created_at AS created_at
       FROM ledger_journals j
       JOIN ledger_entries e ON e.journal_id = j.id
       JOIN ledger_accounts a ON a.id = e.ledger_account_id
      WHERE a.user_id = ? AND e.direction = 'credit' AND j.description LIKE 'Dividend %'
      ORDER BY j.created_at DESC
      LIMIT ?`,
    [userId, capped]
  );
  return rows.map((r) => ({
    journalId: r.journal_id,
    label: /^Dividend (\S+)/.exec(r.description)?.[1] ?? "Distribution",
    description: r.description,
    amountMinor: BigInt(r.amount_minor).toString(),
    currency: r.currency,
    createdAt: r.created_at,
  }));
}

export interface TaxSummary {
  year: number;
  count: number;
  totalsByCurrency: Record<string, string>;
  byAsset: { label: string; currency: string; totalMinor: string }[];
  disclaimer: string;
}

/**
 * Per-year distribution totals for the holder — an informational summary of dividend/yield
 * income (1099-DIV style). NOT a filed tax document. Aggregated in JS (dialect-agnostic).
 */
export async function getTaxSummary(userId: string, year: number): Promise<TaxSummary> {
  const dists = await getDistributions(userId, 500);
  const inYear = dists.filter((d) => (d.createdAt ?? "").slice(0, 4) === String(year));

  const totalsByCurrency: Record<string, bigint> = {};
  const byAssetMap = new Map<string, bigint>();
  for (const d of inYear) {
    totalsByCurrency[d.currency] = (totalsByCurrency[d.currency] ?? 0n) + BigInt(d.amountMinor);
    const key = `${d.label}::${d.currency}`;
    byAssetMap.set(key, (byAssetMap.get(key) ?? 0n) + BigInt(d.amountMinor));
  }

  return {
    year,
    count: inYear.length,
    totalsByCurrency: Object.fromEntries(Object.entries(totalsByCurrency).map(([c, v]) => [c, v.toString()])),
    byAsset: [...byAssetMap.entries()].map(([key, v]) => {
      const [label, currency] = key.split("::");
      return { label: label!, currency: currency!, totalMinor: v.toString() };
    }),
    disclaimer: "Informational summary of distributions received — not a filed tax document. Consult a tax advisor.",
  };
}
