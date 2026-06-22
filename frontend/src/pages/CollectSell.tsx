/**
 * List a graded slab — cert verify (PSA/GemRate) → comps → optional AI pre-grade → human review.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  userApi,
  type CertPreview,
  type SlabCategory,
  type SlabGrader,
  type SellerSubmission,
} from "../api/client";
import { decimalToMinor, formatMoney } from "../lib/money";
import { useToast } from "../components/Toast";

const GRADERS: { id: SlabGrader; label: string }[] = [
  { id: "psa", label: "PSA" },
  { id: "bgs", label: "BGS" },
  { id: "sgc", label: "SGC" },
  { id: "cgc", label: "CGC" },
];

const DEMO_CERTS = "Demo: PSA cert 12345678 (Pokémon) or 87654321 (Jordan)";

export function CollectSell() {
  const toast = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState<SlabCategory>("pokemon");
  const [grader, setGrader] = useState<SlabGrader>("psa");
  const [certNumber, setCertNumber] = useState("");
  const [askAmount, setAskAmount] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [title, setTitle] = useState("");
  const [cert, setCert] = useState<CertPreview | null>(null);
  const [compMinor, setCompMinor] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<SellerSubmission | null>(null);

  async function verify() {
    if (!certNumber.trim()) return toast.show("Enter a cert number", "bad");
    setBusy(true);
    setCert(null);
    setCompMinor(null);
    setAiNote(null);
    try {
      const { cert: c } = await userApi.verifySlabCert(grader, certNumber.trim());
      setCert(c);
      if (!c.verified) toast.show("Cert not found — check grader and number", "bad");
      else toast.show(`Verified via ${c.source}`);
      if (c.cardDescription && !title) setTitle(c.cardDescription);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Verify failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const micro = decimalToMinor(askAmount, 6);
    if (!cert?.verified) return toast.show("Verify cert first", "bad");
    if (micro === null || BigInt(micro) <= 0n) return toast.show("Enter a valid USDC price", "bad");
    setBusy(true);
    try {
      const { submission } = await userApi.submitCollectible({
        category,
        grader,
        certNumber: certNumber.trim(),
        askUsdcMicro: micro,
        title: title.trim() || undefined,
        imageUrls: imageUrl.trim() ? [imageUrl.trim()] : undefined,
        runAiPreGrade: !!imageUrl.trim(),
      });
      setSubmitted(submission);
      setCompMinor(submission.comp?.priceMinor ?? null);
      if (submission.aiGrade?.notes) setAiNote(submission.aiGrade.notes);
      toast.show("Submitted for human review");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Submit failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
        <h1>Listing submitted</h1>
        <div className="card accent">
          <p className="lead" style={{ margin: 0 }}>{submitted.title ?? submitted.certNumber}</p>
          <p className="muted small" style={{ marginTop: 8 }}>
            Status: <span className="badge warn">Pending human review</span>
          </p>
          <p className="micro" style={{ marginTop: 12 }}>
            Compliance reviews cert data, comps, and optional AI pre-grade before your slab appears on Collect.
          </p>
        </div>
        <button onClick={() => navigate("/collect")}>Back to Collect</button>
      </div>
    );
  }

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
      <div className="spread">
        <div>
          <h1>List a slab</h1>
          <p className="muted small" style={{ margin: 0 }}>Sports & Pokémon — PSA, BGS, SGC, CGC</p>
        </div>
        <Link to="/collect" className="ghost sm">← Collect</Link>
      </div>

      <div className="card stack sm">
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as SlabCategory)}>
            <option value="pokemon">Pokémon / TCG</option>
            <option value="sports">Sports cards</option>
          </select>
        </div>
        <div className="field">
          <label>Grader</label>
          <select value={grader} onChange={(e) => setGrader(e.target.value as SlabGrader)}>
            {GRADERS.map((g) => (
              <option key={g.id} value={g.id}>{g.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Cert number</label>
          <input
            value={certNumber}
            onChange={(e) => setCertNumber(e.target.value)}
            placeholder="e.g. 12345678"
            inputMode="numeric"
          />
          <p className="micro">{DEMO_CERTS}</p>
        </div>
        <button type="button" disabled={busy} onClick={verify}>
          {busy ? "Verifying…" : "Verify cert"}
        </button>
      </div>

      {cert && (
        <div className="card stack sm">
          <h2>Cert result</h2>
          <div className="spread">
            <span className={cert.verified ? "badge ok" : "badge warn"}>
              {cert.verified ? `Verified · ${cert.source}` : "Not verified"}
            </span>
            {cert.grade ? <span className="micro">Grade {cert.grade}</span> : null}
          </div>
          {cert.cardDescription ? <p className="small" style={{ margin: 0 }}>{cert.cardDescription}</p> : null}
          {cert.year || cert.brand ? (
            <p className="micro">{[cert.year, cert.brand, cert.subject].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
      )}

      <div className="card stack sm">
        <h2>Listing details</h2>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="From cert or custom" />
        </div>
        <div className="field">
          <label>Ask price (USDC)</label>
          <input inputMode="decimal" value={askAmount} onChange={(e) => setAskAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div className="field">
          <label>Photo URL (optional — enables AI pre-grade)</label>
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        </div>
        {compMinor ? (
          <p className="micro">Market comp (advisory): {formatMoney(compMinor, "USDC", { trim: true })}</p>
        ) : null}
        {aiNote ? <p className="micro">{aiNote}</p> : null}
        <button disabled={busy || !cert?.verified} onClick={submit}>
          {busy ? "Submitting…" : "Submit for review"}
        </button>
        <p className="micro">After approval, buyers pay you USDC peer-to-peer. Shipping is between you and the buyer.</p>
      </div>
    </div>
  );
}
