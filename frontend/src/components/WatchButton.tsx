/** Save / unsave an asset (watchlist). Optimistic; reverts on error. */
import { useState } from "react";
import { userApi } from "../api/client";
import { Icon } from "./Icon";

export function WatchButton({
  assetId,
  initialWatched,
  iconOnly = false,
  onChange,
}: {
  assetId: string;
  initialWatched: boolean;
  iconOnly?: boolean;
  onChange?: (watched: boolean) => void;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const next = !watched;
    setWatched(next);
    setBusy(true);
    try {
      await (next ? userApi.watchAsset(assetId) : userApi.unwatchAsset(assetId));
      onChange?.(next);
    } catch {
      setWatched(!next); // revert
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`watch-btn ${watched ? "on" : ""} ${iconOnly ? "icon-only" : ""}`}
      onClick={toggle}
      aria-pressed={watched}
      title={watched ? "Saved — click to remove" : "Save to watchlist"}
    >
      <Icon name="bookmark" size={15} />
      {iconOnly ? null : watched ? "Saved" : "Save"}
    </button>
  );
}
