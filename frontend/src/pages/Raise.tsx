/**
 * Raise — capital formation / primary raises (Phase 29 P5).
 *
 * Browse open offerings and commit funds (escrowed until the raise settles or refunds),
 * start a raise on a token you issued, and track your commitments. Ties P1 (issued tokens)
 * and P2 (accreditation) together.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  raiseApi, issuerApi, newIdempotencyKey, ApiError,
  type OfferingView, type RaiseInvestment, type IssuedAsset,
} from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Empty } from "../components/ui";
import { useToast } from "../components/Toast";

const EXEMPTION_LABEL: Record<string, string> = {
  reg_cf: "Reg CF (open)",
  reg_d_506c: "Reg D 506(c) — accredited only",
  reg_a: "Reg A+",
};

export function Raise() {
  const toast = useToast();
  const { me } = useAuth();
  const [offerings, setOfferings] = useState<OfferingView[] | null>(null);
  const [mineInv, setMineInv] = useState<RaiseInvestment[]>([]);
  const [myTokens, setMyTokens] = useState<IssuedAsset[]>([]);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  async function load() {
    const [o, inv] = await Promise.all([
      raiseApi.offerings().then((r) => r.offerings).catch(() => []),
      raiseApi.myInvestments().then((r) => r.investments).catch(() => []),
    ]);
    setOfferings(o); setMineInv(inv);
  }
  useEffect(() => {
    load();
    issuerApi.mine().then((r) => setMyTokens(r.assets.filter((a) => a.isSecurity))).catch(() => setMyTokens([]));
  }, []);

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try { await fn(); toast.show(ok); await load(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(null); }
  }

  if (offerings === null) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg" style={{ maxWidth: 680 }}>
      <div className="spread">
        <div>
          <h1>Raise</h1>
          <p className="muted small" style={{ margin: 0 }}>Invest in open offerings, or raise capital on a token you issued.</p>
        </div>
        <button className="ghost sm" onClick={() => setShowStart((s) => !s)}>{showStart ? "Close" : "Start a raise"}</button>
      </div>

      {showStart && <StartRaise myTokens={myTokens} onDone={() => { setShowStart(false); load(); }} />}

      {/* Open offerings */}
      <div className="stack">
        <h2 style={{ margin: 0 }}>Open raises</h2>
        {offerings.length === 0 ? (
          <div className="card"><Empty>No open raises right now.</Empty></div>
        ) : (
          offerings.map((o) => {
            const raised = Number(o.raisedMinor), target = Number(o.targetMinor);
            const pct = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
            const u = units[o.id] ?? "";
            const cost = /^\d+$/.test(u) ? BigInt(u) * BigInt(o.priceMinor) : 0n;
            const isIssuer = me?.id === o.issuerUserId;
            return (
              <div className="card stack sm" key={o.id}>
                <div className="spread">
                  <div className="title">{o.assetSymbol ?? o.assetName ?? "Offering"}</div>
                  <span className="pill">{EXEMPTION_LABEL[o.exemption] ?? o.exemption}</span>
                </div>
                <div className="vbar"><div className="vbar-fill" style={{ width: `${pct}%` }} /></div>
                <div className="micro" style={{ textTransform: "none", letterSpacing: 0 }}>
                  {formatMoney(o.raisedMinor, o.currency)} raised of {formatMoney(o.targetMinor, o.currency)} target ·
                  {" "}cap {formatMoney(o.capMinor, o.currency)} · {o.investorCount} investor{o.investorCount === 1 ? "" : "s"} ·
                  {" "}{formatMoney(o.priceMinor, o.currency)} / unit
                </div>

                {isIssuer ? (
                  <div className="row" style={{ gap: 8 }}>
                    <button className="grow" disabled={busy === o.id} onClick={() => run(o.id, () => raiseApi.close(o.id), "Raise closed")}>
                      Close raise
                    </button>
                    <button className="ghost" disabled={busy === o.id} onClick={() => run(o.id, () => raiseApi.cancel(o.id), "Raise cancelled")}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    <input inputMode="numeric" placeholder="Units" value={u}
                      onChange={(e) => setUnits((m) => ({ ...m, [o.id]: e.target.value.replace(/\D/g, "") }))} style={{ flex: 1 }} />
                    <button disabled={busy === o.id || !u || BigInt(u || "0") <= 0n}
                      onClick={() => run(o.id, () => raiseApi.invest(o.id, u, newIdempotencyKey()), "Investment committed")}>
                      Invest{cost > 0n ? ` · ${formatMoney(cost.toString(), o.currency)}` : ""}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* My investments */}
      <div className="card">
        <h2>My investments</h2>
        {mineInv.length === 0 ? (
          <Empty>No commitments yet.</Empty>
        ) : (
          mineInv.map((i) => (
            <div className="list-row" key={i.id}>
              <div className="grow">
                <div className="title">{Number(i.units).toLocaleString()} units</div>
                <div className="micro">{new Date(i.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="right">
                <div className="amount">{formatMoney(i.amountMinor, "USD")}</div>
                <div className="micro">{i.status}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StartRaise({ myTokens, onDone }: { myTokens: IssuedAsset[]; onDone: () => void }) {
  const toast = useToast();
  const [assetId, setAssetId] = useState("");
  const [exemption, setExemption] = useState<"reg_cf" | "reg_d_506c" | "reg_a">("reg_cf");
  const [price, setPrice] = useState("");
  const [target, setTarget] = useState("");
  const [cap, setCap] = useState("");
  const [min, setMin] = useState("");
  const [busy, setBusy] = useState(false);
  const dollarsToMinor = (v: string) => String(Math.round(parseFloat(v || "0") * 100));

  const valid = useMemo(
    () => assetId && parseFloat(price) > 0 && parseFloat(target) > 0 && parseFloat(cap) >= parseFloat(target),
    [assetId, price, target, cap]
  );

  async function submit() {
    setBusy(true);
    try {
      await raiseApi.open({
        assetId, exemption, priceMinor: dollarsToMinor(price), targetMinor: dollarsToMinor(target),
        capMinor: dollarsToMinor(cap), minInvestmentMinor: min ? dollarsToMinor(min) : undefined,
      });
      toast.show("Raise opened");
      onDone();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not open the raise", "bad");
    } finally { setBusy(false); }
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Start a raise</h2>
      {myTokens.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          You need a security/equity token to raise on. Create one in <strong>Tokenize</strong> first.
        </p>
      ) : (
        <>
          <div className="field">
            <label>Token</label>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
              <option value="">Select a token you issued…</option>
              {myTokens.map((t) => <option key={t.id} value={t.id}>{t.name}{t.symbol ? ` · ${t.symbol}` : ""}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Exemption</label>
            <select value={exemption} onChange={(e) => setExemption(e.target.value as typeof exemption)}>
              <option value="reg_cf">Reg CF — open to all</option>
              <option value="reg_d_506c">Reg D 506(c) — accredited only</option>
              <option value="reg_a">Reg A+</option>
            </select>
          </div>
          <div className="grid cols-2">
            <div className="field"><label>Price / unit (USD)</label><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="10.00" /></div>
            <div className="field"><label>Min investment (USD)</label><input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="optional" /></div>
            <div className="field"><label>Target (USD)</label><input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="50000" /></div>
            <div className="field"><label>Cap (USD)</label><input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="250000" /></div>
          </div>
          <button disabled={!valid || busy} onClick={submit}>{busy ? "Opening…" : "Open raise"}</button>
        </>
      )}
    </div>
  );
}
