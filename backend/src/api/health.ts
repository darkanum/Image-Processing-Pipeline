import { Router, type Request, type Response } from "express";

export const healthRouter = Router();

interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Sub-checks for /health/ready. Cheap to run. */
const runChecks = async (): Promise<HealthCheck[]> => [
  { name: "process", ok: true },
  {
    name: "uptime",
    ok: true,
    detail: `${Math.round(process.uptime())}s`,
  },
  {
    name: "memory",
    ok: process.memoryUsage().rss < 1024 * 1024 * 1024, // warn above 1GB
    detail: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS`,
  },
];

healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime(), ts: Date.now() });
});

/**
 * Readiness check — used by Kubernetes / load balancers to decide
 * whether to route traffic to this instance. Returns 503 if any sub-
 * check fails, so an unhealthy instance is removed from the pool.
 */
healthRouter.get("/ready", async (_req: Request, res: Response) => {
  const checks = await runChecks();
  const allOk = checks.every((c) => c.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ready" : "degraded",
    checks,
    ts: Date.now(),
  });
});

/** Liveness — used by Kubernetes to decide whether to restart. */
healthRouter.get("/live", (_req: Request, res: Response) => {
  res.json({ status: "alive", pid: process.pid });
});
