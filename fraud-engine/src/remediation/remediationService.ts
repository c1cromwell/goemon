/**
 * Remediation service — the async consumer of the decisions topic.
 *
 * This is what makes the fire-and-forget path actionable: Goeman emitted the event
 * async (did NOT wait), so the engine reacts here. On a high-severity decision it
 * opens a case and — when auto-remediation is on — calls back into Goeman to FREEZE
 * the user's account (a standing, deterministic money state Goeman owns). A `block`/
 * `challenge` opens a case for analyst review but takes no automated money action.
 *
 * The score is advisory; the decision to freeze is the deterministic threshold
 * (routing_config.freeze_at, surfaced as action === "freeze"). Mirrors Goeman's
 * "model advisory, deterministic code gates" invariant on the engine side.
 */

import type { EventBus } from "../bus/eventBus";
import { TOPICS } from "../bus/eventBus";
import type { CaseService } from "../cases/caseService";
import { severityFor } from "../cases/caseService";
import { getGoemanClient } from "./goemanClient";
import { config } from "../config";
import { logger } from "../observability/logger";
import type { Decision } from "../types";

export class RemediationService {
  constructor(private cases: CaseService) {}

  /** Wire this consumer onto the decisions bus. */
  subscribe(bus: EventBus<Decision>): void {
    bus.subscribe(TOPICS.decisions, "remediation", (d) => this.handle(d));
  }

  /** Exposed for tests / direct invocation. */
  async handle(d: Decision): Promise<void> {
    // Only async decisions drive remediation; sync ones were already gated inline
    // by Goeman. Low-risk async decisions need no case.
    if (d.mode !== "async") return;
    if (d.action === "allow" || d.action === "flag") return;

    const reasonCodes = d.reasons.map((r) => r.code).join(",");
    const c = await this.cases.open({
      userId: d.userId,
      decisionId: d.decisionId,
      severity: severityFor(d.score),
      summary: `auto: ${d.action} (score ${d.score.toFixed(2)}) — ${reasonCodes}`,
    });

    if (d.action === "freeze") {
      if (config.FRAUD_AUTO_REMEDIATE) {
        await this.cases.recordAction(c.id, "freeze_requested", "system", reasonCodes);
        await getGoemanClient().freeze({
          userId: d.userId,
          reason: `fraud-engine: ${reasonCodes}`,
          decisionId: d.decisionId,
        });
        logger.warn({ userId: d.userId, decisionId: d.decisionId }, "auto-froze account via Goeman remediation");
      } else {
        await this.cases.recordAction(c.id, "freeze_recommended", "system", "auto-remediate disabled — awaiting analyst");
      }
    }
  }
}
