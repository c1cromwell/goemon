/**
 * Requests — P2P request-to-pay (X-Money response F3). Ask for money; pay requests
 * you've received. Settles on the native rail (non-custodial) — you hold the funds
 * until you choose to pay. Simple: one create form, a sent/received toggle.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type PaymentRequest } from "../api/client";
import { formatMoney, decimalToMinor } from "../lib/money";
import { Loading, Empty, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function statusKind(s: string): "ok" | "warn" | "bad" {
  if (s === "fulfilled") return "ok";
  if (s === "declined" || s === "canceled" || s === "expired") return "bad";
  return "warn";
}

export function Requests() {
  const toast = useToast();
  const [tab, setTab] = useState<"received" | "sent">("received");
  const [list, setList] = useState<PaymentRequest[] | null>(null);
  const [from, setFrom] = useState("");
  const [amt, setAmt] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setList(await userApi.payRequests(tab)); } catch { setList([]); }
  }
  useEffect(() => { void refresh(); }, [tab]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); await refresh(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(false); }
  }

  function create() {
    const minor = decimalToMinor(amt, 2);
    if (!minor || BigInt(minor) <= 0n) return toast.show("Enter an amount", "bad");
    run(async () => { await userApi.createPayRequest({ fromUserId: from.trim() || undefined, amountMinor: minor, memo: memo.trim() || undefined }); setAmt(""); setMemo(""); setFrom(""); setTab("sent"); }, "Request sent");
  }

  if (list === null) return <Loading />;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Requests</h1>
        <p className="muted small" style={{ margin: 0 }}>Ask for money or pay a request — instant, non-custodial, on your own rail.</p>
      </div>

      {/* Create */}
      <div className="card stack sm">
        <strong>Request money</strong>
        <input inputMode="decimal" placeholder="Amount (USD)" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" />
        <input placeholder="From (user id) — leave blank for an open request" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From user" />
        <input placeholder="What's it for? (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" maxLength={280} />
        <button disabled={busy} onClick={create}>Send request</button>
      </div>

      {/* Toggle */}
      <div className="row" style={{ gap: 8 }}>
        <button className={tab === "received" ? "grow" : "ghost grow"} onClick={() => setTab("received")}>Received</button>
        <button className={tab === "sent" ? "grow" : "ghost grow"} onClick={() => setTab("sent")}>Sent</button>
      </div>

      {/* List */}
      <div className="card">
        {list.length === 0 ? (
          <Empty>{tab === "received" ? "No requests to pay." : "No requests sent."}</Empty>
        ) : (
          <div className="list">
            {list.map((r) => (
              <div key={r.id} className="list-row">
                <div className="stack" style={{ gap: 2 }}>
                  <span>{formatMoney(r.amountMinor, r.currency)}{r.memo ? ` · ${r.memo}` : ""}</span>
                  <span className="muted micro">{new Date(r.createdAt).toLocaleDateString()} · {r.id.slice(0, 8)}…</span>
                </div>
                {r.status === "requested" ? (
                  <div className="row" style={{ gap: 6 }}>
                    {tab === "received" ? (
                      <>
                        <button className="sm" disabled={busy} onClick={() => run(() => userApi.fulfillPayRequest(r.id, newIdempotencyKey()), "Paid")}>Pay</button>
                        <button className="ghost sm" disabled={busy} onClick={() => run(() => userApi.declinePayRequest(r.id), "Declined")}>Decline</button>
                      </>
                    ) : (
                      <button className="ghost sm" disabled={busy} onClick={() => run(() => userApi.cancelPayRequest(r.id), "Canceled")}>Cancel</button>
                    )}
                  </div>
                ) : (
                  <Badge kind={statusKind(r.status)}>{r.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
