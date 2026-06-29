import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freshContext } from "./helpers";
import { setGoemonClient, type GoemonClient } from "../src/remediation/goemonClient";
import { config } from "../src/config";
import type { Context } from "../src/context";
import type { Decision } from "../src/types";

class FakeGoemon implements GoemonClient {
  freezes: { userId: string; decisionId: string }[] = [];
  unfreezes: { userId: string }[] = [];
  flags: { userId: string }[] = [];
  async freeze(a: { userId: string; reason: string; decisionId: string }) {
    this.freezes.push({ userId: a.userId, decisionId: a.decisionId });
  }
  async unfreeze(a: { userId: string; reason: string; decisionId: string }) {
    this.unfreezes.push({ userId: a.userId });
  }
  async flagTransaction(a: { userId: string; transactionRef: string; reason: string; decisionId: string }) {
    this.flags.push({ userId: a.userId });
  }
}

function freezeDecision(): Decision {
  return {
    decisionId: "d-1",
    eventId: "e-1",
    userId: "u-mule",
    mode: "async",
    score: 0.95,
    action: "freeze",
    reasons: [{ code: "pass_through", weight: 0.4 }],
    explanation: [{ feature: "pass_through", contribution: 0.4 }],
    modelVersion: "rules-v1",
  };
}

describe("remediation — async callback into Goemon", () => {
  let ctx: Context;
  let fake: FakeGoemon;

  beforeEach(async () => {
    ({ ctx } = await freshContext());
    fake = new FakeGoemon();
    setGoemonClient(fake);
  });
  afterEach(() => {
    setGoemonClient(null);
    (config as { FRAUD_AUTO_REMEDIATE: boolean }).FRAUD_AUTO_REMEDIATE = true;
  });

  it("opens a case and freezes the account on a freeze decision (auto-remediate on)", async () => {
    await ctx.remediation.handle(freezeDecision());
    expect(fake.freezes).toHaveLength(1);
    expect(fake.freezes[0]!.userId).toBe("u-mule");
    const cases = await ctx.cases.list();
    expect(cases).toHaveLength(1);
    expect(cases[0]!.severity).toBe("critical");
  });

  it("opens a case but does NOT freeze when auto-remediate is off", async () => {
    (config as { FRAUD_AUTO_REMEDIATE: boolean }).FRAUD_AUTO_REMEDIATE = false;
    await ctx.remediation.handle(freezeDecision());
    expect(fake.freezes).toHaveLength(0);
    expect(await ctx.cases.list()).toHaveLength(1);
  });

  it("ignores benign async decisions (no case, no freeze)", async () => {
    await ctx.remediation.handle({ ...freezeDecision(), action: "allow", score: 0.1 });
    expect(fake.freezes).toHaveLength(0);
    expect(await ctx.cases.list()).toHaveLength(0);
  });

  it("does not remediate sync-mode decisions (Goemon already gated those)", async () => {
    await ctx.remediation.handle({ ...freezeDecision(), mode: "score" });
    expect(fake.freezes).toHaveLength(0);
  });

  it("case_events are append-only", async () => {
    await ctx.remediation.handle(freezeDecision());
    const ev = await ctx.db.queryOne<{ id: string }>("SELECT id FROM case_events LIMIT 1");
    await expect(
      ctx.db.execute("UPDATE case_events SET actor = 'x' WHERE id = ?", [ev!.id])
    ).rejects.toThrow(/append-only/);
  });
});
