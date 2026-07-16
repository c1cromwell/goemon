/**
 * Write harness reports under backend/test/.e2e-artifacts/<runId>/.
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import type { HarnessReport, JourneyResult } from "./types";

export function artifactsRoot(): string {
  return path.join(__dirname, "..", ".e2e-artifacts");
}

export function buildReport(opts: {
  baseUrl: string;
  journeys: JourneyResult[];
  startedAt: Date;
}): HarnessReport {
  const finishedAt = new Date();
  const failed = opts.journeys.some((j) => j.status === "FAIL");
  return {
    runId: uuidv4(),
    startedAt: opts.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    baseUrl: opts.baseUrl,
    status: failed ? "FAIL" : "PASS",
    journeys: opts.journeys,
  };
}

export function writeReport(report: HarnessReport): { dir: string; jsonPath: string; summaryPath: string } {
  const dir = path.join(artifactsRoot(), report.runId);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "report.json");
  const summaryPath = path.join(dir, "summary.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(summaryPath, formatSummaryMd(report), "utf8");
  return { dir, jsonPath, summaryPath };
}

export function formatSummaryMd(report: HarnessReport): string {
  const lines: string[] = [
    `# Harness run \`${report.runId}\``,
    "",
    `- **Status:** ${report.status}`,
    `- **Base URL:** ${report.baseUrl}`,
    `- **Started:** ${report.startedAt}`,
    `- **Finished:** ${report.finishedAt}`,
    "",
    "| Journey | Status | Steps | Duration |",
    "|---|---|---|---|",
  ];
  for (const j of report.journeys) {
    const pass = j.steps.filter((s) => s.status === "PASS").length;
    lines.push(`| ${j.id} | ${j.status} | ${pass}/${j.steps.length} | ${j.durationMs}ms |`);
  }
  lines.push("");
  for (const j of report.journeys) {
    lines.push(`## ${j.id} — ${j.name}`);
    if (j.steps.length === 0) {
      lines.push("_No steps registered (Phase 0 scaffold)._");
      lines.push("");
      continue;
    }
    for (const s of j.steps) {
      const code = s.errorCode ? ` (\`${s.errorCode}\`)` : "";
      const detail = s.detail ? ` — ${s.detail}` : "";
      lines.push(`- **${s.status}** \`${s.id}\` ${s.label}${code}${detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
