import client from "prom-client";

/**
 * Process-wide Prometheus metrics. Exposed at /metrics in the API.
 *
 * Cardinality: histograms use coarse buckets that make sense for an
 * image-processing pipeline (sub-second download, multi-second
 * transform, multi-MB payload sizes). Adjust if you need finer
 * resolution in production.
 */
export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Count of HTTP requests by route, method, and status code.",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const jobsEnqueuedTotal = new client.Counter({
  name: "jobs_enqueued_total",
  help: "Number of image processing jobs enqueued.",
  labelNames: ["status"] as const, // accepted | rejected
  registers: [register],
});

export const jobsCompletedTotal = new client.Counter({
  name: "jobs_completed_total",
  help: "Number of image processing jobs that finished.",
  labelNames: ["outcome"] as const, // success | failed
  registers: [register],
});

export const jobsActive = new client.Gauge({
  name: "jobs_active",
  help: "Number of jobs currently being processed by workers.",
  registers: [register],
});

export const jobProcessingDurationSeconds = new client.Histogram({
  name: "job_processing_duration_seconds",
  help: "End-to-end job processing duration in the worker.",
  labelNames: ["outcome"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [register],
});

export const imageBytesProcessed = new client.Counter({
  name: "image_bytes_processed_total",
  help: "Total bytes of source images processed (after download).",
  registers: [register],
});

/**
 * Middleware that records every HTTP request's count and latency.
 * Route label uses the route pattern (e.g. "/api/jobs/:id") so
 * cardinality stays bounded.
 */
import type { NextFunction, Request, Response } from "express";
export const httpMetricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const end = httpRequestDurationSeconds.startTimer();
  res.on("finish", () => {
    // Prefer the matched route pattern over the raw URL to keep cardinality bounded.
    const route = (req.route?.path as string | undefined) ?? req.path;
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
};
