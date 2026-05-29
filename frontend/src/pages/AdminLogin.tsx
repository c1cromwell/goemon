import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api/client";

export function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@bankai.com");
  const [password, setPassword] = useState("Admin1234!");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(email, password);
      setToken(token);
      nav("/admin");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card" onSubmit={submit} style={{ width: 360 }}>
        <h1>BankAI Admin</h1>
        <p className="muted">Risk-adaptive onboarding console</p>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            try {
              await api.seed();
              setError("Seeded admin@bankai.com / Admin1234!");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          Seed default admin
        </button>
      </form>
    </div>
  );
}
