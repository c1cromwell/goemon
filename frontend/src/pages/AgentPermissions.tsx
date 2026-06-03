/**
 * Connected agents — external agents the user has granted access to. A grant is
 * the user's explicit consent (allowed functions + per-transfer ceiling); without
 * an active grant the backend denies the agent even with a valid presentation.
 */
import { useCallback, useEffect, useState } from "react";
import { userApi, type Grant } from "../api/client";
import { decimalToMinor, formatMoney } from "../lib/money";
import { useToast } from "../components/Toast";
import { Loading, Empty } from "../components/ui";

const FUNCTIONS = ["get_balance", "get_transactions", "get_statement", "get_profile", "transfer_funds"];

export function AgentPermissions() {
  const toast = useToast();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [agentDid, setAgentDid] = useState("did:simulator:agent-app");
  const [displayName, setDisplayName] = useState("");
  const [fns, setFns] = useState<string[]>(["get_balance", "get_profile"]);
  const [limit, setLimit] = useState("100");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    userApi.grants().then((r) => setGrants(r.grants)).catch(() => setGrants([]));
  }, []);

  useEffect(() => load(), [load]);

  function toggleFn(f: string) {
    setFns((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));
  }

  async function grant() {
    const minor = decimalToMinor(limit, 2);
    if (!agentDid.trim() || !displayName.trim()) return toast.show("Agent DID and name required", "bad");
    if (minor === null) return toast.show("Invalid transfer limit", "bad");
    if (fns.length === 0) return toast.show("Select at least one function", "bad");
    setBusy(true);
    try {
      await userApi.grantAgent({
        agentDid: agentDid.trim(),
        displayName: displayName.trim(),
        allowedFunctions: fns,
        maxTransferMinor: minor,
      });
      toast.show("Agent connected");
      setCreating(false);
      setDisplayName("");
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Grant failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(did: string) {
    try {
      await userApi.revokeGrant(did, "user_requested");
      toast.show("Access revoked");
      load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Revoke failed", "bad");
    }
  }

  if (grants === null) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
      <div className="spread">
        <div>
          <h1>Connected agents</h1>
          <p className="muted small" style={{ margin: 0 }}>External agents you've authorized to act on your behalf.</p>
        </div>
        {!creating ? <button onClick={() => setCreating(true)}>Connect agent</button> : null}
      </div>

      {creating ? (
        <div className="card">
          <h2>Connect an agent</h2>
          <div className="stack sm">
            <div className="field">
              <label>Agent DID</label>
              <input value={agentDid} onChange={(e) => setAgentDid(e.target.value)} />
            </div>
            <div className="field">
              <label>Display name</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Budget Assistant" />
            </div>
            <div className="field">
              <label>Allowed functions</label>
              <div className="row wrap">
                {FUNCTIONS.map((f) => (
                  <button key={f} type="button" className={fns.includes(f) ? "sm" : "ghost sm"} onClick={() => toggleFn(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Per-transfer ceiling (USD)</label>
              <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button disabled={busy} onClick={grant}>{busy ? "Connecting…" : "Connect"}</button>
            <button className="ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {grants.length === 0 && !creating ? (
        <Empty>No connected agents.</Empty>
      ) : (
        grants.map((g) => (
          <div className="card" key={g.agentDid}>
            <div className="spread">
              <div>
                <div className="title">{g.displayName}</div>
                <div className="code micro">{g.agentDid}</div>
              </div>
              <span className={`badge ${g.active ? "ok" : "bad"}`}>{g.active ? "Active" : "Revoked"}</span>
            </div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              {g.allowedFunctions.map((f) => <span key={f} className="badge">{f}</span>)}
            </div>
            <div className="spread" style={{ marginTop: 12 }}>
              <span className="micro">Ceiling {formatMoney(g.maxTransferMinor, g.currency)} · per transfer</span>
              {g.active ? <button className="danger sm" onClick={() => revoke(g.agentDid)}>Revoke</button> : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
