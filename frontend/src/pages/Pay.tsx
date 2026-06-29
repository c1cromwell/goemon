/**
 * Goeman Pay — merchant wedge (Phase 21): register merchant, request payment, pay via escrow.
 * Zero interchange; programmable rail vs card networks.
 */
import { useEffect, useState } from "react";
import { userApi, newIdempotencyKey, ApiError, type PayMerchant, type PaymentIntent } from "../api/client";
import { formatMoney, decimalToMinor } from "../lib/money";
import { getWalletDid, signPresentation } from "../lib/deviceWallet";
import { useToast } from "../components/Toast";
import { Empty, Loading, Badge } from "../components/ui";

export function Pay() {
  const toast = useToast();
  const [merchants, setMerchants] = useState<PayMerchant[] | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [merchantName, setMerchantName] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [payIntentId, setPayIntentId] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [m, mi, pi] = await Promise.all([
        userApi.payMerchants(),
        userApi.payIntents("merchant"),
        userApi.payIntents("payer"),
      ]);
      setMerchants(m);
      setIntents([...mi, ...pi.filter((p) => !mi.some((x) => x.id === p.id))]);
      setDisabled(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "PAY_DISABLED") {
        setDisabled(true);
        setMerchants([]);
        setIntents([]);
      } else {
        setMerchants([]);
        setIntents([]);
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function registerMerchant() {
    if (!merchantName.trim()) return;
    setBusy(true);
    try {
      await userApi.createPayMerchant(merchantName.trim());
      setMerchantName("");
      toast.show("Merchant registered");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not register", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function createIntent() {
    const minor = decimalToMinor(amount, 6);
    if (!selectedMerchant || !minor || BigInt(minor) <= 0n) {
      toast.show("Select merchant and enter amount", "bad");
      return;
    }
    setBusy(true);
    try {
      await userApi.createPayIntent(
        { merchantId: selectedMerchant, amountMinor: minor, currency: "USDC", memo: "Payment request" },
        newIdempotencyKey()
      );
      setAmount("");
      toast.show("Payment intent created");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not create intent", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function payIntent() {
    if (!payIntentId.trim()) return;
    setBusy(true);
    try {
      await userApi.payIntent(payIntentId.trim(), newIdempotencyKey());
      setPayIntentId("");
      toast.show("Paid — funds held in escrow");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Payment failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function capture(id: string) {
    try {
      await userApi.capturePayIntent(id);
      toast.show("Captured to merchant");
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Capture failed", "bad");
    }
  }

  /**
   * Pay with Goeman — login-less, via a Verifiable Credential.
   *
   * One-time device link (uses your session): make sure this device's wallet key
   * is bound to your VC. Then the actual payment carries NO session — the wallet
   * signs a VP over a one-time checkout challenge and the backend authorizes off
   * the verified credential, not a login.
   */
  async function payWithGoeman(i: PaymentIntent) {
    setBusy(true);
    try {
      // 1) one-time device link (session): ensure a VC exists + bind this wallet key
      const walletDid = await getWalletDid();
      let vcJwt: string;
      try {
        vcJwt = (await userApi.credential()).jwt;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          await userApi.issueCredential();
          vcJwt = (await userApi.credential()).jwt;
        } else throw e;
      }
      await userApi.bindWallet(walletDid);

      // 2) login-less from here: challenge → sign VP on device → pay (no token sent)
      const ch = await userApi.checkoutChallenge(i.id);
      const vpJwt = await signPresentation({ nonce: ch.nonce, vcJwt, aud: ch.aud });
      const res = await userApi.payWithPresentation(i.id, vpJwt);
      toast.show(`Paid ${formatMoney(i.amountMinor, i.currency)} with your credential — no login (${res.authorizedVia})`);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Credential payment failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (merchants === null && !disabled) return <Loading />;

  if (disabled) {
    return (
      <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
        <h1>Goeman Pay</h1>
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            Merchant rail is disabled. Set <span className="code">GOEMAN_PAY_ENABLED=true</span> for demo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 640 }}>
      <div>
        <h1>Goeman Pay</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Escrow-protected merchant payments — zero interchange. Register a merchant, request USDC, capture when delivered.
        </p>
      </div>

      <div className="card stack sm">
        <h2>Your merchants</h2>
        {merchants!.length === 0 ? (
          <Empty>No merchants — register one below (Tier 2).</Empty>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {merchants!.map((m) => (
              <li key={m.id}>{m.name} <span className="muted micro">({m.id.slice(0, 8)}…)</span></li>
            ))}
          </ul>
        )}
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input placeholder="Merchant name" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
          <button disabled={busy} onClick={registerMerchant}>Register</button>
        </div>
      </div>

      <div className="card stack sm">
        <h2>Request payment</h2>
        <select value={selectedMerchant} onChange={(e) => setSelectedMerchant(e.target.value)} aria-label="Merchant">
          <option value="">Select merchant</option>
          {merchants!.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <input inputMode="decimal" placeholder="Amount USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button disabled={busy} onClick={createIntent}>Create intent</button>
      </div>

      <div className="card stack sm">
        <h2>Pay an intent</h2>
        <input placeholder="Intent id" value={payIntentId} onChange={(e) => setPayIntentId(e.target.value)} />
        <button disabled={busy} onClick={payIntent}>Pay (escrow hold)</button>
        <p className="muted micro" style={{ margin: 0 }}>
          Or use <strong>Pay with Goeman</strong> on any unpaid intent below — your device credential
          authorizes the payment with no login or redirect.
        </p>
      </div>

      <div className="card">
        <h2>Intents</h2>
        {intents.length === 0 ? (
          <Empty>No payment intents yet.</Empty>
        ) : (
          <div className="list">
            {intents.map((i) => (
              <div key={i.id} className="list-row">
                <div>
                  <span>{formatMoney(i.amountMinor, i.currency)} · {i.merchantName}</span>
                  <div className="micro muted">{i.id.slice(0, 8)}… · {i.status}</div>
                </div>
                {i.status === "held" ? (
                  <button className="ghost sm" onClick={() => capture(i.id)}>Capture</button>
                ) : i.status === "requires_payment" ? (
                  <button className="sm" disabled={busy} onClick={() => payWithGoeman(i)} title="Pay with your Verifiable Credential — no login">
                    Pay with Goeman
                  </button>
                ) : (
                  <Badge kind={i.status === "settled" ? "ok" : "warn"}>{i.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
