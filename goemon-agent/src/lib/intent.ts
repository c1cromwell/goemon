/**
 * Intent detector — maps a natural-language message to an MCP tool + the scope it
 * requires (and, for transfers, the parsed amount/recipient). Deterministic and
 * local: the agent decides what to *request*; the backend decides what to grant.
 */

export type ToolName = "get_balance" | "get_transactions" | "get_profile" | "transfer_funds";

export interface Intent {
  kind: "tool" | "chat";
  tool?: ToolName;
  scope?: string;
  args?: Record<string, unknown>;
  /** Human echo of what the agent understood. */
  summary: string;
}

/** Parse "$12", "12.50", "12 dollars" into integer cents — string math, no floats. */
function parseUsdMinor(text: string): string | null {
  const m = text.match(/\$?\s*(\d+)(?:\.(\d{1,2}))?\s*(?:dollars|usd)?/i);
  if (!m) return null;
  const whole = m[1]!;
  const frac = (m[2] ?? "").padEnd(2, "0").slice(0, 2);
  return (BigInt(whole) * 100n + BigInt(frac || "0")).toString();
}

export function detectIntent(message: string): Intent {
  const m = message.toLowerCase();

  if (/\b(send|transfer|pay|wire)\b/.test(m)) {
    const email = message.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    const amountMinor = parseUsdMinor(message);
    if (email && amountMinor) {
      return {
        kind: "tool",
        tool: "transfer_funds",
        scope: "transfer:low",
        args: { to: email, amountMinor, currency: "USD" },
        summary: `Transfer $${(Number(amountMinor) / 100).toFixed(2)} to ${email}`,
      };
    }
    return { kind: "chat", summary: "Transfer (need an amount and a recipient email)" };
  }

  if (/\b(balance|how much|funds|money)\b/.test(m)) {
    return { kind: "tool", tool: "get_balance", scope: "balance:read", summary: "Read account balance" };
  }
  if (/\b(transaction|history|recent|statement|activity)\b/.test(m)) {
    return { kind: "tool", tool: "get_transactions", scope: "statement:read", summary: "List recent transactions" };
  }
  if (/\b(profile|tier|status|who am|account level)\b/.test(m)) {
    return { kind: "tool", tool: "get_profile", scope: "profile:read", summary: "Read identity profile" };
  }

  return { kind: "chat", summary: "Conversation" };
}
