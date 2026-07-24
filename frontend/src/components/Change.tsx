/** Colored gain/loss indicator (investing surfaces only). Green up / red down. */
import { pctFromBps, direction, arrow } from "../lib/metrics";

export function Change({ bps, showArrow = true }: { bps: number | null | undefined; showArrow?: boolean }) {
  const dir = direction(bps);
  return (
    <span className={`change ${dir}`}>
      {showArrow && bps != null ? arrow(dir) : null} {pctFromBps(bps, { signed: true })}
    </span>
  );
}
