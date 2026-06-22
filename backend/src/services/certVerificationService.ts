/**
 * Slab cert verification — PSA, GemRate, PriceCharting comps, CardGrade pre-grade.
 * Simulated defaults for dev; wire API keys for production.
 */

import { config } from "../config";
import { AppError, ErrorCode } from "../errors";

export type SlabGrader = "psa" | "bgs" | "sgc" | "cgc";
export type SlabCategory = "sports" | "pokemon";

export interface CertVerificationResult {
  verified: boolean;
  source: string;
  grader: SlabGrader;
  certNumber: string;
  cardDescription?: string;
  grade?: string;
  year?: string;
  brand?: string;
  subject?: string;
  imageUrl?: string;
  raw?: Record<string, unknown>;
}

export interface PriceCompResult {
  source: string;
  priceMinor: bigint;
  currency: string;
  asOf: string;
  label?: string;
}

export interface AiPreGradeResult {
  source: string;
  predictedGrade?: string;
  confidence?: number;
  notes?: string;
  raw?: Record<string, unknown>;
}

const SIMULATED_CERTS: Record<string, Omit<CertVerificationResult, "certNumber" | "grader" | "source">> = {
  "12345678": {
    verified: true,
    cardDescription: "2019 Pokémon SM Black Star Promo Pikachu-Holo",
    grade: "10",
    year: "2019",
    brand: "Pokémon",
    subject: "Pikachu",
  },
  "87654321": {
    verified: true,
    cardDescription: "1986 Fleer Michael Jordan #57",
    grade: "9",
    year: "1986",
    brand: "Fleer",
    subject: "Michael Jordan",
  },
};

async function verifyPsa(certNumber: string): Promise<CertVerificationResult> {
  const token = config.PSA_API_TOKEN;
  if (!token) {
    const sim = SIMULATED_CERTS[certNumber];
    if (sim) {
      return { ...sim, source: "simulated", grader: "psa", certNumber };
    }
    return { verified: false, source: "simulated", grader: "psa", certNumber };
  }

  const url = `https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    return { verified: false, source: "psa", grader: "psa", certNumber, raw: { status: res.status } };
  }
  const body = (await res.json()) as Record<string, unknown>;
  const psaCert = (body.PSACert as Record<string, unknown> | undefined) ?? body;
  const grade = String(psaCert.CardGrade ?? psaCert.GradeDescription ?? "");
  return {
    verified: true,
    source: "psa",
    grader: "psa",
    certNumber,
    cardDescription: String(psaCert.Subject ?? psaCert.CardNumber ?? psaCert.Brand ?? "PSA slab"),
    grade: grade || undefined,
    year: psaCert.Year ? String(psaCert.Year) : undefined,
    brand: psaCert.Brand ? String(psaCert.Brand) : undefined,
    subject: psaCert.Subject ? String(psaCert.Subject) : undefined,
    imageUrl: psaCert.ImageURL ? String(psaCert.ImageURL) : undefined,
    raw: body,
  };
}

async function verifyGemRate(grader: SlabGrader, certNumber: string): Promise<CertVerificationResult> {
  const key = config.GEMRATE_API_KEY;
  if (!key) {
    if (grader === "psa") return verifyPsa(certNumber);
    const sim = SIMULATED_CERTS[certNumber];
    return sim
      ? { ...sim, source: "simulated", grader, certNumber }
      : { verified: false, source: "simulated", grader, certNumber };
  }

  const res = await fetch("https://api.gemrate.com/v1/universal-cert-lookup", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ grader, cert_number: certNumber }),
  });
  if (!res.ok) {
    return { verified: false, source: "gemrate", grader, certNumber, raw: { status: res.status } };
  }
  const body = (await res.json()) as Record<string, unknown>;
  return {
    verified: true,
    source: "gemrate",
    grader,
    certNumber,
    cardDescription: String(body.description ?? body.card_name ?? ""),
    grade: body.grade ? String(body.grade) : undefined,
    raw: body,
  };
}

export async function verifySlabCert(grader: SlabGrader, certNumber: string): Promise<CertVerificationResult> {
  const normalized = certNumber.trim().replace(/\s+/g, "");
  if (!/^\d{6,12}$/.test(normalized)) {
    throw new AppError(ErrorCode.VALIDATION, "certNumber must be 6–12 digits");
  }

  switch (config.CERT_VERIFY_PROVIDER) {
    case "gemrate":
      return verifyGemRate(grader, normalized);
    case "psa":
      if (grader !== "psa") {
        throw new AppError(ErrorCode.VALIDATION, "CERT_VERIFY_PROVIDER=psa only supports PSA slabs");
      }
      return verifyPsa(normalized);
    default:
      if (grader === "psa") return verifyPsa(normalized);
      return verifyGemRate(grader, normalized);
  }
}

export async function fetchPriceComp(input: {
  title: string;
  grader: SlabGrader;
  grade?: string;
  category: SlabCategory;
}): Promise<PriceCompResult | null> {
  const key = config.PRICECHARTING_API_KEY;
  if (!key) {
    const base = input.category === "pokemon" ? 45_000_000n : 120_000_000n;
    const gradeBump = input.grade === "10" ? 50_000_000n : input.grade === "9" ? 20_000_000n : 0n;
    return {
      source: "simulated",
      priceMinor: base + gradeBump,
      currency: "USDC",
      asOf: new Date().toISOString(),
      label: `Simulated comp for ${input.title}`,
    };
  }

  const q = encodeURIComponent(input.title.slice(0, 80));
  const res = await fetch(`https://www.pricecharting.com/api/product?t=${key}&q=${q}`);
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, unknown>;
  const price = body["graded-price"] ?? body["manual-only-price"];
  if (price == null) return null;
  const dollars = Number(price);
  if (!Number.isFinite(dollars)) return null;
  return {
    source: "pricecharting",
    priceMinor: BigInt(Math.round(dollars * 1_000_000)),
    currency: "USDC",
    asOf: new Date().toISOString(),
    label: String(body["product-name"] ?? input.title),
  };
}

export async function fetchAiPreGrade(imageUrl: string): Promise<AiPreGradeResult | null> {
  const key = config.CARDGRADE_API_KEY;
  if (!key || !imageUrl.trim()) {
    return {
      source: "simulated",
      predictedGrade: "8",
      confidence: 0.72,
      notes: "Advisory only — not a legal grade. Human review required.",
    };
  }

  const res = await fetch("https://api.cardgrade.io/api/v1/grade", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, unknown>;
  return {
    source: "cardgrade",
    predictedGrade: body.overall_grade ? String(body.overall_grade) : undefined,
    confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    notes: "Advisory AI pre-grade — not PSA/BGS legal grade.",
    raw: body,
  };
}
