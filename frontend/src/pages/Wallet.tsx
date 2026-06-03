/**
 * On-chain wallet — Hedera USDC. Conditional: shows "not enabled" when the server
 * has Hedera off (NOT_IMPLEMENTED), a provisioning prompt when enabled but no
 * account exists (404), else the account, balance, Receive (QR) and Send.
 *
 * NOTE: real on-device signing of the transfer lands with the Phase 10 iOS
 * wallet; here Send calls the server-side transfer path (clearly labeled).
 */
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  userApi,
  newIdempotencyKey,
  ApiError,
  type HederaAccount,
  type HederaBalance,
} from "../api/client";
import { decimalToMinor, formatMoney } from "../lib/money";
import { useToast } from "../components/Toast";
import { Loading } from "../components/ui";

type State =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "none" }
  | { kind: "ready"; account: HederaAccount; balance: HederaBalance | null };

export function Wallet() {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [toAccount, setToAccount] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    try {
      const account = await userApi.hederaAccount();
      const balance = await userApi.hederaBalance().catch(() => null);
      setState({ kind: "ready", account, balance });
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_IMPLEMENTED") setState({ kind: "disabled" });
      else if (e instanceof ApiError && e.status === 404) setState({ kind: "none" });
      else setState({ kind: "disabled" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function provision() {
    setBusy(true);
    try {
      await userApi.createHederaAccount();
      toast.show("On-chain account created");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not provision account", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const micro = decimalToMinor(amount, 6);
    if (!toAccount.trim()) return toast.show("Enter a recipient account id", "bad");
    if (micro === null || BigInt(micro) <= 0n) return toast.show("Enter a valid amount", "bad");
    setBusy(true);
    try {
      await userApi.hederaTransfer({ toHederaAccountId: toAccount.trim(), amountMicro: micro }, newIdempotencyKey());
      toast.show("Transfer submitted");
      setAmount("");
      setToAccount("");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Transfer failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") return <div className="page"><Loading /></div>;

  if (state.kind === "disabled") {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <h1>On-chain wallet</h1>
        <div className="card">
          <h2>Not enabled</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            This server runs without the Hedera track. Set <span className="code">HEDERA_ENABLED=true</span> to use on-chain USDC.
          </p>
        </div>
      </div>
    );
  }

  if (state.kind === "none") {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
        <h1>On-chain wallet</h1>
        <div className="card">
          <h2>Provision your account</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Create a Hedera account to hold on-chain USDC. The network fee is sponsored.
          </p>
          <button disabled={busy} onClick={provision}>{busy ? "Creating…" : "Create on-chain account"}</button>
        </div>
      </div>
    );
  }

  const { account, balance } = state;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <h1>On-chain wallet</h1>

      <div className="card accent">
        <div className="metric">
          <div className="label">USDC balance</div>
          <div className="value">
            {balance ? <span className="amount">{formatMoney(balance.onChain.usdcMicro, "USDC", { trim: true })}</span> : "—"}
          </div>
        </div>
        <div className="micro" style={{ marginTop: 8 }}>{account.network} · {account.usdcAssociated ? "USDC associated" : "USDC not associated"}</div>
      </div>

      <div className="card">
        <h2>Receive</h2>
        <div className="row" style={{ alignItems: "center", gap: 16 }}>
          <div className="qr-wrap">
            <QRCodeSVG value={account.hederaAccountId} size={108} />
          </div>
          <div className="grow">
            <div className="micro">Account id</div>
            <div className="code" style={{ marginTop: 4 }}>{account.hederaAccountId}</div>
            <button
              className="ghost sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                navigator.clipboard?.writeText(account.hederaAccountId);
                toast.show("Copied");
              }}
            >
              Copy
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Send USDC</h2>
        <div className="stack sm">
          <div className="field">
            <label>To account id</label>
            <input value={toAccount} onChange={(e) => setToAccount(e.target.value)} placeholder="0.0.xxxxx" />
          </div>
          <div className="field">
            <label>Amount (USDC)</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <button style={{ marginTop: 12 }} disabled={busy} onClick={send}>{busy ? "Submitting…" : "Send"}</button>
        <p className="micro" style={{ marginTop: 10 }}>
          On-device signing arrives with the iOS wallet (Phase 10).
        </p>
      </div>
    </div>
  );
}
