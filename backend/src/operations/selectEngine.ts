/**
 * Phase 15.4 — operations engine selection (called once at boot).
 *
 * Precedence (design §7 — Conductor for agents, Temporal for money):
 *   CONDUCTOR_ENABLED → Conductor (the primary agent substrate)
 *   else TEMPORAL_ENABLED → Temporal
 *   else → in-process (the default registered by operationsWorkflow)
 *
 * Either adapter degrades to in-process if its SDK/server is unavailable, so selecting
 * one never risks the runner failing closed.
 */

import { config } from "../config";
import { logger } from "../observability/logger";
import { setEngine } from "./engine";
import { createConductorEngine } from "./conductor/conductorEngine";
import { createTemporalEngine } from "./temporal/temporalEngine";

export function selectOperationsEngine(): void {
  if (config.CONDUCTOR_ENABLED) {
    setEngine(createConductorEngine());
    logger.warn(
      { url: config.CONDUCTOR_URL },
      "Operations engine: Conductor ENABLED (primary agent substrate; falls back to in-process if unavailable). Run `npm run conductor:worker`."
    );
    return;
  }
  if (config.TEMPORAL_ENABLED) {
    setEngine(createTemporalEngine());
    logger.warn(
      { address: config.TEMPORAL_ADDRESS, taskQueue: config.TEMPORAL_TASK_QUEUE },
      "Operations engine: Temporal ENABLED (falls back to in-process if unavailable). Run `npm run temporal:worker`."
    );
  }
}
