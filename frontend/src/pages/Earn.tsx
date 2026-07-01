/**
 * Earn — tokenized Treasury (X-Money response F1). The anti-6%-APY: you OWN a
 * yield-bearing asset (ATB, $1 par), not a custodial balance someone can freeze.
 * Yield accrues to holders automatically. One amount field, two actions. Slick + simple.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type TreasuryPosition } from "../api/client";
import { formatMoney, formatUnits } from "../lib/money";
import { Loading, Empty } from "../components/ui";
import { useToast } from "../components/Toast";

export function Earn() {
  const toast = useToast();
  const [pos, setPos] = useState<TreasuryPosition | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setPos(await userApi.treasury());
      setDisabled(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "EQUITIES_DISABLED") setDisabled(true);
      setPos(null);
    }
  }
  useEffect(() => { void refresh(); }, []);

  // $1 par per token → dollars entered == whole tokens (qtyBase).
  function tokens(): number | null {
    const n = Math.floor(parseFloat(amt));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  async function act(kind: "buy" | "sell") {
    const q = tokens();
    if (!q) return toast.show("Enter a whole-dollar amount", "bad");
    setBusy(true);
    try {
      if (kind === "buy") await userApi.treasurySubscribe(String(q), newIdempotencyKey());
      else await userApi.treasuryRedeem(String(q), newIdempotencyKey());
      toast.show(kind === "buy" ? `Moved $${q} into Treasury — it's yours, and earning` : `Redeemed $${q} to cash`);
      setAmt("");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (pos === null && !disabled) return <Loading />;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Earn</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Own a yield-bearing asset — not a balance someone can freeze. Yield accrues to you automatically.
        </p>
      </div>

      {disabled ? (
        <div className="card"><p className="muted small" style={{ margin: 0 }}>Earn is unavailable. Set <span className="pill">TREASURY_ENABLED=true</span> to enable the prototype.</p></div>
      ) : (
        <>
          {/* Hero: your position + the rate */}
          <div className="card stack sm">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="muted small">Your Treasury</span>
              <span className="pill">{(pos!.apyBps / 100).toFixed(2)}% APY</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 500, fontFamily: "var(--font-display)", letterSpacing: "-0.02em" }}>{formatMoney(pos!.valueMinor, "USD")}</div>
            <span className="muted micro">{pos!.qtyBase} {pos!.symbol} · $1.00 each · held in your name, redeemable anytime</span>
          </div>

          {/* One amount, two actions */}
          <div className="card stack sm">
            <input inputMode="decimal" placeholder="Amount (USD)" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" />
            <div className="row" style={{ gap: 8 }}>
              <button className="grow" disabled={busy} onClick={() => act("buy")}>Move to Treasury</button>
              <button className="ghost grow" disabled={busy} onClick={() => act("sell")}>Redeem to cash</button>
            </div>
          </div>

          {/* Recent yield */}
          <div className="card stack sm">
            <strong>Recent yield</strong>
            {pos!.recentAccruals.length === 0 ? (
              <Empty>No yield distributed yet. It accrues automatically while you hold.</Empty>
            ) : (
              <div className="list">
                {pos!.recentAccruals.map((a, i) => (
                  <div key={i} className="list-row">
                    <span className="muted micro">{new Date(a.as_of).toLocaleDateString()} · {formatUnits(a.per_unit_minor, 2)}/token</span>
                    <span style={{ color: "var(--accent-strong)" }}>paid to {a.holders_paid} holder{a.holders_paid === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
