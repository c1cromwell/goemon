/**
 * Phase 24 — Production readiness + agent-commerce stacked routes.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { getStablecoinProductionStatus, recordStablecoinReadinessSnapshot } from "../services/stablecoinProductionService";
import { getCollectiblesGoLiveStatus } from "../services/collectiblesGoLiveService";
import { getInstantPaymentsStatus, getObservedTransferP99Ms } from "../services/instantPaymentsService";
import { getIdentityIssuerStatus, fetchProofIssuerMetadata } from "../services/identityIssuerService";
import { getNeobankProductionStatus, parseColumnWebhook } from "../services/neobankProductionService";
import { getEquityProductionStatus } from "../services/equityProductionService";
import { getAgentCommerceGate } from "../services/agentCommerceService";
import { listVerifiableIntents } from "../services/verifiableIntentService";
import { catalogSummary, listSupportedProducts } from "../services/productCatalogService";
import { requireAdmin, requireRole, type AdminRequest } from "../middleware/rbac";

export const phase24Router = Router();

phase24Router.get("/readiness", async (_req, res, next) => {
  try {
    const [stablecoin, collectibles, instant, identity, neobank, equities] = await Promise.all([
      getStablecoinProductionStatus(),
      getCollectiblesGoLiveStatus(),
      Promise.resolve(getInstantPaymentsStatus()),
      Promise.resolve(getIdentityIssuerStatus()),
      Promise.resolve(getNeobankProductionStatus()),
      Promise.resolve(getEquityProductionStatus()),
    ]);
    res.json({
      summary: catalogSummary(),
      workstreams: {
        "24.4_stablecoin": stablecoin,
        "24.7_collectibles": collectibles,
        "24.5_instant": { ...instant, observedTransferP99Ms: getObservedTransferP99Ms() },
        "24.1_identity": identity,
        "24.3_neobank": neobank,
        "24.6_equities": equities,
      },
      enabledProducts: listSupportedProducts({ enabledOnly: true }),
    });
  } catch (e) {
    next(e);
  }
});

phase24Router.get("/stablecoin/status", async (_req, res, next) => {
  try {
    res.json(await getStablecoinProductionStatus());
  } catch (e) {
    next(e);
  }
});

phase24Router.get("/instant/sla", (_req, res) => {
  res.json({ ...getInstantPaymentsStatus(), observedTransferP99Ms: getObservedTransferP99Ms() });
});

phase24Router.get("/identity/issuer", async (_req, res, next) => {
  try {
    const status = getIdentityIssuerStatus();
    const proof = status.issuer === "proof" ? await fetchProofIssuerMetadata().catch(() => null) : null;
    res.json({ ...status, proof });
  } catch (e) {
    next(e);
  }
});

phase24Router.get("/agent-commerce/gate", async (req, res, next) => {
  try {
    const q = z
      .object({
        clientDid: z.string().min(1),
        intentId: z.string().min(1),
        resource: z.string().min(1),
        identityProven: z.enum(["0", "1", "true", "false"]).optional(),
        paymentComplete: z.enum(["0", "1", "true", "false"]).optional(),
      })
      .parse(req.query);
    const gate = await getAgentCommerceGate({
      clientDid: q.clientDid,
      intentId: q.intentId,
      resource: q.resource,
      identityProven: q.identityProven === "1" || q.identityProven === "true",
      paymentComplete: q.paymentComplete === "1" || q.paymentComplete === "true",
    });
    res.json(gate);
  } catch (e) {
    next(e);
  }
});

phase24Router.get("/intents/me", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    res.json(await listVerifiableIntents(req.userId!));
  } catch (e) {
    next(e);
  }
});

/** Column BaaS webhook stub (verify HMAC in prod). */
export const bankWebhookRouter = Router();

bankWebhookRouter.post("/column", async (req, res, next) => {
  try {
    const event = parseColumnWebhook(req.body);
    res.json({ received: true, event, note: "Stub — wire returnTransfer/deposit when BANK_RAIL_PROVIDER=column" });
  } catch (e) {
    next(e);
  }
});

export const phase24AdminRouter = Router();

phase24AdminRouter.use(requireAdmin);

phase24AdminRouter.post("/stablecoin/snapshot", requireRole("admin", "compliance"), async (_req: AdminRequest, res, next) => {
  try {
    await recordStablecoinReadinessSnapshot();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
