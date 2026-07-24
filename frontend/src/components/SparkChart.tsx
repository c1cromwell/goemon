/** Tiny inline sparkline (hand-rolled SVG). Green/red by net direction. */
export function SparkChart({ values, height = 28 }: { values: number[]; height?: number }) {
  if (values.length < 2) return <div className="spark" style={{ height }} />;
  const W = 120;
  const H = height;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / span) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = values[values.length - 1]! >= values[0]!;
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
