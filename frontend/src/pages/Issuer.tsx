/**
 * Issuer / Tokenization console (Phase 29 P1).
 *
 * A guided wizard that turns the asset-type + compliance-profile registries into a
 * "tokenize anything" flow: pick a type (smart defaults) → details → compliance
 * (the form adapts to the chosen profile's dimensions) → supply & listing → review.
 * Plain language over jargon; the engine does the rest.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  issuerApi,
  newIdempotencyKey,
  ApiError,
  type IssuerOptions,
  type IssuerComplianceProfile,
} from "../api/client";
import { Loading } from "../components/ui";
import { useToast } from "../components/Toast";

const STEPS = ["Type", "Details", "Compliance", "Supply", "Review"];

type Form = {
  kind: string;
  name: string;
  symbol: string;
  description: string;
  complianceProfile: string;
  minTier: number;
  jurisdictions: string; // comma-separated; empty = all
  holderCap: string; // optional
  whitelist: string; // comma/newline user ids
  supply: string;
  list: boolean;
  surface: "invest" | "collect";
  priceDollars: string;
};

const EMPTY: Form = {
  kind: "", name: "", symbol: "", description: "", complianceProfile: "",
  minTier: 0, jurisdictions: "", holderCap: "", whitelist: "",
  supply: "", list: false, surface: "invest", priceDollars: "",
};

export function Issuer() {
  const toast = useToast();
  const navigate = useNavigate();
  const [options, setOptions] = useState<IssuerOptions | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ symbol: string | null; name: string; listed: boolean; profile: string } | null>(null);

  useEffect(() => {
    issuerApi.options().then(setOptions).catch(() => setOptions({ enabled: false, assetTypes: [], complianceProfiles: [] }));
  }, []);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const profile: IssuerComplianceProfile | undefined = useMemo(
    () => options?.complianceProfiles.find((p) => p.name === form.complianceProfile),
    [options, form.complianceProfile]
  );
  const dims = profile?.dimensions ?? [];

  if (options === null) return <div className="page"><Loading /></div>;

  if (!options.enabled) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <h1>Tokenize</h1>
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            The issuance console isn't enabled in this environment. Set{" "}
            <span className="pill">ISSUANCE_CONSOLE_ENABLED=true</span> to create tokens.
          </p>
        </div>
      </div>
    );
  }

  // ---- result view -------------------------------------------------------
  if (created) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <h1>Token created</h1>
        <div className="card accent pad-lg stack sm">
          <div className="title" style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>
            {created.name} {created.symbol ? <span className="muted">· {created.symbol}</span> : null}
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="pill">{created.profile}</span>
            {created.listed ? <span className="pill">Listed</span> : <span className="pill">Not listed</span>}
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <button onClick={() => { setCreated(null); setForm(EMPTY); setStep(0); }}>Issue another</button>
          {created.listed ? <button className="ghost" onClick={() => navigate("/invest")}>View marketplace</button> : null}
        </div>
      </div>
    );
  }

  // ---- validation per step ----------------------------------------------
  const canNext = (() => {
    if (step === 0) return !!form.kind;
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return !!form.complianceProfile;
    if (step === 3) return /^\d+$/.test(form.supply) && BigInt(form.supply || "0") > 0n && (!form.list || parseFloat(form.priceDollars) > 0);
    return true;
  })();

  function pickType(kind: string) {
    const t = options!.assetTypes.find((a) => a.kind === kind);
    set({ kind, complianceProfile: t?.complianceProfile ?? "exempt-basic" });
  }

  async function submit() {
    setBusy(true);
    try {
      const body = {
        kind: form.kind,
        name: form.name.trim(),
        symbol: form.symbol.trim() || undefined,
        complianceProfile: form.complianceProfile,
        minTier: form.minTier || undefined,
        jurisdictionAllow: dims.includes("jurisdictionAllow") && form.jurisdictions.trim()
          ? form.jurisdictions.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
          : undefined,
        holderCap: dims.includes("holderCap") && form.holderCap.trim() ? parseInt(form.holderCap, 10) : undefined,
        whitelist: dims.includes("whitelist") && form.whitelist.trim()
          ? form.whitelist.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
          : undefined,
        metadata: form.description.trim() ? { description: form.description.trim() } : undefined,
        initialSupply: form.supply,
        listing: form.list
          ? { surface: form.surface, priceMinor: String(Math.round(parseFloat(form.priceDollars) * 100)) }
          : undefined,
      };
      const res = await issuerApi.create(body, newIdempotencyKey());
      setCreated({ symbol: res.asset.symbol, name: res.asset.name, listed: res.listed, profile: res.complianceProfile });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not create the token", "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page stack lg" style={{ maxWidth: 720 }}>
      <div>
        <h1>Tokenize</h1>
        <p className="muted small" style={{ margin: 0 }}>Create a compliant token in a few steps. We apply the right rules for you.</p>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={`stepper-item ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
            <span className="stepper-dot">{i < step ? "✓" : i + 1}</span>
            <span className="stepper-label">{s}</span>
          </div>
        ))}
      </div>

      {/* Step 0 — Type */}
      {step === 0 && (
        <div className="grid cols-2">
          {options.assetTypes.map((t) => (
            <div
              key={t.kind}
              className={`card tappable ${form.kind === t.kind ? "accent" : ""}`}
              onClick={() => pickType(t.kind)}
            >
              <div className="spread">
                <div className="title">{t.label}</div>
                <span className="pill">{t.isSecurity ? "Security" : "Open"}</span>
              </div>
              <p className="muted small" style={{ margin: "8px 0 0" }}>
                {t.isSecurity ? "Regulated — transfer rules apply." : "Freely held by verified users."}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Step 1 — Details */}
      {step === 1 && (
        <div className="card stack">
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. 123 Maple St LLC Units" />
          </div>
          <div className="field">
            <label>Symbol (optional)</label>
            <input value={form.symbol} onChange={(e) => set({ symbol: e.target.value.toUpperCase() })} placeholder="MAPLE" maxLength={16} />
          </div>
          <div className="field">
            <label>Description (optional)</label>
            <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What does this token represent?" />
          </div>
        </div>
      )}

      {/* Step 2 — Compliance (adapts to the chosen profile's dimensions) */}
      {step === 2 && (
        <div className="card stack">
          <div className="field">
            <label>Who can hold this?</label>
            <select value={form.complianceProfile} onChange={(e) => set({ complianceProfile: e.target.value })}>
              {options.complianceProfiles.map((p) => (
                <option key={p.name} value={p.name}>{p.label}</option>
              ))}
            </select>
            {profile ? <p className="muted small" style={{ margin: "6px 0 0" }}>{profile.description}</p> : null}
          </div>

          {dims.includes("minTier") && (
            <div className="field">
              <label>Minimum verification level</label>
              <select value={form.minTier} onChange={(e) => set({ minTier: parseInt(e.target.value, 10) })}>
                <option value={0}>Any verified user</option>
                <option value={1}>Tier 1 (phone verified)</option>
                <option value={2}>Tier 2 (full KYC)</option>
              </select>
            </div>
          )}
          {dims.includes("jurisdictionAllow") && (
            <div className="field">
              <label>Allowed jurisdictions (optional)</label>
              <input value={form.jurisdictions} onChange={(e) => set({ jurisdictions: e.target.value })} placeholder="US, CA — leave blank for all" />
            </div>
          )}
          {dims.includes("holderCap") && (
            <div className="field">
              <label>Maximum number of investors (optional)</label>
              <input inputMode="numeric" value={form.holderCap} onChange={(e) => set({ holderCap: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 99" />
            </div>
          )}
          {dims.includes("whitelist") && (
            <div className="field">
              <label>Whitelist — allowed holders</label>
              <textarea rows={3} value={form.whitelist} onChange={(e) => set({ whitelist: e.target.value })} placeholder="user ids, one per line or comma-separated" />
            </div>
          )}
          {dims.includes("accreditation") && (
            <span className="pill">Accredited investors only</span>
          )}
        </div>
      )}

      {/* Step 3 — Supply & listing */}
      {step === 3 && (
        <div className="card stack">
          <div className="field">
            <label>How many units to create?</label>
            <input inputMode="numeric" value={form.supply} onChange={(e) => set({ supply: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 1000" />
          </div>
          <label className="row" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.list} onChange={(e) => set({ list: e.target.checked })} style={{ width: "auto" }} />
            <span>List on the marketplace now</span>
          </label>
          {form.list && (
            <>
              <div className="field">
                <label>Marketplace</label>
                <select value={form.surface} onChange={(e) => set({ surface: e.target.value as "invest" | "collect" })}>
                  <option value="invest">Invest (securities / RWA)</option>
                  <option value="collect">Collect (collectibles)</option>
                </select>
              </div>
              <div className="field">
                <label>Price per unit (USD)</label>
                <input inputMode="decimal" value={form.priceDollars} onChange={(e) => set({ priceDollars: e.target.value })} placeholder="e.g. 50.00" />
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4 — Review */}
      {step === 4 && (
        <div className="card stack sm">
          <Row k="Type" v={options.assetTypes.find((t) => t.kind === form.kind)?.label ?? form.kind} />
          <Row k="Name" v={form.name + (form.symbol ? ` · ${form.symbol}` : "")} />
          <Row k="Who can hold" v={profile?.label ?? form.complianceProfile} />
          {dims.includes("minTier") ? <Row k="Min level" v={["Any", "Tier 1", "Tier 2"][form.minTier] ?? String(form.minTier)} /> : null}
          {dims.includes("jurisdictionAllow") && form.jurisdictions.trim() ? <Row k="Jurisdictions" v={form.jurisdictions} /> : null}
          {dims.includes("holderCap") && form.holderCap ? <Row k="Max investors" v={form.holderCap} /> : null}
          <Row k="Supply" v={form.supply ? `${Number(form.supply).toLocaleString()} units` : "—"} />
          <Row k="Listing" v={form.list ? `${form.surface} · $${form.priceDollars || "0"} / unit` : "Not listed"} />
        </div>
      )}

      {/* Nav */}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
        {step < STEPS.length - 1 ? (
          <button disabled={!canNext || busy} onClick={() => setStep((s) => s + 1)}>Next</button>
        ) : (
          <button disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create token"}</button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="spread">
      <span className="muted small">{k}</span>
      <span className="small" style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );
}
