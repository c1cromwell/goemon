/**
 * Verification & tiers — the quiet tier ladder, what each tier unlocks, and the
 * deterministic upgrade flow (phone → KYC) that advances 0 → 1 → 2. Tier 2
 * unlocks transfers and SmartChat.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { userApi } from "../api/client";
import { TIERS, MAX_TIER } from "../lib/tiers";
import { TierLadder } from "../components/TierLadder";
import { ProgressRing } from "../components/ProgressRing";

export function Onboarding() {
  const { tier, refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tier 1 form
  const [phone, setPhone] = useState("");
  // Tier 2 form
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [country, setCountry] = useState("US");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete this step");
    } finally {
      setBusy(false);
    }
  }

  const upgradeTier1 = () => run(() => userApi.tier1(phone.trim()));
  const upgradeTier2 = () =>
    run(async () => {
      await userApi.tier2Start(fullName.trim(), dob, country);
      await userApi.tier2Complete();
    });

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 620 }}>
      <div className="spread">
        <div>
          <h1>Verification</h1>
          <p className="muted small" style={{ margin: 0 }}>Unlock more as you verify.</p>
        </div>
        <ProgressRing percent={(tier / MAX_TIER) * 100} label={`T${tier}`} />
      </div>

      <div className="card accent">
        <TierLadder tier={tier} />
      </div>

      {/* The ladder rungs */}
      <div className="card">
        <h2>What each tier unlocks</h2>
        {TIERS.map((t) => (
          <div className="list-row" key={t.tier}>
            <div className="lead" style={{ background: t.tier <= tier ? "var(--accent-weak)" : undefined, color: t.tier <= tier ? "var(--accent)" : undefined }}>
              {t.tier}
            </div>
            <div className="grow">
              <div className="title">{t.name}</div>
              <div className="micro">{t.unlocks}</div>
            </div>
            {t.tier === tier ? <span className="badge ok">Current</span> : t.tier < tier ? <span className="badge">Done</span> : null}
          </div>
        ))}
      </div>

      {/* Next-step action */}
      {tier === 0 ? (
        <div className="card">
          <h2>Step 1 · Add your phone</h2>
          <div className="field">
            <label>Phone number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
          </div>
          <button style={{ marginTop: 12 }} disabled={busy || !phone.trim()} onClick={upgradeTier1}>
            {busy ? "Verifying…" : "Verify phone → Tier 1"}
          </button>
        </div>
      ) : tier === 1 ? (
        <div className="card">
          <h2>Step 2 · Identity check</h2>
          <div className="stack sm">
            <div className="field">
              <label>Full legal name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="row">
              <div className="field grow">
                <label>Date of birth</label>
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label>Country</label>
                <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
              </div>
            </div>
          </div>
          <button style={{ marginTop: 12 }} disabled={busy || !fullName.trim() || !dob} onClick={upgradeTier2}>
            {busy ? "Checking…" : "Complete KYC → Tier 2"}
          </button>
        </div>
      ) : (
        <div className="card">
          <h2>You're verified</h2>
          <p className="muted small" style={{ marginTop: 0 }}>Transfers and SmartChat are unlocked.</p>
          <button className="ghost sm" onClick={() => navigate("/agent")}>Open Agent</button>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
