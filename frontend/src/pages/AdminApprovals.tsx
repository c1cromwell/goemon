import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, clearToken, getToken, getAdminRole, type AgentReviewRow, type MilestoneStatus, type KgGraph, type KgNode, type ModelRegistryEntry, type ModelRoutingPreview, type ModelInvocationRow, type ModelInvocationStats, type CorporateAgentDef, type CorporateRoutePlan, type ProductSquadAgentDef } from "../api/client";

export function AdminApprovals() {
  const nav = useNavigate();
  const [reviews, setReviews] = useState<AgentReviewRow[]>([]);
  const [milestones, setMilestones] = useState<MilestoneStatus[]>([]);
  const [recentKg, setRecentKg] = useState<KgNode[]>([]);
  const [kgGraph, setKgGraph] = useState<KgGraph | null>(null);
  const [modelRegistry, setModelRegistry] = useState<ModelRegistryEntry[]>([]);
  const [modelRouting, setModelRouting] = useState<ModelRoutingPreview[]>([]);
  const [modelInvocations, setModelInvocations] = useState<ModelInvocationRow[]>([]);
  const [modelStats, setModelStats] = useState<ModelInvocationStats | null>(null);
  const [corporateAgents, setCorporateAgents] = useState<CorporateAgentDef[]>([]);
  const [routePreview, setRoutePreview] = useState<CorporateRoutePlan | null>(null);
  const [routeIntent, setRouteIntent] = useState("monthly treasury report");
  const [productAgents, setProductAgents] = useState<ProductSquadAgentDef[]>([]);
  const [productKg, setProductKg] = useState<KgGraph | null>(null);
  const [pdlcProduct, setPdlcProduct] = useState("Collect");
  const [pdlcVersion, setPdlcVersion] = useState("2.0");
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
      const [a, m, kg, models, inv, stats, corp, prod, pkg] = await Promise.all([
        api.agentApprovals(),
        api.milestones(),
        api.kgRecent(15),
        api.modelRegistry(),
        api.modelInvocations(20),
        api.modelStats(),
        api.corporateAgents(),
        api.productSquadAgents(),
        api.kgProduct(30),
      ]);
      setReviews(a.reviews);
      setMilestones(m.milestones);
      setRecentKg(kg.decisions);
      setModelRegistry(models.registry);
      setModelRouting(models.routing);
      setModelInvocations(inv.invocations);
      setModelStats(stats);
      setCorporateAgents(corp.agents);
      setProductAgents(prod.agents);
      setProductKg(pkg);
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

  async function previewRoute() {
    setBusy("route-preview");
    try {
      const { route } = await api.corporatePreviewRoute(routeIntent);
      setRoutePreview(route);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runCorporateAgent(agentId: string) {
    setBusy(`corp-${agentId}`);
    try {
      await api.corporateRun(agentId, {});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function routeViaBrain() {
    setBusy("brain-route");
    try {
      await api.corporateRoute(routeIntent);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runPdlc() {
    setBusy("pdlc-run");
    try {
      await api.productPdlcRun(pdlcProduct, pdlcVersion);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runProductAgent(agentId: string) {
    setBusy(`prod-${agentId}`);
    try {
      await api.productSquadRun(agentId, { product: pdlcProduct, version: pdlcVersion });
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

      <section className="card">
        <h2>Model router (M4)</h2>
        <p className="muted">
          Task class → capability tier → cheapest model. Invocations logged append-only for cost/usage policy.
          {modelStats && (
            <> Total OK invocations: <strong>{modelStats.totalInvocations}</strong>
              {" · "}micro-USD cost: <strong>{modelStats.totalCostMicroUsd}</strong></>
          )}
        </p>
        {modelRouting.length > 0 && (
          <table style={{ marginBottom: "1rem" }}>
            <thead>
              <tr>
                <th>Task class</th>
                <th>Tier</th>
                <th>Primary model</th>
              </tr>
            </thead>
            <tbody>
              {modelRouting.map((r) => (
                <tr key={r.taskClass}>
                  <td>{r.taskClass}</td>
                  <td>{r.tier}</td>
                  <td>{r.primaryModel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {modelRegistry.length > 0 && (
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Registry: {modelRegistry.filter((e) => e.enabled).map((e) => `${e.id} (${e.tier})`).join(" · ")}
          </p>
        )}
        {modelInvocations.length === 0 ? (
          <p className="muted">No model invocations yet — run a skill with OPERATIONS_ORCHESTRATOR=anthropic.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Model</th>
                <th>Skill</th>
                <th>Tokens</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {modelInvocations.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.taskClass}</td>
                  <td>{inv.modelId}</td>
                  <td>{inv.skill ?? "—"}</td>
                  <td>{inv.inputTokens}+{inv.outputTokens}</td>
                  <td>{inv.status}{inv.errorCode ? ` (${inv.errorCode})` : ""}</td>
                  <td>{new Date(inv.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Corporate agent fleet (M5)</h2>
        <p className="muted">C-suite agents on the operations runner — CEO gates on CFO, CLO, and CPO outputs.</p>
        {corporateAgents.length === 0 ? (
          <p className="muted">Loading corporate agents…</p>
        ) : (
          <table style={{ marginBottom: "1rem" }}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Skill</th>
                <th>Supervision</th>
                <th>CEO gate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {corporateAgents.map((agent) => (
                <tr key={agent.id}>
                  <td>
                    <div><strong>{agent.name}</strong>{agent.reused ? " (reused)" : ""}</div>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>{agent.charter}</div>
                  </td>
                  <td><code>{agent.skill}</code></td>
                  <td>{agent.supervision}</td>
                  <td>{agent.ceoGate ?? "—"}</td>
                  <td>
                    {agent.id !== "argus-brain" && (
                      <button
                        type="button"
                        className="ghost sm"
                        disabled={busy === `corp-${agent.id}`}
                        onClick={() => void runCorporateAgent(agent.id)}
                      >
                        Run
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            style={{ flex: 1, minWidth: 240 }}
            value={routeIntent}
            onChange={(e) => setRouteIntent(e.target.value)}
            placeholder="Intent for Argus Brain (e.g. ship Collect v2)"
          />
          <button type="button" className="ghost sm" disabled={busy === "route-preview"} onClick={() => void previewRoute()}>
            Preview route
          </button>
          <button type="button" className="sm" disabled={busy === "brain-route"} onClick={() => void routeViaBrain()}>
            Route via Brain
          </button>
        </div>
        {routePreview && (
          <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
            → <strong>{routePreview.targetSkill}</strong> ({routePreview.agentId}) — {routePreview.rationale}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Product squad + PDLC (M6)</h2>
        <p className="muted">
          Strategist → Engineer + Cyber → QA → Orchestrator launch → CEO gate. Product KG tracks launches, strategies, and support fixes.
          {productKg && <> · <strong>{productKg.nodes.length}</strong> product-scoped nodes</>}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "1rem", alignItems: "center" }}>
          <input value={pdlcProduct} onChange={(e) => setPdlcProduct(e.target.value)} placeholder="Product name" />
          <input value={pdlcVersion} onChange={(e) => setPdlcVersion(e.target.value)} placeholder="Version" style={{ width: 80 }} />
          <button type="button" className="sm" disabled={busy === "pdlc-run"} onClick={() => void runPdlc()}>
            Run full PDLC
          </button>
        </div>
        {productAgents.length > 0 && (
          <table style={{ marginBottom: "1rem" }}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Phase</th>
                <th>Skill</th>
                <th>Gate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {productAgents.map((agent) => (
                <tr key={agent.id}>
                  <td>
                    <div><strong>{agent.name}</strong>{agent.reused ? " (reused)" : ""}</div>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>{agent.charter}</div>
                  </td>
                  <td>{agent.pdlcPhase ?? "—"}</td>
                  <td><code>{agent.skill}</code></td>
                  <td>{agent.ceoGate ?? agent.supervision}</td>
                  <td>
                    {agent.id !== "orchestrator" && (
                      <button
                        type="button"
                        className="ghost sm"
                        disabled={busy === `prod-${agent.id}`}
                        onClick={() => void runProductAgent(agent.id)}
                      >
                        Run
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {productKg && productKg.nodes.length > 0 && (
          <div style={{ fontSize: "0.85rem" }}>
            <h3>Product KG ({productKg.nodes.length} nodes)</h3>
            <ul className="muted">
              {productKg.nodes.slice(0, 12).map((n) => (
                <li key={n.id}><strong>{n.nodeType}</strong> — {n.title}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
