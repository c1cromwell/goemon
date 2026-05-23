/**
 * Phase 2 — W3C BitstringStatusList 2021.
 *
 * Each credential gets a position (statusListIndex) in an annual bitstring.
 * A 0 bit means valid; a 1 bit means revoked. The bitstring is gzip-compressed
 * then base64url-encoded before storage and serving.
 *
 * Spec: https://www.w3.org/TR/vc-bitstring-status-list/
 *
 * The minimum bitstring size per the spec is 131,072 bits (16 KB), ensuring
 * an observer cannot infer which positions are in use from the list size.
 *
 * Functions accept an optional `db` parameter so callers already inside a
 * transaction can pass their tx-scoped Db (avoids nested-transaction errors).
 */

import zlib from "zlib";
import { getDb, type Db } from "../db";

const BITSTRING_BYTES = 16384; // 131,072 bits — W3C minimum

interface StatusListRow {
  id: string;
  list_year: number;
  next_index: number;
  encoded_list: string | null;
  updated_at: string;
}

/** Get or initialise the status list for a year using the provided db context. */
async function getOrCreate(year: number, db: Db): Promise<StatusListRow> {
  const existing = await db.queryOne<StatusListRow>(
    "SELECT id, list_year, next_index, encoded_list, updated_at FROM credential_status_lists WHERE list_year = ?",
    [year]
  );
  if (existing) return existing;

  const id = `status-list-${year}`;
  const emptyEncoded = encode(Buffer.alloc(BITSTRING_BYTES, 0));
  await db.execute(
    `INSERT INTO credential_status_lists (id, list_year, next_index, encoded_list, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
    [id, year, emptyEncoded, new Date().toISOString()]
  );
  return { id, list_year: year, next_index: 0, encoded_list: emptyEncoded, updated_at: new Date().toISOString() };
}

/**
 * Reserve the next available index in the year's list.
 * Pass `db` when already inside a transaction to avoid nesting.
 */
export async function assignIndex(year: number, db?: Db): Promise<number> {
  const root = db ?? getDb();
  return root.transaction(async (tx) => {
    const row = await getOrCreate(year, tx);
    const index = row.next_index;
    await tx.execute(
      "UPDATE credential_status_lists SET next_index = ?, updated_at = ? WHERE list_year = ?",
      [index + 1, new Date().toISOString(), year]
    );
    return index;
  });
}

/**
 * Set the bit at index to 1 (revoked).
 * Pass `db` when already inside a transaction to avoid nesting.
 */
export async function revoke(year: number, index: number, db?: Db): Promise<void> {
  const root = db ?? getDb();
  await root.transaction(async (tx) => {
    const row = await tx.queryOne<StatusListRow>(
      "SELECT encoded_list FROM credential_status_lists WHERE list_year = ?",
      [year]
    );
    if (!row?.encoded_list) throw new Error(`Status list for year ${year} not found`);

    const buf = decode(row.encoded_list);
    setBit(buf, index, true);
    const updated = encode(buf);
    await tx.execute(
      "UPDATE credential_status_lists SET encoded_list = ?, updated_at = ? WHERE list_year = ?",
      [updated, new Date().toISOString(), year]
    );
  });
}

/** Get the current encoded list for a year (creates if absent). */
export async function getEncodedList(year: number): Promise<string> {
  const row = await getOrCreate(year, getDb());
  return row.encoded_list ?? encode(Buffer.alloc(BITSTRING_BYTES, 0));
}

/** Check a bit without writing. Works on the raw encoded string. */
export function isRevoked(encodedList: string, index: number): boolean {
  const buf = decode(encodedList);
  return getBit(buf, index);
}

// ---------------------------------------------------------------------------
// Bitstring helpers
// ---------------------------------------------------------------------------

/** gzip + base64url */
export function encode(buf: Buffer): string {
  const compressed = zlib.gzipSync(buf);
  return compressed.toString("base64url");
}

/** base64url + gunzip */
export function decode(encoded: string): Buffer {
  const compressed = Buffer.from(encoded, "base64url");
  return zlib.gunzipSync(compressed);
}

function getBit(buf: Buffer, index: number): boolean {
  const byteIndex = Math.floor(index / 8);
  const bitOffset = 7 - (index % 8); // MSB-first
  return ((buf[byteIndex]! >> bitOffset) & 1) === 1;
}

function setBit(buf: Buffer, index: number, value: boolean): void {
  const byteIndex = Math.floor(index / 8);
  const bitOffset = 7 - (index % 8); // MSB-first
  if (value) {
    buf[byteIndex] = (buf[byteIndex]! | (1 << bitOffset));
  } else {
    buf[byteIndex] = (buf[byteIndex]! & ~(1 << bitOffset));
  }
}
