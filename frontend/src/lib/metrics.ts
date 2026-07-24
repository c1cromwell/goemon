/** Formatting helpers for the asset-intelligence surfaces (Phase 30). */

/** basis points → signed percent string, e.g. 1040 → "+10.40%". */
export function pctFromBps(bps: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (bps == null) return "—";
  const pct = bps / 100;
  const sign = opts.signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export type Direction = "up" | "down" | "flat";

export function direction(bps: number | null | undefined): Direction {
  if (bps == null || bps === 0) return "flat";
  return bps > 0 ? "up" : "down";
}

export function arrow(dir: Direction): string {
  return dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
}

/** Compact count, e.g. 1234 → "1.2K". */
export function compactCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
