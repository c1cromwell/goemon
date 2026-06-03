/**
 * Register — create an account, then add a passkey. Account creation uses a
 * password (the only user-creation path in this prototype; dev-only). Once in,
 * we offer passkey enrollment so future sign-ins are passwordless.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { userApi } from "../api/client";
import { enrollPasskey, passkeysSupported } from "../lib/webauthn";

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "passkey">("form");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordEnabled, setPasswordEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    userApi.passwordAuthEnabled().then(setPasswordEnabled).catch(() => setPasswordEnabled(false));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), password, fullName.trim() || undefined);
      setStep("passkey");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setBusy(false);
    }
  }

  async function onAddPasskey() {
    setBusy(true);
    setError(null);
    try {
      await enrollPasskey();
      navigate("/onboarding");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey setup failed — you can add one later");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card pad-lg narrow" style={{ width: "100%" }}>
        <div className="brand" style={{ padding: "0 0 18px" }}>
          <span className="mark">B</span> BankAI
        </div>

        {step === "form" ? (
          <>
            <h1>Create your account</h1>
            <p className="muted small" style={{ marginTop: 0 }}>
              A few details to get started. You'll add a passkey next.
            </p>

            {passwordEnabled === false ? (
              <p className="error" style={{ marginTop: 16 }}>
                Self-serve registration is disabled on this server.
              </p>
            ) : (
              <form onSubmit={onCreate} className="stack sm" style={{ marginTop: 16 }}>
                <div className="field">
                  <label>Full name</label>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Optional" />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label>Password</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button className="block lg" type="submit" disabled={busy}>
                  {busy ? "Creating…" : "Create account"}
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <h1>Add a passkey</h1>
            <p className="muted small" style={{ marginTop: 0 }}>
              Passkeys let you sign in with Face ID, Touch ID, or your device PIN — no password to remember.
            </p>
            <button className="block lg" style={{ marginTop: 18 }} disabled={busy || !passkeysSupported()} onClick={onAddPasskey}>
              {busy ? "Setting up…" : "Set up passkey"}
            </button>
            <button className="link" style={{ marginTop: 14 }} onClick={() => navigate("/onboarding")}>
              Skip for now
            </button>
          </>
        )}

        {error ? <p className="error" style={{ marginTop: 14 }}>{error}</p> : null}

        {step === "form" ? (
          <p className="muted small" style={{ marginTop: 22 }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Sign in
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
