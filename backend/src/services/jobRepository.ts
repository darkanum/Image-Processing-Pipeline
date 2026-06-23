import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb, getBucket } from "./firebase.js";
import { logger } from "../utils/logger.js";
import type { JobRecord, ProgressUpdate, MetadataPatch } from "../types/job.js";

const COLLECTION = "jobs";

/**
 * Create or overwrite a job record in Firestore.
 */
export const createJobRecord = async (job: JobRecord): Promise<void> => {
  const db = getDb();
  await db.collection(COLLECTION).doc(job.id).set(job);
  logger.debug({ id: job.id }, "firestore: created job record");
};

/**
 * Patch a job record. Only fields present in the patch are touched;
 * `updatedAt` is always bumped, and `finishedAt` is set when status is terminal.
 */
export const updateJobRecord = async (
  id: string,
  patch: ProgressUpdate,
): Promise<void> => {
  const db = getDb();
  const now = Date.now();
  const isTerminal =
    patch.status === "completed" || patch.status === "failed";

  const update: Record<string, unknown> = {
    status: patch.status,
    progress: patch.progress,
    updatedAt: now,
  };
  if (patch.currentStep !== undefined) update.currentStep = patch.currentStep;
  if (patch.resultUrl !== undefined) update.resultUrl = patch.resultUrl;
  if (patch.errorMessage !== undefined) update.errorMessage = patch.errorMessage;
  if (patch.metadata) {
    // Merge metadata without dropping existing fields.
    update.metadata = patch.metadata;
  }
  if (isTerminal) update.finishedAt = now;

  await db.collection(COLLECTION).doc(id).set(update, { merge: true });
  logger.debug({ id, status: patch.status, progress: patch.progress }, "firestore: updated job");
};

/**
 * Patch only the metadata sub-document, leaving status/progress untouched.
 */
export const updateJobMetadata = async (
  id: string,
  patch: MetadataPatch,
): Promise<void> => {
  const db = getDb();
  await db
    .collection(COLLECTION)
    .doc(id)
    .set({ ...patch, updatedAt: Date.now() }, { merge: true });
};

/**
 * Mark a job as failed with an error message.
 */
export const markJobFailed = async (id: string, message: string): Promise<void> => {
  await updateJobRecord(id, {
    status: "failed",
    progress: 0,
    errorMessage: message,
  });
};

/**
 * Fetch a single job record. Returns null when not found.
 */
export const getJobRecord = async (id: string): Promise<JobRecord | null> => {
  const db = getDb();
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return snap.data() as JobRecord;
};

/**
 * List recent job records (newest first).
 */
export const listJobRecords = async (limit = 50): Promise<JobRecord[]> => {
  const db = getDb();
  const snap = await db
    .collection(COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as JobRecord);
};

/**
 * Upload a processed image buffer to Firebase Storage and return its public URL.
 *
 * Storage emulator requires `makePublic()`/signed URL emulation — we use
 * getSignedUrl with a long expiry so the same code works against both emulator
 * and production. Emulator returns a local URL pointing at the storage emulator.
 */
export const uploadResult = async (
  id: string,
  buffer: Buffer,
  contentType: string,
  extension: string,
): Promise<string> => {
  const bucket = getBucket().bucket();
  const filename = `results/${id}/processed.${extension}`;
  const file = bucket.file(filename);

  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: "public, max-age=3600",
      metadata: { jobId: id },
    },
    resumable: false,
  });

  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 3600 * 1000,
  });
  logger.info({ id, filename, bytes: buffer.length }, "storage: uploaded result");
  return signedUrl;
};

/** Convert a Firestore Timestamp or epoch number to ms — defensive helper. */
export const tsToMs = (v: Timestamp | number | null | undefined): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  // Firebase Timestamp exposes toMillis()
  if (typeof (v as Timestamp).toMillis === "function") {
    return (v as Timestamp).toMillis();
  }
  return 0;
};

/** Used by tests to clean up. */
export const __clearJobRecords = async (): Promise<void> => {
  const db = getDb();
  const snap = await db.collection(COLLECTION).limit(50).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  // Touch FieldValue to keep the import non-empty (silences unused warnings).
  void FieldValue;
};
