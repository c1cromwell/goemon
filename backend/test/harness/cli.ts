#!/usr/bin/env tsx
/**
 * Goemon agent harness CLI — Phase 0 scaffold.
 *
 *   npm run harness -- --help
 *   npm run harness -- --all
 *   npm run harness -- --journey j6
 *
 * Requires a live API only once journeys have steps (Phase 1+).
 * Plan: docs/AGENT-HARNESS-IMPLEMENTATION-PLAN.md
 */

import { registerPhase0Placeholders, resolveJourneyIds, listJourneys } from "./registry";
import { runJourneys } from "./runner";
import { buildReport, writeReport } from "./report";

function printHelp(): void {
  registerPhase0Placeholders();
  const registered = listJourneys();
  console.log(`Goemon agent harness (Phase 0 scaffold)

Usage:
  npm run harness -- [options]
  npm run harness:j6

Options:
  --help              Show this help and exit 0
  --all               Run all registered journeys (default if no --journey)
  --journey <ids>     Comma-separated journey ids (e.g. j5,j6,j7)
  --base-url <url>    API base (default: HARNESS_BASE_URL or http://localhost:3001)
  --continue          Do not fail-fast within a journey

Environment:
  HARNESS_BASE_URL       default http://localhost:3001
  HARNESS_DEMO_EMAIL     default alex@demo.com (used in Phase 1+)
  HARNESS_DEMO_PASSWORD  default Demo1234!

Registered journeys:
${registered.length === 0 ? "  (none)" : registered.map((j) => `  ${j.id.padEnd(6)} ${j.name}${j.steps.length === 0 ? "  [placeholder — 0 steps]" : `  [${j.steps.length} steps]`}`).join("\n")}

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

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  registerPhase0Placeholders();

  const spec = args.journey ?? "all";
  if (!args.journey && !args.all && process.argv.slice(2).length === 0) {
    // bare `npm run harness` → --all
  }

  let journeys;
  try {
    journeys = resolveJourneyIds(spec === "all" || args.all ? "all" : spec);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 2;
  }

  const startedAt = new Date();
  console.log(`Harness: ${journeys.length} journey(s) @ ${args.baseUrl}`);
  for (const j of journeys) {
    console.log(`  · ${j.id} (${j.steps.length} steps)${j.steps.length === 0 ? " [placeholder]" : ""}`);
  }

  const results = await runJourneys(journeys, args.baseUrl, { failFast: args.failFast });
  const report = buildReport({ baseUrl: args.baseUrl, journeys: results, startedAt });
  const { dir, jsonPath, summaryPath } = writeReport(report);

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
