import { Worker, type Job } from "bullmq";
import { QUEUE_NAME, buildRedisClient } from "./services/queue.js";
import { processImageJob } from "./workers/imageWorker.js";
import { logger } from "./utils/logger.js";
import { getEnv } from "./config/env.js";

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
});

worker.on("failed", (job, err) => {
  logger.error(
    { id: job?.id, err: err.message, attemptsMade: job?.attemptsMade },
    "worker: job failed",
  );
});

worker.on("completed", (job) => {
  logger.info({ id: job.id }, "worker: job completed");
});

worker.on("error", (err) => {
  logger.error({ err: err.message }, "worker: queue error");
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "shutting down worker");
  try {
    await worker.close();
    await connection.quit();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "shutdown error");
  }
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
