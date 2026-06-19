/**
 * Phase 22.4 — CreditBureauReporter provider seam (simulated default; partner swap in prod).
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export interface BureauReportInput {
  teenUserId: string;
  guardianUserId: string;
  statementId: string;
  period: string;
  paidOnTime: boolean;
  utilizationBps: number;
  closingBalanceMinor: bigint;
}

export interface BureauReportResult {
  externalRef: string;
  status: "submitted" | "accepted" | "rejected";
  payload: Record<string, unknown>;
}

export interface CreditBureauReporter {
  name: string;
  submitReport(input: BureauReportInput): Promise<BureauReportResult>;
}

function simulatedReporter(): CreditBureauReporter {
  return {
    name: "simulated",
    async submitReport(input) {
      return {
        externalRef: `sim-bureau-${uuidv4().slice(0, 8)}`,
        status: "accepted",
        payload: {
          period: input.period,
          paidOnTime: input.paidOnTime,
          utilizationBps: input.utilizationBps,
          note: "Simulated bureau submission — no real credit file impact",
        },
      };
    },
  };
}

function notImplemented(name: string): CreditBureauReporter {
  return {
    name,
    async submitReport(): Promise<never> {
      throw new AppError(
        ErrorCode.NOT_IMPLEMENTED,
        `CREDIT_BUREAU_REPORTER=${name} is not wired — integrate a credit-builder reporting partner + counsel`
      );
    },
  };
}

let reporter: CreditBureauReporter | null = null;
export function setCreditBureauReporter(r: CreditBureauReporter | null): void {
  reporter = r;
}

export function getCreditBureauReporter(): CreditBureauReporter {
  if (reporter) return reporter;
  switch (config.CREDIT_BUREAU_REPORTER) {
    case "step":
      return notImplemented("step");
    case "experian":
      return notImplemented("experian");
    default:
      return simulatedReporter();
  }
}
