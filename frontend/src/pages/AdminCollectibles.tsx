/**
 * Admin — seller collectible submission review (cert + comps + AI pre-grade).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, clearToken, getToken, type SellerSubmission } from "../api/client";
import { formatMoney } from "../lib/money";

export function AdminCollectibles() {
  const nav = useNavigate();
  const [queue, setQueue] = useState<SellerSubmission[]>([]);
  const [selected, setSelected] = useState<SellerSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logout = useCallback(() => {
    clearToken();
    nav("/admin/login");
  }, [nav]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const { submissions } = await api.collectibleReviews();
      setQueue(submissions);
      if (selected) {
        const updated = submissions.find((s) => s.id === selected.id);
        setSelected(updated ?? null);
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("UNAUTHENTICATED") || msg.includes("FORBIDDEN")) logout();
      else setError(msg);
    }
  }, [logout, selected]);

  useEffect(() => {
    if (!getToken()) {
      nav("/admin/login");
      return;
    }
    void refresh();
  }, [nav, refresh]);

  async function approve(id: string) {
    setBusy(true);
    try {
      await api.approveCollectible(id);
      setSelected(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      setError("Enter a rejection reason");
      return;
    }
    setBusy(true);
    try {
      await api.rejectCollectible(id, rejectReason.trim());
      setSelected(null);
      setRejectReason("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page stack lg">
      <header className="bar">
        <h1>Collectibles review</h1>
        <div>
          <Link to="/admin" className="ghost sm">← Identities</Link>
          <button className="ghost" onClick={() => void refresh()}>Refresh</button>
          <button className="ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <section className="card">
          <h2>Pending ({queue.length})</h2>
          {queue.length === 0 ? (
            <p className="muted small">No submissions awaiting review.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Grader</th>
                  <th>Cert</th>
                  <th>Ask</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((s) => (
                  <tr key={s.id}>
                    <td>{s.title ?? "—"}</td>
                    <td>{s.grader.toUpperCase()}</td>
                    <td>{s.certNumber}</td>
                    <td>{formatMoney(s.askUsdcMicro, "USDC", { trim: true })}</td>
                    <td>
                      <button className="ghost sm" onClick={() => setSelected(s)}>Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {selected && (
          <section className="card stack sm">
            <h2>Review detail</h2>
            <p className="lead" style={{ margin: 0 }}>{selected.title}</p>
            <p className="micro">
              {selected.category} · {selected.grader.toUpperCase()} #{selected.certNumber} · {selected.certSource}
            </p>

            <div className="card" style={{ background: "var(--surface-2)" }}>
              <div className="micro">Cert verification</div>
              <p className="small" style={{ margin: "6px 0 0" }}>
                {selected.cert.verified ? "✓ Verified" : "✗ Failed"} — Grade {selected.cert.grade ?? "?"}
              </p>
              <p className="micro">{selected.cert.cardDescription}</p>
            </div>

            {selected.comp && (
              <div className="card" style={{ background: "var(--surface-2)" }}>
                <div className="micro">Price comp ({selected.comp.source})</div>
                <p className="small" style={{ margin: "6px 0 0" }}>
                  {formatMoney(selected.comp.priceMinor, "USDC", { trim: true })}
                </p>
              </div>
            )}

            {selected.aiGrade && (
              <div className="card" style={{ background: "var(--surface-2)" }}>
                <div className="micro">AI pre-grade ({selected.aiGrade.source}) — advisory only</div>
                <p className="small" style={{ margin: "6px 0 0" }}>
                  Predicted {selected.aiGrade.predictedGrade ?? "—"}
                  {selected.aiGrade.confidence != null ? ` (${Math.round(selected.aiGrade.confidence * 100)}%)` : ""}
                </p>
                {selected.aiGrade.notes ? <p className="micro">{selected.aiGrade.notes}</p> : null}
              </div>
            )}

            <p className="small">
              Seller ask: <strong>{formatMoney(selected.askUsdcMicro, "USDC", { trim: true })}</strong>
            </p>

            <div className="row" style={{ gap: 8 }}>
              <button disabled={busy} onClick={() => approve(selected.id)}>Approve → publish</button>
            </div>
            <div className="field">
              <label>Rejection reason</label>
              <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. cert mismatch" />
            </div>
            <button className="danger" disabled={busy} onClick={() => reject(selected.id)}>Reject</button>
          </section>
        )}
      </div>
    </div>
  );
}
