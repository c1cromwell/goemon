/**
 * Phase 20 — Data warehouse export seam (analytics pipeline prototype).
 *
 * Incrementally exports append-only operational streams (audit_logs, ledger_journals,
 * mcp_audit_logs) to a swappable warehouse sink. Cursors track the last exported row
 * per stream; export runs are append-only history. Off by default behind
 * DATA_WAREHOUSE_ENABLED (prod-fatal).
 *
 * The simulated sink writes JSON rows to warehouse_staging_records for local
 * verification; bigquery/snowflake/redshift are NOT_IMPLEMENTED stubs.
 */

import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { warehouseExportTotal } from "../observability/metrics";

export type WarehouseStream = "audit_logs" | "ledger_journals" | "mcp_audit_logs";
export type WarehouseSinkName = "simulated" | "bigquery" | "snowflake" | "redshift";

const ALL_STREAMS: WarehouseStream[] = ["audit_logs", "ledger_journals", "mcp_audit_logs"];

/** Per-stream timestamp column (mcp_audit_logs uses called_at). */
const STREAM_TIME_COLUMN: Record<WarehouseStream, string> = {
  audit_logs: "created_at",
  ledger_journals: "created_at",
  mcp_audit_logs: "called_at",
};

export interface WarehouseSink {
  name: WarehouseSinkName;
  /** Push a batch of row payloads for one stream. Returns rows accepted. */
  pushBatch(stream: WarehouseStream, rows: Record<string, unknown>[]): Promise<number>;
}

export interface ExportRun {
  id: string;
  result: "ok" | "error" | "skipped";
  streams: WarehouseStream[];
  recordsExported: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface ExportCursor {
  stream: WarehouseStream;
  lastId: string;
  lastCreatedAt: string;
  updatedAt: string;
}

function assertEnabled(): void {
  if (!config.DATA_WAREHOUSE_ENABLED) {
    throw new AppError(ErrorCode.DATA_WAREHOUSE_DISABLED, "Data warehouse export is currently unavailable");
  }
}

function simulatedSink(): WarehouseSink {
  return {
    name: "simulated",
    async pushBatch(stream, rows) {
      const db = getDb();
      const exportedAt = new Date().toISOString();
      for (const row of rows) {
        await db.execute(
          "INSERT INTO warehouse_staging_records (id, stream, payload, exported_at) VALUES (?, ?, ?, ?)",
          [uuidv4(), stream, JSON.stringify(row), exportedAt]
        );
      }
      return rows.length;
    },
  };
}

function notImplemented(name: WarehouseSinkName): WarehouseSink {
  const fail = async (): Promise<never> => {
    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      `WAREHOUSE_SINK=${name} is not wired in this prototype — integrate BigQuery/Snowflake/Redshift`
    );
  };
  return { name, pushBatch: fail };
}

let sink: WarehouseSink | null = null;
export function setWarehouseSink(s: WarehouseSink | null): void {
  sink = s;
}

export function getWarehouseSink(): WarehouseSink {
  if (sink) return sink;
  switch (config.WAREHOUSE_SINK) {
    case "bigquery":
      return notImplemented("bigquery");
    case "snowflake":
      return notImplemented("snowflake");
    case "redshift":
      return notImplemented("redshift");
    default:
      return simulatedSink();
  }
}

async function getCursor(stream: WarehouseStream): Promise<ExportCursor | null> {
  const row = await getDb().queryOne<{ stream: string; last_id: string; last_created_at: string; updated_at: string }>(
    "SELECT stream, last_id, last_created_at, updated_at FROM warehouse_export_cursors WHERE stream = ?",
    [stream]
  );
  if (!row) return null;
  return {
    stream: row.stream as WarehouseStream,
    lastId: row.last_id,
    lastCreatedAt: row.last_created_at,
    updatedAt: row.updated_at,
  };
}

async function upsertCursor(stream: WarehouseStream, lastId: string, lastCreatedAt: string): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  const existing = await getCursor(stream);
  if (existing) {
    await db.execute(
      "UPDATE warehouse_export_cursors SET last_id = ?, last_created_at = ?, updated_at = ? WHERE stream = ?",
      [lastId, lastCreatedAt, now, stream]
    );
  } else {
    await db.execute(
      "INSERT INTO warehouse_export_cursors (stream, last_id, last_created_at, updated_at) VALUES (?, ?, ?, ?)",
      [stream, lastId, lastCreatedAt, now]
    );
  }
}

type Row = Record<string, unknown> & { id: string };

