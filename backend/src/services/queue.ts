import { Queue, type ConnectionOptions } from "bullmq";
import IORedis, { type Redis, type RedisOptions } from "ioredis";
import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const QUEUE_NAME = "imageProcessing";

let queue: Queue | null = null;

/**
 * Build a Redis connection options object from env.
 * Throws early on misconfig so we fail fast.
 */
export const buildRedisConnection = (): RedisOptions & { maxRetriesPerRequest: null } => {
  const env = getEnv();
  const opts: RedisOptions & { maxRetriesPerRequest: null } = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
  };
  if (env.REDIS_PASSWORD) {
    opts.password = env.REDIS_PASSWORD;
  }
  return opts;
};

/**
 * Lazily-instantiated BullMQ queue. Reused across requests in the API process.
 */
export const getImageQueue = (): Queue => {
  if (queue) return queue;
  const conn = buildRedisConnection();
  // BullMQ's ConnectionOptions is a structural subset of RedisOptions.
  queue = new Queue(QUEUE_NAME, {
    connection: conn as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600, count: 1000 },
    },
  });
  logger.info({ queue: QUEUE_NAME }, "BullMQ queue ready");
  return queue;
};

/**
 * Build a raw Redis client (used by the worker, which manages its own lifecycle).
 */
export const buildRedisClient = (): Redis => {
  const conn = buildRedisConnection();
  return new IORedis(conn);
};

/** Test helper. */
export const __resetQueueForTests = (): void => {
  queue = null;
};
