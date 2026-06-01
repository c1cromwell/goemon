/**
 * Phase 6 — SmartChat intent classifier.
 *
 * Turns a natural-language message into a structured intent the SmartChat service
 * can act on. Mirrors the orchestratorModel pattern: a deterministic "simulated"
 * classifier (offline, used in tests and as the default) and an optional
 * "anthropic" classifier via structured tool-use.
 *
 * SECURITY NOTE: the classifier is *advisory only*. It never moves money. Its
 * output is fed into the operation-token + MFA + ledgerService pipeline, which
 * re-validates the recipient, the amount (integer minor units), the tier scope,
 * and the MFA gate before anything executes. A hallucinated amount or recipient
 * can at worst produce a rejected operation, never an unauthorized transfer.
 */

import { config } from "../config";
import { logger } from "../observability/logger";

export type SmartChatOperation =
  | "balance.read"
  | "transactions.read"
  | "transfer.send"
  | "chat";

export interface ClassifiedIntent {
  operation: SmartChatOperation;
  /** For transfer.send — the raw recipient identifier the user named (email). */
  recipient?: string;
  /** For transfer.send — amount in INTEGER minor units, carried as a string for JSON/bigint safety. */
  amountMinor?: string;
  /** ISO-4217-ish code; only USD/USDC are supported downstream. */
  currency?: string;
  /** Human-readable echo of what was understood (shown back to the user). */
  summary: string;
}

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

/**
 * Parse a human money string into integer minor units (cents) WITHOUT floating
 * point. Accepts forms like "$1,234.56", "1234.56", "500", "500 dollars".
 * Returns null if no amount is present.
 */
export function parseAmountMinor(text: string): bigint | null {
  const m = text.match(/(?:\$\s*)?(\d[\d,]*)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const whole = m[1]!.replace(/,/g, "");
  // Pad/truncate the fractional part to exactly 2 digits without rounding via float.
  const frac = (m[2] ?? "").padEnd(2, "0").slice(0, 2);
  try {
    return BigInt(whole) * 100n + BigInt(frac);
  } catch {
    return null;
  }
}

/** Deterministic, offline classifier. Default path; always used in tests. */
export function classifyIntentSimulated(message: string): ClassifiedIntent {
  const text = message.trim();
  const lower = text.toLowerCase();

  const isTransfer = /\b(send|transfer|pay|wire|remit)\b/.test(lower);
  if (isTransfer) {
    const amount = parseAmountMinor(text);
    const recipient = text.match(EMAIL_RE)?.[0];
    const currency = /\busdc\b/i.test(text) ? "USDC" : "USD";
    return {
      operation: "transfer.send",
      recipient,
      amountMinor: amount != null ? amount.toString() : undefined,
      currency,
      summary:
        amount != null && recipient
          ? `Transfer ${currency} ${(amount / 100n).toString()}.${(amount % 100n).toString().padStart(2, "0")} to ${recipient}`
          : "Transfer (missing amount or recipient)",
    };
  }

  if (/\b(balance|how much|funds|available|account total)\b/.test(lower)) {
    return { operation: "balance.read", summary: "Read account balance" };
  }

  if (/\b(transaction|history|statement|recent|spent|activity|payments?)\b/.test(lower)) {
    return { operation: "transactions.read", summary: "Read recent transactions" };
  }

  return { operation: "chat", summary: "General conversation" };
}

const SYSTEM_PROMPT = `You are the intent classifier for a bank's SmartChat. Classify the
user's message into exactly one banking operation and extract structured parameters.
You NEVER move money — you only classify. Amounts MUST be returned as integer minor
units (US cents for USD). If the user says "$500" return 50000. If no amount is
present, omit it. Only extract a recipient if the user clearly names one (an email).`;

const SUBMIT_TOOL = {
  name: "submit_intent",
  description: "Submit the classified banking intent.",
  input_schema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["balance.read", "transactions.read", "transfer.send", "chat"],
      },
      recipient: { type: "string", description: "Recipient email, only for transfer.send" },
      amount_minor: { type: "integer", description: "Amount in integer minor units (cents)" },
      currency: { type: "string", enum: ["USD", "USDC"] },
      summary: { type: "string", description: "One-line human-readable summary of the intent" },
    },
    required: ["operation", "summary"],
  },
} as const;

const VALID_OPS: SmartChatOperation[] = ["balance.read", "transactions.read", "transfer.send", "chat"];

function sanitizeIntent(raw: Record<string, unknown>): ClassifiedIntent {
  const operation = VALID_OPS.includes(raw.operation as SmartChatOperation)
    ? (raw.operation as SmartChatOperation)
    : "chat";
  const currency = raw.currency === "USDC" ? "USDC" : "USD";
  let amountMinor: string | undefined;
  if (operation === "transfer.send" && raw.amount_minor != null) {
    // Coerce to a non-negative integer; reject NaN/negatives by dropping them.
    const n = Math.trunc(Number(raw.amount_minor));
    if (Number.isFinite(n) && n > 0) amountMinor = BigInt(n).toString();
  }
  const recipient =
    operation === "transfer.send" && typeof raw.recipient === "string" && EMAIL_RE.test(raw.recipient)
      ? raw.recipient
      : undefined;
  return {
    operation,
    recipient,
    amountMinor,
    currency,
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 300) : "Intent",
  };
}

async function classifyIntentAnthropic(message: string): Promise<ClassifiedIntent> {
  // Lazy-require so the SDK is never loaded on the simulated/test path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: config.ANTHROPIC_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
    messages: [{ role: "user", content: message }],
  });

  const toolUse = (response.content as Array<{ type: string; name?: string; input?: unknown }>).find(
    (block) => block.type === "tool_use" && block.name === SUBMIT_TOOL.name
  );
  if (!toolUse || typeof toolUse.input !== "object" || toolUse.input == null) {
    throw new Error("Anthropic classifier returned no tool_use block");
  }
  return sanitizeIntent(toolUse.input as Record<string, unknown>);
}

/**
 * Classify a SmartChat message. Uses the configured classifier; on any Anthropic
 * failure it falls back to the deterministic classifier so chat never hard-fails
 * on a model outage. The simulated classifier is always safe to run offline.
 */
export async function classifyIntent(message: string): Promise<ClassifiedIntent> {
  if (config.SMARTCHAT_ORCHESTRATOR === "anthropic" && config.ANTHROPIC_API_KEY) {
    try {
      return await classifyIntentAnthropic(message);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Anthropic SmartChat classifier failed; using simulated fallback");
    }
  }
  return classifyIntentSimulated(message);
}
