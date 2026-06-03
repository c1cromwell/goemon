/**
 * Agent — SmartChat. Natural-language money operations. Each actionable message
 * mints a short-lived (90s) operation token; transfers over $500 require an MFA
 * code before they execute. The agent never moves money on its own — the token +
 * MFA gate is the control. Gated at Tier 2 by the router.
 */
import { useEffect, useRef, useState } from "react";
import {
  userApi,
  newIdempotencyKey,
  type OperationTokenView,
  type SmartChatResult,
} from "../api/client";

interface ChatMsg {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  token?: OperationTokenView | null;
}

export function Agent() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: "intro",
      role: "agent",
      text: "Hi — I can check your balance, show transactions, or send money. Try “send $20 to alex@example.com” or “what's my balance?”",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState<{ tokenId: string; devCode?: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, mfa]);

  function push(m: Omit<ChatMsg, "id">) {
    setMessages((prev) => [...prev, { ...m, id: `${Date.now()}-${Math.random()}` }]);
  }

  function applyResult(r: SmartChatResult) {
    push({ role: "agent", text: r.reply, token: r.operationToken });
    if (r.requiresMfa && r.operationToken) {
      setMfa({ tokenId: r.operationToken.id, devCode: r.devMfaCode });
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push({ role: "user", text });
    setBusy(true);
    try {
      const r = await userApi.smartchat(text);
      applyResult(r);
    } catch (e) {
      push({ role: "system", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa() {
    if (!mfa || !mfaCode.trim()) return;
    setBusy(true);
    try {
      const r = await userApi.smartchatMfa(mfa.tokenId, mfaCode.trim(), newIdempotencyKey());
      setMfa(null);
      setMfaCode("");
      applyResult(r);
    } catch (e) {
      push({ role: "system", text: e instanceof Error ? e.message : "MFA verification failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <h1>Agent</h1>
      <p className="muted small" style={{ marginTop: 0 }}>SmartChat — ask in plain language.</p>

      <div className="chat grow" style={{ marginTop: 12 }}>
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.text}
            {m.token ? <TokenChip token={m.token} /> : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {mfa ? (
        <div className="card" style={{ marginTop: 12 }}>
          <h2 style={{ margin: 0 }}>Confirm with MFA</h2>
          <p className="muted small" style={{ marginTop: 6 }}>
            This transfer needs a verification code.
            {mfa.devCode ? <> Dev code: <span className="code">{mfa.devCode}</span></> : null}
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              className="grow"
              inputMode="numeric"
              placeholder="Enter code"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitMfa()}
            />
            <button disabled={busy || !mfaCode.trim()} onClick={submitMfa}>
              Confirm
            </button>
          </div>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 12, paddingBottom: 8 }}>
        <input
          className="grow"
          placeholder="Message BankAI…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button disabled={busy || !input.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

/** Operation-token status + 90s countdown chip rendered under an agent reply. */
function TokenChip({ token }: { token: OperationTokenView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (token.status !== "pending" && token.status !== "awaiting_mfa") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [token.status]);

  const remaining = Math.max(0, Math.round((new Date(token.expiresAt).getTime() - now) / 1000));
  const live = token.status === "pending" || token.status === "awaiting_mfa";

  return (
    <div style={{ marginTop: 8, fontSize: 12 }}>
      {live ? (
        <span className="countdown">
          <span className="pulse" />
          {token.operation} · {remaining}s left
        </span>
      ) : (
        <span className="micro">
          {token.operation} · {token.status}
        </span>
      )}
    </div>
  );
}
