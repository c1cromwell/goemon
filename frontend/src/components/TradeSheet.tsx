/**
 * Trade sheet — the quote → confirm flow with full fee disclosure before any
 * money moves. Quantities are integer base units; amounts render from minor
 * units. The confirm POST carries a stable Idempotency-Key per (qty) so a retry
 * replays rather than double-posts.
 */
import { useEffect, useRef, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type AssetDetail, type Quote } from "../api/client";
import { formatMoney, formatUnits } from "../lib/money";
import { useToast } from "./Toast";
import { Spinner } from "./ui";

type Side = "buy" | "sell" | "subscribe";

const VERB: Record<Side, string> = { buy: "Buy", sell: "Sell", subscribe: "Subscribe" };

export function TradeSheet({
  detail,
  side,
  onClose,
  onDone,
}: {
  detail: AssetDetail;
  side: Side;
  onClose: () => void;
  onDone: () => void;
}) {
  const { asset } = detail;
  const toast = useToast();
  const [qty, setQty] = useState("1");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<{ qty: string; key: string } | null>(null);

  const qtyValid = /^\d+$/.test(qty) && BigInt(qty || "0") > 0n;

  useEffect(() => {
    if (!qtyValid) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const q = await userApi.quote(asset.id, side, qty);
        if (!cancelled) setQuote(q);
      } catch (e) {
        if (!cancelled) {
          setQuote(null);
          setError(e instanceof Error ? e.message : "Could not price this trade");
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [asset.id, side, qty, qtyValid]);

  function idempotencyKey(): string {
    if (keyRef.current?.qty === qty) return keyRef.current.key;
    const key = newIdempotencyKey();
    keyRef.current = { qty, key };
    return key;
  }

  async function confirm() {
    if (!qtyValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const key = idempotencyKey();
      if (side === "subscribe") await userApi.subscribe(asset.id, qty, key);
      else await userApi.order(asset.id, side, qty, key);
      toast.show(`${VERB[side]} confirmed`);
      onDone();
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === "COMPLIANCE_BLOCKED"
          ? "Blocked by compliance rules for this asset."
          : e instanceof Error
            ? e.message
            : "Trade failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <h1>
            {VERB[side]} {asset.symbol ?? asset.name}
          </h1>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>Quantity {asset.decimals > 0 ? `(base units, ${asset.decimals}dp)` : "(units)"}</label>
          <input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
            autoFocus
          />
          {asset.decimals > 0 && qtyValid ? (
            <div className="micro" style={{ marginTop: 6 }}>
              = {formatUnits(qty, asset.decimals)} {asset.symbol ?? "units"}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ background: "var(--surface-2)", borderColor: "transparent" }}>
          {quoting ? (
            <div className="row">
              <Spinner /> <span className="muted">Pricing…</span>
            </div>
          ) : quote ? (
            <>
              <div className="kv">
                <span className="k">Price</span>
                <span className="amount">{formatMoney(quote.priceMinor, quote.currency)} / unit</span>
              </div>
              <div className="kv">
                <span className="k">Gross</span>
                <span className="amount">{formatMoney(quote.grossMinor, quote.currency)}</span>
              </div>
              <div className="kv">
                <span className="k">Fee</span>
                <span className="amount">{formatMoney(quote.feeMinor, quote.currency)}</span>
              </div>
              <div className="kv total">
                <span className="k">{side === "sell" ? "You receive" : "You pay"}</span>
                <span className="amount">{formatMoney(quote.netMinor, quote.currency)}</span>
              </div>
              {quote.stale ? (
                <div className="micro" style={{ marginTop: 8, color: "var(--warn)" }}>
                  Price as of {new Date(quote.priceAsOf).toLocaleString()} · may be stale
                </div>
              ) : (
                <div className="micro" style={{ marginTop: 8 }}>
                  Source: {quote.priceSource}
                </div>
              )}
            </>
          ) : (
            <span className="muted small">Enter a quantity to see pricing.</span>
          )}
        </div>

        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}

        <button
          className="block lg"
          style={{ marginTop: 16 }}
          disabled={!quote || quoting || submitting}
          onClick={confirm}
        >
          {submitting ? "Confirming…" : `Confirm ${VERB[side].toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}
