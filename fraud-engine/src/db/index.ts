/**
 * SQLite store for the fraud engine (better-sqlite3, wrapped in a small async
 * interface so the call sites read like the Goemon backend's `Db`). The engine is
 * SQLite-only by design — it is a prototype-scale stand-in for the north-star
 * lakehouse/feature-store; production would swap this layer wholesale.
 *
 * Write SQL with `?` placeholders. Money/amount columns are INTEGER (minor units)
 * and read back through BigInt — never trust the driver's numeric type for money.
 */

import fs from "fs";
import path from "path";
import { config } from "../config";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

function normalizeParams(params: unknown[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => (typeof p === "bigint" ? p.toString() : p));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDb(sqlite: any): Db {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return sqlite.prepare(sql).all(...normalizeParams(params)) as T[];
    },
    async queryOne<T>(sql: string, params?: unknown[]) {
      return (sqlite.prepare(sql).get(...normalizeParams(params)) as T) ?? null;
    },
    async execute(sql: string, params?: unknown[]) {
      sqlite.prepare(sql).run(...normalizeParams(params));
    },
    async exec(sql: string) {
      sqlite.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(makeDb(sqlite));
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

let _db: Db | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _raw: any = null;

export function getDb(): Db {
  if (_db) return _db;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const dbPath = path.resolve(config.SQLITE_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _raw = new Database(dbPath);
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("foreign_keys = ON");
  _db = makeDb(_raw);
  return _db;
}

/** Point the engine at a specific SQLite file (tests use ":memory:"). */
export function openDbAt(dbPath: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  _raw = new Database(dbPath);
  _raw.pragma("journal_mode = WAL");
  _raw.pragma("foreign_keys = ON");
  _db = makeDb(_raw);
  return _db;
}

export async function closeDb(): Promise<void> {
  if (!_raw) return;
  _raw.close();
  _raw = null;
  _db = null;
}
