import rateLimit from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";

/**
 * Per-IP rate limiter for state-changing endpoints (POST /api/jobs).
 * In-memory store; for multi-instance deployments swap for a Redis-
 * backed store via `rate-limit-redis`.
 */
export const submitRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,          // 30 submissions / minute / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many jobs submitted; slow down and try again shortly." },
  keyGenerator: (req: Request): string => req.ip ?? "anonymous",
});

/** Generous read rate-limit (just enough to keep Firestore sane). */
export const readRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests; slow down." },
  keyGenerator: (req: Request): string => req.ip ?? "anonymous",
});
