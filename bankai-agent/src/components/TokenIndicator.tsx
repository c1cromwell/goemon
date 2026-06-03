/** Live 90s scoped-token countdown — makes the short-lived, single-intent token visible. */
import { useEffect, useState } from "react";
import type { ScopedToken } from "../lib/agent";

export function TokenIndicator({ token }: { token: ScopedToken }) {
  const [now, setNow] = useState(Date.now());
  const expiresAt = token.obtainedAt + token.expiresIn * 1000;
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = remaining === 0;

  useEffect(() => {
    if (expired) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expired]);

  const pct = Math.max(0, Math.min(100, (remaining / token.expiresIn) * 100));

  return (
    <div className={`token ${expired ? "expired" : ""}`} title={`jti ${token.jti}`}>
      <span className="bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      {expired ? "token expired" : `${remaining}s`} · [{token.scope.join(", ")}]
    </div>
  );
}
