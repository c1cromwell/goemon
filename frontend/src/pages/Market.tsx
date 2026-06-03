/**
 * Invest / Collect — the two marketplace surfaces. Same information architecture,
 * one accent, type-led cards. Eligibility (tier/jurisdiction) is shown quietly;
 * the backend is the source of truth and re-checks on trade.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { userApi, type ListingView, type Surface } from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading } from "../components/ui";

const COPY: Record<Surface, { title: string; sub: string }> = {
  invest: { title: "Invest", sub: "Tokenized real-world assets and securities." },
  collect: { title: "Collect", sub: "Collectibles and gaming assets." },
};

function MarketPage({ surface }: { surface: Surface }) {
  const navigate = useNavigate();
  const [listings, setListings] = useState<ListingView[] | null>(null);

  useEffect(() => {
    setListings(null);
    userApi
      .listings(surface)
      .then((r) => setListings(r.listings))
      .catch(() => setListings([]));
  }, [surface]);

  const copy = COPY[surface];

  return (
    <div className="page stack lg">
      <div>
        <h1>{copy.title}</h1>
        <p className="muted small" style={{ margin: 0 }}>{copy.sub}</p>
      </div>

      {listings === null ? (
        <Loading />
      ) : listings.length === 0 ? (
        <Empty>No assets listed yet. Seed the marketplace to populate this surface.</Empty>
      ) : (
        <div className="grid cols-3">
          {listings.map((l) => (
            <div key={l.assetId} className="card tappable" onClick={() => navigate(`/asset/${l.assetId}`)}>
              <div className="spread" style={{ alignItems: "flex-start" }}>
                <div className="lead">{(l.symbol ?? l.name)[0]?.toUpperCase()}</div>
                {l.eligible ? null : <span className="badge warn">{l.eligibilityReason ?? "Restricted"}</span>}
              </div>
              <div className="title" style={{ marginTop: 12 }}>{l.name}</div>
              <div className="micro">{l.symbol ?? l.kind}</div>
              <div className="metric" style={{ marginTop: 14 }}>
                <div className="value" style={{ fontSize: 22 }}>
                  <span className="amount">{formatMoney(l.priceMinor, l.currency)}</span>
                </div>
                <div className="micro">per unit</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Invest() {
  return <MarketPage surface="invest" />;
}
export function Collect() {
  return <MarketPage surface="collect" />;
}
