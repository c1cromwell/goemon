/**
 * Argus Starter — guardian dashboard (Phase 22.0–22.3).
 */
import { useEffect, useState } from "react";
import {
  userApi,
  ApiError,
  type StarterGuardianDashboard,
  type StarterHousehold,
  type StarterReview,
} from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

export function StarterGuardian() {
  const toast = useToast();
  const [household, setHousehold] = useState<StarterHousehold | null | undefined>(undefined);
  const [dashboard, setDashboard] = useState<StarterGuardianDashboard | null>(null);
  const [reviews, setReviews] = useState<StarterReview[]>([]);
  const [householdName, setHouseholdName] = useState("My Household");
  const [teenEmail, setTeenEmail] = useState("");
  const [teenName, setTeenName] = useState("");
  const [teenDob, setTeenDob] = useState("");
  const [dailyLimit, setDailyLimit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const h = await userApi.starterHousehold();
      setHousehold(h.household);
      if (h.household) {
        const [dash, rev] = await Promise.all([userApi.starterDashboard(), userApi.starterReviews()]);
        setDashboard(dash);
        setReviews(rev.reviews);
      } else {
        setDashboard(null);
        setReviews([]);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "TEEN_DISABLED") {
        setHousehold(null);
        setDashboard(null);
      } else {
        setHousehold(null);
      }
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.show(ok);
      await refresh();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Action failed", "bad");
    } finally {
      setBusy(false);
    }
  }

  if (household === undefined) return <Loading />;

  if (household === null && dashboard === null) {
    return (
      <div className="page stack lg">
        <h1>Argus Starter</h1>
        <p className="muted">Family accounts for teens 13+ are not enabled in this environment.</p>
      </div>
    );
  }

  return (
    <div className="page stack lg">
      <div>
        <h1>Argus Starter</h1>
        <p className="muted" style={{ margin: 0 }}>Guardian dashboard — teens, controls, approvals, coach insights.</p>
      </div>

      {!household ? (
        <div className="card stack md">
          <h2 style={{ margin: 0 }}>Set up your household</h2>
          <label className="field">
            <span className="label">Household name</span>
            <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy} onClick={() => run(() => userApi.createStarterHousehold(householdName.trim() || undefined), "Household created")}>
            Create household
          </button>
        </div>
      ) : (
        <>
          <div className="card row spread">
            <div>
              <div className="micro">Household</div>
              <strong>{dashboard?.household.name ?? household.name}</strong>
            </div>
            <Badge kind={dashboard?.pendingApprovals ? "warn" : "ok"}>
              {dashboard?.pendingApprovals ?? 0} pending
            </Badge>
          </div>

          {reviews.length > 0 && (
            <div className="card stack md">
              <h2 style={{ margin: 0 }}>Approval queue</h2>
              {reviews.map((r) => {
                let payload: { amountMinor?: string; merchant?: string } = {};
                try { payload = JSON.parse(r.recommendation); } catch { /* ignore */ }
                return (
                  <div key={r.id} className="card inset stack xs">
                    <div className="muted small">{r.reason}</div>
                    <div>{payload.merchant ?? "Purchase"} · {formatMoney(payload.amountMinor ?? "0", "USD")}</div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn primary" disabled={busy} onClick={() => run(() => userApi.decideStarterReview(r.id, "approve"), "Approved")}>Approve</button>
                      <button className="btn" disabled={busy} onClick={() => run(() => userApi.decideStarterReview(r.id, "reject"), "Denied")}>Deny</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {dashboard?.coachInsights?.length ? (
            <div className="card stack sm">
              <h2 style={{ margin: 0 }}>Coach insights</h2>
              {dashboard.coachInsights.map((i) => (
                <div key={i.id} className="muted small">{i.summary}</div>
              ))}
            </div>
          ) : null}

          <div className="card stack md">
            <h2 style={{ margin: 0 }}>Linked teens</h2>
            {dashboard?.teens.length ? dashboard.teens.map((t) => (
              <div key={t.userId} className="card inset stack xs">
                <div className="row spread">
                  <strong>{t.fullName ?? t.email}</strong>
                  <Badge kind="warn">Minor</Badge>
                </div>
                <div className="row spread">
                  <span>Cash {formatMoney(t.balances.cash, t.balances.currency)}</span>
                  <span>Savings {formatMoney(t.balances.savings, t.balances.currency)}</span>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" disabled={busy} onClick={() => run(() => userApi.issueTeenCard(t.userId), "Teen card issued")}>Issue debit card</button>
                  <button className="btn" disabled={busy} onClick={() => run(() => userApi.freezeTeen(t.userId), "Account frozen")}>Freeze</button>
                  <button className="btn" disabled={busy} onClick={() => run(() => userApi.unfreezeTeen(t.userId), "Account unfrozen")}>Unfreeze</button>
                </div>
                <label className="field">
                  <span className="label">Daily spend limit ($)</span>
                  <input
                    value={dailyLimit[t.userId] ?? "50"}
                    onChange={(e) => setDailyLimit((d) => ({ ...d, [t.userId]: e.target.value }))}
                  />
                </label>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    const dollars = parseFloat(dailyLimit[t.userId] ?? "50");
                    if (!Number.isFinite(dollars)) return toast.show("Enter a valid limit", "bad");
                    run(() => userApi.updateTeenSpendPolicy(t.userId, { dailyLimitMinor: String(Math.round(dollars * 100)) }), "Spend limit updated");
                  }}
                >
                  Save spend limit
                </button>
              </div>
            )) : <Empty>No teens linked yet.</Empty>}
          </div>

          <div className="card stack md">
            <h2 style={{ margin: 0 }}>Add a teen</h2>
            <label className="field"><span className="label">Email</span><input value={teenEmail} onChange={(e) => setTeenEmail(e.target.value)} type="email" /></label>
            <label className="field"><span className="label">Full name</span><input value={teenName} onChange={(e) => setTeenName(e.target.value)} /></label>
            <label className="field"><span className="label">Date of birth</span><input value={teenDob} onChange={(e) => setTeenDob(e.target.value)} type="date" /></label>
            <button className="btn primary" disabled={busy} onClick={() => {
              if (!teenEmail.trim() || !teenName.trim() || !teenDob) return toast.show("All fields required", "bad");
              run(async () => {
                await userApi.addStarterTeen({ email: teenEmail.trim(), fullName: teenName.trim(), dob: teenDob });
                setTeenEmail(""); setTeenName(""); setTeenDob("");
              }, "Teen linked");
            }}>Link teen</button>
          </div>
        </>
      )}
    </div>
  );
}
