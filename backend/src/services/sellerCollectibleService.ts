/**
 * Seller P2P collectible submissions — cert gate + human review → marketplace listing.
 */

import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logAudit } from "./auditService";
import {
  verifySlabCert,
  fetchPriceComp,
  fetchAiPreGrade,
  type SlabGrader,
  type SlabCategory,
  type CertVerificationResult,
} from "./certVerificationService";
import * as tokenization from "./tokenizationService";
import * as listings from "./listingService";

export type SubmissionStatus = "pending_cert" | "pending_human" | "approved" | "rejected";

export interface SellerSubmissionRow {
  id: string;
  seller_user_id: string;
  category: SlabCategory;
  grader: SlabGrader;
  cert_number: string;
  title: string | null;
  description: string | null;
  ask_usdc_micro: string;
  image_urls: string;
  cert_verified: number;
  cert_source: string | null;
  cert_payload: string;
  comp_price_minor: string | null;
  comp_source: string | null;
  comp_as_of: string | null;
  ai_grade_payload: string | null;
  status: SubmissionStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  asset_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToView(row: SellerSubmissionRow) {
  return {
    id: row.id,
    sellerUserId: row.seller_user_id,
    category: row.category,
    grader: row.grader,
    certNumber: row.cert_number,
    title: row.title,
    description: row.description,
    askUsdcMicro: row.ask_usdc_micro,
    imageUrls: JSON.parse(row.image_urls || "[]") as string[],
    certVerified: row.cert_verified === 1,
    certSource: row.cert_source,
    cert: JSON.parse(row.cert_payload || "{}") as CertVerificationResult,
    comp: row.comp_price_minor
      ? {
          priceMinor: row.comp_price_minor,
          source: row.comp_source,
          asOf: row.comp_as_of,
        }
      : null,
    aiGrade: row.ai_grade_payload ? JSON.parse(row.ai_grade_payload) : null,
    status: row.status,
    rejectionReason: row.rejection_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    assetId: row.asset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function previewCert(grader: SlabGrader, certNumber: string) {
  const cert = await verifySlabCert(grader, certNumber);
  return { cert };
}

export async function submitSellerListing(input: {
  sellerUserId: string;
  category: SlabCategory;
  grader: SlabGrader;
  certNumber: string;
  askUsdcMicro: bigint;
  title?: string;
  description?: string;
  imageUrls?: string[];
  runAiPreGrade?: boolean;
}) {
  if (input.askUsdcMicro <= 0n) throw new AppError(ErrorCode.VALIDATION, "askUsdcMicro must be positive");

  const cert = await verifySlabCert(input.grader, input.certNumber);
  if (!cert.verified) {
    throw new AppError(ErrorCode.VALIDATION, "Certificate could not be verified — check grader and cert number");
  }

  const title =
    input.title?.trim() ||
    cert.cardDescription ||
    `${input.category} slab ${input.certNumber}`;

  const [comp, aiGrade] = await Promise.all([
    fetchPriceComp({ title, grader: input.grader, grade: cert.grade, category: input.category }),
    input.runAiPreGrade && input.imageUrls?.[0]
      ? fetchAiPreGrade(input.imageUrls[0])
      : Promise.resolve(null),
  ]);

  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().execute(
    `INSERT INTO seller_collectible_submissions
       (id, seller_user_id, category, grader, cert_number, title, description, ask_usdc_micro, image_urls,
        cert_verified, cert_source, cert_payload, comp_price_minor, comp_source, comp_as_of, ai_grade_payload,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'pending_human', ?, ?)`,
    [
      id,
      input.sellerUserId,
      input.category,
      input.grader,
      input.certNumber.trim(),
      title,
      input.description ?? null,
      input.askUsdcMicro.toString(),
      JSON.stringify(input.imageUrls ?? []),
      cert.source,
      JSON.stringify(cert),
      comp?.priceMinor.toString() ?? null,
      comp?.source ?? null,
      comp?.asOf ?? null,
      aiGrade ? JSON.stringify(aiGrade) : null,
      now,
      now,
    ]
  );

  await logAudit({
    userId: input.sellerUserId,
    action: "collectibles.submission.create",
    resource: id,
    details: { grader: input.grader, certNumber: input.certNumber, status: "pending_human" },
  });

  const row = await getDb().queryOne<SellerSubmissionRow>(
    "SELECT * FROM seller_collectible_submissions WHERE id = ?",
    [id]
  );
  return rowToView(row!);
}

export async function listMySubmissions(sellerUserId: string) {
  const rows = await getDb().query<SellerSubmissionRow>(
    "SELECT * FROM seller_collectible_submissions WHERE seller_user_id = ? ORDER BY created_at DESC",
    [sellerUserId]
  );
  return rows.map(rowToView);
}

export async function listPendingSubmissions() {
  const rows = await getDb().query<SellerSubmissionRow>(
    `SELECT * FROM seller_collectible_submissions
     WHERE status = 'pending_human' ORDER BY created_at ASC`
  );
  return rows.map(rowToView);
}

export async function getSubmission(id: string) {
  const row = await getDb().queryOne<SellerSubmissionRow>(
    "SELECT * FROM seller_collectible_submissions WHERE id = ?",
    [id]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Submission not found");
  return rowToView(row);
}

export async function approveSubmission(id: string, reviewerId: string) {
  const row = await getDb().queryOne<SellerSubmissionRow>(
    "SELECT * FROM seller_collectible_submissions WHERE id = ?",
    [id]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Submission not found");
  if (row.status !== "pending_human") {
    throw new AppError(ErrorCode.CONFLICT, `Submission is ${row.status}, not pending review`);
  }

  const cert = JSON.parse(row.cert_payload) as CertVerificationResult;
  const asset = await tokenization.createAsset({
    kind: "collectible",
    tokenStandard: "hts",
    name: row.title ?? `Slab ${row.cert_number}`,
    symbol: `SLAB-${row.cert_number.slice(-6)}`,
    decimals: 0,
    metadata: {
      category: row.category,
      grader: row.grader,
      certNumber: row.cert_number,
      grade: cert.grade,
      sellerUserId: row.seller_user_id,
      submissionId: row.id,
      imageUrls: JSON.parse(row.image_urls || "[]"),
      listingType: "seller_p2p",
    },
    custodyAttestationUri: `cert:${row.grader}:${row.cert_number}`,
    minTier: 0,
    initialSupply: 1n,
  });

  await listings.createListing({
    assetId: asset.id,
    surface: "collect",
    priceMinor: BigInt(row.ask_usdc_micro),
    currency: "USDC",
    priceSource: `seller:${row.seller_user_id}`,
    reviewer: reviewerId,
    ddOutcome: "human_approved",
  });
  await listings.transitionListing(asset.id, "soft", reviewerId);
  await listings.transitionListing(asset.id, "public", reviewerId);

  const now = new Date().toISOString();
  await getDb().execute(
    `UPDATE seller_collectible_submissions
     SET status = 'approved', asset_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
    [asset.id, reviewerId, now, now, id]
  );

  await logAudit({
    userId: row.seller_user_id,
    action: "collectibles.submission.approved",
    resource: id,
    details: { assetId: asset.id, reviewerId },
  });

  return { submission: await getSubmission(id), assetId: asset.id };
}

export async function rejectSubmission(id: string, reviewerId: string, reason: string) {
  const row = await getDb().queryOne<SellerSubmissionRow>(
    "SELECT * FROM seller_collectible_submissions WHERE id = ?",
    [id]
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "Submission not found");
  if (row.status !== "pending_human") {
    throw new AppError(ErrorCode.CONFLICT, `Submission is ${row.status}, not pending review`);
  }

  const now = new Date().toISOString();
  await getDb().execute(
    `UPDATE seller_collectible_submissions
     SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
    [reason, reviewerId, now, now, id]
  );

  await logAudit({
    userId: row.seller_user_id,
    action: "collectibles.submission.rejected",
    resource: id,
    status: "blocked",
    details: { reason, reviewerId },
  });

  return getSubmission(id);
}
