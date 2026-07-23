/**
 * AssetCover — always renders a picture for an asset. Uses the real image when
 * one is available (from listing.imageUrl / asset metadata); otherwise draws a
 * professional generated cover keyed by the asset's kind (palette + glyph), so
 * the Invest/buy surfaces never show a bare, image-less card.
 */
import { useState } from "react";
import { kindMeta, coverGradient } from "../lib/assetVisuals";

export function AssetCover({
  imageUrl,
  name,
  symbol,
  kind,
  variant = "card",
}: {
  imageUrl?: string | null;
  name: string;
  symbol?: string | null;
  kind: string;
  variant?: "card" | "hero";
}) {
  const [failed, setFailed] = useState(false);
  const km = kindMeta(kind);
  const showImg = !!imageUrl && !failed;
  const seed = symbol ?? name ?? kind;
  const mono = (symbol ?? name ?? "?").slice(0, 3).toUpperCase();

  return (
    <div
      className={`asset-cover ${variant}`}
      style={showImg ? undefined : { background: coverGradient(kind, seed) }}
    >
      {showImg ? (
        <img src={imageUrl!} alt={name} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="asset-cover-art">
          <span className="asset-cover-glyph" aria-hidden>
            {km.glyph}
          </span>
          <span className="asset-cover-mono">{mono}</span>
        </div>
      )}
    </div>
  );
}
