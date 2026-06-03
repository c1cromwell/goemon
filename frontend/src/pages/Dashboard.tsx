/**
 * Home — the user's money at a glance. Ledger USD cash + savings, the quiet tier
 * ladder, one primary action, a compact on-chain USDC card (only when Hedera is
 * provisioned), and a short activity preview.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  userApi,
  type Balances,
  type Transaction,
  type HederaBalance,
} from "../api/client";
import { formatMoney } from "../lib/money";
import { TierLadder } from "../components/TierLadder";
import { Loading, Money } from "../components/ui";
import { TARGET_TIER } from "../lib/tiers";

export function Dashboard() {
  const { me, tier } = useAuth();
  const navigate = useNavigate();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [onChain, setOnChain] = useState<HederaBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [b, t] = await Promise.all([
        userApi.balance().catch(() => null),
        userApi.transactions(5).catch(() => []),
      ]);
      // On-chain block is optional — only present if Hedera is enabled+provisioned.
      const oc = await userApi.hederaBalance().catch(() => null);
      if (!active) return;
      setBalances(b);
      setTxns(t);
      setOnChain(oc);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <div className="page"><Loading /></div>;

  const belowTarget = tier < TARGET_TIER;
  const firstName = (me?.fullName ?? me?.email ?? "").split(/[ @]/)[0];

  return (
    <div className="page stack lg">
      <div className="spread">
        <div>
          <h1>{greeting()}{firstName ? `, ${firstName}` : ""}</h1>
          <p className="muted small" style={{ margin: 0 }}>Here's your money today.</p>
        </div>
        <TierLadder tier={tier} />
      </div>

      {/* Hero balance + one primary action */}
      <div className="card accent pad-lg">
        <div className="metric">
          <div className="label">Available cash</div>
          <div className="value lg">
            {balances ? <Money minor={balances.cash.amount} currency={balances.cash.currency} /> : "—"}
          </div>
        </div>
        <div className="row wrap" style={{ marginTop: 18 }}>
          {belowTarget ? (
            <button className="lg" onClick={() => navigate("/onboarding")}>
              Verify your identity
            </button>
          ) : (
            <button className="lg" onClick={() => navigate("/agent")}>
              Send or ask BankAI
            </button>
          )}
          <button className="ghost" onClick={() => navigate("/invest")}>Invest</button>
          <button className="ghost" onClick={() => navigate("/collect")}>Collect</button>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Savings</h2>
          <div className="metric">
            <div className="value">
              {balances ? <Money minor={balances.savings.amount} currency={balances.savings.currency} /> : "—"}
            </div>
          </div>
        </div>

        {onChain ? (
          <div className="card tappable" onClick={() => navigate("/wallet")}>
            <h2>On-chain USDC</h2>
            <div className="metric">
              <div className="value">
                <Money minor={onChain.onChain.usdcMicro} currency="USDC" trim />
              </div>
            </div>
            <p className="micro" style={{ marginTop: 10 }}>Receive · Send →</p>
          </div>
        ) : (
          <div className="card">
            <h2>Tier progress</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              {belowTarget
                ? "Verify your identity to unlock transfers and SmartChat."
                : "You're verified for transfers and SmartChat."}
            </p>
            <button className="ghost sm" onClick={() => navigate("/onboarding")}>View tiers</button>
          </div>
        )}
      </div>

      {/* Activity preview */}
      <div className="card">
        <div className="spread" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Recent activity</h2>
          <button className="link" onClick={() => navigate("/activity")}>View all</button>
        </div>
        {txns.length === 0 ? (
          <p className="muted small">No transactions yet.</p>
        ) : (
          txns.map((t) => {
            const negative = t.type === "debit" || t.type === "transfer_out";
            return (
              <div className="list-row" key={t.id}>
                <div className="lead">{(t.description?.[0] ?? t.type[0] ?? "•").toUpperCase()}</div>
                <div className="grow">
                  <div className="title">{t.description || labelFor(t.type)}</div>
                  <div className="micro">{new Date(t.createdAt).toLocaleString()}</div>
                </div>
                <div className={`amount ${negative ? "" : ""}`} style={{ color: negative ? "var(--text)" : "var(--accent)" }}>
                  {negative ? "−" : "+"}
                  {formatMoney(t.amountMinor, t.currency).replace(/^[+-]/, "")}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function labelFor(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
