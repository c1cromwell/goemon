/**
 * Phase 15.0 — internal MCP-style "skill" servers (scoped, read/recommend/draft).
 *
 * A Skill exposes a versioned set of tools for one back-office domain. Every tool is
 * read / recommend / draft — NONE execute (no money, no account/credential mutation,
 * no regulator submission). Each tool declares a `scope`; a caller is granted a set
 * of requested scopes and the client can only invoke tools whose scope falls in the
 * intersection (skill-allowed ∩ requested) — the same intersection model Phase 7
 * presentationService enforces for external agents.
 *
 * The client records each invocation (tool + scope + timestamp — never raw args/PII)
 * so the workflow runner can persist a tool-call trail into agent_runs.
 */

import { AppError, ErrorCode } from "../errors";

export interface SkillTool<Args = unknown, Result = unknown> {
  /** Scope gating this tool, e.g. "kyc:read". Must be read/recommend/draft only. */
  scope: string;
  handler: (args: Args) => Promise<Result>;
}

export interface Skill {
  name: string;
  version: string;
  tools: Record<string, SkillTool>;
}

export interface ToolCallRecord {
  tool: string;
  scope: string;
  at: string;
}

export interface ScopedSkillClient {
  /** Invoke a tool by name. Throws SCOPE_DENIED if it is outside the granted scopes. */
  call<Result = unknown>(tool: string, args?: unknown): Promise<Result>;
  /** The recorded invocations (no args/PII) — for the agent_runs trail. */
  getCalls(): ToolCallRecord[];
}

export function defineSkill(skill: Skill): Skill {
  return skill;
}

/**
 * Build a client over `skill` limited to `requestedScopes`. Effective scope is the
 * intersection of the skill's tool scopes and the requested scopes; a tool whose
 * scope is not in that intersection is not callable.
 */
export function createScopedClient(skill: Skill, requestedScopes: string[]): ScopedSkillClient {
  const requested = new Set(requestedScopes);
  const calls: ToolCallRecord[] = [];

  return {
    async call<Result = unknown>(tool: string, args?: unknown): Promise<Result> {
      const def = skill.tools[tool];
      if (!def) {
        throw new AppError(ErrorCode.NOT_FOUND, `Skill ${skill.name} has no tool "${tool}"`);
      }
      if (!requested.has(def.scope)) {
        throw new AppError(
          ErrorCode.SCOPE_DENIED,
          `Tool "${tool}" requires scope ${def.scope}, which is not granted to this run`
        );
      }
      calls.push({ tool, scope: def.scope, at: new Date().toISOString() });
      return def.handler(args) as Promise<Result>;
    },
    getCalls() {
      return [...calls];
    },
  };
}
