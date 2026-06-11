/**
 * Escrow — hold a payment to someone, then release it, get it refunded, or dispute
 * it (docs/business/PAYMENT-NETWORK-STRATEGY.md §4 — the chargeback substitute).
 *
 * As payer you can Release (pay the payee) or Dispute; as payee you can Refund
 * (return it) or Dispute. A disputed escrow is resolved by a mediator (admin).
 * Money is rendered only from integer minor units.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { userApi, newIdempotencyKey, ApiError, type EscrowView } from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function statusKind(s: EscrowView["status"]): "ok" | "warn" | "bad" {
  if (s === "disputed") return "bad";
  if (s === "held") return "warn";
  return "ok";
}

export function Escrow() {
  const { me } = useAuth();
  const toast = useToast();
  const [escrows, setEscrows] = useState<EscrowView[] | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "USDC">("USD");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setEscrows(await userApi.escrows());
    } catch {
      setEscrows([]);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function send() {
    const dollars = parseFloat(amount);
    if (!email || !Number.isFinite(dollars) || dollars <= 0) {
      toast.show("Enter a payee email and a positive amount", "bad");
      return;
    }
    setBusy(true);
    try {
      // USD → cents; USDC → micro-units (6dp).
      const minor = String(Math.round(dollars * (currency === "USDC" ? 1_000_000 : 100)));
      await userApi.escrowHold({ payeeEmail: email, amountMinor: minor, currency, memo: memo || undefined }, newIdempotencyKey());
      toast.show(`Funds held in escrow (${currency})`);
      setEmail("");
      setAmount("");
      setMemo("");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not hold funds", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.show(ok);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "bad");
    }
  }

  function dispute(id: string) {
    const reason = window.prompt("Reason for dispute?");
    if (reason) act(() => userApi.escrowDispute(id, reason), "Dispute opened");
  }

  if (escrows === null) return <Loading />;

  return (
    <div className="page stack lg">
      <div>
        <h1>Escrow</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Hold a payment until it's released — the dispute-protected way to pay.
        </p>
      </div>

      {/* New hold */}
      <div className="card stack sm">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Payee email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Payee email" />
          <input type="number" min={0} step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" style={{ width: 110 }} />
          <select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "USDC")} aria-label="Currency">
            <option value="USD">USD</option>
            <option value="USDC">USDC</option>
          </select>
          <input placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" />
          <button onClick={send} disabled={busy}>{busy ? "Holding…" : "Hold in escrow"}</button>
        </div>
      </div>

      {/* List */}
      {escrows.length === 0 ? (
        <Empty>No escrow payments yet.</Empty>
      ) : (
        <div className="list">
          {escrows.map((e) => {
            const isPayer = e.payerId === me?.id;
            const counterparty = isPayer ? e.payeeEmail : e.payerEmail;
            return (
              <div key={e.id} className="list-row" style={{ alignItems: "flex-start" }}>
                <div className="stack" style={{ gap: 2 }}>
                  <span>
                    {formatMoney(e.amountMinor, e.currency)} · {isPayer ? "to" : "from"} {counterparty ?? "—"}
                  </span>
                  <span className="muted micro">
                    {e.memo ? `${e.memo} · ` : ""}
                    {e.status === "disputed" && e.disputeReason ? `dispute: ${e.disputeReason}` : new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {e.status === "held" && isPayer && (
                    <button className="ghost sm" onClick={() => act(() => userApi.escrowRelease(e.id), "Released to payee")}>Release</button>
                  )}
                  {e.status === "held" && !isPayer && (
                    <button className="ghost sm" onClick={() => act(() => userApi.escrowRefund(e.id), "Refunded to payer")}>Refund</button>
                  )}
                  {e.status === "held" && (
                    <button className="ghost sm" onClick={() => dispute(e.id)}>Dispute</button>
                  )}
                  <Badge kind={statusKind(e.status)}>{e.status}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
