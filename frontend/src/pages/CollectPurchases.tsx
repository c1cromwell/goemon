/**
 * Collectible escrow purchases — buyer/seller actions on in-flight trades.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { userApi, ApiError, type CollectiblePurchase } from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function statusKind(s: CollectiblePurchase["status"]): "ok" | "warn" | "bad" {
  if (s === "disputed") return "bad";
  if (s === "escrow_held" || s === "shipped") return "warn";
  return "ok";
}

export function CollectPurchases() {
  const { me } = useAuth();
  const toast = useToast();
  const [purchases, setPurchases] = useState<CollectiblePurchase[] | null>(null);

  async function refresh() {
    try {
      const { purchases: rows } = await userApi.collectiblePurchases();
      setPurchases(rows);
    } catch {
      setPurchases([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.show(ok);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "bad");
    }
  }

  if (purchases === null) return <Loading />;

  return (
    <div className="page stack lg">
      <div className="spread">
        <div>
          <h1>Escrow purchases</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Seller P2P slab trades — ship, confirm, or dispute.
          </p>
        </div>
        <Link to="/collect" className="ghost sm">← Collect</Link>
      </div>

      {purchases.length === 0 ? (
        <Empty>No escrow purchases yet.</Empty>
      ) : (
        <div className="list">
          {purchases.map((p) => {
            const isBuyer = p.buyerUserId === me?.id;
            const isSeller = p.sellerUserId === me?.id;
            return (
              <div key={p.id} className="list-row" style={{ alignItems: "flex-start" }}>
                <div className="stack" style={{ gap: 2 }}>
                  <span>
                    {formatMoney(p.amountMinor, p.currency)} · {isBuyer ? "buying" : "selling"}
                  </span>
                  <span className="muted micro">
                    <Link to={`/asset/${p.assetId}`}>View listing</Link>
                    {" · "}
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {isSeller && p.status === "escrow_held" && (
                    <>
                      <button className="ghost sm" onClick={() => act(() => userApi.shipCollectiblePurchase(p.id), "Marked shipped")}>
                        Mark shipped
                      </button>
                      <button className="ghost sm" onClick={() => act(() => userApi.cancelCollectiblePurchase(p.id), "Purchase canceled")}>
                        Cancel
                      </button>
                    </>
                  )}
                  {isBuyer && p.status === "shipped" && (
                    <button className="ghost sm" onClick={() => act(() => userApi.confirmCollectiblePurchase(p.id), "Receipt confirmed — seller paid")}>
                      Confirm receipt
                    </button>
                  )}
                  {(p.status === "escrow_held" || p.status === "shipped") && (
                    <button
                      className="ghost sm"
                      onClick={() => {
                        const reason = window.prompt("Reason for dispute?");
                        if (reason) void act(() => userApi.disputeCollectiblePurchase(p.id, reason), "Dispute opened");
                      }}
                    >
                      Dispute
                    </button>
                  )}
                  <Badge kind={statusKind(p.status)}>{p.status.replace(/_/g, " ")}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
