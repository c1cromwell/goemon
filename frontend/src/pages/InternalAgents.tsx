/**
 * Internal agents — the user's own scoped automation agents. Create with a
 * permission set and a per-transfer ceiling, list, and deactivate. Permissions
 * are capped by the user's tier (the backend re-checks).
 */
import { useCallback, useEffect, useState } from "react";
import { userApi, type AgentRow } from "../api/client";
import { decimalToMinor, formatMoney } from "../lib/money";
import { useToast } from "../components/Toast";
import { Loading, Empty } from "../components/ui";

const PERMISSIONS = ["balance:read", "statement:read", "profile:read", "transfer:low", "transfer:high"];

export function InternalAgents() {
  const toast = useToast();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<string[]>(["balance:read", "profile:read"]);
  const [limit, setLimit] = useState("100");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    userApi.agents().then(setAgents).catch(() => setAgents([]));
  }, []);

  useEffect(() => load(), [load]);

  function togglePerm(p: string) {
    setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function create() {
    const minor = decimalToMinor(limit, 2);
    if (!name.trim()) return toast.show("Name required", "bad");
    if (minor === null) return toast.show("Invalid transfer limit", "bad");
    setBusy(true);
    try {
      await userApi.createAgent({
        name: name.trim(),
        permissions: perms,
        transfer_limit_minor: Number(minor),
      });
      toast.show("Agent created");
      setCreating(false);
      setName("");
      setPerms(["balance:read", "profile:read"]);
      setLimit("100");
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Create failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await userApi.deleteAgent(id);
      toast.show("Agent removed");
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Remove failed", "bad");
    }
  }

  if (agents === null) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
      <div className="spread">
        <div>
          <h1>Internal agents</h1>
          <p className="muted small" style={{ margin: 0 }}>Scoped automation that acts within your account.</p>
        </div>
        {!creating ? <button onClick={() => setCreating(true)}>New agent</button> : null}
      </div>

      {creating ? (
        <div className="card">
          <h2>New agent</h2>
          <div className="stack sm">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Savings sweeper" />
            </div>
            <div className="field">
              <label>Permissions</label>
              <div className="row wrap">
                {PERMISSIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={perms.includes(p) ? "sm" : "ghost sm"}
                    onClick={() => togglePerm(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Per-transfer limit (USD)</label>
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button disabled={busy} onClick={create}>{busy ? "Creating…" : "Create agent"}</button>
            <button className="ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {agents.length === 0 && !creating ? (
        <Empty>No agents yet.</Empty>
      ) : (
        agents.map((a) => {
          const permList = safeJsonArray(a.permissions);
          return (
            <div className="card" key={a.id}>
              <div className="spread">
                <div>
                  <div className="title">{a.name}</div>
                  <div className="micro">{a.status}</div>
                </div>
                <button className="danger sm" onClick={() => remove(a.id)}>Remove</button>
              </div>
              <div className="row wrap" style={{ marginTop: 10 }}>
                {permList.map((p) => <span key={p} className="badge">{p}</span>)}
              </div>
              <div className="micro" style={{ marginTop: 10 }}>
                Limit {formatMoney(a.transfer_limit_minor, a.currency || "USD")} per transfer
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
