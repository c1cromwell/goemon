import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, clearToken, getToken, type IdentitySummary, type ReviewItem, type EscrowView } from "../api/client";
import { formatMoney } from "../lib/money";

export function AdminConsole() {
  const nav = useNavigate();
  const [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [disputes, setDisputes] = useState<EscrowView[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logout = useCallback(() => {
    clearToken();
    nav("/admin/login");
  }, [nav]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [ids, q] = await Promise.all([api.identities(), api.reviewQueue()]);
      setIdentities(ids);
      setQueue(q);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("UNAUTHENTICATED") || msg.includes("FORBIDDEN")) logout();
      else setError(msg);
    }
    // Disputes load separately — a role gap here shouldn't block identity review.
    try {
      setDisputes(await api.escrowDisputes());
    } catch {
      /* not compliance/admin — skip */
    }
  }, [logout]);

  async function resolve(id: string, outcome: "release" | "refund") {
    try {
      await api.resolveEscrow(id, outcome);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      nav("/admin/login");
      return;
    }
    void refresh();
  }, [nav, refresh]);

  async function simulate() {
    setBusy(true);
    try {
      await api.simulate(["low", "medium", "high", "review", "reject"]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(sessionId: string, approve: boolean) {
    try {
      await api.decide(sessionId, approve);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openDetail(userId: string) {
    try {
      setDetail(await api.identityDetail(userId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="bar">
        <h1>Argus Financial Partners Admin · Identities</h1>
        <div>
          <Link to="/admin/approvals" className="ghost sm" style={{ marginRight: 8 }}>CEO Approvals</Link>
          <Link to="/admin/collectibles" className="ghost sm" style={{ marginRight: 8 }}>Collectibles review</Link>
          <button className="ghost" onClick={simulate} disabled={busy}>
            {busy ? "Generating…" : "Generate simulated identities"}
          </button>
          <button className="ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {queue.length > 0 && (
        <section className="card">
          <h2>Manual review queue ({queue.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Confidence</th>
                <th>Created</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.session_id}>
                  <td>{r.email}</td>
                  <td>{r.pii_confidence?.toFixed(2) ?? "—"}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>
                    <button onClick={() => decide(r.session_id, true)}>Approve</button>
                    <button className="danger" onClick={() => decide(r.session_id, false)}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {disputes.length > 0 && (
        <section className="card">
          <h2>Escrow disputes ({disputes.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Amount</th>
                <th>Payer</th>
                <th>Payee</th>
                <th>Reason</th>
                <th>Resolve</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td>{formatMoney(d.amountMinor, d.currency)}</td>
                  <td>{d.payerEmail ?? d.payerId}</td>
                  <td>{d.payeeEmail ?? d.payeeId}</td>
                  <td>{d.disputeReason ?? "—"}</td>
                  <td>
                    <button onClick={() => resolve(d.id, "release")}>Release to payee</button>
                    <button className="danger" onClick={() => resolve(d.id, "refund")}>Refund payer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>All registered identities ({identities.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Last decision</th>
              <th>Confidence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {identities.map((i) => (
              <tr key={i.user_id}>
                <td>
                  {i.email} {i.is_simulated && <span className="badge">SIM</span>}
                </td>
                <td>{i.tier}</td>
                <td>{i.identity_status}</td>
                <td>{i.risk_tier}</td>
                <td>{i.decision ?? "—"}</td>
                <td>{i.pii_confidence?.toFixed(2) ?? "—"}</td>
                <td>
                  <button className="ghost" onClick={() => openDetail(i.user_id)}>
                    Detail
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail && (
        <section className="card detail">
          <div className="bar">
            <h2>Identity detail · decision trail</h2>
            <button className="ghost" onClick={() => setDetail(null)}>
              Close
            </button>
          </div>
          <pre>{JSON.stringify(detail, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
