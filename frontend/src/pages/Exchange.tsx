/**
 * Exchange — secondary market order book (Phase 29 P6, the liquidity unlock).
 *
 * Pick an asset, see the live book (bids/asks) + recent trades, and place limit orders that
 * match peer-to-peer at the maker price. Sell orders escrow your units; buy orders escrow cash.
 */
import { useEffect, useState } from "react";
import {
  marketApi, newIdempotencyKey, ApiError,
  type MarketAsset, type BookLevel, type MarketOrder, type MarketTrade,
} from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Empty } from "../components/ui";
import { useToast } from "../components/Toast";

export function Exchange() {
  const toast = useToast();
  const [assets, setAssets] = useState<MarketAsset[] | null>(null);
  const [assetId, setAssetId] = useState("");
  const [book, setBook] = useState<{ bids: BookLevel[]; asks: BookLevel[] }>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [orders, setOrders] = useState<MarketOrder[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    marketApi.assets().then((r) => {
      setAssets(r.assets);
      if (r.assets.length && !assetId) setAssetId(r.assets[0]!.id);
    }).catch(() => setAssets([]));
  }, []);

  async function refresh(id: string) {
    if (!id) return;
    const [b, t, o] = await Promise.all([
      marketApi.book(id).catch(() => ({ bids: [], asks: [] })),
      marketApi.trades(id).then((r) => r.trades).catch(() => []),
      marketApi.myOrders().then((r) => r.orders).catch(() => []),
    ]);
    setBook(b); setTrades(t); setOrders(o);
  }
  useEffect(() => { refresh(assetId); }, [assetId]);

  async function submit() {
    if (!/^\d+$/.test(qty) || parseFloat(price) <= 0) return;
    setBusy(true);
    try {
      const res = await marketApi.place(
        { assetId, side, qty, limitPriceMinor: String(Math.round(parseFloat(price) * 100)) },
        newIdempotencyKey()
      );
      toast.show(res.fills.length ? `Order filled (${res.fills.length} trade${res.fills.length === 1 ? "" : "s"})` : "Order resting on the book");
      setQty(""); setPrice("");
      await refresh(assetId);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Order failed", "bad");
    } finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true);
    try { await marketApi.cancel(id); toast.show("Order cancelled"); await refresh(assetId); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Cancel failed", "bad"); }
    finally { setBusy(false); }
  }

  if (assets === null) return <div className="page"><Loading /></div>;

  const myOpen = orders.filter((o) => o.assetId === assetId && o.status === "open");
  const cost = /^\d+$/.test(qty) && parseFloat(price) > 0 ? BigInt(qty) * BigInt(Math.round(parseFloat(price) * 100)) : 0n;

  return (
    <div className="page stack lg" style={{ maxWidth: 720 }}>
      <div>
        <h1>Exchange</h1>
        <p className="muted small" style={{ margin: 0 }}>Trade tokenized assets peer-to-peer. Zero rail fee.</p>
      </div>

      {assets.length === 0 ? (
        <div className="card"><Empty>Nothing to trade yet. Hold a tokenized asset or post the first order.</Empty></div>
      ) : (
        <>
          <div className="field">
            <label>Asset</label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.symbol ? ` · ${a.symbol}` : ""}</option>)}
            </select>
          </div>

          <div className="grid cols-2">
            {/* Order book */}
            <div className="card">
              <h2>Order book</h2>
              {book.asks.length === 0 && book.bids.length === 0 ? (
                <Empty>No open orders.</Empty>
              ) : (
                <>
                  {book.asks.slice().reverse().map((l) => (
                    <div className="spread" key={`a${l.priceMinor}`}>
                      <span className="small" style={{ color: "var(--danger)" }}>{formatMoney(l.priceMinor, "USD")}</span>
                      <span className="amount">{Number(l.qty).toLocaleString()}</span>
                    </div>
                  ))}
                  <hr className="hr" />
                  {book.bids.map((l) => (
                    <div className="spread" key={`b${l.priceMinor}`}>
                      <span className="small" style={{ color: "var(--accent-strong)" }}>{formatMoney(l.priceMinor, "USD")}</span>
                      <span className="amount">{Number(l.qty).toLocaleString()}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Place order */}
            <div className="card stack sm">
              <h2 style={{ margin: 0 }}>Place order</h2>
              <div className="row" style={{ gap: 6 }}>
                <button className={side === "buy" ? "" : "ghost"} style={{ flex: 1 }} onClick={() => setSide("buy")}>Buy</button>
                <button className={side === "sell" ? "" : "ghost"} style={{ flex: 1 }} onClick={() => setSide("sell")}>Sell</button>
              </div>
              <div className="field"><label>Units</label><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="10" /></div>
              <div className="field"><label>Limit price / unit (USD)</label><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="5.00" /></div>
              <button disabled={busy || !qty || parseFloat(price) <= 0} onClick={submit}>
                {side === "buy" ? "Buy" : "Sell"}{cost > 0n ? ` · ${formatMoney(cost.toString(), "USD")}` : ""}
              </button>
            </div>
          </div>

          {/* My open orders */}
          <div className="card">
            <h2>My open orders</h2>
            {myOpen.length === 0 ? (
              <Empty>No open orders on this asset.</Empty>
            ) : (
              myOpen.map((o) => (
                <div className="list-row" key={o.id}>
                  <div className="grow">
                    <div className="title" style={{ color: o.side === "buy" ? "var(--accent-strong)" : "var(--danger)" }}>
                      {o.side.toUpperCase()} {Number(o.qtyRemaining).toLocaleString()} @ {formatMoney(o.limitPriceMinor, o.currency)}
                    </div>
                    <div className="micro">{Number(o.qtyRemaining).toLocaleString()} of {Number(o.qtyTotal).toLocaleString()} left</div>
                  </div>
                  <button className="ghost sm" disabled={busy} onClick={() => cancel(o.id)}>Cancel</button>
                </div>
              ))
            )}
          </div>

          {/* Recent trades */}
          <div className="card">
            <h2>Recent trades</h2>
            {trades.length === 0 ? (
              <Empty>No trades yet.</Empty>
            ) : (
              trades.map((t) => (
                <div className="list-row" key={t.id}>
                  <div className="grow"><div className="title">{Number(t.qty).toLocaleString()} units</div>
                    <div className="micro">{new Date(t.createdAt).toLocaleString()}</div></div>
                  <div className="amount">{formatMoney(t.priceMinor, t.currency)}</div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
