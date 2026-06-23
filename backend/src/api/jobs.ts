import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getImageQueue, QUEUE_NAME } from "../services/queue.js";
import {
  createJobRecord,
  getJobRecord,
  listJobRecords,
} from "../services/jobRepository.js";
import { logger } from "../utils/logger.js";
import type { JobRecord } from "../types/job.js";

const createJobSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine(
      (u) => {
        try {
          const p = new URL(u);
          return p.protocol === "http:" || p.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "url must be http(s)" },
    ),
});

export const jobsRouter = Router();

/**
 * POST /api/jobs
 * Body: { url: string }
 * Creates a Firestore job record and enqueues a BullMQ job.
 */
jobsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        issues: parsed.error.issues,
      });
    }

    const queue = getImageQueue();
    // BullMQ job id == Firestore doc id so the worker can update by id alone.
    const bullJob = await queue.add(
      QUEUE_NAME,
      { url: parsed.data.url },
      { /* default options from queue */ },
    );

    const now = Date.now();
    const record: JobRecord = {
      id: bullJob.id!,
      url: parsed.data.url,
      status: "pending",
      progress: 0,
      currentStep: "queued",
      resultUrl: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      metadata: {},
    };
    await createJobRecord(record);

    logger.info({ id: bullJob.id, url: parsed.data.url }, "job created");
    return res.status(201).json(record);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/jobs
 * List recent jobs (newest first).
 */
jobsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await listJobRecords(50);
    return res.json({ jobs });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/jobs/:id
 * Returns a single job record, or 404 if it doesn't exist.
 */
jobsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const job = await getJobRecord(id);
    if (!job) {
      return res.status(404).json({ error: "Job not found", id });
    }
    return res.json(job);
  } catch (err) {
    return next(err);
  }
});
