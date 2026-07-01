/**
 * Waitlist — pre-launch landing (Ink & Seal). Public route. Captures early-access
 * emails via POST /api/waitlist. Copy + structure follow docs/designs/Goemon Waitlist.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { waitlistApi, ApiError } from "../api/client";
import { BrandMark } from "../components/BrandMark";

const PILLARS = [
  { k: "Build", d: "Wealth tools — tokenized assets, savings, agent-native commerce and a marketplace." },
  { k: "Protect", d: "Keys, scopes, fraud freeze and reconciliation — security designed as the product." },
  { k: "Preserve", d: "Ledger truth, an append-only audit trail, and human gates on money and legal." },
];

const CHIPS = ["Non-custodial keys", "Hedera settlement", "Append-only audit"];

export function Waitlist({ source = "waitlist" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await waitlistApi.join(value, source);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <header className="landing-bar">
        <div className="brand">
          <span className="mark">
            <BrandMark size={26} />
          </span>
          <span>GOEMON</span>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <Link className="micro-link" to="/login">Log in</Link>
          <a className="micro-link" href="#join">Join waitlist</a>
        </div>
      </header>

      <section className="landing-hero">
        <div className="stack" style={{ gap: 18 }}>
          <span className="eyebrow">Early access · Phase A</span>
          <h1 className="hero-title">Verifiable finance. Helping build assets you control.</h1>
          <p className="hero-sub">Tokenization &amp; asset platform for the modern &amp; future of finance.</p>

          {!submitted ? (
            <form id="join" onSubmit={onSubmit} className="join-form">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                aria-label="Email"
              />
              <button type="submit" disabled={busy}>{busy ? "Joining…" : "Join the waitlist"}</button>
              {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
              <p className="micro">No spam. We'll email you once, when early access opens.</p>
            </form>
          ) : (
            <div className="card pad-lg stack sm" style={{ maxWidth: 460 }}>
              <strong style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>You're on the list.</strong>
              <p className="muted small" style={{ margin: 0 }}>
                We saved <strong>{email.trim()}</strong>. You'll hear from us when Phase A opens — nothing before then.
              </p>
              <button className="ghost sm" style={{ alignSelf: "start" }} onClick={() => { setSubmitted(false); setEmail(""); }}>
                Add another email
              </button>
            </div>
          )}

          <div className="chip-row">
            {CHIPS.map((c) => <span key={c} className="chip">{c}</span>)}
          </div>
        </div>

        <div className="hero-art" aria-hidden="true">
          <img src="/brand/hero-light.png" alt="Goemon Global Finance" />
        </div>
      </section>

      <section className="landing-section">
        <h2 className="section-title">What you're joining</h2>
        <div className="pillars">
          {PILLARS.map((p) => (
            <div className="card pad-lg" key={p.k}>
              <div className="pillar-k">{p.k}</div>
              <p className="muted small" style={{ margin: "8px 0 0" }}>{p.d}</p>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          Software and rails — not a bank. In Phase A, regulated partners move fiat when required.
        </p>
        <a className="cta" href="#join">Request early access</a>
      </section>

      <footer className="landing-foot">
        <div className="brand">
          <span className="mark"><BrandMark size={20} /></span> GOEMON
        </div>
        <span className="muted micro">Goemon Global Finance, LLC · Wyoming · Not a bank.</span>
        <span className="micro">
          <Link to="/waitlist">Privacy</Link> · <Link to="/waitlist">Terms</Link>
        </span>
      </footer>
    </div>
  );
}
