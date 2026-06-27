/**
 * Borrow — collateralized lending. "Get cash without selling your savings." Pledge your
 * tokenized Treasury (ATB) and borrow USD against it; keep the asset to reclaim when you
 * repay. Shows your borrowing power live, your active loans, and a health bar that warns
 * before liquidation. One pledge field, one borrow field, repay inline.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type TreasuryPosition, type BorrowingPower, type Loan } from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Empty, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function healthKind(bps: number): "ok" | "warn" | "bad" {
  if (bps >= 15000) return "ok";   // ≥150% of the liquidation ceiling — comfortable
  if (bps >= 11000) return "warn"; // getting close
  return "bad";
}

export function Borrow() {
  const toast = useToast();
  const [pos, setPos] = useState<TreasuryPosition | null>(null);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [pledge, setPledge] = useState("");
  const [power, setPower] = useState<BorrowingPower | null>(null);
  const [borrow, setBorrow] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [p, l] = await Promise.all([userApi.treasury().catch(() => null), userApi.loans().catch(() => [])]);
      setPos(p); setLoans(l); setDisabled(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "LENDING_DISABLED") setDisabled(true);
      setLoans([]);
    }
  }
  useEffect(() => { void refresh(); }, []);

  // Live borrowing power for the pledged token count.
  useEffect(() => {
    const q = Math.floor(parseFloat(pledge));
    if (!pos?.assetId || !Number.isFinite(q) || q <= 0) { setPower(null); return; }
    let live = true;
    userApi.lendingQuote(pos.assetId, String(q)).then((bp) => { if (live) setPower(bp); }).catch(() => { if (live) setPower(null); });
    return () => { live = false; };
  }, [pledge, pos?.assetId]);

  async function open() {
    const q = Math.floor(parseFloat(pledge));
    const cents = Math.round(parseFloat(borrow) * 100);
    if (!pos?.assetId || !Number.isFinite(q) || q <= 0) return toast.show("Enter tokens to pledge", "bad");
    if (!Number.isFinite(cents) || cents <= 0) return toast.show("Enter an amount to borrow", "bad");
    setBusy(true);
    try {
      await userApi.openLoan(pos.assetId, String(q), String(cents), newIdempotencyKey());
      toast.show("Loan opened"); setPledge(""); setBorrow(""); setPower(null);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not open the loan", "bad");
    } finally { setBusy(false); }
  }

  async function repay(loan: Loan) {
    setBusy(true);
    try {
      await userApi.repayLoan(loan.id, loan.outstandingMinor, newIdempotencyKey());
      toast.show("Repaid"); await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Repayment failed", "bad");
    } finally { setBusy(false); }
  }

  if (loans === null) return <Loading />;

  if (disabled) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <div><h1>Borrow</h1><p className="muted small" style={{ margin: 0 }}>Borrow against your holdings.</p></div>
        <div className="card"><Empty>Lending is currently unavailable.</Empty></div>
      </div>
    );
  }

  const heldTokens = pos ? Number(pos.qtyBase) : 0;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Borrow</h1>
        <p className="muted small" style={{ margin: 0 }}>Get cash without selling. Pledge your Treasury holdings and borrow USD against them — keep the asset, reclaim it when you repay.</p>
      </div>

      {/* New loan */}
      <div className="card stack sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>New loan</strong>
          <span className="muted small">{heldTokens} {pos?.symbol ?? "ATB"} available</span>
        </div>
        {heldTokens <= 0 ? (
          <Empty>Buy some Treasury (Earn) first to use as collateral.</Empty>
        ) : (
          <>
            <input inputMode="numeric" placeholder={`Tokens to pledge (max ${heldTokens})`} value={pledge} onChange={(e) => setPledge(e.target.value)} aria-label="Tokens to pledge" />
            {power && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">Collateral value</span>
                  <span>{formatMoney(power.collateralValueMinor, "USD")}</span>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted small">Max borrow ({power.maxLtvBps / 100}% LTV · {(power.aprBps / 100).toFixed(1)}% APR)</span>
                  <span style={{ fontWeight: 600 }}>{formatMoney(power.maxBorrowMinor, "USD")}</span>
                </div>
              </div>
            )}
            <input inputMode="decimal" placeholder="Borrow (USD)" value={borrow} onChange={(e) => setBorrow(e.target.value)} aria-label="Amount to borrow" />
            <button disabled={busy || !power} onClick={open}>{busy ? "Working…" : "Borrow"}</button>
          </>
        )}
      </div>

      {/* Active + past loans */}
      <div className="card">
        {loans.length === 0 ? (
          <Empty>No loans yet.</Empty>
        ) : (
          <div className="list">
            {loans.map((l) => (
              <div key={l.id} className="list-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span>{formatMoney(l.outstandingMinor, l.borrowCurrency)} owed · {formatMoney(l.collateralValueMinor, "USD")} collateral</span>
                  <span className="muted micro">
                    {new Date(l.openedAt).toLocaleDateString()} · {(l.aprBps / 100).toFixed(1)}% APR
                    {l.status === "active" && ` · health ${(l.healthFactorBps / 100).toFixed(0)}%`}
                  </span>
                </div>
                {l.status === "active" ? (
                  <div className="row" style={{ gap: 6 }}>
                    <Badge kind={healthKind(l.healthFactorBps)}>{healthKind(l.healthFactorBps) === "bad" ? "at risk" : "healthy"}</Badge>
                    <button className="sm" disabled={busy} onClick={() => repay(l)}>Repay</button>
                  </div>
                ) : (
                  <Badge kind={l.status === "repaid" ? "ok" : "bad"}>{l.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
