import { Worker, type Job } from "bullmq";
import { QUEUE_NAME, buildRedisClient } from "./services/queue.js";
import { processImageJob } from "./workers/imageWorker.js";
import { logger } from "./utils/logger.js";
import { getEnv } from "./config/env.js";
import { startCleanupScheduler } from "./services/cleanup.js";
import {
  jobsActive,
  jobsCompletedTotal,
  jobProcessingDurationSeconds,
} from "./observability/metrics.js";
import { register } from "./observability/metrics.js";

const env = getEnv();
const connection = buildRedisClient();

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => processImageJob(job, job.data),
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  },
);

worker.on("ready", () => {
  logger.info(
    { queue: QUEUE_NAME, concurrency: env.WORKER_CONCURRENCY },
    "imageProcessing worker ready",
  );
  // Start the periodic cleanup loop. In a multi-worker cluster run this
  // in only one instance (use a leader-election lock if needed).
  startCleanupScheduler();
});

worker.on("failed", (job, err) => {
  jobsCompletedTotal.inc({ outcome: "failed" });
  jobsActive.dec();
  logger.error(
    { id: job?.id, err: err.message, attemptsMade: job?.attemptsMade },
    "worker: job failed",
  );
});

worker.on("completed", (job) => {
  jobsCompletedTotal.inc({ outcome: "success" });
  jobsActive.dec();
  if (job.processedOn && job.finishedOn) {
    const duration = (job.finishedOn - job.processedOn) / 1000;
    jobProcessingDurationSeconds.observe({ outcome: "success" }, duration);
  }
  logger.info({ id: job.id }, "worker: job completed");
});

worker.on("error", (err) => {
  logger.error({ err: err.message }, "worker: queue error");
});

// Track active jobs.
worker.on("active", () => jobsActive.inc());
worker.on("stalled", () => logger.warn("worker: job stalled"));

// Graceful shutdown — stop accepting new jobs, let in-flight finish.
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker: shutdown signal received, draining");
  const timer = setTimeout(() => {
    logger.error("worker: forced exit after 30s grace period");
    process.exit(1);
  }, 30_000);
  try {
    await worker.close(); // stops accepting + waits for in-flight
    await connection.quit();
    logger.info("worker: clean shutdown complete");
    clearTimeout(timer);
    process.exit(0);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "worker: shutdown error");
    process.exit(1);
  }
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Periodically emit the current metric snapshot to logs (every 60s).
// Lets an operator tail logs to see throughput without scraping /metrics.
setInterval(() => {
  void register.getMetricsAsJSON().then((metrics) => {
    const active = (metrics.find((m) => m.name === "jobs_active")?.values?.[0]?.value as number) ?? 0;
    const completed =
      (metrics
        .find((m) => m.name === "jobs_completed_total")
        ?.values?.reduce((acc, v) => acc + Number(v.value), 0) as number) ?? 0;
    logger.info({ jobs_active: active, jobs_completed_total: completed }, "metrics snapshot");
  });
}, 60_000);
