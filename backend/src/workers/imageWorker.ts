import type { Job } from "bullmq";
import { downloadImage } from "../services/downloader.js";
import { transformImage } from "../services/imageProcessor.js";
import {
  markJobFailed,
  updateJobRecord,
  updateJobMetadata,
  uploadResult,
} from "../services/jobRepository.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_TRANSFORM, type ProgressUpdate, type TransformSpec } from "../types/job.js";

interface JobPayload {
  url: string;
  transform?: TransformSpec;
}

const STEPS = {
  downloading: { progress: 25, status: "downloading" as const, step: "downloading" as const },
  processing: { progress: 55, status: "processing" as const, step: "processing" as const },
  uploading: { progress: 85, status: "uploading" as const, step: "uploading" as const },
  completed: { progress: 100, status: "completed" as const, step: "completed" as const },
};

const reportProgress = async (id: string, p: ProgressUpdate): Promise<void> => {
  await updateJobRecord(id, p);
};

/**
 * Process a single image-processing job:
 *   1. download source
 *   2. transform (resize + crop + grayscale + watermark + rotate + flip + opacity + format)
 *   3. upload result to Firebase Storage
 *   4. mark completed
 *
 * On failure: mark failed with errorMessage; rethrow so BullMQ retries (up to N attempts).
 */
export const processImageJob = async (
  job: Job,
  payload: JobPayload,
): Promise<void> => {
  const id = String(job.id);
  const url = payload?.url;
  const transform: TransformSpec = payload?.transform
    ? { ...DEFAULT_TRANSFORM, ...payload.transform }
    : DEFAULT_TRANSFORM;

  if (!url) {
    const msg = "Job payload missing 'url'";
    await markJobFailed(id, msg);
    throw new Error(msg);
  }

  logger.info({ id, url, attempt: job.attemptsMade + 1 }, "processing job");

  // Step 1: download
  await reportProgress(id, {
    status: STEPS.downloading.status,
    progress: STEPS.downloading.progress,
    currentStep: STEPS.downloading.step,
  });

  let downloaded;
  try {
    downloaded = await downloadImage(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(id, message);
    const code = (err as Error & { code?: string }).code;
    const nonRetryable = code === "INVALID_URL" || code === "NOT_IMAGE" || code === "TOO_LARGE";
    if (nonRetryable) {
      throw new UnrecoverableError(message);
    }
    throw err;
  }

  await updateJobMetadata(id, {
    metadata: { bytes: downloaded.bytes, format: downloaded.contentType.split("/")[1] ?? "unknown" },
  });

  // Step 2: transform
  await reportProgress(id, {
    status: STEPS.processing.status,
    progress: STEPS.processing.progress,
    currentStep: STEPS.processing.step,
  });

  let transformed;
  try {
    transformed = await transformImage(downloaded.buffer, transform);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(id, `Transform failed: ${message}`);
    throw new UnrecoverableError(`Transform failed: ${message}`);
  }

  await updateJobMetadata(id, {
    metadata: {
      width: transformed.width,
      height: transformed.height,
      format: transformed.format,
    },
  });

  // Step 3: upload
  await reportProgress(id, {
    status: STEPS.uploading.status,
    progress: STEPS.uploading.progress,
    currentStep: STEPS.uploading.step,
  });

  const mime = `image/${transformed.format}`;
  let resultUrl: string;
  try {
    resultUrl = await uploadResult(id, transformed.buffer, mime, transformed.format);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(id, `Upload failed: ${message}`);
    throw err;
  }

  // Step 4: completed
  await updateJobRecord(id, {
    status: STEPS.completed.status,
    progress: STEPS.completed.progress,
    currentStep: STEPS.completed.step,
    resultUrl,
    metadata: { bytes: transformed.bytes },
  });
};

/**
 * BullMQ ships an UnrecoverableError but we re-declare a small stand-in
 * to avoid importing internals that may change between versions.
 */
class UnrecoverableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableError";
  }
}
