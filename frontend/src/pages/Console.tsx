/**
 * Console — a terminal-style command surface over the SmartChat agent (the "CLI-first"
 * experience). Each line is natural language routed through the same agent pipeline used
 * by the chat (operation token + 90s TTL + MFA gate); `help` and `clear` are local.
 * Examples: `balance`, `deposit $50`, `withdraw $20 to my bank`, `pay "City Power" $90`,
 * `send $20 to blair@demo.com`, `history`.
 */
import { useEffect, useRef, useState } from "react";
import { userApi, newIdempotencyKey, ApiError } from "../api/client";

type Kind = "in" | "out" | "sys" | "err";
interface Line { kind: Kind; text: string }

const HELP = [
  "Commands (natural language — the agent classifies + a 90s token authorizes):",
  "  balance                      show your available balance",
  "  history                      recent transactions",
  "  deposit $50                  add funds from your bank",
  "  withdraw $20 to my bank      ACH payout",
  '  pay "City Power" $90         pay a saved biller',
  "  send $20 to blair@demo.com   transfer to a person",
  "  help · clear                 local commands",
  "Money-out over $500 prompts for an MFA code.",
];

const COLOR: Record<Kind, string> = {
  in: "var(--accent)",
  out: "var(--text)",
  sys: "var(--muted)",
  err: "var(--bad)",
};

export function Console() {
  const [log, setLog] = useState<Line[]>([{ kind: "sys", text: "Goeman console — type `help`." }]);
  const [input, setInput] = useState("");
  const [pendingMfa, setPendingMfa] = useState<{ tokenId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);

  function push(line: Line) { setLog((l) => [...l, line]); }

  async function submit() {
    const line = input.trim();
    if (!line || busy) return;
    push({ kind: "in", text: `> ${line}` });
    setInput("");

    if (line === "clear") { setLog([]); return; }
    if (line === "help") { HELP.forEach((t) => push({ kind: "sys", text: t })); return; }

    setBusy(true);
    try {
      if (pendingMfa) {
        const r = await userApi.smartchatMfa(pendingMfa.tokenId, line, newIdempotencyKey());
        setPendingMfa(null);
        push({ kind: "out", text: r.reply });
      } else {
        const r = await userApi.smartchat(line);
        push({ kind: "out", text: r.reply });
        if (r.requiresMfa && r.operationToken) {
          setPendingMfa({ tokenId: r.operationToken.id });
          push({ kind: "sys", text: `MFA required — enter the 6-digit code${r.devMfaCode ? ` (dev: ${r.devMfaCode})` : ""}` });
        }
      }
    } catch (e) {
      push({ kind: "err", text: e instanceof ApiError ? `${e.code}: ${e.message}` : "Error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page stack lg">
      <div>
        <h1>Console</h1>
        <p className="muted small" style={{ margin: 0 }}>A command line over your agent — same money rails, terminal feel.</p>
      </div>

      <div
        className="card"
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, minHeight: 360, maxHeight: "60vh", overflowY: "auto", padding: 16 }}
        onClick={() => document.getElementById("console-input")?.focus()}
      >
        {log.map((l, i) => (
          <div key={i} style={{ color: COLOR[l.kind], whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{l.text}</div>
        ))}
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ color: pendingMfa ? "var(--bad)" : "var(--accent)" }}>{pendingMfa ? "mfa>" : "$"}</span>
          <input
            id="console-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            disabled={busy}
            autoFocus
            aria-label="Console input"
            style={{ flex: 1, border: "none", background: "transparent", color: "var(--text)", fontFamily: "inherit", fontSize: 13, outline: "none" }}
            placeholder={busy ? "…" : pendingMfa ? "6-digit code" : "type a command"}
          />
        </div>
        <div ref={endRef} />
      </div>
    </div>
  );
}
