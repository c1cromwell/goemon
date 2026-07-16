/**
 * Thin HTTP client for the harness. Surfaces backend `error.code` so journeys
 * can assert on stable ErrorCodes. Money POSTs should pass Idempotency-Key.
 */

export class HarnessHttpError extends Error {
  readonly code: string;
  readonly status: number;
  readonly body: unknown;

  constructor(code: string, message: string, status: number, body: unknown) {
    super(message);
    this.name = "HarnessHttpError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export interface RequestOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  bearer?: string;
  idempotencyKey?: string;
  body?: unknown;
  /** When true, do not throw on non-2xx — return { status, json }. */
  allowError?: boolean;
}

export interface HarnessClient {
  baseUrl: string;
  request<T = unknown>(path: string, opts?: RequestOpts): Promise<{ status: number; json: T }>;
  get<T = unknown>(path: string, bearer?: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown, opts?: Omit<RequestOpts, "method" | "body">): Promise<T>;
}

export function createClient(baseUrl: string): HarnessClient {
  const root = baseUrl.replace(/\/$/, "");

  async function request<T = unknown>(
    path: string,
    opts: RequestOpts = {}
  ): Promise<{ status: number; json: T }> {
    const url = path.startsWith("http") ? path : `${root}${path.startsWith("/") ? "" : "/"}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    let json: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    if (!res.ok && !opts.allowError) {
      const err = (json as { error?: { code?: string; message?: string } })?.error;
      throw new HarnessHttpError(
        err?.code ?? "HTTP_ERROR",
        err?.message ?? `HTTP ${res.status}`,
        res.status,
        json
      );
    }

    return { status: res.status, json: json as T };
  }

  return {
    baseUrl: root,
    request,
    async get<T>(path: string, bearer?: string): Promise<T> {
      const r = await request<T>(path, { method: "GET", bearer });
      return r.json;
    },
    async post<T>(path: string, body: unknown, opts: Omit<RequestOpts, "method" | "body"> = {}): Promise<T> {
      const r = await request<T>(path, { ...opts, method: "POST", body });
      return r.json;
    },
  };
}
