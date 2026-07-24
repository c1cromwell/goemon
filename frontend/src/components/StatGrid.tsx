/** A grid of labeled stat tiles. `value` may be a string or a rendered node (e.g. a Change). */
import type { ReactNode } from "react";

export interface Stat {
  label: string;
  value: ReactNode;
  sub?: string;
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="stat-grid">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <span className="stat-label">{s.label}</span>
          <span className="stat-value">{s.value}</span>
          {s.sub ? <span className="stat-sub">{s.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}
