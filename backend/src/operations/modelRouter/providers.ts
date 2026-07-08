/**
 * M4.1 — Provider seam: Anthropic, OpenAI, Cursor Composer; Google/local stubs.
 */

import { AppError, ErrorCode } from "../../errors";
import { config } from "../../config";
import type { ModelInvokeRequest, ModelInvokeResult, RegistryEntry } from "./types";

function microCost(entry: RegistryEntry, inputTokens: number, outputTokens: number): number {
  return Math.round(
    (inputTokens * entry.inputMicroUsdPer1k) / 1000 + (outputTokens * entry.outputMicroUsdPer1k) / 1000
  );
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

type AnthropicTool = { name: string; description?: string; input_schema?: unknown };

function mapOpenAiTools(tools: unknown[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return (tools as AnthropicTool[]).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema ?? { type: "object", properties: {} },
    },
  }));
}

function mapOpenAiToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object") return undefined;
  const tc = toolChoice as { type?: string; name?: string };
  if (tc.type === "tool" && tc.name) {
    return { type: "function", function: { name: tc.name } };
  }
  return toolChoice;
}

async function invokeAnthropic(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  if (!config.ANTHROPIC_API_KEY) {
    throw new AppError(ErrorCode.INTERNAL, "ANTHROPIC_API_KEY required for anthropic provider");
  }
  const started = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: entry.model,
    max_tokens: req.maxTokens ?? 512,
    system: req.system,
    tools: req.tools,
    tool_choice: req.toolChoice,
    messages: [{ role: "user", content: req.userContent }],
  });
  const inputTokens = message.usage?.input_tokens ?? 0;
  const outputTokens = message.usage?.output_tokens ?? 0;
  const latencyMs = Date.now() - started;
  return {
    modelId: entry.id,
    vendor: entry.vendor,
    tier: entry.tier,
    raw: message,
    inputTokens,
    outputTokens,
    latencyMs,
    costMicroUsd: microCost(entry, inputTokens, outputTokens),
  };
}

/**
 * Shared OpenAI-compatible chat-completions call. OpenAI and Chutes (Bittensor SN64) speak
 * the same protocol, so both providers funnel through here — only the endpoint, key, error
 * label, and the key under which the raw response is stashed differ.
 */
async function invokeOpenAiCompatible(
  entry: RegistryEntry,
  req: ModelInvokeRequest,
  opts: { url: string; apiKey: string; providerLabel: string; rawKey: string }
): Promise<ModelInvokeResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: entry.model,
    max_tokens: req.maxTokens ?? 512,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.userContent },
    ],
  };
  const tools = mapOpenAiTools(req.tools);
  if (tools) body.tools = tools;
  const toolChoice = mapOpenAiToolChoice(req.toolChoice);
  if (toolChoice) body.tool_choice = toolChoice;

  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new AppError(
      ErrorCode.INTERNAL,
      `${opts.providerLabel} API error ${res.status}: ${errText.slice(0, 200)}`
    );
  }
  const message = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = message.choices?.[0]?.message;
  const toolCall = choice?.tool_calls?.[0];
  const rawContent = toolCall
    ? [
        {
          type: "tool_use",
          name: toolCall.function?.name,
          input: toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {},
        },
      ]
    : [{ type: "text", text: choice?.content ?? "" }];
  const inputTokens = message.usage?.prompt_tokens ?? estimateTokens(req.system + req.userContent);
  const outputTokens = message.usage?.completion_tokens ?? estimateTokens(JSON.stringify(rawContent));
  const latencyMs = Date.now() - started;
  return {
    modelId: entry.id,
    vendor: entry.vendor,
    tier: entry.tier,
    raw: { content: rawContent, [opts.rawKey]: message },
    inputTokens,
    outputTokens,
    latencyMs,
    costMicroUsd: microCost(entry, inputTokens, outputTokens),
  };
}

async function invokeOpenAi(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  if (!config.OPENAI_API_KEY) {
    throw new AppError(ErrorCode.INTERNAL, "OPENAI_API_KEY required for openai provider");
  }
  return invokeOpenAiCompatible(entry, req, {
    url: "https://api.openai.com/v1/chat/completions",
    apiKey: config.OPENAI_API_KEY,
    providerLabel: "OpenAI",
    rawKey: "openai",
  });
}

/**
 * Chutes / Bittensor Subnet 64 — opt-in, best-effort decentralized inference over an
 * OpenAI-compatible endpoint. Consumed with a fiat-billed API key (no TAO). The router only
 * ever routes the non-PII marketing_draft task here, with Anthropic/OpenAI as the fallback.
 */
async function invokeChutes(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  const apiKey = process.env.CHUTES_API_KEY ?? config.CHUTES_API_KEY;
  if (!apiKey) {
    throw new AppError(ErrorCode.INTERNAL, "CHUTES_API_KEY required for chutes provider");
  }
  return invokeOpenAiCompatible(entry, req, {
    url: `${config.CHUTES_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    apiKey,
    providerLabel: "Chutes",
    rawKey: "chutes",
  });
}

async function invokeCursor(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  if (!config.CURSOR_API_KEY) {
    throw new AppError(ErrorCode.INTERNAL, "CURSOR_API_KEY required for cursor provider");
  }
  const started = Date.now();
  let Agent: { prompt: (prompt: string, opts: Record<string, unknown>) => Promise<{ status?: string; result?: string }> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Agent = require("@cursor/sdk").Agent;
  } catch {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, "@cursor/sdk not installed — npm install @cursor/sdk");
  }

  const prompt =
    `${req.system}\n\n---\n\n${req.userContent}` +
    (req.tools?.length
      ? `\n\nRespond by calling tool ${(req.tools[0] as AnthropicTool).name} with valid JSON matching its schema.`
      : "");

  const result = await Agent.prompt(prompt, {
    apiKey: config.CURSOR_API_KEY,
    model: { id: entry.model },
    local: { cwd: process.cwd() },
  });

  if (result.status === "error") {
    throw new AppError(ErrorCode.INTERNAL, "Cursor Composer run failed");
  }

  const text = result.result ?? "";
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(text);
  const latencyMs = Date.now() - started;

  let raw: unknown = { content: [{ type: "text", text }] };
  if (req.tools?.length) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      raw = {
        content: [{ type: "tool_use", name: (req.tools[0] as AnthropicTool).name, input: parsed }],
      };
    } catch {
      /* keep text block */
    }
  }

  return {
    modelId: entry.id,
    vendor: entry.vendor,
    tier: entry.tier,
    raw,
    inputTokens,
    outputTokens,
    latencyMs,
    costMicroUsd: microCost(entry, inputTokens, outputTokens),
  };
}

function stubProvider(vendor: string): never {
  throw new AppError(ErrorCode.NOT_IMPLEMENTED, `${vendor} model provider not wired`);
}

export async function invokeProvider(entry: RegistryEntry, req: ModelInvokeRequest): Promise<ModelInvokeResult> {
  switch (entry.vendor) {
    case "anthropic":
      return invokeAnthropic(entry, req);
    case "openai":
      return invokeOpenAi(entry, req);
    case "cursor":
      return invokeCursor(entry, req);
    case "chutes":
      return invokeChutes(entry, req);
    case "google":
      return stubProvider("Google");
    case "local":
      return stubProvider("Local");
    default:
      throw new AppError(ErrorCode.INTERNAL, `Unknown vendor ${entry.vendor}`);
  }
}

export { microCost };
