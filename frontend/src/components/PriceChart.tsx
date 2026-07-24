/**
 * PriceChart — hand-rolled SVG area/line chart with a hover crosshair and range
 * tabs. Green/red by net direction over the visible range. No charting library.
 *
 * Data is the asset's listing price history (event-driven, not intraday), so range
 * tabs filter by date and gracefully fall back to "all" when a window is too sparse.
 */
import { useMemo, useRef, useState } from "react";
import { formatMoney } from "../lib/money";

export interface PricePoint {
  priceMinor: string;
  asOf: string;
}

type Range = "1M" | "3M" | "1Y" | "ALL";
const RANGES: { key: Range; label: string; days: number | null }[] = [
  { key: "1M", label: "1M", days: 31 },
  { key: "3M", label: "3M", days: 92 },
  { key: "1Y", label: "1Y", days: 366 },
  { key: "ALL", label: "All", days: null },
];

const W = 640;
const H = 200;
const PAD = 6;

export function PriceChart({ points, currency }: { points: PricePoint[]; currency: string }) {
  const [range, setRange] = useState<Range>("ALL");
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const parsed = useMemo(
    () => points.map((p) => ({ t: Date.parse(p.asOf) || 0, v: Number(BigInt(p.priceMinor)) })),
    [points]
  );

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    if (days == null) return parsed;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const filtered = parsed.filter((p) => p.t >= cutoff);
    return filtered.length >= 2 ? filtered : parsed; // fall back when too sparse
  }, [parsed, range]);

  if (parsed.length < 2) {
    return <div className="muted small" style={{ padding: "24px 0" }}>Not enough price history to chart yet.</div>;
  }

  const ys = visible.map((p) => p.v);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const n = visible.length;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);

  const line = visible.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const up = visible[n - 1]!.v >= visible[0]!.v;
  const stroke = up ? "var(--up)" : "var(--down)";
  const fill = up ? "var(--up-weak)" : "var(--down-weak)";

  function onMove(e: React.MouseEvent) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (n - 1)));
  }

  const hp = hover != null ? visible[hover] : null;

  return (
    <div>
      <div className="chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 200 }}>
          <path d={area} fill={fill} stroke="none" />
          <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {hp ? (
            <>
              <line x1={x(hover!)} y1={0} x2={x(hover!)} y2={H} stroke="var(--line-strong)" strokeWidth="1" />
              <circle cx={x(hover!)} cy={y(hp.v)} r="3.5" fill={stroke} />
            </>
          ) : null}
        </svg>
        {hp ? (
          <div className="chart-crosshair" style={{ left: `${(hover! / (n - 1)) * 100}%` }}>
            {formatMoney(BigInt(Math.round(hp.v)), currency)}
            {hp.t ? <span className="muted"> · {new Date(hp.t).toLocaleDateString()}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="chart-ranges">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={`chart-range ${range === r.key ? "active" : ""}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
