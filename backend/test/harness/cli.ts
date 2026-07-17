#!/usr/bin/env tsx
/**
 * Goemon agent harness CLI.
 *
 *   npm run harness -- --help
 *   npm run harness -- --all
 *   npm run harness:j6          # requires live API (seed:e2e + npm run dev)
 *
 * Plan: docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md
 */

import { registerBuiltInJourneys, resolveJourneyIds, listJourneys } from "./registry";
import { runJourneys } from "./runner";
import { buildReport, writeReport } from "./report";
import type { JourneyResult } from "./types";
import * as fs from "fs";
import * as path from "path";

function printHelp(): void {
  registerBuiltInJourneys();
  const registered = listJourneys();
  console.log(`Goemon agent harness

Usage:
  npm run harness -- [options]
  npm run harness:j5
  npm run harness:j6
  npm run harness:j7

Options:
  --help              Show this help and exit 0
  --all               Run all registered journeys (default if no --journey)
  --journey <ids>     Comma-separated journey ids (e.g. j5,j6,j7)
  --base-url <url>    API base (default: HARNESS_BASE_URL or http://localhost:3001)
  --continue          Do not fail-fast within a journey

Environment:
  HARNESS_BASE_URL       default http://localhost:3001
  HARNESS_DEMO_EMAIL     default alex@demo.com
  HARNESS_DEMO_PASSWORD  default Demo1234!

Registered journeys:
${registered.length === 0 ? "  (none)" : registered.map((j) => `  ${j.id.padEnd(6)} ${j.name}${j.steps.length === 0 ? "  [placeholder — 0 steps]" : `  [${j.steps.length} steps]`}`).join("\n")}

J5–J7 require a live API:
  npm run seed:e2e && npm run dev
  npm run harness:j5   # SmartChat + MFA
  npm run harness:j6   # OID4VP → MCP
  npm run harness:j7   # Marketplace (needs seed:marketplace)

Artifacts: backend/test/.e2e-artifacts/<runId>/report.json
`);
}

function parseArgs(argv: string[]): {
  help: boolean;
  all: boolean;
  journey?: string;
  baseUrl: string;
  failFast: boolean;
} {
  let help = false;
  let all = false;
  let journey: string | undefined;
  let baseUrl = process.env.HARNESS_BASE_URL ?? "http://localhost:3001";
  let failFast = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--all") all = true;
    else if (a === "--continue") failFast = false;
    else if (a === "--journey" || a === "-j") {
      journey = argv[++i];
      if (!journey) throw new Error("--journey requires a value");
    } else if (a === "--base-url") {
      const v = argv[++i];
      if (!v) throw new Error("--base-url requires a value");
      baseUrl = v;
    } else if (a?.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return { help, all, journey, baseUrl, failFast };
}

function writeTranscript(dir: string, results: JourneyResult[]): void {
  // Transcript lines are collected on the runner context; surface step details only
  // (already redacted). Keep a flat trail for triage.
  const lines: string[] = ["# Harness HTTP trail (redacted)", ""];
  for (const j of results) {
    lines.push(`## ${j.id}`);
    for (const s of j.steps) {
      lines.push(`- [${s.status}] ${s.id}: ${s.detail ?? s.label}${s.errorCode ? ` (${s.errorCode})` : ""}`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(dir, "transcript.md"), lines.join("\n"), "utf8");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  registerBuiltInJourneys();

  const spec = args.journey ?? "all";

  let journeys;
  try {
    journeys = resolveJourneyIds(spec === "all" || args.all ? "all" : spec);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 2;
  }

  const needsLive = journeys.some((j) => j.steps.length > 0);
  if (needsLive) {
    try {
      const res = await fetch(`${args.baseUrl.replace(/\/$/, "")}/api/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `Live API not reachable at ${args.baseUrl} (${msg}).\n` +
          `Start it with: cd backend && npm run seed:e2e && npm run dev`
      );
      return 2;
    }
  }

  const startedAt = new Date();
  console.log(`Harness: ${journeys.length} journey(s) @ ${args.baseUrl}`);
  for (const j of journeys) {
    console.log(`  · ${j.id} (${j.steps.length} steps)${j.steps.length === 0 ? " [placeholder]" : ""}`);
  }

  const results = await runJourneys(journeys, args.baseUrl, { failFast: args.failFast });
  const report = buildReport({ baseUrl: args.baseUrl, journeys: results, startedAt });
  const { dir, jsonPath, summaryPath } = writeReport(report);
  writeTranscript(dir, results);

  console.log("");
  for (const j of results) {
    const mark = j.status === "PASS" ? "PASS" : j.status;
    console.log(`  ${mark} ${j.id} (${j.steps.filter((s) => s.status === "PASS").length}/${j.steps.length})`);
    for (const s of j.steps) {
      if (s.status === "FAIL") console.log(`       FAIL ${s.id}: ${s.detail}`);
    }
  }
  console.log("");
  console.log(`Status:  ${report.status}`);
  console.log(`Report:  ${jsonPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Dir:     ${dir}`);

  return report.status === "PASS" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
