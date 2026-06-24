import type { NextFunction, Request, Response } from "express";

/**
 * Pino logger attached to each request so handlers can log structured
 * fields without re-plumbing the request id.
 */
declare module "express-serve-static-core" {
  interface Request {
    log: {
      info: (obj: Record<string, unknown>, msg?: string) => void;
      warn: (obj: Record<string, unknown>, msg?: string) => void;
      error: (obj: Record<string, unknown>, msg?: string) => void;
      debug: (obj: Record<string, unknown>, msg?: string) => void;
    };
  }
}

import { logger as rootLogger } from "../utils/logger.js";

export const attachLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  req.log = {
    info: (obj, msg) => rootLogger.info({ ...obj, requestId: req.id, route: req.path }, msg),
    warn: (obj, msg) => rootLogger.warn({ ...obj, requestId: req.id, route: req.path }, msg),
    error: (obj, msg) => rootLogger.error({ ...obj, requestId: req.id, route: req.path }, msg),
    debug: (obj, msg) => rootLogger.debug({ ...obj, requestId: req.id, route: req.path }, msg),
  };
  res.on("finish", () => {
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    const ms = Date.now() - start;
    rootLogger[level](
      { requestId: req.id, method: req.method, route: req.path, status: res.statusCode, ms },
      "http request",
    );
  });
  next();
};
