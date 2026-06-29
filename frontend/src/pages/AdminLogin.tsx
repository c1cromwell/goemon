import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken, setAdminRole } from "../api/client";

const DEV_ACCOUNTS = [
  { role: "CEO", email: "ceo@goemanglobal.com", password: "Ceo1234!", path: "/admin/approvals" },
  { role: "Chief of Staff", email: "cos@goemanglobal.com", password: "Cos1234!", path: "/admin/approvals" },
  { role: "Admin", email: "admin@goemanglobal.com", password: "Admin1234!", path: "/admin" },
] as const;

export function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("ceo@goemanglobal.com");
  const [password, setPassword] = useState("Ceo1234!");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, role } = await api.login(email, password);
      setToken(token);
      setAdminRole(role);
      nav(role === "ceo" || role === "chief_of_staff" ? "/admin/approvals" : "/admin");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function useAccount(acct: (typeof DEV_ACCOUNTS)[number]) {
    setEmail(acct.email);
    setPassword(acct.password);
  }

  return (
    <div className="center">
      <form className="card" onSubmit={submit} style={{ width: 420 }}>
        <h1>Goeman Global Finance Admin</h1>
        <p className="muted">CEO Approvals · onboarding · compliance</p>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            try {
              const r = await api.seed();
              setError(
                `Seeded accounts — CEO ${r.ceo.email} / Ceo1234! · CS ${r.cs.email} / Cos1234! · admin ${r.admin.email} / Admin1234!`
              );
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          Seed all admin accounts
        </button>

        <div style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            Dev accounts (also printed by <code>cd backend && npm run setup</code>):
          </p>
          <table style={{ width: "100%", fontSize: "0.8rem" }}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Email</th>
                <th>Password</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {DEV_ACCOUNTS.map((a) => (
                <tr key={a.email}>
                  <td>{a.role}</td>
                  <td>{a.email}</td>
                  <td>{a.password}</td>
                  <td>
                    <button type="button" className="ghost sm" onClick={() => useAccount(a)}>
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}
