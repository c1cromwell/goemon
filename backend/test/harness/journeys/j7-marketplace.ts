/**
 * J7 — Marketplace: quote → Tier-2 escrow subscribe; Tier-1 gated with COMPLIANCE_BLOCKED.
 *
 * Live HTTP against a running backend (npm run seed:e2e / seed:marketplace && npm run dev).
 * Direct API steps (AGT client shape); NL subscribe via SmartChat left optional.
 */

import { v4 as uuidv4 } from "uuid";
import { HarnessHttpError } from "../client";
import { clientFrom, fail, note, pass, redactSecret } from "../setup";
import type { JourneyDef, StepContext, StepResult } from "../types";

const TIER2_EMAIL = process.env.HARNESS_DEMO_EMAIL ?? "alex@demo.com";
const TIER2_PASSWORD = process.env.HARNESS_DEMO_PASSWORD ?? "Demo1234!";
const TIER1_EMAIL = process.env.HARNESS_TIER1_EMAIL ?? "casey@demo.com";
const TIER1_PASSWORD = process.env.HARNESS_TIER1_PASSWORD ?? "Demo1234!";

interface ListingView {
  assetId: string;
  name: string;
  symbol: string | null;
  kind: string;
  surface: string;
  priceMinor: string;
  minTier: number;
  eligible: boolean;
  eligibilityReason?: string;
}

interface Quote {
  side: string;
  assetId: string;
  qtyBase: string;
  priceMinor: string;
  currency: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
}

interface OrderResult {
  orderId: string;
  status: string;
  side: string;
  assetId: string;
  qtyBase: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  currency: string;
  journalId: string | null;
}

function step(
  id: string,
  label: string,
  run: (ctx: StepContext) => Promise<StepResult>
) {
  return { id, label, run };
}

function isMinorInt(v: string | undefined | null): boolean {
  return typeof v === "string" && /^\d+$/.test(v);
}

async function login(ctx: StepContext, email: string, password: string): Promise<string> {
  const http = clientFrom(ctx);
  const login = await http.post<{ userId: string; token: string }>("/api/auth/login/password", {
    email,
    password,
  });
  ctx.bearer = login.token;
  note(ctx, `POST /api/auth/login/password → ${email} userId=${login.userId}`);
  return login.userId;
}

async function cashMinor(ctx: StepContext): Promise<bigint> {
  const http = clientFrom(ctx);
  const bal = await http.get<{ cash: { amount: string } }>("/api/accounts/balance", ctx.bearer);
  return BigInt(bal.cash.amount);
}

function pickInvestSecurity(listings: ListingView[]): ListingView | undefined {
  const invest = listings.filter((l) => l.surface === "invest" || l.kind === "security");
  return (
    invest.find((l) => l.eligible && (l.symbol === "MAPLE" || /maple/i.test(l.name))) ??
    invest.find((l) => l.eligible && l.minTier >= 2) ??
    invest.find((l) => l.eligible)
  );
}

