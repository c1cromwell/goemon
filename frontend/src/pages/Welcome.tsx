/**
 * Welcome — sample marketing home (Ink & Seal). Public route. A fuller pre-launch
 * page than the waitlist landing: hero, what-you-can-hold, the security pillars, and
 * a waitlist CTA. Structure follows docs/designs/Goemon Home.
 */
import { Link } from "react-router-dom";
import { BrandMark } from "../components/BrandMark";

const CAPABILITIES = [
  { k: "Non-custodial keys", d: "Keys live in your device's secure hardware. The server never holds your private key." },
  { k: "Hedera settlement", d: "On-chain settlement with a public, verifiable record — reconciled to the ledger daily." },
  { k: "Append-only audit", d: "Every action is written to an immutable trail. Nothing is edited away." },
  { k: "Regulated partner rail", d: "Software and rails — not a bank. Licensed partners move fiat when required." },
];

const HOLDINGS = [
  { k: "Tokenized RWA", d: "Real-world assets — treasuries, funds, real estate — held as compliance-gated positions." },
  { k: "Self-custodied", d: "Your assets, your keys. A signed, portable record you can export at any time." },
  { k: "Agent-native", d: "Grant a scoped, revocable agent access — it acts under your rules, never around them." },
];

export function Welcome() {
  return (
    <div className="landing">
      <header className="landing-bar">
        <div className="brand">
          <span className="mark"><BrandMark size={26} /></span>
          <span>GOEMON</span>
        </div>
        <div className="row" style={{ gap: 18 }}>
          <Link className="micro-link" to="/login">Log in</Link>
          <Link className="micro-link" to="/waitlist">Join waitlist</Link>
        </div>
      </header>

      <section className="landing-hero-solo">
        <div className="stack" style={{ gap: 18, maxWidth: 760 }}>
          <span className="eyebrow">Every conversation, a proof.</span>
          <h1 className="hero-title">Verifiable finance, keys you control.</h1>
          <p className="hero-sub">
            A tokenization-first platform: a non-custodial wallet, a double-entry ledger, agent-native
            commerce, and real-world assets — built so you keep control while software enforces
            compliance and audit.
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <Link to="/waitlist"><button className="lg">Join the waitlist</button></Link>
            <a href="#hold"><button className="ghost lg">See what you can hold</button></a>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2 className="section-title">Security designed as the product</h2>
        <div className="pillars">
          {CAPABILITIES.map((c) => (
            <div className="card pad-lg" key={c.k}>
              <div className="pillar-k">{c.k}</div>
              <p className="muted small" style={{ margin: "8px 0 0" }}>{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="hold">
        <h2 className="section-title">What you can hold</h2>
        <div className="pillars">
          {HOLDINGS.map((h) => (
            <div className="card pad-lg" key={h.k}>
              <div className="pillar-k">{h.k}</div>
              <p className="muted small" style={{ margin: "8px 0 0" }}>{h.d}</p>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          Build · Protect · Preserve — your trust &amp; your assets.
        </p>
        <Link to="/waitlist" className="cta">Request early access</Link>
      </section>

      <footer className="landing-foot">
        <div className="brand">
          <span className="mark"><BrandMark size={20} /></span> GOEMON
        </div>
        <span className="muted micro">Goemon Global Finance, LLC · Wyoming · Not a bank.</span>
        <span className="micro"><Link to="/login">Sign in</Link></span>
      </footer>
    </div>
  );
}
