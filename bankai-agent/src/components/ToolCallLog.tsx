/** Step trace of an agent run: challenge → wallet signature → token → tool call. */
import type { Step } from "../lib/agent";

export function ToolCallLog({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="trace">
      {steps.map((s, i) => (
        <div className="step" key={i}>
          <span className={`dot ${s.status}`} />
          <span>{s.label}</span>
          {s.detail ? <span className="detail">· {s.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}
