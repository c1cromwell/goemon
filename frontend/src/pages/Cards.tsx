/**
 * Cards — debit cards (Phase 19.4). Issue a card, simulate a purchase (authorization
 * holds funds), and void an uncaptured hold. Capture/refund are the merchant/processor
 * side (admin). Money renders only from integer minor units.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type Card, type CardAuth } from "../api/client";
import { formatMoney, formatUnits } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function toMinor(dollars: string): string | null {
  const n = parseFloat(dollars);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 100));
}
function authKind(s: string): "ok" | "warn" | "bad" {
  if (s === "captured") return "ok";
  if (s === "voided" || s === "refunded") return "bad";
  return "warn"; // authorized (held)
}

export function Cards() {
  const toast = useToast();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [auths, setAuths] = useState<CardAuth[]>([]);
  const [amt, setAmt] = useState("");
  const [merchant, setMerchant] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [rewards, setRewards] = useState<{ totalMinor: string; currency: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [c, a, r] = await Promise.all([userApi.cards(), userApi.cardAuthorizations(), userApi.cardRewards().catch(() => null)]);
      setCards(c.cards);
      setAuths(a.authorizations);
      setRewards(r);
      if (!selected && c.cards[0]) setSelected(c.cards[0].id);
    } catch {
      setCards([]);
    }
  }
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); await refresh(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(false); }
  }

  function issue() { run(() => userApi.issueCard(), "Card issued"); }
  function purchase() {
    const minor = toMinor(amt);
    if (!selected) return toast.show("Issue or select a card first", "bad");
    if (!minor) return toast.show("Enter a positive amount", "bad");
    run(async () => { await userApi.cardAuthorize(selected, minor, newIdempotencyKey(), merchant || undefined); setAmt(""); setMerchant(""); }, "Purchase authorized (held)");
  }

  if (cards === null) return <Loading />;

  return (
    <div className="page stack lg">
      <div>
        <h1>Cards</h1>
        <p className="muted small" style={{ margin: 0 }}>Issue a debit card and spend from your balance. A purchase holds funds until the merchant captures.</p>
      </div>

      {/* Cards */}
      <div className="stack sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Your cards</strong>
          <button className="ghost sm" onClick={issue} disabled={busy}>+ Issue card</button>
        </div>
        {cards.length === 0 ? (
          <Empty>No cards yet — issue one to get started.</Empty>
        ) : (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {cards.map((c) => (
              <button
                key={c.id}
                className="card stack sm"
                onClick={() => setSelected(c.id)}
                style={{ minWidth: 220, textAlign: "left", outline: selected === c.id ? "2px solid var(--accent)" : "none", cursor: "pointer" }}
              >
                <span className="muted micro">{c.network.toUpperCase()}</span>
                <span style={{ fontSize: 20, letterSpacing: 2 }}>{c.masked_number}</span>
                <span className="muted micro">Exp {String(c.exp_month).padStart(2, "0")}/{String(c.exp_year).slice(-2)} · {c.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cashback — earned as USDC, an asset you own */}
      {rewards && BigInt(rewards.totalMinor) > 0n && (
        <div className="card stack sm">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <strong>Cashback earned</strong>
            <span className="pill">USDC</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{formatUnits(rewards.totalMinor, 6)} {rewards.currency}</div>
          <span className="muted micro">A real asset you own — not points locked in a platform.</span>
        </div>
      )}

      {/* Simulate a purchase */}
      {cards.length > 0 && (
        <div className="card stack sm">
          <strong>Simulate a purchase</strong>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Card">
              {cards.map((c) => <option key={c.id} value={c.id}>{c.masked_number}</option>)}
            </select>
            <input type="number" min={0} step="0.01" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" style={{ width: 110 }} />
            <input placeholder="Merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} aria-label="Merchant" />
            <button onClick={purchase} disabled={busy}>Authorize</button>
          </div>
        </div>
      )}

      {/* Authorizations */}
      <div className="stack sm">
        <strong>Activity</strong>
        {auths.length === 0 ? (
          <Empty>No card activity yet.</Empty>
        ) : (
          <div className="list">
            {auths.map((a) => (
              <div key={a.id} className="list-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span>{a.merchant ?? "Purchase"} · {formatMoney(a.amount_minor, a.currency)}</span>
                  <span className="muted micro">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {a.status === "authorized" && (
                    <button className="ghost sm" onClick={() => run(() => userApi.cardVoid(a.id), "Authorization voided")} disabled={busy}>Void</button>
                  )}
                  <Badge kind={authKind(a.status)}>{a.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
