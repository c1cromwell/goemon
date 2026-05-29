/**
 * Phase 1 — Database abstraction.
 *
 * One async interface (`Db`) over two backends:
 *   - Postgres (pg Pool)        when DATABASE_URL is set  -> production
 *   - SQLite   (better-sqlite3) otherwise                 -> local dev
 *
 * Conventions:
 *   - Write SQL with `?` placeholders. The Postgres adapter rewrites them to $1..$n.
 *   - Money columns are INTEGER (sqlite) / BIGINT (pg). Read them through
 *     Money.fromDb(); never rely on the driver's numeric type for money.
 *   - All timestamps are ISO-8601 UTC text with DEFAULT CURRENT_TIMESTAMP.
 *
 * NOTE: better-sqlite3 is synchronous; we wrap it in resolved Promises so callers
 * use one async API. SQLite transactions are implemented with explicit
 * BEGIN/COMMIT/ROLLBACK (the native .transaction() helper requires a sync fn).
 */

import { config } from "../config";

export type Dialect = "postgres" | "sqlite";

export interface Db {
  readonly dialect: Dialect;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  /** Run fn inside a transaction. The fn receives a tx-scoped Db. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Execute a full multi-statement SQL script (migrations only). */
  exec(sql: string): Promise<void>;
}

/** Convert `?`-style placeholders to Postgres `$1..$n`. */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Coerce bigint params to string so pg/sqlite bind them correctly. */
function normalizeParams(params: unknown[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => (typeof p === "bigint" ? p.toString() : p));
}

// ---------------------------------------------------------------------------
// Postgres adapter
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePostgresDb(poolOrClient: any, isTx = false): Db {
  const run = async (sql: string, params?: unknown[]) => {
    const res = await poolOrClient.query(toPgPlaceholders(sql), normalizeParams(params));
    return res.rows as Record<string, unknown>[];
  };
  return {
    dialect: "postgres",
    async query<T>(sql: string, params?: unknown[]) {
      return (await run(sql, params)) as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]) {
      const rows = await run(sql, params);
      return (rows[0] as T) ?? null;
    },
    async execute(sql: string, params?: unknown[]) {
      await run(sql, params);
    },
    async exec(sql: string) {
      await poolOrClient.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (isTx) return fn(this); // already inside a transaction
      const client = await poolOrClient.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const txDb = makePostgresDb(client, true);
        const result = await fn(txDb);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// SQLite adapter
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSqliteDb(sqlite: any, isTx = false): Db {
  return {
    dialect: "sqlite",
    async query<T>(sql: string, params?: unknown[]) {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...normalizeParams(params)) as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]) {
      const stmt = sqlite.prepare(sql);
      return (stmt.get(...normalizeParams(params)) as T) ?? null;
    },
    async execute(sql: string, params?: unknown[]) {
      const stmt = sqlite.prepare(sql);
      stmt.run(...normalizeParams(params));
    },
    async exec(sql: string) {
      sqlite.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (isTx) return fn(this);
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(makeSqliteDb(sqlite, true));
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: Db | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _raw: any = null;

export function getDb(): Db {
  if (_db) return _db;

  if (config.dbDialect === "postgres") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require("pg");
    _raw = new Pool({ connectionString: config.DATABASE_URL });
    _db = makePostgresDb(_raw);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path");
    const dbPath = path.resolve(config.SQLITE_PATH);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    _raw = new Database(dbPath);
    _raw.pragma("journal_mode = WAL");
    _raw.pragma("foreign_keys = ON");
    _db = makeSqliteDb(_raw);
  }
  return _db;
}

/** Close underlying connections (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (!_raw) return;
  if (config.dbDialect === "postgres") {
    await _raw.end();
  } else {
    _raw.close();
  }
  _raw = null;
  _db = null;
}
