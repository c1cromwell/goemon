/**
 * Bills — bill pay (Phase 19.3). Save billers, pay now or schedule (optionally recurring),
 * and cancel a scheduled payment. Payments settle through the bank rail; money renders
 * only from integer minor units.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type BillPayee, type BillPayment } from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function toMinor(dollars: string): string | null {
  const n = parseFloat(dollars);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n * 100));
}
function payKind(s: string): "ok" | "warn" | "bad" {
  if (s === "sent") return "ok";
  if (s === "failed") return "bad";
  return "warn"; // scheduled / canceled
}

export function Bills() {
  const toast = useToast();
  const [payees, setPayees] = useState<BillPayee[] | null>(null);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [newPayee, setNewPayee] = useState("");
  const [category, setCategory] = useState("");
  const [last4, setLast4] = useState("");
  const [payeeId, setPayeeId] = useState("");
  const [amt, setAmt] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "weekly" | "monthly">("none");
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [p, pm] = await Promise.all([userApi.billPayees(), userApi.billPayments()]);
      setPayees(p.payees);
      setPayments(pm.payments);
      if (!payeeId && p.payees[0]) setPayeeId(p.payees[0].id);
    } catch {
      setPayees([]);
    }
  }
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); await refresh(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(false); }
  }

  function addPayee() {
    if (!newPayee.trim()) return toast.show("Enter a payee name", "bad");
    run(async () => { await userApi.addBillPayee({ name: newPayee.trim(), category: category || undefined, last4: last4 || undefined }); setNewPayee(""); setCategory(""); setLast4(""); }, "Payee added");
  }
  function pay() {
    const minor = toMinor(amt);
    if (!payeeId) return toast.show("Add or select a payee", "bad");
    if (!minor) return toast.show("Enter a positive amount", "bad");
    const scheduled = scheduledFor ? new Date(scheduledFor).toISOString() : undefined;
    run(async () => {
      await userApi.payBill({ payeeId, amountMinor: minor, recurrence, scheduledFor: scheduled }, newIdempotencyKey());
      setAmt(""); setScheduledFor("");
    }, scheduled ? "Payment scheduled" : "Bill paid");
  }

  if (payees === null) return <Loading />;

  return (
    <div className="page stack lg">
      <div>
        <h1>Bills</h1>
        <p className="muted small" style={{ margin: 0 }}>Pay billers now or schedule recurring payments.</p>
      </div>

      {/* Add payee */}
      <div className="card stack sm">
        <strong>Add a payee</strong>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Biller name" value={newPayee} onChange={(e) => setNewPayee(e.target.value)} aria-label="Biller name" />
          <input placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" />
          <input placeholder="Acct last 4" value={last4} onChange={(e) => setLast4(e.target.value)} aria-label="Account last 4" style={{ width: 90 }} maxLength={4} />
          <button className="ghost sm" onClick={addPayee} disabled={busy}>Add</button>
        </div>
      </div>

      {/* Pay */}
      {payees.length > 0 && (
        <div className="card stack sm">
          <strong>Pay a bill</strong>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={payeeId} onChange={(e) => setPayeeId(e.target.value)} aria-label="Payee">
              {payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="number" min={0} step="0.01" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" style={{ width: 110 }} />
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)} aria-label="Recurrence">
              <option value="none">One-time</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} aria-label="Schedule for" />
            <button onClick={pay} disabled={busy}>{scheduledFor ? "Schedule" : "Pay now"}</button>
          </div>
        </div>
      )}

      {/* Payments */}
      <div className="stack sm">
        <strong>Payments</strong>
        {payments.length === 0 ? (
          <Empty>No bill payments yet.</Empty>
        ) : (
          <div className="list">
            {payments.map((p) => {
              const payee = payees.find((x) => x.id === p.payee_id);
              return (
                <div key={p.id} className="list-row">
                  <div className="stack" style={{ gap: 2 }}>
                    <span>{payee?.name ?? "Bill"} · {formatMoney(p.amount_minor, p.currency)}{p.recurrence !== "none" ? ` · ${p.recurrence}` : ""}</span>
                    <span className="muted micro">
                      {p.status === "scheduled" ? `due ${new Date(p.scheduled_for).toLocaleDateString()}` : new Date(p.sent_at ?? p.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {p.status === "scheduled" && (
                      <button className="ghost sm" onClick={() => run(() => userApi.cancelBill(p.id), "Payment canceled")} disabled={busy}>Cancel</button>
                    )}
                    <Badge kind={payKind(p.status)}>{p.status}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
