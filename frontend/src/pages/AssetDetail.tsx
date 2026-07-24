/**
 * Asset detail — a trading-grade view (Robinhood/E*TRADE-informed): price hero with
 * change + chart, a stat grid of investment metrics, a structured per-kind panel, a
 * collectibles intelligence section, and a sticky buy/sell bar. Valuation is a labeled
 * REFERENCE signal and yield is TRAILING/historical — never advice.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  userApi,
  type AssetDetail as AssetDetailT,
  type AssetMetrics,
  type CollectibleIntel,
} from "../api/client";
import { formatMoney, formatUnits } from "../lib/money";
import { pctFromBps, compactCount } from "../lib/metrics";
import { imageFromMetadata, prettyKind } from "../lib/assetVisuals";
import { Loading } from "../components/ui";
import { AssetCover } from "../components/AssetCover";
import { PriceChart } from "../components/PriceChart";
import { WatchButton } from "../components/WatchButton";
import { StatGrid, type Stat } from "../components/StatGrid";
import { Change } from "../components/Change";
import { TradeSheet } from "../components/TradeSheet";
import { CollectibleBuySheet } from "../components/CollectibleBuySheet";

type Side = "buy" | "sell" | "subscribe";

/** Structured, human per-kind detail rows (replaces the raw metadata dump). */
function kindDetails(kind: string, meta: Record<string, unknown>): Array<{ label: string; value: string }> {
  const s = (v: unknown) => (v == null ? null : String(v));
  const money = (v: unknown) => (v == null ? null : formatMoney(String(v), "USD"));
  const rows: Array<[string, string | null]> = [];
  if (kind === "real_estate") {
    rows.push(["Property type", s(meta.propertyType)]);
    rows.push(["Address", s(meta.address)]);
    rows.push(["Appraised value", money(meta.valuationMinor)]);
    rows.push(["Annual income", money(meta.incomeMinor)]);
    if (meta.valuationMinor && meta.incomeMinor) {
      const cap = (Number(meta.incomeMinor) / Number(meta.valuationMinor)) * 100;
      rows.push(["Cap rate", `${cap.toFixed(2)}%`]);
    }
  } else if (kind === "commodity") {
    rows.push(["Commodity", s(meta.commodityType)]);
    rows.push(["Unit", s(meta.unit)]);
    rows.push(["Purity", s(meta.purity)]);
    rows.push(["Custody attestation", s(meta.custodyAttestationUri)]);
  } else if (kind === "royalty") {
    rows.push(["IP type", s(meta.ipType)]);
    rows.push(["Title", s(meta.title)]);
    rows.push(["Rights holder", s(meta.rightsHolder)]);
  } else if (kind === "treasury") {
    rows.push(["Par value", money(meta.parMinor)]);
    rows.push(["Target APY", meta.apyBps != null ? pctFromBps(Number(meta.apyBps)) : null]);
    rows.push(["Backing", s(meta.backing)]);
  }
  // Anything else meaningful in metadata that we didn't map, shown generically.
  if (rows.filter(([, v]) => v).length === 0) {
    for (const [k, v] of Object.entries(meta)) {
      rows.push([k.replace(/_/g, " "), typeof v === "object" ? JSON.stringify(v) : String(v)]);
    }
  }
  return rows.filter(([, v]) => v != null).map(([label, value]) => ({ label, value: value! }));
}

