/**
 * Phase 3 — Internal agent routes.
 *
 * GET    /api/agents      — list agents
 * POST   /api/agents      — create agent
 * GET    /api/agents/:id  — get agent
 * PATCH  /api/agents/:id  — update agent
 * DELETE /api/agents/:id  — delete agent (soft)
 */

import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { AppError, ErrorCode } from "../errors";
import * as agentService from "../services/agentService";

export const agentsRouter = Router();

agentsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agents = await agentService.listAgents(req.userId!);
    res.json(agents);
  } catch (e) {
    next(e);
  }
});

agentsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, permissions, transfer_limit_minor, expires_at } = req.body as {
      name?: string;
      description?: string;
      permissions?: string[];
      transfer_limit_minor?: number;
      expires_at?: string;
    };
    if (!name) throw new AppError(ErrorCode.VALIDATION, "name required");
    const agent = await agentService.createAgent(req.userId!, {
      name,
      description,
      permissions,
      transfer_limit_minor,
      expires_at,
    });
    res.status(201).json(agent);
  } catch (e) {
    next(e);
  }
});

agentsRouter.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agent = await agentService.getAgent(req.userId!, req.params.id!);
    if (!agent) throw new AppError(ErrorCode.NOT_FOUND, "Agent not found");
    res.json(agent);
  } catch (e) {
    next(e);
  }
});

agentsRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agent = await agentService.updateAgent(req.userId!, req.params.id!, req.body);
    res.json(agent);
  } catch (e) {
    next(e);
  }
});

agentsRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await agentService.deleteAgent(req.userId!, req.params.id!);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
