/**
 * Escrow buy sheet — seller P2P collectibles: hold USDC → seller ships → buyer confirms.
 */
import { useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type AssetDetail } from "../api/client";
import { formatMoney } from "../lib/money";
import { useToast } from "./Toast";

export function CollectibleBuySheet({
  detail,
  onClose,
  onDone,
}: {
  detail: AssetDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { asset, listing } = detail;
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = detail.collectiblesEscrowEnabled !== false;

  async function confirm() {
    if (!listing) return;
    setSubmitting(true);
    setError(null);
    try {
      await userApi.purchaseCollectible(asset.id, newIdempotencyKey());
      toast.show("Payment held in escrow — seller will ship the slab");
      onDone();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === "COLLECTIBLES_ESCROW_DISABLED"
          ? "In-app escrow is not enabled on this environment."
          : e instanceof Error
            ? e.message
            : "Purchase failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <h1>Buy with escrow</h1>
          <button className="link" onClick={onClose}>Close</button>
        </div>

        <p className="small muted" style={{ marginTop: 0 }}>
          Goemon holds your USDC until you confirm receipt. The seller ships directly to you — no vault partner required.
        </p>

        <div className="card" style={{ background: "var(--surface-2)", borderColor: "transparent" }}>
          <div className="kv">
            <span className="k">Item</span>
            <span>{asset.name}</span>
          </div>
          <div className="kv total">
            <span className="k">You pay (held)</span>
            <span className="amount">{listing ? formatMoney(listing.priceMinor, listing.currency) : "—"}</span>
          </div>
        </div>

        <ol className="small muted" style={{ margin: "16px 0", paddingLeft: 18 }}>
          <li>Funds move to escrow immediately</li>
          <li>Seller marks shipped when they send the slab</li>
          <li>You confirm receipt to release payment</li>
          <li>Disputes are mediated if something goes wrong</li>
        </ol>

        {!enabled ? (
          <p className="error">In-app escrow is disabled — set COLLECTIBLES_ESCROW_ENABLED for demo.</p>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <button
          className="block lg"
          disabled={!listing || !enabled || submitting}
          onClick={confirm}
        >
          {submitting ? "Holding funds…" : "Buy & hold in escrow"}
        </button>
      </div>
    </div>
  );
}
