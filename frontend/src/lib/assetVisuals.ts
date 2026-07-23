/**
 * Per-asset-kind visual language. Drives the generated cover art (palette +
 * glyph) shown when an asset has no real image, and the kind label/filter tabs
 * on the Invest surface. Kind strings match the backend AssetKind union
 * (tokenizationService.ts) with a graceful default for anything unrecognised.
 */
export interface KindMeta {
  key: string;
  label: string;
  glyph: string;
  hue: number;
}

const KINDS: Record<string, KindMeta> = {
  security: { key: "security", label: "Securities", glyph: "\u{1F4DC}", hue: 28 },
  equity: { key: "equity", label: "Equities", glyph: "\u{1F4C8}", hue: 158 },
  treasury: { key: "treasury", label: "Treasury", glyph: "\u{1F3DB}\u{FE0F}", hue: 262 },
  real_estate: { key: "real_estate", label: "Real estate", glyph: "\u{1F3E0}", hue: 210 },
  commodity: { key: "commodity", label: "Commodities", glyph: "\u{1F947}", hue: 42 },
  royalty: { key: "royalty", label: "Royalties", glyph: "\u{1F3B5}", hue: 322 },
  collectible: { key: "collectible", label: "Collectibles", glyph: "\u{1F3B4}", hue: 350 },
  gaming: { key: "gaming", label: "Gaming", glyph: "\u{1F3AE}", hue: 190 },
};

const DEFAULT_META: KindMeta = { key: "other", label: "Other", glyph: "\u{25C6}", hue: 220 };

export function kindMeta(kind: string | null | undefined): KindMeta {
  if (!kind) return DEFAULT_META;
  return KINDS[kind] ?? { ...DEFAULT_META, key: kind, label: prettyKind(kind) };
}

/** Kind label for a tab/badge, e.g. "real_estate" → "Real estate". */
export function prettyKind(kind: string): string {
  const known = KINDS[kind];
  if (known) return known.label;
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Stable small integer from a string, for deterministic per-asset variation. */
function hashInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Deterministic two-stop gradient for an asset's generated cover. */
export function coverGradient(kind: string | null | undefined, seed: string): string {
  const { hue } = kindMeta(kind);
  const shift = (hashInt(seed) % 40) - 20;
  const h1 = hue + shift;
  const h2 = hue + shift + 30;
  return `linear-gradient(140deg, hsl(${h1} 46% 44%), hsl(${h2} 52% 28%))`;
}

/** Pull a usable image URL out of an asset's free-form metadata, if any. */
export function imageFromMetadata(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  for (const k of ["imageUrl", "image", "coverUrl", "photoUrl", "thumbnailUrl"]) {
    const v = meta[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}
