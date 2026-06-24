import { NextFunction, Request, Response } from "express";

/**
 * Centralized error handler. Converts thrown errors / rejected promises
 * into structured JSON responses with a stable shape:
 *
 *   { error: "human readable", requestId: "uuid", code?: "string" }
 *
 * Stack traces are only logged (not returned) — leaks in production are
 * an information-disclosure risk.
 */
export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: "Not found", requestId: res.getHeader("X-Request-Id") });
};

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const status = typeof err.status === "number" && err.status >= 400 && err.status < 600 ? err.status : 500;
  const requestId = req.id;
  // Log full error including stack for 5xx, only message for 4xx.
  if (status >= 500) {
    req.log?.error({ err, requestId }, "request failed");
  } else {
    req.log?.warn({ err: { message: err.message, code: err.code }, requestId }, "request rejected");
  }
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message || "Bad request",
    code: err.code,
    requestId,
  });
};

/** Helper to throw structured errors from routes. */
export const apiError = (status: number, message: string, code?: string, details?: unknown): ApiError => {
  const e = new Error(message) as ApiError;
  e.status = status;
  if (code) e.code = code;
  if (details) e.details = details;
  return e;
};
