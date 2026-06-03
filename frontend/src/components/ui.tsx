/** Small presentational primitives shared across pages. */
import type { ReactNode } from "react";
import { formatMoney, type FormatMoneyOpts } from "../lib/money";

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="empty">
      <Spinner />
      {label ? <div style={{ marginTop: 10 }}>{label}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Render an integer minor-unit amount. NEVER pass a float here. */
export function Money({
  minor,
  currency,
  className,
  ...opts
}: { minor: string | bigint; currency: string; className?: string } & FormatMoneyOpts) {
  return <span className={`amount ${className ?? ""}`}>{formatMoney(minor, currency, opts)}</span>;
}

export function Badge({ kind, children }: { kind?: "ok" | "warn" | "bad"; children: ReactNode }) {
  return <span className={`badge ${kind ?? ""}`}>{children}</span>;
}
