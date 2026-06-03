/**
 * Credentials — the user's Verifiable Credential (W3C VC JWT). Issue one, view
 * its subject DID + allowed operations, and revoke it. The JWT itself is the
 * holder's to present; we show it collapsed.
 */
import { useCallback, useEffect, useState } from "react";
import { userApi, ApiError, type Credential } from "../api/client";
import { useToast } from "../components/Toast";
import { Loading } from "../components/ui";

export function Credentials() {
  const toast = useToast();
  const [cred, setCred] = useState<Credential | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showJwt, setShowJwt] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCred(await userApi.credential());
    } catch (e) {
      // NOT_FOUND simply means no credential yet.
      if (e instanceof ApiError && e.status === 404) setCred(null);
      else toast.show(e instanceof Error ? e.message : "Could not load credential", "bad");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue() {
    setBusy(true);
    try {
      await userApi.issueCredential();
      toast.show("Credential issued");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Issue failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!cred) return;
    setBusy(true);
    try {
      await userApi.revokeCredential(cred.id, "user_requested");
      toast.show("Credential revoked");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Revoke failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="page"><Loading /></div>;

  return (
    <div className="page stack lg narrow" style={{ maxWidth: 620 }}>
      <div>
        <h1>Credentials</h1>
        <p className="muted small" style={{ margin: 0 }}>Your verifiable credential for agent access.</p>
      </div>

      {!cred ? (
        <div className="card">
          <h2>No credential yet</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Issue a verifiable credential to let connected agents act on your behalf under scoped permissions.
          </p>
          <button disabled={busy} onClick={issue}>{busy ? "Issuing…" : "Issue credential"}</button>
        </div>
      ) : (
        <div className="card">
          <div className="spread">
            <h2 style={{ margin: 0 }}>Verifiable credential</h2>
            <span className={`badge ${cred.revoked ? "bad" : "ok"}`}>{cred.revoked ? "Revoked" : "Active"}</span>
          </div>
          <div className="kv"><span className="k">Subject DID</span><span className="code">{cred.didSubject}</span></div>
          <div className="kv"><span className="k">Allowed operations</span><span>{cred.allowedOps.join(", ")}</span></div>
          <div className="kv"><span className="k">Issued</span><span>{new Date(cred.issuedAt).toLocaleDateString()}</span></div>
          <div className="kv"><span className="k">Expires</span><span>{new Date(cred.expiresAt).toLocaleDateString()}</span></div>
          {cred.revoked && cred.revokeReason ? (
            <div className="kv"><span className="k">Reason</span><span>{cred.revokeReason}</span></div>
          ) : null}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="ghost sm" onClick={() => setShowJwt((s) => !s)}>{showJwt ? "Hide" : "Show"} JWT</button>
            {!cred.revoked ? <button className="danger sm" disabled={busy} onClick={revoke}>Revoke</button> : null}
          </div>
          {showJwt ? (
            <div className="detail" style={{ marginTop: 12 }}>
              <pre>{cred.jwt}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
