/**
 * Currency exchange — FX quote + cross-currency settlement widget.
 *
 * Quote is read-only (FX_ENABLED); Convert moves money on the ledger
 * (FX_SETTLEMENT_ENABLED, idempotent). Both degrade gracefully when their switch
 * is off (FX_DISABLED). Amounts are always integer minor units via the registry's
 * per-currency decimals — never floats.
 */
import { useEffect, useMemo, useState } from "react";
import {
  userApi,
  newIdempotencyKey,
  ApiError,
  type FxCurrency,
  type FxQuoteResult,
  type FxConversion,
} from "../api/client";
import { formatUnits, decimalToMinor } from "../lib/money";
import { useToast } from "../components/Toast";
import { Empty, Loading, Badge } from "../components/ui";

export function Fx() {
  const toast = useToast();
  const [currencies, setCurrencies] = useState<FxCurrency[] | null>(null);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<FxQuoteResult | null>(null);
  const [history, setHistory] = useState<FxConversion[]>([]);
  const [busy, setBusy] = useState(false);

  const fromCcy = useMemo(() => currencies?.find((c) => c.code === from), [currencies, from]);
  const toCcy = useMemo(() => currencies?.find((c) => c.code === to), [currencies, to]);

  async function load() {
    try {
      const [{ currencies: cs }, { conversions }] = await Promise.all([
        userApi.fxCurrencies(),
        userApi.fxConversions().catch(() => ({ conversions: [] as FxConversion[] })),
      ]);
      setCurrencies(cs);
      setHistory(conversions);
    } catch {
      setCurrencies([]);
    }
  }
  useEffect(() => { void load(); }, []);

  // Re-quoting on input change keeps the displayed rate honest; clear stale quotes.
  useEffect(() => { setQuote(null); }, [from, to, amount]);

  function amountMinor(): string | null {
    return fromCcy ? decimalToMinor(amount, fromCcy.decimals) : null;
  }

  async function getQuote() {
    const minor = amountMinor();
    if (from === to) { toast.show("Pick two different currencies", "bad"); return; }
    if (!minor || BigInt(minor) <= 0n) { toast.show("Enter an amount", "bad"); return; }
    setBusy(true);
    try {
      setQuote(await userApi.fxQuote(from, to, minor));
    } catch (e) {
      toast.show(e instanceof ApiError ? (e.code === "FX_DISABLED" ? "FX quotes are disabled (set FX_ENABLED=true)" : e.message) : "Quote failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    const minor = amountMinor();
    if (!minor || BigInt(minor) <= 0n || from === to) return;
    setBusy(true);
    try {
      const r = await userApi.fxConvert(from, to, minor, newIdempotencyKey());
      toast.show(`Converted — received ${formatUnits(r.toAmountMinor, toCcy?.decimals ?? 2)} ${r.to} (fee ${formatUnits(r.feeMinor, toCcy?.decimals ?? 2)} ${r.to})`);
      setAmount("");
      setQuote(null);
      await load();
    } catch (e) {
      toast.show(
        e instanceof ApiError
          ? e.code === "FX_DISABLED"
            ? "Conversion is disabled (set FX_SETTLEMENT_ENABLED=true)"
            : e.message
          : "Conversion failed",
        "bad"
      );
    } finally {
      setBusy(false);
    }
  }

  if (currencies === null) return <Loading />;

  const dec = (code: string) => currencies.find((c) => c.code === code)?.decimals ?? 2;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Currency exchange</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Quote a conversion, then settle it on the ledger. Rates carry a source and a staleness flag;
          conversions charge a transparent spread.
        </p>
      </div>

      <div className="card stack sm">
        <div className="row" style={{ gap: 8 }}>
          <label className="stack xs" style={{ flex: 1 }}>
            <span className="micro muted">From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From currency">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </label>
          <button
            className="ghost sm"
            style={{ alignSelf: "flex-end" }}
            title="Swap"
            onClick={() => { setFrom(to); setTo(from); }}
          >⇄</button>
          <label className="stack xs" style={{ flex: 1 }}>
            <span className="micro muted">To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To currency">
              {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </label>
        </div>

        <input
          inputMode="decimal"
          placeholder={`Amount in ${from}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <div className="row" style={{ gap: 8 }}>
          <button disabled={busy} onClick={getQuote}>Get quote</button>
          <button className="ghost" disabled={busy || !quote} onClick={convert}>Convert</button>
        </div>

        {quote && (
          <div className="card stack xs" style={{ background: "var(--surface, transparent)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">Rate</span>
              <span>1 {quote.from} = {quote.rate} {quote.to}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">You send</span>
              <span>{formatUnits(quote.fromAmountMinor, dec(quote.from))} {quote.from}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted small">You get (mid)</span>
              <span>{formatUnits(quote.toAmountMinor, dec(quote.to))} {quote.to}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted micro">{quote.source}{quote.stale ? " · stale" : ""}</span>
              {quote.stale ? <Badge kind="warn">stale</Badge> : <Badge kind="ok">live</Badge>}
            </div>
            <p className="muted micro" style={{ margin: 0 }}>
              Convert applies a spread; the exact net (after fee) is shown on completion.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Recent conversions</h2>
        {history.length === 0 ? (
          <Empty>No conversions yet.</Empty>
        ) : (
          <div className="list">
            {history.map((c) => (
              <div key={c.id} className="list-row">
                <div>
                  <span>{formatUnits(c.fromAmountMinor, dec(c.from))} {c.from} → {formatUnits(c.toAmountMinor, dec(c.to))} {c.to}</span>
                  <div className="micro muted">
                    @ {c.rate} · fee {formatUnits(c.feeMinor, dec(c.to))} {c.to} · {c.source}
                  </div>
                </div>
                <Badge kind="ok">settled</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
