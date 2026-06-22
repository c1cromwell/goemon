/**
 * Invest / Collect — marketplace + seller slab listings (P2P lane).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { userApi, type ListingView, type SellerSubmission, type Surface } from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading } from "../components/ui";

const COPY: Record<Surface, { title: string; sub: string }> = {
  invest: { title: "Invest", sub: "Tokenized real-world assets and securities." },
  collect: { title: "Collect", sub: "Graded slabs — vault inventory and seller listings." },
};

const STATUS_LABEL: Record<string, string> = {
  pending_human: "In review",
  approved: "Live",
  rejected: "Rejected",
};

function MarketPage({ surface }: { surface: Surface }) {
  const navigate = useNavigate();
  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [mine, setMine] = useState<SellerSubmission[]>([]);

  useEffect(() => {
    setListings(null);
    userApi
      .listings(surface)
      .then((r) => setListings(r.listings))
      .catch(() => setListings([]));
    if (surface === "collect") {
      userApi.myCollectibleSubmissions().then((r) => setMine(r.submissions)).catch(() => setMine([]));
    }
  }, [surface]);

  const copy = COPY[surface];

  return (
    <div className="page stack lg">
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div>
          <h1>{copy.title}</h1>
          <p className="muted small" style={{ margin: 0 }}>{copy.sub}</p>
        </div>
        {surface === "collect" ? (
          <div className="row" style={{ gap: 8 }}>
            <Link to="/collect/purchases" className="ghost sm">Escrow purchases</Link>
            <Link to="/collect/sell" className="button sm">List a slab</Link>
          </div>
        ) : null}
      </div>

      {surface === "collect" && mine.length > 0 && (
        <section className="card">
          <h2>Your listings</h2>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Cert</th>
                <th>Ask</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.id}>
                  <td>{s.title ?? s.certNumber}</td>
                  <td>{s.grader.toUpperCase()} {s.certNumber}</td>
                  <td>{formatMoney(s.askUsdcMicro, "USDC", { trim: true })}</td>
                  <td>
                    <span className={`badge ${s.status === "approved" ? "ok" : s.status === "rejected" ? "warn" : ""}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                    {s.assetId && s.status === "approved" ? (
                      <button className="ghost sm" style={{ marginLeft: 8 }} onClick={() => navigate(`/asset/${s.assetId}`)}>
                        View
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {listings === null ? (
        <Loading />
      ) : listings.length === 0 ? (
        <Empty>
          {surface === "collect"
            ? "No live listings yet. List a graded slab or seed the marketplace."
            : "No assets listed yet. Seed the marketplace to populate this surface."}
        </Empty>
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
