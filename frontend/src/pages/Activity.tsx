/**
 * Activity — a unified timeline composed from ledger transactions and SmartChat
 * operation tokens (there is no single user-facing audit endpoint; we merge the
 * two sources by timestamp). Read-only.
 */
import { useEffect, useState } from "react";
import { userApi, type Transaction, type OperationTokenView } from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Empty } from "../components/ui";

interface Item {
  id: string;
  at: number;
  kind: "txn" | "op";
  title: string;
  sub: string;
  amount?: { minor: string; currency: string; negative: boolean };
  status?: string;
}

export function Activity() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    (async () => {
      const [txns, tokens] = await Promise.all([
        userApi.transactions(100).catch(() => [] as Transaction[]),
        userApi.operationTokens(50).catch(() => [] as OperationTokenView[]),
      ]);
      const merged: Item[] = [
        ...txns.map((t): Item => ({
          id: `txn:${t.id}`,
          at: new Date(t.createdAt).getTime(),
          kind: "txn",
          title: t.description || labelFor(t.type),
          sub: new Date(t.createdAt).toLocaleString(),
          amount: {
            minor: t.amountMinor,
            currency: t.currency,
            negative: t.type === "debit" || t.type === "transfer_out",
          },
        })),
        ...tokens.map((o): Item => ({
          id: `op:${o.id}`,
          at: new Date(o.createdAt).getTime(),
          kind: "op",
          title: `SmartChat · ${o.operation}`,
          sub: new Date(o.createdAt).toLocaleString(),
          status: o.status,
        })),
      ].sort((a, b) => b.at - a.at);
      setItems(merged);
    })();
  }, []);

  if (items === null) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
      <div>
        <h1>Activity</h1>
        <p className="muted small" style={{ margin: 0 }}>Transfers and agent operations.</p>
      </div>

      {items.length === 0 ? (
        <Empty>Nothing here yet.</Empty>
      ) : (
        <div className="card">
          {items.map((it) => (
            <div className="list-row" key={it.id}>
              <div className="lead">{it.kind === "op" ? "AI" : it.title[0]?.toUpperCase()}</div>
              <div className="grow">
                <div className="title">{it.title}</div>
                <div className="micro">{it.sub}</div>
              </div>
              {it.amount ? (
                <div className="amount" style={{ color: it.amount.negative ? "var(--text)" : "var(--accent)" }}>
                  {it.amount.negative ? "−" : "+"}
                  {formatMoney(it.amount.minor, it.amount.currency).replace(/^[+-]/, "")}
                </div>
              ) : it.status ? (
                <span className={`badge ${it.status === "executed" ? "ok" : it.status === "failed" ? "bad" : ""}`}>{it.status}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
