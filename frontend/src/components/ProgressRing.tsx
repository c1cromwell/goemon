/** Subtle progress ring — quiet, earned gamification (no XP bars/confetti). */
export function ProgressRing({ percent, label }: { percent: number; label?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="ring" style={{ ["--p" as string]: String(p) }} aria-label={`${p}% complete`}>
      <div className="hole">{label ?? `${p}%`}</div>
    </div>
  );
}
