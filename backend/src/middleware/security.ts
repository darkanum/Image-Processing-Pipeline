import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    /** Unique id assigned at the edge of the request pipeline. */
    id: string;
    /** Wall-clock start time for latency tracking. */
    startedAt: number;
  }
}

/**
 * Assign every incoming request a unique id and a start timestamp.
 * The id is exposed in the `X-Request-Id` response header so the browser
 * (and any upstream proxy / log aggregator) can correlate logs.
 */
export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header("x-request-id");
  req.id = incoming && /^[A-Za-z0-9_\-]{6,128}$/.test(incoming) ? incoming : randomUUID();
  req.startedAt = Date.now();
  res.setHeader("X-Request-Id", req.id);
  next();
};

/**
 * Reject requests with no / wrong API key. We compare in constant time to
 * avoid timing-side-channel attacks on the key.
 *
 * In production this would be replaced by an OAuth2 bearer token / mTLS
 * / signed JWT — the surface is identical (one middleware on the routes
 * you want to protect) so the swap is mechanical.
 */
const UNSAFE_KEYS = new Set(["changeme", "demo", "test", "dev", "secret"]);

export const requireApiKey = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const env = process.env.API_KEY ?? "";
  // If no API key is configured, treat the API as open. This keeps the
  // emulator-mode demo runnable but should be turned on before any public
  // deploy. We also log a warning at startup (see config/env.ts).
  if (env.length === 0) return next();

  if (UNSAFE_KEYS.has(env)) {
    // Fail-closed if a placeholder key is configured.
    res.status(503).json({
      error: "API key is set to an unsafe placeholder; set API_KEY to a strong secret",
      requestId: req.id,
    });
    return;
  }

  const presented =
    req.header("x-api-key") ??
    (req.header("authorization")?.startsWith("Bearer ")
      ? req.header("authorization")!.slice("Bearer ".length)
      : null);

  if (!presented) {
    res.status(401).json({ error: "Missing API key", requestId: req.id });
    return;
  }
  if (!constantTimeEqual(presented, env)) {
    res.status(401).json({ error: "Invalid API key", requestId: req.id });
    return;
  }
  next();
};

/** Constant-time string compare. Both inputs must be the same length. */
const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
