/**
 * Asset detail — price, disclosures, the user's holding, and the trade actions.
 * Buy/Sell are secondary-market orders (asset must be active); Subscribe is the
 * primary-issuance escrow path. Compliance is re-checked server-side on confirm.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { userApi, type AssetDetail as AssetDetailT } from "../api/client";
import { formatMoney, formatUnits } from "../lib/money";
import { Loading } from "../components/ui";
import { TradeSheet } from "../components/TradeSheet";

type Side = "buy" | "sell" | "subscribe";

export function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tier } = useAuth();
  const [detail, setDetail] = useState<AssetDetailT | null>(null);
  const [heldBase, setHeldBase] = useState<string>("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [d, p] = await Promise.all([userApi.asset(id), userApi.portfolio().catch(() => null)]);
      setDetail(d);
      const h = p?.holdings.find((x) => x.assetId === id);
      setHeldBase(h?.qtyBase ?? "0");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load asset");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="page"><Loading /></div>;
  if (error || !detail) return <div className="page"><p className="error">{error ?? "Not found"}</p></div>;

  const { asset, listing } = detail;
  const active = asset.status === "active";
  const held = BigInt(heldBase) > 0n;
  const eligible = tier >= asset.minTier;
  const meta = asset.metadata ?? {};

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
      <button className="link" onClick={() => navigate(-1)}>← Back</button>

      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>{asset.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {asset.symbol ?? asset.kind} · {asset.tokenStandard}
            {asset.isSecurity ? " · security" : ""}
          </p>
        </div>
        <span className={`badge ${active ? "ok" : ""}`}>{asset.status}</span>
      </div>

      <div className="card accent pad-lg">
        <div className="metric">
          <div className="label">Price</div>
          <div className="value">
            {listing ? <span className="amount">{formatMoney(listing.priceMinor, listing.currency)}</span> : "Unlisted"}
          </div>
          {listing ? <div className="micro" style={{ marginTop: 6 }}>Source: {listing.priceSource}</div> : null}
        </div>
      </div>

      {!eligible ? (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <span className="badge warn">Requires Tier {asset.minTier}</span>
          <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>
            Verify your identity to trade this asset.
          </p>
          <button className="ghost sm" style={{ marginTop: 10 }} onClick={() => navigate("/onboarding")}>Verify identity</button>
        </div>
      ) : (
        <div className="row wrap">
          {active ? (
            <button className="lg" disabled={!listing} onClick={() => setSide("buy")}>Buy</button>
          ) : (
            <button className="lg" disabled={!listing} onClick={() => setSide("subscribe")}>Subscribe</button>
          )}
          {active && held ? (
            <button className="ghost" onClick={() => setSide("sell")}>Sell</button>
          ) : null}
          {active && listing?.surface === "invest" ? (
            <button className="ghost" onClick={() => setSide("subscribe")}>Subscribe (primary)</button>
          ) : null}
        </div>
      )}

      <div className="card">
        <h2>Your holding</h2>
        <div className="metric">
          <div className="value" style={{ fontSize: 22 }}>
            <span className="amount">{formatUnits(heldBase, asset.decimals)}</span>{" "}
            <span className="muted" style={{ fontSize: 14 }}>{asset.symbol ?? "units"}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Details</h2>
        <div className="kv"><span className="k">Token standard</span><span>{asset.tokenStandard}</span></div>
        <div className="kv"><span className="k">Minimum tier</span><span>Tier {asset.minTier}</span></div>
        <div className="kv"><span className="k">Total supply</span><span className="amount">{formatUnits(asset.totalSupply, asset.decimals)}</span></div>
        {Object.entries(meta).map(([k, v]) => (
          <div className="kv" key={k}>
            <span className="k">{k.replace(/_/g, " ")}</span>
            <span>{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>

      {side ? (
        <TradeSheet
          detail={detail}
          side={side}
          onClose={() => setSide(null)}
          onDone={() => {
            setSide(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
