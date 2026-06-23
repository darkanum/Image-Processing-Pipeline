import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { healthRouter } from "./api/health.js";
import { jobsRouter } from "./api/jobs.js";
import { logger } from "./utils/logger.js";
import { getEnv } from "./config/env.js";

export const buildApp = (): Express => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  // Lightweight request logger
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.debug(
        { method: req.method, url: req.originalUrl, ms: Date.now() - start, status: res.statusCode },
        "http request",
      );
    });
    next();
  });

  app.use("/health", healthRouter);
  app.use("/api/jobs", jobsRouter);

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Centralized error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, "request failed");
    const status = (err as Error & { status?: number }).status ?? 500;
    res.status(status).json({ error: err.message || "Internal server error" });
  });

  return app;
};

// Start the server when executed directly (production entrypoint).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const env = getEnv();
  const app = buildApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "API server listening");
  });
}
