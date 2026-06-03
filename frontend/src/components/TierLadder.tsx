/**
 * Tier ladder — dots + "N to go". Quiet, legible progress toward a milestone.
 * Levels 1..MAX_TIER are shown as dots; filled up to the current tier, the next
 * level highlighted.
 */
import { MAX_TIER, TARGET_TIER, tierName } from "../lib/tiers";

export function TierLadder({
  tier,
  target = TARGET_TIER,
  showCaption = true,
}: {
  tier: number;
  target?: number;
  showCaption?: boolean;
}) {
  const levels = Array.from({ length: MAX_TIER }, (_, i) => i + 1); // 1..MAX_TIER
  const toGo = Math.max(0, target - tier);
  const caption =
    tier >= target ? `${tierName(tier)} · all set` : `${tierName(tier)} · ${toGo} to go`;

  return (
    <div className="stack sm">
      <div className="ladder" role="img" aria-label={`Tier ${tier} of ${MAX_TIER}`}>
        {levels.map((lvl) => {
          const filled = lvl <= tier;
          const next = lvl === tier + 1;
          return <span key={lvl} className={`dot ${filled ? "filled" : ""} ${next ? "next" : ""}`} />;
        })}
      </div>
      {showCaption ? <span className="micro">{caption}</span> : null}
    </div>
  );
}
