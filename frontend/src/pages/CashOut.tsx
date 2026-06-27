/**
 * Cash out — USDC → fiat off-ramp. The exit door that pairs with Add cash: sell USDC and
 * receive fiat in a linked bank/card. Enter an amount → see exactly what you'll receive
 * (fee disclosed) → Cash out. A licensed provider takes the USDC and delivers the fiat
 * under its own license. One amount field, a live quote.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type OffRampQuote, type OffRampOrder } from "../api/client";
import { formatMoney, formatUnits, decimalToMinor } from "../lib/money";
import { Loading, Empty, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function statusKind(s: string): "ok" | "warn" | "bad" {
  if (s === "completed") return "ok";
  if (s === "failed") return "bad";
  return "warn";
}

export function CashOut() {
  const toast = useToast();
  const [amt, setAmt] = useState("");
  const [dest, setDest] = useState("");
  const [quote, setQuote] = useState<OffRampQuote | null>(null);
  const [orders, setOrders] = useState<OffRampOrder[] | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setOrders(await userApi.offrampOrders()); setDisabled(false); }
    catch (e) { if (e instanceof ApiError && e.code === "OFFRAMP_DISABLED") setDisabled(true); setOrders([]); }
  }
  useEffect(() => { void refresh(); }, []);

  // Live quote (USDC is 6dp).
  useEffect(() => {
    const micro = decimalToMinor(amt, 6);
    if (!micro || BigInt(micro) <= 0n) { setQuote(null); return; }
    let live = true;
    userApi.offrampQuote(micro).then((q) => { if (live) setQuote(q); }).catch(() => { if (live) setQuote(null); });
    return () => { live = false; };
  }, [amt]);

  async function cashOut() {
    const micro = decimalToMinor(amt, 6);
    if (!micro || BigInt(micro) <= 0n) return toast.show("Enter an amount", "bad");
    setBusy(true);
    try {
      const order = await userApi.offrampOrder(micro, dest.trim() || undefined, newIdempotencyKey());
      toast.show(`Cashing out ${formatMoney(order.fiatAmountMinor, order.fiatCurrency)}`);
      setAmt(""); setQuote(null);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Cash out failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (orders === null) return <Loading />;

  if (disabled) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <div><h1>Cash out</h1><p className="muted small" style={{ margin: 0 }}>Sell USDC and send fiat to your bank.</p></div>
        <div className="card"><Empty>The off-ramp is currently unavailable.</Empty></div>
      </div>
    );
  }

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Cash out</h1>
        <p className="muted small" style={{ margin: 0 }}>Sell USDC and receive fiat in your linked bank or card — your money is never trapped on the rail.</p>
      </div>

      {/* Sell */}
      <div className="card stack sm">
        <strong>How much USDC?</strong>
        <input inputMode="decimal" placeholder="Amount (USDC)" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount in USDC" />
        <input placeholder="Send to (bank/card · optional)" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination" maxLength={64} />
        {quote && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">You sell</span>
              <span>{formatUnits(quote.usdcAmountMinor, 6)} USDC</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">Off-ramp fee ({(quote.feeBps / 100).toFixed(2)}%)</span>
              <span className="muted small">{formatUnits(quote.feeMinor, 6)} USDC</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", fontWeight: 600 }}>
              <span>You receive</span>
              <span>{formatMoney(quote.fiatAmountMinor, quote.fiatCurrency)}</span>
            </div>
          </div>
        )}
        <button disabled={busy || !quote} onClick={cashOut}>{busy ? "Working…" : "Cash out"}</button>
        <p className="muted micro" style={{ margin: 0 }}>A licensed provider converts the USDC and pays your linked account under its own license.</p>
      </div>

      {/* History */}
      <div className="card">
        {orders.length === 0 ? (
          <Empty>No cash-outs yet.</Empty>
        ) : (
          <div className="list">
            {orders.map((o) => (
              <div key={o.id} className="list-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span>{formatMoney(o.fiatAmountMinor, o.fiatCurrency)} · {formatUnits(o.usdcAmountMinor, 6)} USDC</span>
                  <span className="muted micro">{new Date(o.createdAt).toLocaleDateString()} · {o.provider}{o.destination ? ` · ${o.destination}` : ""}</span>
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
