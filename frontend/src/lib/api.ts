/**
 * Tiny fetch wrapper that attaches the API key (if configured at build
 * time) to every request and surfaces structured errors with the
 * request id so users can include it in support tickets.
 *
 * `VITE_API_URL` is the *host* of the API (no path). The wrapper always
 * prefixes paths with `/api` because that's where the Express router
 * is mounted. This means callers can pass plain resource paths like
 * `/jobs` and the wrapper builds `/api/jobs` regardless of whether the
 * app is served from the API host directly (dev) or from a different
 * origin (production).
 */
export interface ApiErrorPayload {
  error: string;
  code?: string;
  requestId?: string;
  details?: unknown;
}

const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";
const API_HOST = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
// Always go through /api. In dev the SPA and API share an origin via
// nginx proxy so the leading "" keeps the URL relative; in production
// the API_HOST is the absolute origin and we still hit /api.
const API_PREFIX = "/api";

export const apiBase = (): string => `${API_HOST}${API_PREFIX}`;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error || `Request failed (${status})`);
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.requestId;
  }
}

interface RequestOpts {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

export const apiRequest = async <T>(path: string, opts: RequestOpts = {}): Promise<T> => {
  const url = `${API_HOST}${API_PREFIX}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-Api-Key"] = API_KEY;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "POST",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      throw new ApiError(0, {
        error:
          "Failed to fetch — backend unreachable. Is the API container running and reachable?",
        code: "NETWORK",
      });
    }
    throw err;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
};
