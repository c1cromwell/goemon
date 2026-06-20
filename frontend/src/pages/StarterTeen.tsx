/**
 * Argus Starter — teen view (Phase 22.2–22.3): savings, quests, streaks, coach.
 */
import { useEffect, useState } from "react";
import { userApi, ApiError, newIdempotencyKey, type GamificationState, type StarterCoachDashboard, type StarterSavingsOverview } from "../api/client";
import { formatMoney } from "../lib/money";
import { ProgressRing } from "../components/ProgressRing";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

export function StarterTeen() {
  const toast = useToast();
  const [savings, setSavings] = useState<StarterSavingsOverview | null>(null);
  const [game, setGame] = useState<GamificationState | null>(null);
  const [coach, setCoach] = useState<StarterCoachDashboard | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [saveAmt, setSaveAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);

  async function refresh() {
    try {
      const [s, g, c] = await Promise.all([userApi.starterSavings(), userApi.starterGamification(), userApi.starterCoach()]);
      setSavings(s);
      setGame(g);
      setCoach(c);
    } catch (e) {
      if (e instanceof ApiError && (e.code === "TEEN_DISABLED" || e.code === "FORBIDDEN")) setDisabled(true);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.show(ok); await refresh(); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : "Action failed", "bad"); }
    finally { setBusy(false); }
  }

  if (disabled) {
    return (
      <div className="page stack lg">
        <h1>Argus Starter</h1>
        <p className="muted">This view is for linked teen accounts. Sign in as a minor or enable Starter in the backend.</p>
      </div>
    );
  }

  if (!savings || !game || !coach) return <Loading />;

  const streak = game.streaks.find((s) => s.streakType === "check_in")?.currentCount ?? 0;

  return (
    <div className="page stack lg">
      <div className="row spread">
        <div>
          <h1 style={{ margin: 0 }}>Your Starter</h1>
          <p className="muted" style={{ margin: 0 }}>{coach.nudge}</p>
        </div>
        <Badge kind="ok">{streak} day streak</Badge>
      </div>

      <div className="card row spread">
        <div>
          <div className="micro">Net worth</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{formatMoney(game.netWorth.totalMinor, "USD")}</div>
          <div className="muted small">Cash {formatMoney(game.netWorth.cashMinor, "USD")} · Savings {formatMoney(game.netWorth.savingsMinor, "USD")}</div>
        </div>
        <ProgressRing percent={Math.min(100, streak * 5)} label="Streak" />
      </div>

      <div className="card stack md">
        <h2 style={{ margin: 0 }}>Quests</h2>
        {game.quests.map((q) => (
          <div key={q.id} className="row spread">
            <span>{q.title}</span>
            <Badge kind={q.status === "completed" ? "ok" : "warn"}>{q.status}</Badge>
          </div>
        ))}
        <button className="btn" disabled={busy} onClick={() => run(() => userApi.starterCheckIn(), "Checked in")}>Daily check-in</button>
      </div>

      <div className="card stack md">
        <h2 style={{ margin: 0 }}>Savings goals</h2>
        {savings.goals.length ? savings.goals.map((g) => {
          const pct = Number(g.target_minor) > 0 ? Math.min(100, (Number(g.allocated_minor) / Number(g.target_minor)) * 100) : 0;
          return (
            <div key={g.id} className="card inset stack xs">
              <div className="row spread"><strong>{g.name}</strong><span>{Math.round(pct)}%</span></div>
              <ProgressRing percent={pct} label={g.name} />
            </div>
          );
        }) : <Empty>No goals yet.</Empty>}
        <label className="field"><span className="label">Goal name</span><input value={goalName} onChange={(e) => setGoalName(e.target.value)} /></label>
        <label className="field"><span className="label">Target ($)</span><input value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} /></label>
        <button className="btn" disabled={busy} onClick={() => {
          const t = parseFloat(goalTarget);
          if (!goalName.trim() || !Number.isFinite(t) || t <= 0) return toast.show("Enter goal name and target", "bad");
          run(() => userApi.createSavingsGoal(goalName.trim(), String(Math.round(t * 100))), "Goal created");
        }}>Create goal</button>
        <label className="field"><span className="label">Save amount ($)</span><input value={saveAmt} onChange={(e) => setSaveAmt(e.target.value)} /></label>
        <button className="btn primary" disabled={busy} onClick={() => {
          const a = parseFloat(saveAmt);
          if (!Number.isFinite(a) || a <= 0) return toast.show("Enter amount", "bad");
          run(() => userApi.depositSavings(String(Math.round(a * 100)), undefined, newIdempotencyKey()), "Saved");
        }}>Move to savings</button>
      </div>

      <div className="card stack md">
        <h2 style={{ margin: 0 }}>Learn & earn</h2>
        {game.lessons.map((l) => (
          <div key={l.id} className="row spread">
            <span>{l.title}</span>
            {l.completed ? <Badge kind="ok">Done</Badge> : (
              <button className="btn" disabled={busy} onClick={() => run(() => userApi.completeStarterLesson(l.id), "Lesson complete")}>Complete</button>
            )}
          </div>
        ))}
      </div>

      <div className="card stack sm muted">
        <div className="micro">Money coach</div>
        <p style={{ margin: 0 }}>{coach.spending.summary}</p>
        <p style={{ margin: 0 }}>{coach.savings.recommendation}</p>
      </div>
    </div>
  );
}
