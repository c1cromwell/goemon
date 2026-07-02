/**
 * Portfolio — holder cockpit (Phase 29 P3, investment-management tools).
 *
 * Read-only projections from the ledger: total value + positions, distributions
 * (dividends/yield received), and an informational per-year tax summary. No jargon;
 * money always rendered from integer minor units.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { portfolioApi, type Portfolio, type Distribution, type TaxSummary } from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Empty } from "../components/ui";

const THIS_YEAR = new Date().getUTCFullYear();

export function PortfolioPage() {
  const navigate = useNavigate();
  const [port, setPort] = useState<Portfolio | null>(null);
  const [dists, setDists] = useState<Distribution[]>([]);
  const [year, setYear] = useState(THIS_YEAR);
  const [tax, setTax] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [p, d] = await Promise.all([
        portfolioApi.positions().catch(() => null),
        portfolioApi.distributions().then((r) => r.distributions).catch(() => []),
      ]);
      if (!active) return;
      setPort(p);
      setDists(d);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    portfolioApi.taxSummary(year).then(setTax).catch(() => setTax(null));
  }, [year]);

  if (loading) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg" style={{ maxWidth: 720 }}>
      <div>
        <h1>Portfolio</h1>
        <p className="muted small" style={{ margin: 0 }}>Your tokenized holdings, distributions, and a tax summary.</p>
      </div>

      {/* Total value */}
      <div className="card accent pad-lg">
        <div className="metric">
          <div className="label">Total value</div>
          <div className="value lg" style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}>
            {port ? formatMoney(port.totalValueMinor, "USD") : "—"}
          </div>
          <div className="micro" style={{ fontFamily: "var(--mono)", color: "var(--text-3)", marginTop: 6 }}>
            {port ? `${formatMoney(port.holdingsValueMinor, "USD")} holdings · ${formatMoney(port.cashMinor, "USD")} cash` : ""}
          </div>
        </div>
      </div>

      {/* Positions */}
      <div className="card">
        <h2>Positions</h2>
        {!port || port.holdings.length === 0 ? (
          <Empty>No tokenized positions yet. Invest or Collect to build your portfolio.</Empty>
        ) : (
          port.holdings.map((h) => (
            <div className="list-row tappable" key={h.assetId} onClick={() => navigate(`/asset/${h.assetId}`)}>
              <div className="grow">
                <div className="title">{h.name}{h.symbol ? <span className="muted"> · {h.symbol}</span> : null}</div>
                <div className="micro">{h.kind} · {Number(h.qtyBase).toLocaleString()} units</div>
              </div>
              <div className="right">
                <div className="amount">{h.valueMinor ? formatMoney(h.valueMinor, h.currency ?? "USD") : "—"}</div>
                <div className="micro">{h.priceMinor ? `${formatMoney(h.priceMinor, h.currency ?? "USD")} / unit` : "unpriced"}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Distributions */}
      <div className="card">
        <h2>Distributions</h2>
        {dists.length === 0 ? (
          <Empty>No distributions yet. Dividends and yield appear here automatically.</Empty>
        ) : (
          dists.map((d) => (
            <div className="list-row" key={d.journalId}>
              <div className="grow">
                <div className="title">{d.label}</div>
                <div className="micro">{new Date(d.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="amount" style={{ color: "var(--accent-strong)" }}>+{formatMoney(d.amountMinor, d.currency)}</div>
            </div>
          ))
        )}
      </div>

      {/* Tax summary */}
      <div className="card stack sm">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Tax summary</h2>
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost sm" onClick={() => setYear((y) => y - 1)}>‹</button>
            <span className="title" style={{ minWidth: 44, textAlign: "center" }}>{year}</span>
            <button className="ghost sm" disabled={year >= THIS_YEAR} onClick={() => setYear((y) => Math.min(THIS_YEAR, y + 1))}>›</button>
          </div>
        </div>
        {!tax || tax.count === 0 ? (
          <Empty>No distributions in {year}.</Empty>
        ) : (
          <>
            {Object.entries(tax.totalsByCurrency).map(([cur, total]) => (
              <div className="spread" key={cur}>
                <span className="muted small">Total distributions ({cur})</span>
                <span className="title">{formatMoney(total, cur)}</span>
              </div>
            ))}
            <hr className="hr" />
            {tax.byAsset.map((a) => (
              <div className="spread" key={`${a.label}-${a.currency}`}>
                <span className="muted small">{a.label}</span>
                <span className="small" style={{ fontWeight: 600 }}>{formatMoney(a.totalMinor, a.currency)}</span>
              </div>
            ))}
          </>
        )}
        <p className="micro" style={{ margin: "4px 0 0", textTransform: "none", letterSpacing: 0 }}>
          {tax?.disclaimer ?? "Informational only — not a filed tax document."}
        </p>
      </div>
    </div>
  );
}
