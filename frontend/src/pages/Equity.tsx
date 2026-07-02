/**
 * My Equity — employee equity compensation (Phase 29 P4).
 *
 * A recipient's grants with vesting progress, 83(b) status, and actions: release
 * newly-vested restricted units, or exercise vested options (pay price → receive units).
 * Ties to the Equity Incentive Plan (docs/legal/EQUITY-INCENTIVE-PLAN.md).
 */
import { useEffect, useState } from "react";
import { equityApi, newIdempotencyKey, ApiError, type EquityGrantView } from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Empty } from "../components/ui";
import { useToast } from "../components/Toast";

const AWARD_LABEL: Record<string, string> = {
  unit_award: "Restricted units",
  profits_interest: "Profits interest",
  option: "Stock option",
};

export function Equity() {
  const toast = useToast();
  const [grants, setGrants] = useState<EquityGrantView[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => equityApi.mine().then((r) => setGrants(r.grants)).catch(() => setGrants([]));
  useEffect(() => { load(); }, []);

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try { await fn(); toast.show(ok); await load(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(null); }
  }

  if (grants === null) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg" style={{ maxWidth: 640 }}>
      <div>
        <h1>My equity</h1>
        <p className="muted small" style={{ margin: 0 }}>Your grants, vesting, and 83(b) status.</p>
      </div>

      {grants.length === 0 ? (
        <div className="card"><Empty>No equity grants yet. Grants from your employer appear here.</Empty></div>
      ) : (
        grants.map((g) => {
          const total = Number(g.unitsTotal), vested = Number(g.vested);
          const pct = total > 0 ? Math.round((vested / total) * 100) : 0;
          const isOption = g.awardType === "option";
          const exercisable = Number(g.exercisable), releasable = Number(g.releasable);
          const q = qty[g.id] ?? "";
          const cost = isOption && /^\d+$/.test(q) ? BigInt(q) * BigInt(g.exercisePriceMinor) : 0n;
          return (
            <div className="card stack sm" key={g.id}>
              <div className="spread">
                <div className="title">
                  {g.assetSymbol ?? g.assetName ?? "Equity"}
                  <span className="muted"> · {AWARD_LABEL[g.awardType] ?? g.awardType}</span>
                </div>
                <span className="pill">{g.status === "fully_released" ? "Fully vested" : `${pct}% vested`}</span>
              </div>

              {/* Vesting bar */}
              <div className="vbar"><div className="vbar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="micro" style={{ textTransform: "none", letterSpacing: 0 }}>
                {vested.toLocaleString()} of {total.toLocaleString()} units vested · {g.cliffMonths}-mo cliff, {g.durationMonths}-mo total
                {isOption ? ` · $${(Number(g.exercisePriceMinor) / 100).toFixed(2)} / unit exercise` : ""}
              </div>

              {/* 83(b) */}
              <div className="spread">
                <span className="muted small">83(b) election</span>
                {g.eightyThreeBFiled ? (
                  <span className="small" style={{ color: "var(--accent-strong)", fontWeight: 600 }}>Filed ✓</span>
                ) : (
                  <button className="ghost sm" disabled={busy === g.id} onClick={() => act(g.id, () => equityApi.file83b(g.id), "Marked 83(b) filed")}>
                    Mark filed{g.eightyThreeBDeadline ? ` (by ${new Date(g.eightyThreeBDeadline).toLocaleDateString()})` : ""}
                  </button>
                )}
              </div>

              {/* Action */}
              {isOption ? (
                <div className="row" style={{ gap: 8 }}>
                  <input
                    inputMode="numeric" placeholder={`Exercise (up to ${exercisable})`} value={q}
                    onChange={(e) => setQty((m) => ({ ...m, [g.id]: e.target.value.replace(/\D/g, "") }))}
                    style={{ flex: 1 }}
                  />
                  <button
                    disabled={busy === g.id || !q || BigInt(q || "0") <= 0n || BigInt(q || "0") > BigInt(g.exercisable)}
                    onClick={() => act(g.id, () => equityApi.exercise(g.id, q, newIdempotencyKey()), "Options exercised")}
                  >
                    Exercise{cost > 0n ? ` · ${formatMoney(cost.toString(), g.currency)}` : ""}
                  </button>
                </div>
              ) : (
                <button
                  disabled={busy === g.id || releasable <= 0}
                  onClick={() => act(g.id, () => equityApi.release(g.id), "Vested units delivered")}
                >
                  {releasable > 0 ? `Release ${releasable.toLocaleString()} vested units` : "Nothing new to release"}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
