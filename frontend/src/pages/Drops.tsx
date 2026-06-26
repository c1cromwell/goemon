/**
 * Drops — collector/creator drops (X-Money response F5). Browse limited tokenized
 * editions and claim ones you OWN (non-custodial); creators issue a drop and get paid
 * directly. Three simple tabs: Browse · Create · Owned.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type Drop } from "../api/client";
import { formatMoney, decimalToMinor } from "../lib/money";
import { Loading, Empty, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

type Tab = "browse" | "create" | "owned";

export function Drops() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("browse");
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [claims, setClaims] = useState<Array<{ drop_id: string; edition_number: number; name: string; created_at: string }>>([]);
  const [disabled, setDisabled] = useState(false);
  const [name, setName] = useState("");
  const [edition, setEdition] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [d, c] = await Promise.all([userApi.drops(), userApi.myDropClaims().catch(() => ({ claims: [] }))]);
      setDrops(d.drops); setClaims(c.claims); setDisabled(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "CREATOR_DROPS_DISABLED") setDisabled(true);
      setDrops([]);
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); await refresh(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(false); }
  }

  function create() {
    const ed = parseInt(edition, 10);
    const p = decimalToMinor(price, 2);
    if (!name.trim() || !Number.isInteger(ed) || ed <= 0 || !p) return toast.show("Name, edition size, and price", "bad");
    run(async () => { await userApi.createDrop({ name: name.trim(), editionSize: ed, priceMinor: p }); setName(""); setEdition(""); setPrice(""); setTab("browse"); }, "Drop created");
  }

  if (drops === null && !disabled) return <Loading />;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Drops</h1>
        <p className="muted small" style={{ margin: 0 }}>Limited tokenized editions — claim ones you own; creators get paid directly.</p>
      </div>

      {disabled ? (
        <div className="card"><p className="muted small" style={{ margin: 0 }}>Drops are unavailable. Set <span className="pill">CREATOR_DROPS_ENABLED=true</span> to enable the prototype.</p></div>
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            {(["browse", "create", "owned"] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? "grow" : "ghost grow"} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>{t}</button>
            ))}
          </div>

          {tab === "browse" && (
            <div className="card">
              {drops!.length === 0 ? <Empty>No active drops.</Empty> : (
                <div className="list">
                  {drops!.map((d) => (
                    <div key={d.id} className="list-row">
                      <div className="stack" style={{ gap: 2 }}>
                        <span>{d.name} · {formatMoney(d.priceMinor, d.currency)}</span>
                        <span className="muted micro">{d.claimedCount}/{d.editionSize} claimed</span>
                      </div>
                      {d.status === "active" ? (
                        <button className="sm" disabled={busy} onClick={() => run(() => userApi.claimDrop(d.id, newIdempotencyKey()), "Claimed — it's yours")}>Claim</button>
                      ) : <Badge kind="bad">{d.status}</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "create" && (
            <div className="card stack sm">
              <strong>Issue a drop</strong>
              <input placeholder="Name (e.g. Genesis Card)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={120} />
              <div className="row" style={{ gap: 8 }}>
                <input type="number" min={1} placeholder="Edition size" value={edition} onChange={(e) => setEdition(e.target.value)} aria-label="Edition size" />
                <input inputMode="decimal" placeholder="Price (USD)" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" />
              </div>
              <button disabled={busy} onClick={create}>Create drop</button>
              <p className="muted micro" style={{ margin: 0 }}>Mints a limited tokenized edition; fans pay you directly when they claim.</p>
            </div>
          )}

          {tab === "owned" && (
            <div className="card">
              {claims.length === 0 ? <Empty>You haven't claimed any editions yet.</Empty> : (
                <div className="list">
                  {claims.map((c, i) => (
                    <div key={i} className="list-row">
                      <span>{c.name} · #{c.edition_number}</span>
                      <span className="muted micro">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
