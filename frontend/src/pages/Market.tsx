/**
 * Invest / Collect — marketplace + seller slab listings (P2P lane).
 * Invest is tabbed by asset kind with a search / eligibility / sort filter row;
 * every listing shows a cover image (real image or a generated kind cover).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { userApi, type ListingView, type SellerSubmission, type Surface } from "../api/client";
import { formatMoney } from "../lib/money";
import { prettyKind } from "../lib/assetVisuals";
import { AssetCover } from "../components/AssetCover";
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

// Preferred left-to-right tab order; kinds not listed here fall in after, A→Z.
const KIND_ORDER = [
  "real_estate",
  "equity",
  "treasury",
  "commodity",
  "royalty",
  "security",
  "collectible",
  "gaming",
];

type Sort = "recent" | "price-asc" | "price-desc" | "name";

function MarketPage({ surface }: { surface: Surface }) {
  const navigate = useNavigate();
  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [mine, setMine] = useState<SellerSubmission[]>([]);
  const [activeKind, setActiveKind] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("recent");

  useEffect(() => {
    setListings(null);
    setActiveKind("all");
    userApi
      .listings(surface)
      .then((r) => setListings(r.listings))
      .catch(() => setListings([]));
    if (surface === "collect") {
      userApi.myCollectibleSubmissions().then((r) => setMine(r.submissions)).catch(() => setMine([]));
    }
  }, [surface]);

  const copy = COPY[surface];

  // Distinct kinds present, in preferred order — drives the tab bar.
  const kindsPresent = useMemo(() => {
    const set = new Set((listings ?? []).map((l) => l.kind));
    const ordered = KIND_ORDER.filter((k) => set.has(k));
    const extras = [...set].filter((k) => !KIND_ORDER.includes(k)).sort();
    return [...ordered, ...extras];
  }, [listings]);

  const countByKind = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of listings ?? []) m[l.kind] = (m[l.kind] ?? 0) + 1;
    return m;
  }, [listings]);

  const visible = useMemo(() => {
    let out = listings ?? [];
    if (activeKind !== "all") out = out.filter((l) => l.kind === activeKind);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((l) => l.name.toLowerCase().includes(q) || (l.symbol ?? "").toLowerCase().includes(q));
    if (eligibleOnly) out = out.filter((l) => l.eligible);
    const sorted = [...out];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "price-asc") sorted.sort((a, b) => cmpBig(a.priceMinor, b.priceMinor));
    else if (sort === "price-desc") sorted.sort((a, b) => cmpBig(b.priceMinor, a.priceMinor));
    return sorted;
  }, [listings, activeKind, query, eligibleOnly, sort]);

  const showTabs = kindsPresent.length >= 2;

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
        <>
          {showTabs && (
            <div className="tabs" role="tablist">
              <button
                className={`tab ${activeKind === "all" ? "active" : ""}`}
                onClick={() => setActiveKind("all")}
                role="tab"
                aria-selected={activeKind === "all"}
              >
                All <span className="tab-count">{listings.length}</span>
              </button>
              {kindsPresent.map((k) => (
                <button
                  key={k}
                  className={`tab ${activeKind === k ? "active" : ""}`}
                  onClick={() => setActiveKind(k)}
                  role="tab"
                  aria-selected={activeKind === k}
                >
                  {prettyKind(k)} <span className="tab-count">{countByKind[k]}</span>
                </button>
              ))}
            </div>
          )}

          <div className="filter-row">
            <input
              className="filter-search"
              type="search"
              placeholder="Search by name or symbol"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="filter-toggle">
              <input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} />
              Eligible only
            </label>
            <select className="filter-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
              <option value="recent">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>

          {visible.length === 0 ? (
            <Empty>No assets match your filters.</Empty>
          ) : (
            <div className="grid cols-3">
              {visible.map((l) => (
                <div key={l.assetId} className="asset-card card tappable" onClick={() => navigate(`/asset/${l.assetId}`)}>
                  <AssetCover imageUrl={l.imageUrl} name={l.name} symbol={l.symbol} kind={l.kind} />
                  <div className="asset-card-body">
                    <div className="spread" style={{ alignItems: "flex-start", gap: 8 }}>
                      <div className="title">{l.name}</div>
                      {l.eligible ? null : <span className="badge warn">{l.eligibilityReason ?? "Restricted"}</span>}
                    </div>
                    <div className="micro">
                      {prettyKind(l.kind)}
                      {l.symbol ? ` · ${l.symbol}` : ""}
                    </div>
                    <div className="asset-card-price">
                      <span className="amount">{formatMoney(l.priceMinor, l.currency)}</span>
                      <span className="micro"> / unit</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function cmpBig(a: string, b: string): number {
  try {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  } catch {
    return 0;
  }
}

export function Invest() {
  return <MarketPage surface="invest" />;
}
export function Collect() {
  return <MarketPage surface="collect" />;
}
