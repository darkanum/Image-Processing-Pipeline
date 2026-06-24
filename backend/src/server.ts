import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { healthRouter } from "./api/health.js";
import { jobsRouter } from "./api/jobs.js";
import { buildOpenApiDocument } from "./api/openapi.js";
import { requestId } from "./middleware/security.js";
import { requireApiKey } from "./middleware/security.js";
import { submitRateLimiter, readRateLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { attachLogger } from "./observability/requestLogger.js";
import { httpMetricsMiddleware, register } from "./observability/metrics.js";
import { getEnv, logSecurityWarnings } from "./config/env.js";
import { logger } from "./utils/logger.js";

/**
 * Build the Express app. Composition order matters:
 *   1. requestId     - tag every request with an id
 *   2. logger        - attach per-request logger
 *   3. metrics       - time the request
 *   4. helmet        - security headers (CSP relaxed for /docs and /docs.json)
 *   5. cors          - cross-origin policy
 *   6. body parser   - JSON
 *   7. /health, /metrics, /docs, /docs.json — unauthenticated infra endpoints
 *   8. api routes    - auth + rate limit
 *   9. 404 + error handler
 */
export const buildApp = (): Express => {
  const env = getEnv();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // honor X-Forwarded-For from any proxy chain

  // --- Phase 1: request context ---
  app.use(requestId);
  app.use(attachLogger);
  app.use(httpMetricsMiddleware);

  // --- Phase 2: hard security defaults ---
  // helmet: secure-by-default headers (CSP, X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy, etc.). CSP is set to be permissive enough for our SPA
  // (which loads images from Firestore Storage emulator) but still tight.
  // We also relax CSP for the Swagger UI at /docs — it needs 'unsafe-inline'
  // for its own inline scripts. In production you'd use a CSP nonce.
  const cspDirectives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // The SPA needs to call our API, the Firestore emulator,
    // and the Storage emulator. Allow the dev defaults in dev only.
    "connect-src": [
      "'self'",
      // Wildcard for emulator ports — production replaces this
      // with a fixed allow-list via ALLOWED_ORIGINS in the API.
      "http://localhost:*",
      "ws://localhost:*",
    ],
    "img-src": ["'self'", "data:", "blob:", "http://localhost:*"],
    "script-src": ["'self'", "'unsafe-inline'"], // unsafe-inline for Swagger UI inline scripts
    "style-src": ["'self'", "'unsafe-inline'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "frame-ancestors": ["'none'"],
    "font-src": ["'self'", "https:", "data:"],
  };
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: cspDirectives,
      },
      hsts: env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      crossOriginEmbedderPolicy: false, // we serve images from a different origin
    }),
  );

  // --- Phase 3: CORS lockdown ---
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin / curl (no origin header) in any environment.
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0) return callback(null, true); // dev mode
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Api-Key", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
      maxAge: 600,
    }),
  );

  // --- Phase 4: body parsing with size cap ---
  app.use(express.json({ limit: "64kb" }));

  // --- Phase 5: unauthenticated infra endpoints ---
  app.use("/health", healthRouter);
  app.get("/metrics", async (_req: Request, res: Response) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  // --- Phase 6: API documentation (OpenAPI 3.0.3 + Swagger UI) ---
  // The OpenAPI spec is regenerated on every request so any runtime
  // schema change is reflected immediately. The UI is mounted at
  // /docs and the raw JSON spec at /docs.json. Both are public —
  // they're doc endpoints, not operational surfaces.
  app.get("/docs.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.json(buildOpenApiDocument());
  });
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(buildOpenApiDocument(), {
      customSiteTitle: "Image Processing API",
      customCss: ".swagger-ui .topbar { display: none }", // hide top bar — looks cleaner
      swaggerOptions: {
        persistAuthorization: true, // remember the X-Api-Key value across page reloads
        docExpansion: "list",        // collapse everything by default
        filter: true,               // add a search box
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    }),
  );

  // --- Phase 7: authenticated API ---
  app.use("/api/jobs", requireApiKey, jobsRouter);
  // Public (unauthenticated) read endpoints use a separate rate limit.
  app.use("/api/jobs", readRateLimiter, jobsRouter);
  app.use(submitRateLimiter);

  // --- Phase 8: catch-alls ---
  app.use(notFoundHandler);
  app.use((err: Error, req: Request, res: Response, next: NextFunction) =>
    errorHandler(err, req, res, next),
  );

  return app;
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const env = getEnv();
  logSecurityWarnings(logger);
  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, apiKeyRequired: Boolean(env.API_KEY) },
      "API server listening",
    );
    logger.info(
      { url: `http://localhost:${env.PORT}/docs` },
      "OpenAPI docs available at /docs (Swagger UI) and /docs.json (raw spec)",
    );
  });

  // Graceful shutdown — give in-flight requests 10s to finish before
  // closing the listener, then force-exit.
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutdown: signal received, draining connections");
    const timer = setTimeout(() => {
      logger.error("shutdown: forced exit after 10s grace period");
      process.exit(1);
    }, 10_000);
    server.close((err) => {
      if (err) logger.error({ err: err.message }, "shutdown: server.close error");
      clearTimeout(timer);
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
