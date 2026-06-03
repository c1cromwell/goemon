/**
 * Login — passkey-first. Enter email → authenticate with a passkey. The password
 * form only appears when the backend reports password auth is enabled (dev).
 */
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { userApi } from "../api/client";
import { passkeysSupported } from "../lib/webauthn";

export function Login() {
  const { loginPasskey, loginPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [busy, setBusy] = useState<"passkey" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    userApi.passwordAuthEnabled().then(setPasswordEnabled).catch(() => setPasswordEnabled(false));
  }, []);

  async function onPasskey() {
    if (!email.trim()) return setError("Enter your email first");
    setBusy("passkey");
    setError(null);
    try {
      await loginPasskey(email.trim());
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setBusy("password");
    setError(null);
    try {
      await loginPassword(email.trim(), password);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="center">
      <div className="card pad-lg narrow" style={{ width: "100%" }}>
        <div className="brand" style={{ padding: "0 0 18px" }}>
          <span className="mark">B</span> BankAI
        </div>
        <h1>Welcome back</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Sign in with your passkey.
        </p>

        <div className="field" style={{ marginTop: 18 }}>
          <label>Email</label>
          <input
            type="email"
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <button className="block lg" style={{ marginTop: 16 }} disabled={busy !== null || !passkeysSupported()} onClick={onPasskey}>
          {busy === "passkey" ? "Authenticating…" : "Continue with passkey"}
        </button>
        {!passkeysSupported() ? (
          <p className="micro" style={{ marginTop: 8 }}>
            This browser doesn't support passkeys.
          </p>
        ) : null}

        {passwordEnabled ? (
          <>
            <hr className="hr" style={{ margin: "20px 0" }} />
            {!showPassword ? (
              <button className="link" onClick={() => setShowPassword(true)}>
                Use a password instead
              </button>
            ) : (
              <form onSubmit={onPassword} className="stack sm">
                <div className="field">
                  <label>Password</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button className="ghost block" type="submit" disabled={busy !== null}>
                  {busy === "password" ? "Signing in…" : "Sign in with password"}
                </button>
              </form>
            )}
          </>
        ) : null}

        {error ? <p className="error" style={{ marginTop: 14 }}>{error}</p> : null}

        <p className="muted small" style={{ marginTop: 22 }}>
          New to BankAI? <Link to="/register" style={{ color: "var(--accent)", fontWeight: 600 }}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}
