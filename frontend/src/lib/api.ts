/**
 * Tiny fetch wrapper that attaches the API key (if configured at build
 * time) to every request and surfaces structured errors with the
 * request id so users can include it in support tickets.
 */
export interface ApiErrorPayload {
  error: string;
  code?: string;
  requestId?: string;
  details?: unknown;
}

const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? "";
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

export const apiBase = (): string => API_BASE;

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
  const url = `${API_BASE}${path}`;
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
