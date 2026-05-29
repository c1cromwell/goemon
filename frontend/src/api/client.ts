/**
 * Phase 5A — Minimal admin API client.
 *
 * Stores the admin JWT in localStorage and attaches it as a Bearer token. Expanded
 * into the full customer-portal client in Phase 8.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3001/api";
const TOKEN_KEY = "bankai_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code ?? "ERROR";
    const message = body?.error?.message ?? res.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return body as T;
}

export interface IdentitySummary {
  user_id: string;
  email: string;
  full_name: string | null;
  is_simulated: boolean;
  tier: number;
  identity_status: string;
  risk_tier: string;
  session_status: string | null;
  decision: string | null;
  pii_confidence: number | null;
  created_at: string;
}

export interface ReviewItem {
  session_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  pii_confidence: number | null;
  decision: string | null;
  created_at: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; role: string }>("/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  seed: () => request<{ created: boolean; email: string }>("/admin/seed", { method: "POST" }),
  identities: () => request<IdentitySummary[]>("/admin/identities"),
  identityDetail: (userId: string) => request<Record<string, unknown>>(`/admin/identities/${userId}`),
  reviewQueue: () => request<ReviewItem[]>("/admin/onboarding/sessions?status=review_required"),
  decide: (sessionId: string, approve: boolean) =>
    request(`/admin/onboarding/sessions/${sessionId}/decision`, { method: "POST", body: JSON.stringify({ approve }) }),
  simulate: (profiles?: string[]) =>
    request<{ results: Array<{ profile: string; decision: string; status: string; expected: string }> }>(
      "/admin/simulations",
      { method: "POST", body: JSON.stringify({ profiles }) }
    ),
};
