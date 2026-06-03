/**
 * Account linking — the one-time consent step. The user authenticates to BankAI
 * (dev password), chooses the scopes to grant, and the agent binds its wallet key
 * + records the grant. This stands in for the portal "Connect agent" + iOS wallet
 * binding; after this, the agent never sees the user's session again.
 */
import { useState } from "react";
import { linkAccount, REQUESTABLE_SCOPES, type LinkState } from "../lib/setup";

const SCOPE_LABEL: Record<string, string> = {
  "balance:read": "Read balance",
  "statement:read": "Read transactions",
  "profile:read": "Read profile",
  "transfer:low": "Send money (≤ limit)",
};

export function Setup({ onLinked }: { onLinked: (s: LinkState) => void }) {
  const [email, setEmail] = useState("alex@demo.com");
  const [password, setPassword] = useState("Demo1234!");
  const [scopes, setScopes] = useState<string[]>([...REQUESTABLE_SCOPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(s: string) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function submit() {
    if (scopes.length === 0) return setError("Grant at least one permission");
    setBusy(true);
    setError(null);
    try {
      onLinked(await linkAccount(email.trim(), password, scopes));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Linking failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card narrow">
        <div className="brand" style={{ marginBottom: 16 }}>
          <span className="mark">A</span> BankAI Assistant
          <span className="ext-tag">external agent</span>
        </div>
        <h1>Connect your BankAI account</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          This third-party agent will act on your behalf under the permissions you grant. It receives a fresh,
          90-second token per action — never your password after this step.
        </p>

        <div className="stack" style={{ marginTop: 18 }}>
          <div>
            <label>BankAI email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label>Permissions to grant</label>
            <div className="row wrap">
              {REQUESTABLE_SCOPES.map((s) => (
                <button key={s} type="button" className={`chip sm ${scopes.includes(s) ? "on" : ""}`} onClick={() => toggle(s)}>
                  {SCOPE_LABEL[s] ?? s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}

        <button className="block" style={{ marginTop: 18 }} disabled={busy} onClick={submit}>
          {busy ? "Connecting…" : "Connect account"}
        </button>
        <p className="micro" style={{ marginTop: 12 }}>
          Demo: signs in, issues a verifiable credential if needed, binds this app's wallet key, and records the grant.
        </p>
      </div>
    </div>
  );
}