async function fetchNewRows(stream: WarehouseStream, cursor: ExportCursor | null, batchSize: number): Promise<Row[]> {
  const timeCol = STREAM_TIME_COLUMN[stream];
  if (cursor) {
    return getDb().query<Row>(
      `SELECT * FROM ${stream}
         WHERE ${timeCol} > ? OR (${timeCol} = ? AND id > ?)
         ORDER BY ${timeCol} ASC, id ASC LIMIT ?`,
      [cursor.lastCreatedAt, cursor.lastCreatedAt, cursor.lastId, batchSize]
    );
  }
  return getDb().query<Row>(`SELECT * FROM ${stream} ORDER BY ${timeCol} ASC, id ASC LIMIT ?`, [batchSize]);
}

async function exportStream(stream: WarehouseStream, batchSize: number): Promise<number> {
  const cursor = await getCursor(stream);
  const rows = await fetchNewRows(stream, cursor, batchSize);
  if (rows.length === 0) return 0;

  const payloads = rows.map((r) => ({ ...r }));
  const accepted = await getWarehouseSink().pushBatch(stream, payloads);

  const last = rows[rows.length - 1]!;
  const timeCol = STREAM_TIME_COLUMN[stream];
  const lastCreatedAt = String(last[timeCol] ?? "");
  await upsertCursor(stream, last.id, lastCreatedAt);
  return accepted;
}

/** Export one batch per stream (default batch size 500). Idempotent via cursors. */
export async function runWarehouseExport(opts?: { batchSize?: number; streams?: WarehouseStream[] }): Promise<ExportRun> {
  if (!config.DATA_WAREHOUSE_ENABLED) {
    const run: ExportRun = {
      id: uuidv4(),
      result: "skipped",
      streams: [],
      recordsExported: 0,
      errorMessage: "DATA_WAREHOUSE_ENABLED is off",
      createdAt: new Date().toISOString(),
    };
    await recordRun(run);
    warehouseExportTotal.inc({ result: "skipped" });
    return run;
  }

  assertEnabled();
  const batchSize = Math.min(Math.max(opts?.batchSize ?? 500, 1), 5000);
  const streams = opts?.streams ?? ALL_STREAMS;
  const runId = uuidv4();
  let total = 0;

  try {
    for (const stream of streams) {
      total += await exportStream(stream, batchSize);
    }
    const run: ExportRun = {
      id: runId,
      result: "ok",
      streams,
      recordsExported: total,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };
    await recordRun(run);
    warehouseExportTotal.inc({ result: "ok" });
    return run;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const run: ExportRun = {
      id: runId,
      result: "error",
      streams,
      recordsExported: total,
      errorMessage: msg,
      createdAt: new Date().toISOString(),
    };
    await recordRun(run);
    warehouseExportTotal.inc({ result: "error" });
    throw e;
  }
}

async function recordRun(run: ExportRun): Promise<void> {
  await getDb().execute(
    `INSERT INTO warehouse_export_runs (id, result, streams, records_exported, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [run.id, run.result, JSON.stringify(run.streams), run.recordsExported, run.errorMessage, run.createdAt]
  );
}

export async function getLatestExportRun(): Promise<ExportRun | null> {
  const row = await getDb().queryOne<{
    id: string;
    result: string;
    streams: string;
    records_exported: number;
    error_message: string | null;
    created_at: string;
  }>("SELECT * FROM warehouse_export_runs ORDER BY created_at DESC LIMIT 1");
  if (!row) return null;
  return {
    id: row.id,
    result: row.result as ExportRun["result"],
    streams: JSON.parse(row.streams) as WarehouseStream[],
    recordsExported: row.records_exported,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export async function getExportCursors(): Promise<ExportCursor[]> {
  const rows = await getDb().query<{ stream: string; last_id: string; last_created_at: string; updated_at: string }>(
    "SELECT stream, last_id, last_created_at, updated_at FROM warehouse_export_cursors ORDER BY stream"
  );
  return rows.map((r) => ({
    stream: r.stream as WarehouseStream,
    lastId: r.last_id,
    lastCreatedAt: r.last_created_at,
    updatedAt: r.updated_at,
  }));
}

/** Staging row count for the simulated sink (tests / admin visibility). */
export async function getStagingRecordCount(stream?: WarehouseStream): Promise<number> {
  if (stream) {
    const row = await getDb().queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM warehouse_staging_records WHERE stream = ?",
      [stream]
    );
    return row?.n ?? 0;
  }
  const row = await getDb().queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM warehouse_staging_records");
  return row?.n ?? 0;
}
