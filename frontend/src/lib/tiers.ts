/**
 * Identity tier ladder metadata (mirrors the backend TIER_OPS gating).
 * Used by the tier ladder UI and the Onboarding page to show what each tier
 * unlocks. Quiet gamification: progress is legible, never loud.
 */
export interface TierInfo {
  tier: number;
  name: string;
  unlocks: string;
}

export const TIERS: TierInfo[] = [
  { tier: 0, name: "Guest", unlocks: "View balance & profile" },
  { tier: 1, name: "Verified", unlocks: "Statements & history" },
  { tier: 2, name: "Member", unlocks: "Transfers & SmartChat" },
  { tier: 3, name: "Trusted", unlocks: "Higher transfer limits" },
  { tier: 4, name: "Premier", unlocks: "Lending & advanced products" },
];

export const MAX_TIER = 4;

/** Default milestone users are working toward (transfers unlock at Tier 2). */
export const TARGET_TIER = 2;

export function tierName(tier: number): string {
  return TIERS.find((t) => t.tier === tier)?.name ?? `Tier ${tier}`;
}
