import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getImageQueue, QUEUE_NAME } from "../services/queue.js";
import {
  createJobRecord,
  getJobRecord,
  listJobRecords,
} from "../services/jobRepository.js";
import { logger } from "../utils/logger.js";
import { jobsEnqueuedTotal } from "../observability/metrics.js";
import { apiError } from "../middleware/errorHandler.js";
import { DEFAULT_TRANSFORM, type JobRecord, type TransformSpec } from "../types/job.js";
import { createJobRequestSchema } from "./openapi.js";

/** Re-export the schemas so existing tests / external imports still work. */
export { createJobRequestSchema } from "./openapi.js";

/** Local validation extends the shared request schema with a runtime
 *  check on the URL protocol. The OpenAPI `format: uri` already implies
 *  http(s) but zod's `.url()` accepts ftp:// and friends, so we add
 *  the protocol guard here. */
const createJobSchema = createJobRequestSchema.extend({
  url: createJobRequestSchema.shape.url.refine(
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
 * Body: { url: string, transform?: TransformSpec }
 * Creates a Firestore job record and enqueues a BullMQ job.
 */
jobsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      jobsEnqueuedTotal.inc({ status: "rejected" });
      throw apiError(400, "Invalid request", "VALIDATION_FAILED", parsed.error.issues);
    }

    const transform: TransformSpec = parsed.data.transform
      ? { ...DEFAULT_TRANSFORM, ...parsed.data.transform }
      : DEFAULT_TRANSFORM;

    const queue = getImageQueue();
    // BullMQ job id == Firestore doc id so the worker can update by id alone.
    const bullJob = await queue.add(
      QUEUE_NAME,
      { url: parsed.data.url, transform },
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
      transform,
      metadata: {},
    };
    await createJobRecord(record);

    jobsEnqueuedTotal.inc({ status: "accepted" });
    logger.info(
      { id: bullJob.id, url: parsed.data.url, hasTransform: true },
      "job created",
    );
    return res.status(201).json(record);
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/jobs?limit=N&cursor=<id>
 * List recent jobs (newest first). Capped to 200 to bound payload size.
 * Cursor is the last job's `id`; pass it to get the next page.
 */
jobsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 50;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
    const jobs = await listJobRecords(limit, cursor);
    const nextCursor = jobs.length === limit ? jobs[jobs.length - 1]!.id : null;
    return res.json({ jobs, nextCursor });
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