export const j7Journey: JourneyDef = {
  id: "j7",
  name: "Marketplace subscribe / compliance",
  description:
    "Quote fee disclosure → Tier-2 escrow subscribe → Tier-1 subscribe blocked (COMPLIANCE_BLOCKED)",
  steps: [
    step("auth_t2", "Auth Tier-2 demo user", async (ctx) => {
      try {
        const userId = await login(ctx, TIER2_EMAIL, TIER2_PASSWORD);
        const cash = await cashMinor(ctx);
        ctx.state.t2UserId = userId;
        ctx.state.cashBefore = cash.toString();
        if (cash < 10_000n) {
          return fail(
            "auth_t2",
            "Auth Tier-2 demo user",
            `insufficient cash ${cash} (need headroom for subscribe)`
          );
        }
        return pass("auth_t2", "Auth Tier-2 demo user", `userId=${userId} cash=${cash}`);
      } catch (e) {
        if (e instanceof HarnessHttpError) {
          return fail("auth_t2", "Auth Tier-2 demo user", `${e.code}: ${e.message}`, e.code);
        }
        throw e;
      }
    }),

    step("find_listing", "Find tradeable Invest security (seed:marketplace)", async (ctx) => {
      const http = clientFrom(ctx);
      const res = await http.get<{ listings: ListingView[] }>(
        "/api/marketplace/listings?surface=invest",
        ctx.bearer
      );
      note(ctx, `GET /api/marketplace/listings?surface=invest → ${res.listings.length} listing(s)`);
      const pick = pickInvestSecurity(res.listings);
      if (!pick) {
        return fail(
          "find_listing",
          "Find tradeable Invest security (seed:marketplace)",
          "no eligible invest/security listing — run npm run seed:marketplace"
        );
      }
      ctx.state.listing = pick;
      return pass(
        "find_listing",
        "Find tradeable Invest security (seed:marketplace)",
        `${pick.symbol ?? "?"} ${pick.name} assetId=${redactSecret(pick.assetId)} priceMinor=${pick.priceMinor}`
      );
    }),

    step("quote", "Quote subscribe — fee disclosed as integer minor units", async (ctx) => {
      const listing = ctx.state.listing as ListingView | undefined;
      if (!listing) return fail("quote", "Quote subscribe — fee disclosed as integer minor units", "no listing");
      const http = clientFrom(ctx);
      const qtyBase = "1";
      const q = await http.post<Quote>(
        "/api/marketplace/quote",
        { assetId: listing.assetId, side: "subscribe", qtyBase },
        { bearer: ctx.bearer }
      );
      note(
        ctx,
        `POST /api/marketplace/quote → gross=${q.grossMinor} fee=${q.feeMinor} net=${q.netMinor} ${q.currency}`
      );
      for (const [k, v] of [
        ["grossMinor", q.grossMinor],
        ["feeMinor", q.feeMinor],
        ["netMinor", q.netMinor],
        ["priceMinor", q.priceMinor],
        ["qtyBase", q.qtyBase],
      ] as const) {
        if (!isMinorInt(v)) {
          return fail(
            "quote",
            "Quote subscribe — fee disclosed as integer minor units",
            `${k}=${v} is not an integer minor-unit string`
          );
        }
      }
      // Subscribe: buyer pays gross + fee (= net).
      if (BigInt(q.netMinor) !== BigInt(q.grossMinor) + BigInt(q.feeMinor)) {
        return fail(
          "quote",
          "Quote subscribe — fee disclosed as integer minor units",
          `net ${q.netMinor} !== gross ${q.grossMinor} + fee ${q.feeMinor}`
        );
      }
      ctx.state.quote = q;
      return pass(
        "quote",
        "Quote subscribe — fee disclosed as integer minor units",
        `gross=${q.grossMinor} fee=${q.feeMinor} net=${q.netMinor}`
      );
    }),

    step("subscribe", "Tier-2 subscribe → escrow hold journal", async (ctx) => {
      const listing = ctx.state.listing as ListingView | undefined;
      const quote = ctx.state.quote as Quote | undefined;
      if (!listing || !quote) {
        return fail("subscribe", "Tier-2 subscribe → escrow hold journal", "missing listing/quote");
      }
      const http = clientFrom(ctx);
      const before = await cashMinor(ctx);
      const order = await http.post<OrderResult>(
        `/api/marketplace/assets/${listing.assetId}/subscribe`,
        { qtyBase: quote.qtyBase },
        { bearer: ctx.bearer, idempotencyKey: uuidv4() }
      );
      note(
        ctx,
        `POST /api/marketplace/assets/:id/subscribe → status=${order.status} orderId=${redactSecret(order.orderId)} journalId=${order.journalId ?? "null"}`
      );
      if (order.status !== "open") {
        return fail(
          "subscribe",
          "Tier-2 subscribe → escrow hold journal",
          `expected status=open, got ${order.status}`
        );
      }
      if (!order.journalId) {
        return fail(
          "subscribe",
          "Tier-2 subscribe → escrow hold journal",
          "missing escrow journalId"
        );
      }
      for (const [k, v] of [
        ["grossMinor", order.grossMinor],
        ["feeMinor", order.feeMinor],
        ["netMinor", order.netMinor],
      ] as const) {
        if (!isMinorInt(v)) {
          return fail(
            "subscribe",
            "Tier-2 subscribe → escrow hold journal",
            `${k}=${v} is not an integer minor-unit string`
          );
        }
      }
      const after = await cashMinor(ctx);
      const expectedDebit = BigInt(order.netMinor);
      if (after !== before - expectedDebit) {
        return fail(
          "subscribe",
          "Tier-2 subscribe → escrow hold journal",
          `cash ${before} → ${after}, expected debit ${expectedDebit}`
        );
      }
      ctx.state.order = order;
      return pass(
        "subscribe",
        "Tier-2 subscribe → escrow hold journal",
        `escrowed netMinor=${order.netMinor} journalId=${redactSecret(order.journalId)}`
      );
    }),

    step("auth_t1", "Switch to Tier-1 demo user", async (ctx) => {
      try {
        const userId = await login(ctx, TIER1_EMAIL, TIER1_PASSWORD);
        ctx.state.t1UserId = userId;
        return pass("auth_t1", "Switch to Tier-1 demo user", `userId=${userId} (${TIER1_EMAIL})`);
      } catch (e) {
        if (e instanceof HarnessHttpError) {
          return fail("auth_t1", "Switch to Tier-1 demo user", `${e.code}: ${e.message}`, e.code);
        }
        throw e;
      }
    }),

    step("compliance_blocked", "Tier-1 subscribe → COMPLIANCE_BLOCKED", async (ctx) => {
      const listing = ctx.state.listing as ListingView | undefined;
      if (!listing) {
        return fail("compliance_blocked", "Tier-1 subscribe → COMPLIANCE_BLOCKED", "missing asset");
      }
      const http = clientFrom(ctx);
      try {
        await http.post(
          `/api/marketplace/assets/${listing.assetId}/subscribe`,
          { qtyBase: "1" },
          { bearer: ctx.bearer, idempotencyKey: uuidv4() }
        );
        return fail(
          "compliance_blocked",
          "Tier-1 subscribe → COMPLIANCE_BLOCKED",
          "subscribe unexpectedly succeeded for Tier-1 user"
        );
      } catch (e) {
        if (!(e instanceof HarnessHttpError)) throw e;
        note(ctx, `POST subscribe (Tier-1) → ${e.code}: ${e.message}`);
        if (e.code !== "COMPLIANCE_BLOCKED") {
          return fail(
            "compliance_blocked",
            "Tier-1 subscribe → COMPLIANCE_BLOCKED",
            `expected COMPLIANCE_BLOCKED got ${e.code}: ${e.message}`,
            e.code
          );
        }
        return pass(
          "compliance_blocked",
          "Tier-1 subscribe → COMPLIANCE_BLOCKED",
          e.message,
          "COMPLIANCE_BLOCKED"
        );
      }
    }),
  ],
};
