/**
 * Bank — the daily-driver money rails (Phase 19 Stage-1): deposit, withdraw (ACH/wire),
 * linked external accounts, and a statement export. Money flows through the partner-bank
 * rail and settles into the ledger; balances render only from integer minor units.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type BankTransfer, type BankAccount, type Statement } from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function toMinor(dollars: string): string | null {
  const n = parseFloat(dollars);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 100));
}
function statusKind(s: string): "ok" | "warn" | "bad" {
  if (s === "settled") return "ok";
  if (s === "returned" || s === "failed") return "bad";
  return "warn";
}

export function Bank() {
  const toast = useToast();
  const [balance, setBalance] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<BankTransfer[] | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [depositAmt, setDepositAmt] = useState("");
  const [wdAmt, setWdAmt] = useState("");
  const [wdMethod, setWdMethod] = useState<"ach" | "wire" | "instant">("ach");
  const [wdDest, setWdDest] = useState("");
  const [last4, setLast4] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [bal, tr, acc] = await Promise.all([userApi.balance(), userApi.bankTransfers(), userApi.bankAccounts()]);
      setBalance(bal.cash.amount);
      setTransfers(tr.transfers);
      setAccounts(acc.accounts);
    } catch {
      setTransfers([]);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); await refresh(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(false); }
  }

  function deposit() {
    const minor = toMinor(depositAmt);
    if (!minor) return toast.show("Enter a positive amount", "bad");
    run(async () => { await userApi.bankDeposit(minor, newIdempotencyKey()); setDepositAmt(""); }, "Deposit settled");
  }
  function withdraw() {
    const minor = toMinor(wdAmt);
    if (!minor) return toast.show("Enter a positive amount", "bad");
    run(async () => { await userApi.bankWithdraw({ amountMinor: minor, method: wdMethod, destination: wdDest || undefined }, newIdempotencyKey()); setWdAmt(""); }, "Payout sent");
  }
  function link() {
    if (!/^\d{4}$/.test(last4)) return toast.show("Enter the last 4 digits", "bad");
    run(async () => { await userApi.linkBankAccount({ last4 }); setLast4(""); }, "Account linked");
  }
  async function loadStatement() {
    try {
      const from = new Date(Date.now() - 90 * 86400_000).toISOString();
      setStatement(await userApi.bankStatement(from, new Date().toISOString()));
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not load statement", "bad");
    }
  }

  if (transfers === null) return <Loading />;

  return (
    <div className="page stack lg">
      <div>
        <h1>Bank</h1>
        <p className="muted small" style={{ margin: 0 }}>Move money in and out — deposits, ACH/wire payouts, and statements.</p>
      </div>

      {balance !== null && (
        <div className="card">
          <span className="muted small">Available balance</span>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{formatMoney(balance, "USD")}</div>
        </div>
      )}

      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* Deposit */}
        <div className="card stack sm" style={{ flex: 1, minWidth: 240 }}>
          <strong>Deposit</strong>
          <div className="row" style={{ gap: 8 }}>
            <input type="number" min={0} step="0.01" placeholder="Amount" value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} aria-label="Deposit amount" />
            <button onClick={deposit} disabled={busy}>Add funds</button>
          </div>
        </div>
        {/* Withdraw */}
        <div className="card stack sm" style={{ flex: 1, minWidth: 240 }}>
          <strong>Withdraw</strong>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input type="number" min={0} step="0.01" placeholder="Amount" value={wdAmt} onChange={(e) => setWdAmt(e.target.value)} aria-label="Withdraw amount" style={{ width: 110 }} />
            <select value={wdMethod} onChange={(e) => setWdMethod(e.target.value as typeof wdMethod)} aria-label="Method">
              <option value="ach">ACH</option>
              <option value="wire">Wire</option>
              <option value="instant">Instant</option>
            </select>
            <input placeholder="To account (optional)" value={wdDest} onChange={(e) => setWdDest(e.target.value)} aria-label="Destination" style={{ width: 150 }} />
            <button onClick={withdraw} disabled={busy}>Send</button>
          </div>
        </div>
      </div>

      {/* Linked accounts */}
      <div className="card stack sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Linked accounts</strong>
          <div className="row" style={{ gap: 8 }}>
            <input placeholder="Last 4" value={last4} onChange={(e) => setLast4(e.target.value)} aria-label="Account last 4" style={{ width: 80 }} maxLength={4} />
            <button className="ghost sm" onClick={link} disabled={busy}>Link</button>
          </div>
        </div>
        {accounts.length === 0 ? <span className="muted micro">No linked accounts.</span> : accounts.map((a) => (
          <div key={a.id} className="row" style={{ justifyContent: "space-between" }}>
            <span>{a.label ?? a.type} {a.masked_number}</span>
            <Badge kind="ok">{a.status}</Badge>
          </div>
        ))}
      </div>

      {/* Statement */}
      <div className="card stack sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Statement (90 days)</strong>
          <button className="ghost sm" onClick={loadStatement}>Load</button>
        </div>
        {statement && (
          <div className="stack sm">
            <span className="muted micro">Opening {formatMoney(statement.openingMinor, statement.currency)} · Closing {formatMoney(statement.closingMinor, statement.currency)}</span>
            {statement.lines.slice(-12).reverse().map((l, i) => (
              <div key={i} className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted micro">{new Date(l.date).toLocaleDateString()} · {l.description}</span>
                <span className={l.direction === "credit" ? "amount" : "amount"} style={{ color: l.direction === "credit" ? "var(--ok)" : undefined }}>
                  {l.direction === "credit" ? "+" : "−"}{formatMoney(l.amountMinor, statement.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transfers */}
      <div className="stack sm">
        <strong>Recent transfers</strong>
        {transfers.length === 0 ? (
          <Empty>No bank transfers yet.</Empty>
        ) : (
          <div className="list">
            {transfers.map((t) => (
              <div key={t.id} className="list-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span>{t.direction === "in" ? "Deposit" : `${t.method.toUpperCase()} payout`} · {formatMoney(t.amount_minor, t.currency)}</span>
                  <span className="muted micro">{new Date(t.created_at).toLocaleString()}{t.counterparty ? ` · ${t.counterparty}` : ""}</span>
                </div>
                <Badge kind={statusKind(t.status)}>{t.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
