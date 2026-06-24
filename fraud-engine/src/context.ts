/**
 * Application context — wires every layer together once and hands the assembled
 * services to the HTTP layer (and to tests). Keeping composition here means tests
 * build a real engine over an in-memory DB with one call.
 */

import type { Db } from "./db";
import { SqliteFeatureStore } from "./features/featureStore";
import { ModelRegistry } from "./models/registry";
import { ModelServer } from "./models/serving";
import { RulesModel } from "./models/rulesModel";
import { SequenceModel } from "./models/sequenceModel";
import { CelRulesModel } from "./models/celRulesModel";
import { DEFAULT_RULE_SET } from "./rules/defaultRuleset";
import { seedDefaultRuleset, loadRuleSet } from "./rules/rulesetStore";
import { Router } from "./router/router";
import { DecisionEngine } from "./router/decisionEngine";
import { InProcessEventBus } from "./bus/eventBus";
import { CaseService } from "./cases/caseService";
import { RemediationService } from "./remediation/remediationService";
import { LabelStore } from "./learning/labelStore";
import { Retrainer } from "./learning/retrain";
import type { Decision } from "./types";

export interface Context {
  db: Db;
  store: SqliteFeatureStore;
  registry: ModelRegistry;
  server: ModelServer;
  router: Router;
  engine: DecisionEngine;
  decisionBus: InProcessEventBus<Decision>;
  cases: CaseService;
  remediation: RemediationService;
  labels: LabelStore;
  retrainer: Retrainer;
}

export async function buildContext(db: Db): Promise<Context> {
  const store = new SqliteFeatureStore(db);
  const registry = new ModelRegistry(db);

  const server = new ModelServer();
  const rules = new RulesModel();
  const sequence = new SequenceModel();
  server.registerModel(rules);
  server.registerModel(sequence);

  // CEL ruleset model — the same rules as DATA. Seed the default set (a faithful
  // CEL port of rules-v1), then build the model from the table. Registered as
  // SHADOW so it scores alongside prod and divergence is logged, with no behavior
  // change until the fraud team promotes it — the no-redeploy adoption story.
  await seedDefaultRuleset(db);
  const celRules = new CelRulesModel(DEFAULT_RULE_SET, await loadRuleSet(db, DEFAULT_RULE_SET));
  server.registerModel(celRules);

  // Built-in registry state: rules is prod (the deterministic floor), the sequence
  // model ships in shadow until the fraud team promotes it.
  await registry.register(rules.version, "rules", "prod", "built-in deterministic floor");
  await registry.register(sequence.version, "sequence", "shadow", "built-in sequence model (Transformer stand-in)");
  await registry.register(celRules.version, "rules", "shadow", "CEL rules-as-data (port of rules-v1); promote to take live");

  const router = new Router(registry, server, db);
  const decisionBus = new InProcessEventBus<Decision>();
  const engine = new DecisionEngine(db, store, router, decisionBus);

  const cases = new CaseService(db);
  const remediation = new RemediationService(cases);
  remediation.subscribe(decisionBus);

  const labels = new LabelStore(db);
  const retrainer = new Retrainer(db, registry, server, labels);

  return { db, store, registry, server, router, engine, decisionBus, cases, remediation, labels, retrainer };
}
