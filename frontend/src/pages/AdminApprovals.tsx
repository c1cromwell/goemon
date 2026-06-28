import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, clearToken, getToken, getAdminRole, type AgentReviewRow, type MilestoneStatus, type KgGraph, type KgNode } from "../api/client";

export function AdminApprovals() {
  const nav = useNavigate();
  const [reviews, setReviews] = useState<AgentReviewRow[]>([]);
  const [milestones, setMilestones] = useState<MilestoneStatus[]>([]);
  const [recentKg, setRecentKg] = useState<KgNode[]>([]);
  const [kgGraph, setKgGraph] = useState<KgGraph | null>(null);
  const [role, setRole] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const logout = useCallback(() => {
    clearToken();
    nav("/admin/login");
  }, [nav]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [a, m, kg] = await Promise.all([api.agentApprovals(), api.milestones(), api.kgRecent(15)]);
      setReviews(a.reviews);
      setMilestones(m.milestones);
      setRecentKg(kg.decisions);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("UNAUTHENTICATED") || msg.includes("FORBIDDEN")) logout();
      else setError(msg);
    }
  }, [logout]);

  useEffect(() => {
    if (!getToken()) {
      nav("/admin/login");
      return;
    }
    void refresh();
    setRole(getAdminRole() ?? "");
  }, [nav, refresh]);

  async function decide(reviewId: string, decision: "approve" | "reject") {
    setBusy(reviewId);
    try {
      await api.agentReviewDecision(reviewId, decision, note[reviewId]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function signMilestone(id: string) {
    setBusy(id);
    try {
      await api.signMilestone(id, note[`m-${id}`]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadWorkflowGraph(workflowRun: string) {
    setBusy(`kg-${workflowRun}`);
    try {
      setKgGraph(await api.kgWorkflow(workflowRun));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const canSignMilestone = role === "ceo" || role === "chief_of_staff" || role === "admin";

  return (
    <div className="page">
      <header className="bar">
        <h1>CEO Approvals · Agentic OS</h1>
        <div>
          <Link to="/admin" className="ghost sm" style={{ marginRight: 8 }}>Identities</Link>
          <button className="ghost" type="button" onClick={() => void refresh()}>Refresh</button>
          <button className="ghost" type="button" onClick={logout}>Sign out</button>
        </div>
      </header>

      {role && <p className="muted">Signed in as role: <strong>{role}</strong></p>}
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Runtime gates ({reviews.length})</h2>
        <p className="muted">Financial outputs · first prod launch · legal signoff — CEO primary, CS backup.</p>
        {reviews.length === 0 ? (
          <p className="muted">No pending approvals for your role.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Skill</th>
                <th>Reason</th>
                <th>Created</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td>{r.gate_category ?? r.output_class ?? "—"}</td>
                  <td>{r.skill}</td>
                  <td>{r.reason ?? "—"}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>
                    <input
                      placeholder="Decision note"
                      value={note[r.id] ?? ""}
                      onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button className="sm" disabled={busy === r.id} onClick={() => void decide(r.id, "approve")}>Approve</button>
                    <button className="ghost sm" disabled={busy === r.id} onClick={() => void decide(r.id, "reject")}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Milestone deploy sign-offs</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Status</th>
              <th>Signed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {milestones.map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td>
                  <div>{m.title}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>{m.description}</div>
                </td>
                <td>{m.signed ? "Signed" : "Pending"}</td>
                <td>{m.signedAt ? new Date(m.signedAt).toLocaleString() : "—"}</td>
                <td>
                  {!m.signed && canSignMilestone && (
                    <>
                      <input
                        placeholder="Sign-off note"
                        value={note[`m-${m.id}`] ?? ""}
                        onChange={(e) => setNote((n) => ({ ...n, [`m-${m.id}`]: e.target.value }))}
                      />
                      <button className="sm" disabled={busy === m.id} onClick={() => void signMilestone(m.id)}>Sign off</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Decision knowledge graph (M3)</h2>
        <p className="muted">Append-only audit of agent decisions, human gates, and milestone sign-offs.</p>
        {recentKg.length === 0 ? (
          <p className="muted">No decisions recorded yet — run an agent workflow to populate the graph.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Scope</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recentKg.map((n) => (
                <tr key={n.id}>
                  <td>{n.nodeType}</td>
                  <td>{n.title}</td>
                  <td>{n.scope}</td>
                  <td>{new Date(n.createdAt).toLocaleString()}</td>
                  <td>
                    {typeof n.body.workflowRun === "string" && (
                      <button
                        type="button"
                        className="ghost sm"
                        disabled={busy === `kg-${n.body.workflowRun}`}
                        onClick={() => void loadWorkflowGraph(String(n.body.workflowRun))}
                      >
                        View graph
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {kgGraph && (
          <div style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            <h3>Workflow subgraph ({kgGraph.nodes.length} nodes · {kgGraph.edges.length} edges)</h3>
            <ul className="muted">
              {kgGraph.nodes.map((n) => (
                <li key={n.id}><strong>{n.nodeType}</strong> — {n.title} <span>({n.scope})</span></li>
              ))}
            </ul>
            <p className="muted">Edges: {kgGraph.edges.map((e) => `${e.edgeType}`).join(" · ") || "none"}</p>
          </div>
        )}
      </section>
    </div>
  );
}
