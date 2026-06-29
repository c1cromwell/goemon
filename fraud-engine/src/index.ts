/**
 * Entrypoint — migrate, build the context, mount the app, listen.
 */

import { config } from "./config";
import { getDb, closeDb } from "./db";
import { runMigrations } from "./db/migrate";
import { buildContext } from "./context";
import { buildApp } from "./server";
import { logger } from "./observability/logger";

async function main(): Promise<void> {
  const db = getDb();
  await runMigrations(db);
  const ctx = await buildContext(db);
  const app = buildApp(ctx);

  const srv = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "goemon-fraud-engine listening");
  });

  const shutdown = async () => {
    srv.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error({ err: (e as Error).message }, "fatal boot error");
  process.exit(1);
});
