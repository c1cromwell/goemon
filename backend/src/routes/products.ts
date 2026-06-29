/**
 * Phase 24 — Supported product catalog routes.
 */

import { Router } from "express";
import { z } from "zod";
import { catalogSummary, getProduct, listSupportedProducts } from "../services/productCatalogService";

export const productsRouter = Router();

productsRouter.get("/supported", (req, res) => {
  const enabledOnly = req.query.enabled === "1" || req.query.enabled === "true";
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  res.json({
    summary: catalogSummary(),
    products: listSupportedProducts({ enabledOnly, category }),
  });
});

productsRouter.get("/supported/:sku", (req, res, next) => {
  try {
    const product = getProduct(z.string().min(1).parse(req.params.sku));
    if (!product) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown product SKU", retryable: false } });
      return;
    }
    res.json(product);
  } catch (e) {
    next(e);
  }
});
