/** Watchlist — the assets a user has saved. Reuses the image-forward asset card. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { userApi, type ListingView } from "../api/client";
import { formatMoney } from "../lib/money";
import { pctFromBps, compactCount } from "../lib/metrics";
import { prettyKind } from "../lib/assetVisuals";
import { AssetCover } from "../components/AssetCover";
import { Change } from "../components/Change";
import { WatchButton } from "../components/WatchButton";
import { Empty, Loading } from "../components/ui";

export function Watchlist() {
  const navigate = useNavigate();
  const [listings, setListings] = useState<ListingView[] | null>(null);

  useEffect(() => {
    userApi
      .watchlist()
      .then((r) => setListings(r.listings))
      .catch(() => setListings([]));
  }, []);

  return (
    <div className="page stack lg">
      <div>
        <h1>Watchlist</h1>
        <p className="muted small" style={{ margin: 0 }}>Assets you've saved.</p>
      </div>

      {listings === null ? (
        <Loading />
      ) : listings.length === 0 ? (
        <Empty>Nothing saved yet. Tap the bookmark on any asset to add it here.</Empty>
      ) : (
        <div className="grid cols-3">
          {listings.map((l) => (
            <div key={l.assetId} className="asset-card card tappable" onClick={() => navigate(`/asset/${l.assetId}`)}>
              <AssetCover imageUrl={l.imageUrl} name={l.name} symbol={l.symbol} kind={l.kind} />
              <div className="asset-card-body">
                <div className="spread" style={{ alignItems: "flex-start", gap: 8 }}>
                  <div className="title">{l.name}</div>
                  <WatchButton
                    assetId={l.assetId}
                    initialWatched
                    iconOnly
                    onChange={(w) => {
                      if (!w) setListings((cur) => (cur ? cur.filter((x) => x.assetId !== l.assetId) : cur));
                    }}
                  />
                </div>
                <div className="micro">{prettyKind(l.kind)}{l.symbol ? ` · ${l.symbol}` : ""}</div>
                <div className="asset-card-price">
                  <span className="amount">{formatMoney(l.priceMinor, l.currency)}</span>
                  <span className="micro"> / unit</span>
                  {l.metrics && l.metrics.priceChangeBps != null ? (
                    <span style={{ fontSize: 12, marginLeft: 8 }}><Change bps={l.metrics.priceChangeBps} /></span>
                  ) : null}
                </div>
                {l.metrics ? (
                  <div className="card-metrics">
                    <span>{compactCount(l.metrics.investorCount)} investors</span>
                    {l.metrics.yieldApyBps != null ? (
                      <><span className="dot">·</span><span>{pctFromBps(l.metrics.yieldApyBps)} APY</span></>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
