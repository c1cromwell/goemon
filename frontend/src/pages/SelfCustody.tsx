/**
 * Self-custody — the anti-deplatforming proof (X-Money response F2). Shows what's
 * truly yours (non-custodial wallet, on-chain assets — no one can freeze) vs. the
 * custodial ledger balance (disclosed honestly), the guarantee, and a one-tap export.
 * "X can freeze your money — we can't; you hold the keys."
 */
import { useEffect, useState } from "react";
import { userApi, ApiError, type SelfCustodyReport } from "../api/client";
import { formatMoney } from "../lib/money";
import { Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

export function SelfCustody() {
  const toast = useToast();
  const [report, setReport] = useState<SelfCustodyReport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    userApi.selfCustody().then(setReport).catch(() => setReport(null));
  }, []);

  async function exportData() {
    setBusy(true);
    try {
      const data = await userApi.selfCustodyExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "goeman-self-custody-export.json"; a.click();
      URL.revokeObjectURL(url);
      toast.show("Exported — your keys, identity, and holdings, signed and portable");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Export failed", "bad");
    } finally { setBusy(false); }
  }

  if (report === null) return <Loading />;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 560 }}>
      <div>
        <h1>Self-custody</h1>
        <p className="muted small" style={{ margin: 0 }}>You hold the keys. No platform — including us — can freeze or seize what's self-custodied.</p>
      </div>

      {/* Yours, unfreezable */}
      <div className="card stack sm">
        <div className="row" style={{ justifyContent: "space-between" }}><strong>Yours — no one can freeze</strong><Badge kind="ok">self-custodied</Badge></div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted small">Wallet key</span>
          <span className="micro">on your device · server holds no key</span>
        </div>
        {report.selfCustodied.walletDid && <span className="muted micro" style={{ wordBreak: "break-all" }}>{report.selfCustodied.walletDid}</span>}
        {report.selfCustodied.hedera && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">On-chain account</span>
            <span className="micro">{report.selfCustodied.hedera.accountId} · {report.selfCustodied.hedera.serverHoldsKey ? "key wrapped at rest" : "device-held key"}</span>
          </div>
        )}
      </div>

      {/* Custodial, disclosed honestly */}
      <div className="card stack sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Custodial balance</strong>
          <Badge kind={report.frozen ? "bad" : "warn"}>{report.frozen ? "held for review" : "custodial"}</Badge>
        </div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{formatMoney(report.custodial.cashMinor, report.custodial.currency)}</div>
        <p className="muted micro" style={{ margin: 0 }}>{report.custodial.note}</p>
      </div>

      {/* Guarantee */}
      <div className="card stack sm">
        <strong>Our guarantee</strong>
        {report.guarantee.map((g, i) => (
          <div key={i} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <span style={{ color: "var(--ok)" }}>✓</span>
            <span className="small">{g}</span>
          </div>
        ))}
      </div>

      {/* Export */}
      <div className="card stack sm">
        <strong>Right to exit</strong>
        <p className="muted micro" style={{ margin: 0 }}>Download a signed, portable record of your identity, keys reference, and holdings — leave anytime, no lock-in.</p>
        <button disabled={busy} onClick={exportData}>Export my data</button>
      </div>
    </div>
  );
}