export function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tier } = useAuth();
  const [detail, setDetail] = useState<AssetDetailT | null>(null);
  const [metrics, setMetrics] = useState<AssetMetrics | null>(null);
  const [intel, setIntel] = useState<CollectibleIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await userApi.asset(id);
      setDetail(d);
      const m = await userApi.assetMetrics(id).catch(() => null);
      setMetrics(m);
      if (d.asset.kind === "collectible") {
        setIntel(await userApi.collectibleIntel(id).catch(() => null));
      }
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
  const heldBase = metrics?.position?.heldQtyBase ?? "0";
  const held = BigInt(heldBase) > 0n;
  const eligible = tier >= asset.minTier;
  const meta = asset.metadata ?? {};
  const escrowBuy = detail.purchaseMode === "escrow";
  const openPurchase = detail.activePurchase;
  const purchasePending = openPurchase && openPurchase.status !== "completed" && openPurchase.status !== "refunded";
  const canBuy = active && listing && !purchasePending;
  const currency = listing?.currency ?? metrics?.currency ?? "USD";

  // Stat grid.
  const stats: Stat[] = [];
  if (metrics?.costPerUnitMinor) stats.push({ label: "Cost / unit", value: formatMoney(metrics.costPerUnitMinor, currency) });
  if (metrics) stats.push({ label: "Change", value: <Change bps={metrics.priceChangeBps} /> });
  if (metrics) stats.push({ label: "Investors", value: compactCount(metrics.investorCount) });
  if (metrics) stats.push({ label: "Saves", value: compactCount(metrics.saverCount) });
  if (metrics) stats.push({ label: "Views", value: compactCount(metrics.viewerCount) });
  if (metrics) stats.push({ label: "Volume", value: formatMoney(metrics.tradeStats.totalVolumeMinor, currency) });
  if (metrics) stats.push({ label: "Trades", value: String(metrics.tradeStats.tradeCount) });
  const apy = metrics?.yield.apyBps ?? null;
  const trailing = metrics?.yield.trailingYieldBps ?? null;
  if (apy != null || trailing != null) {
    stats.push({ label: "Yield", value: pctFromBps(apy ?? trailing), sub: apy != null ? "target APY" : "trailing 12mo" });
  }
  if (metrics?.valuation) {
    stats.push({
      label: "Reference value",
      value: formatMoney(metrics.valuation.referenceValueMinor, currency),
      sub: `${metrics.valuation.label === "premium" ? "at a premium" : metrics.valuation.label === "discount" ? "at a discount" : "near reference"} (${pctFromBps(metrics.valuation.premiumDiscountBps, { signed: true })})`,
    });
  }
  stats.push({ label: "Total supply", value: formatUnits(asset.totalSupply, asset.decimals) });
  stats.push({ label: "Min tier", value: `Tier ${asset.minTier}` });

  const detailRows = kindDetails(asset.kind, meta);

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 720 }}>
      <button className="link" onClick={() => navigate(-1)}>← Back</button>

      <AssetCover variant="hero" imageUrl={imageFromMetadata(meta)} name={asset.name} symbol={asset.symbol} kind={asset.kind} />

      {/* Price hero */}
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{asset.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {asset.symbol ?? prettyKind(asset.kind)} · {prettyKind(asset.kind)}
            {asset.isSecurity ? " · security" : ""}
          </p>
        </div>
        <WatchButton assetId={asset.id} initialWatched={metrics?.isWatched ?? false} />
      </div>

      <div className="metric">
        <div className="value" style={{ fontSize: 34 }}>
          {listing ? <span className="amount">{formatMoney(listing.priceMinor, listing.currency)}</span> : "Unlisted"}
          {metrics ? <span style={{ fontSize: 15, marginLeft: 10 }}><Change bps={metrics.priceChangeBps} /></span> : null}
        </div>
        {listing ? <div className="micro" style={{ marginTop: 4 }}>Source: {listing.priceSource} · per unit</div> : null}
      </div>

      {metrics && metrics.priceHistory.length >= 2 ? (
        <PriceChart points={metrics.priceHistory} currency={currency} />
      ) : null}

      {/* Metrics */}
      {stats.length > 0 ? <StatGrid stats={stats} /> : null}
      {metrics?.valuation?.simulated ? (
        <p className="disclosure">
          Reference value and yield are informational only — not an appraisal, forecast, or recommendation.
          Reference figures are illustrative (simulated data source).
        </p>
      ) : null}

      {escrowBuy ? (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <span className="badge ok">Seller listing · escrow protected</span>
          <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>
            Payment is held until you confirm receipt. Seller ships the slab directly — no vault partner.
          </p>
          {purchasePending && openPurchase ? (
            <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
              Purchase in progress ({openPurchase.status.replace(/_/g, " ")}).{" "}
              <button className="link" onClick={() => navigate("/collect/purchases")}>Manage purchase →</button>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Your holding */}
      <div className="card">
        <h2>Your holding</h2>
        <div className="metric">
          <div className="value" style={{ fontSize: 22 }}>
            <span className="amount">{formatUnits(heldBase, asset.decimals)}</span>{" "}
            <span className="muted" style={{ fontSize: 14 }}>{asset.symbol ?? "units"}</span>
          </div>
        </div>
        {metrics?.position?.costBasis?.unrealizedPnlMinor ? (
          <div className="kv" style={{ marginTop: 10 }}>
            <span className="k">Unrealized P&L</span>
            <span>
              {formatMoney(metrics.position.costBasis.unrealizedPnlMinor, currency, { signed: true })}{" "}
              <Change bps={metrics.position.costBasis.unrealizedPnlBps} showArrow={false} />
            </span>
          </div>
        ) : null}
      </div>

      {/* Structured per-kind details */}
      <div className="card">
        <h2>Details</h2>
        <div className="kv"><span className="k">Token standard</span><span>{asset.tokenStandard}</span></div>
        {detailRows.map((r) => (
          <div className="kv" key={r.label}><span className="k">{r.label}</span><span>{r.value}</span></div>
        ))}
      </div>

      {/* Collectible intelligence */}
      {asset.kind === "collectible" && intel ? <CollectibleIntelPanel intel={intel} currency={currency} /> : null}

      {/* Eligibility gate */}
      {!eligible ? (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <span className="badge warn">Requires Tier {asset.minTier}</span>
          <p className="small muted" style={{ marginBottom: 0, marginTop: 10 }}>Verify your identity to trade this asset.</p>
          <button className="ghost sm" style={{ marginTop: 10 }} onClick={() => navigate("/onboarding")}>Verify identity</button>
        </div>
      ) : (
        <div className="trade-bar">
          {active && canBuy ? (
            <button onClick={() => setSide("buy")}>{escrowBuy ? "Buy with escrow" : "Buy"}</button>
          ) : active && purchasePending ? (
            <button className="ghost" onClick={() => navigate("/collect/purchases")}>View purchase</button>
          ) : null}
          {!active && listing ? <button onClick={() => setSide("subscribe")}>Subscribe</button> : null}
          {active && held && !escrowBuy ? <button className="ghost" onClick={() => setSide("sell")}>Sell</button> : null}
          {active && listing?.surface === "invest" ? (
            <button className="ghost" onClick={() => setSide("subscribe")}>Subscribe (primary)</button>
          ) : null}
        </div>
      )}

      {side === "buy" && escrowBuy ? (
        <CollectibleBuySheet detail={detail} onClose={() => setSide(null)} onDone={() => { setSide(null); void load(); }} />
      ) : side ? (
        <TradeSheet detail={detail} side={side} onClose={() => setSide(null)} onDone={() => { setSide(null); void load(); }} />
      ) : null}
    </div>
  );
}

function CollectibleIntelPanel({ intel, currency }: { intel: CollectibleIntel; currency: string }) {
  const priced = intel.provenance.filter((p) => p.priceMinor).map((p) => ({ priceMinor: p.priceMinor!, asOf: p.occurredAt }));
  return (
    <div className="card">
      <h2>Collectible intelligence</h2>

      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        {intel.grade ? (
          <span className="badge ok">
            {intel.grade.grader.toUpperCase()} {intel.grade.grade}
            {intel.grade.verified ? " · verified" : ""}
          </span>
        ) : null}
        {intel.comp ? (
          <span className="badge">
            Comp {formatMoney(intel.comp.compPriceMinor, currency)} · {pctFromBps(intel.comp.premiumDiscountBps, { signed: true })} vs ask
          </span>
        ) : null}
      </div>

      {intel.population ? (
        <div className="kv"><span className="k">Population (grade {intel.population.grade})</span>
          <span>{intel.population.atGrade} at grade · {intel.population.higher} higher · {intel.population.total} total</span>
        </div>
      ) : null}
      <div className="kv"><span className="k">Times sold</span><span>{intel.tradeHistory.timesSold}</span></div>
      {intel.tradeHistory.lastSaleMinor ? (
        <div className="kv"><span className="k">Last sale</span>
          <span>{formatMoney(intel.tradeHistory.lastSaleMinor, currency)}{intel.tradeHistory.lastSaleAt ? ` · ${new Date(intel.tradeHistory.lastSaleAt).toLocaleDateString()}` : ""}</span>
        </div>
      ) : null}

      {priced.length >= 2 ? (
        <div style={{ marginTop: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Value history</div>
          <PriceChart points={priced} currency={currency} />
        </div>
      ) : null}

      {intel.facts.fields.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>
            {intel.facts.kind === "vehicle" ? "Vehicle facts" : "About this collectible"}
          </div>
          {intel.facts.fields.map((f) => (
            <div className="kv" key={f.label}><span className="k">{f.label}</span><span>{f.value}</span></div>
          ))}
        </div>
      ) : null}

      {intel.provenance.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div className="stat-label" style={{ marginBottom: 6 }}>Provenance & auction history</div>
          {intel.provenance.slice().reverse().map((e, i) => (
            <div className="kv" key={i}>
              <span className="k">{new Date(e.occurredAt).toLocaleDateString()} · {e.eventType}{e.venue ? ` · ${e.venue}` : ""}</span>
              <span>{e.priceMinor ? formatMoney(e.priceMinor, e.currency) : "—"}</span>
            </div>
          ))}
        </div>
      ) : null}

      {intel.simulated ? (
        <p className="disclosure" style={{ marginTop: 10 }}>
          Population, facts, and auction history are illustrative (simulated data source) until a real feed is wired.
        </p>
      ) : null}
    </div>
  );
}
