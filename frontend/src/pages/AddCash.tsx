/**
 * Add cash — fiat → USDC on-ramp. The activation step: turn dollars into spendable
 * USDC on your own rail. Enter an amount → see exactly what you'll get (fee disclosed)
 * → Buy. A licensed provider takes the card/bank payment under its own license; Goeman
 * credits the delivered USDC straight to your balance. One amount field, a live quote.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type OnRampQuote, type OnRampOrder } from "../api/client";
import { formatMoney, formatUnits, decimalToMinor } from "../lib/money";
import { Loading, Empty, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function statusKind(s: string): "ok" | "warn" | "bad" {
  if (s === "completed") return "ok";
  if (s === "failed") return "bad";
  return "warn";
}

export function AddCash() {
  const toast = useToast();
  const [amt, setAmt] = useState("");
  const [quote, setQuote] = useState<OnRampQuote | null>(null);
  const [orders, setOrders] = useState<OnRampOrder[] | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setOrders(await userApi.onrampOrders()); setDisabled(false); }
    catch (e) { if (e instanceof ApiError && e.code === "ONRAMP_DISABLED") setDisabled(true); setOrders([]); }
  }
  useEffect(() => { void refresh(); }, []);

  // Live quote as the amount changes (debounced lightly via the effect).
  useEffect(() => {
    const minor = decimalToMinor(amt, 2);
    if (!minor || BigInt(minor) <= 0n) { setQuote(null); return; }
    let live = true;
    userApi.onrampQuote(minor).then((q) => { if (live) setQuote(q); }).catch(() => { if (live) setQuote(null); });
    return () => { live = false; };
  }, [amt]);

  async function buy() {
    const minor = decimalToMinor(amt, 2);
    if (!minor || BigInt(minor) <= 0n) return toast.show("Enter an amount", "bad");
    setBusy(true);
    try {
      const order = await userApi.onrampOrder(minor, newIdempotencyKey());
      if (order.redirectUrl) {
        window.location.href = order.redirectUrl; // hosted-widget hand-off (real providers)
        return;
      }
      toast.show(`Added ${formatUnits(order.usdcNetMinor, 6)} USDC`);
      setAmt(""); setQuote(null);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Purchase failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (orders === null) return <Loading />;

  if (disabled) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <div><h1>Add cash</h1><p className="muted small" style={{ margin: 0 }}>Buy USDC with your card or bank.</p></div>
        <div className="card"><Empty>The on-ramp is currently unavailable.</Empty></div>
      </div>
    );
  }

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Add cash</h1>
        <p className="muted small" style={{ margin: 0 }}>Buy USDC with your card or bank — it lands on your own rail, ready to spend or send.</p>
      </div>

      {/* Buy */}
      <div className="card stack sm">
        <strong>How much?</strong>
        <input inputMode="decimal" placeholder="Amount (USD)" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount in USD" />
        {quote && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">You pay</span>
              <span>{formatMoney(quote.fiatAmountMinor, "USD")}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">On-ramp fee ({(quote.feeBps / 100).toFixed(2)}%)</span>
              <span className="muted small">{formatUnits(quote.feeMinor, 6)} USDC</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", fontWeight: 600 }}>
              <span>You receive</span>
              <span>{formatUnits(quote.usdcNetMinor, 6)} USDC</span>
            </div>
          </div>
        )}
        <button disabled={busy || !quote} onClick={buy}>{busy ? "Adding…" : "Buy USDC"}</button>
        <p className="muted micro" style={{ margin: 0 }}>A licensed provider processes the payment and verifies you under its own license. We never hold your card details.</p>
      </div>

      {/* History */}
      <div className="card">
        {orders.length === 0 ? (
          <Empty>No purchases yet.</Empty>
        ) : (
          <div className="list">
            {orders.map((o) => (
              <div key={o.id} className="list-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span>{formatUnits(o.usdcNetMinor, 6)} USDC · {formatMoney(o.fiatAmountMinor, o.fiatCurrency)}</span>
                  <span className="muted micro">{new Date(o.createdAt).toLocaleDateString()} · {o.provider}</span>
                </div>
                <Badge kind={statusKind(o.status)}>{o.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
