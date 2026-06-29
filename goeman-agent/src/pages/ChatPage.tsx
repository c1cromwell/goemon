/**
 * Agent chat — the user talks in plain language; each actionable message runs the
 * OID4VP path (challenge → wallet-signed VP → 90s scoped token → MCP tool call),
 * with the token countdown and step trace shown inline.
 */
import { useEffect, useRef, useState } from "react";
import { detectIntent } from "../lib/intent";
import { runIntent } from "../lib/agent";
import { clearLink, type LinkState } from "../lib/setup";
import { MessageBubble, type ChatMessage } from "../components/MessageBubble";

export function ChatPage({ link, onUnlink }: { link: LinkState; onUnlink: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "agent",
      text:
        `Connected to ${link.email}. I can act within: ${link.scopes.join(", ")}.\n` +
        `Try “what's my balance?”, “show recent transactions”, or “send $20 to blair@demo.com”.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function push(m: Omit<ChatMessage, "id">) {
    setMessages((prev) => [...prev, { ...m, id: `${Date.now()}-${Math.random()}` }]);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    push({ role: "user", text });
    setBusy(true);
    try {
      const intent = detectIntent(text);
      const run = await runIntent(intent, link.vcJwt);
      push({ role: "agent", text: run.reply, steps: run.steps, token: run.token });
    } catch (e) {
      push({ role: "system", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  function unlink() {
    clearLink();
    onUnlink();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">A</span> Goeman Global Finance Assistant
          <span className="ext-tag">external agent</span>
        </div>
        <div className="row">
          <span className="micro">{link.email}</span>
          <button className="ghost sm" onClick={unlink}>Disconnect</button>
        </div>
      </header>

      <div className="chat">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {busy ? <div className="bubble system">…requesting a scoped token</div> : null}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <input
          className="grow"
          placeholder="Ask the assistant…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button disabled={busy || !input.trim()} onClick={send}>Send</button>
      </div>
    </div>
  );
}
