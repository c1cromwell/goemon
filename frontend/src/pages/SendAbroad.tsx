/**
 * Send Abroad — cross-border remittance (X-Money response F6). Send to someone in a
 * different currency on the native rail (no Visa, no US-only limit). Quote first
 * ("they receive X"), then send. The global audience X Money can't serve.
 */
import { useEffect, useMemo, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type FxCurrency, type FxQuoteResult, type CrossBorderSend } from "../api/client";
import { formatUnits, decimalToMinor } from "../lib/money";
import { Loading, Empty } from "../components/ui";
import { useToast } from "../components/Toast";

export function SendAbroad() {
  const toast = useToast();
  const [currencies, setCurrencies] = useState<FxCurrency[] | null>(null);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("EURC");
  const [recipient, setRecipient] = useState("");
  const [amt, setAmt] = useState("");
  const [quote, setQuote] = useState<FxQuoteResult | null>(null);
  const [sends, setSends] = useState<CrossBorderSend[]>([]);
  const [busy, setBusy] = useState(false);

  const fromCcy = useMemo(() => currencies?.find((c) => c.code === from), [currencies, from]);
  const dec = (code: string) => currencies?.find((c) => c.code === code)?.decimals ?? 2;

  async function load() {
    try {
      const [{ currencies: cs }, { sends: s }] = await Promise.all([
        userApi.fxCurrencies(),
        userApi.crossBorderSends().catch(() => ({ sends: [] as CrossBorderSend[] })),
      ]);
      setCurrencies(cs);
      setSends(s);
      if (cs.length && !cs.find((c) => c.code === to && c.code !== from)) {
        const other = cs.find((c) => c.code !== from);
        if (other) setTo(other.code);
      }
    } catch { setCurrencies([]); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setQuote(null); }, [from, to, amt]);

  const minor = () => (fromCcy ? decimalToMinor(amt, fromCcy.decimals) : null);

  async function getQuote() {
    const m = minor();
    if (from === to) return toast.show("Pick two different currencies", "bad");
    if (!m || BigInt(m) <= 0n) return toast.show("Enter an amount", "bad");
    setBusy(true);
    try { setQuote(await userApi.crossBorderQuote(from, to, m)); }
    catch (e) { toast.show(e instanceof ApiError ? (e.code === "FX_DISABLED" ? "Cross-border is disabled (FX_ENABLED)" : e.message) : "Quote failed", "bad"); }
    finally { setBusy(false); }
  }

  async function send() {
    const m = minor();
    if (!m || !recipient.trim() || from === to) return toast.show("Recipient + amount + two currencies", "bad");
    setBusy(true);
    try {
      const r = await userApi.crossBorderSend({ recipient: recipient.trim(), from, to, fromAmountMinor: m }, newIdempotencyKey());
      toast.show(`Sent — recipient receives ${formatUnits(r.toAmountMinor, dec(r.to))} ${r.to}`);
      setAmt(""); setRecipient(""); setQuote(null);
      await load();
    } catch (e) {
      toast.show(e instanceof ApiError ? (e.code === "FX_DISABLED" ? "Sending is disabled (FX_SETTLEMENT_ENABLED)" : e.message) : "Send failed", "bad");
    } finally { setBusy(false); }
  }

  if (currencies === null) return <Loading />;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Send abroad</h1>
        <p className="muted small" style={{ margin: 0 }}>Send to someone in another currency — instant, on the native rail, anywhere.</p>
      </div>

      <div className="card stack sm">
        <input placeholder="Recipient (email)" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Recipient email" />
        <div className="row" style={{ gap: 8 }}>
          <label className="stack xs grow"><span className="micro muted">You send</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From currency">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
          <label className="stack xs grow"><span className="micro muted">They receive</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To currency">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </select>
          </label>
        </div>
        <input inputMode="decimal" placeholder={`Amount in ${from}`} value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" />
        <div className="row" style={{ gap: 8 }}>
          <button className="grow" disabled={busy} onClick={getQuote}>Preview</button>
          <button className="ghost grow" disabled={busy || !quote} onClick={send}>Send</button>
        </div>
        {quote && (
          <div className="card stack xs" style={{ background: "var(--surface, transparent)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small">Rate</span><span>1 {quote.from} = {quote.rate} {quote.to}</span></div>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="muted small">They receive (mid)</span><strong>{formatUnits(quote.toAmountMinor, dec(quote.to))} {quote.to}</strong></div>
            <p className="muted micro" style={{ margin: 0 }}>A small FX spread applies on send; the exact net is shown on completion.</p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Recent</h2>
        {sends.length === 0 ? <Empty>No cross-border sends yet.</Empty> : (
          <div className="list">
            {sends.map((s) => (
              <div key={s.id} className="list-row">
                <span>{formatUnits(s.fromAmountMinor, dec(s.from))} {s.from} → {formatUnits(s.toAmountMinor, dec(s.to))} {s.to}</span>
                <span className="muted micro">@ {s.rate}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
