import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getImageQueue, QUEUE_NAME } from "../services/queue.js";
import {
  createJobRecord,
  getJobRecord,
  listJobRecords,
} from "../services/jobRepository.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_TRANSFORM, type JobRecord, type TransformSpec } from "../types/job.js";

const watermarkPosition = z.enum([
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
]);

const watermarkSchema = z.object({
  kind: z.enum(["text", "image"]),
  text: z.string().max(512).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  position: watermarkPosition,
  margin: z.number().int().min(0).max(500),
  opacity: z.number().int().min(0).max(100),
  size: z.number().int().min(8).max(2000),
});

const resizeSchema = z.object({
  mode: z.enum(["fit", "crop", "pad", "none"]),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  lockAspectRatio: z.boolean(),
  preset: z.string().max(64).optional(),
  aspectRatio: z.string().regex(/^\d+:\d+$/).optional(),
  padBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const cropSchema = z.object({
  aspectRatio: z.string().regex(/^\d+:\d+$/).optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  anchor: z.enum(["center", "top", "bottom", "left", "right", "attention"]).optional(),
});

const transformSchema = z.object({
  outputFormat: z.enum(["png", "jpeg", "webp", "original"]).default("original"),
  quality: z.number().int().min(1).max(100).default(82),
  resize: resizeSchema.nullable().default(null),
  crop: cropSchema.nullable().default(null),
  grayscale: z.boolean().default(false),
  watermark: watermarkSchema.nullable().default(null),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  flipHorizontal: z.boolean().default(false),
  flipVertical: z.boolean().default(false),
  opacity: z.number().int().min(0).max(100).default(100),
});

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
  transform: transformSchema.optional(),
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
      return res.status(400).json({
        error: "Invalid request",
        issues: parsed.error.issues,
      });
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
