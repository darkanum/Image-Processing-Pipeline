/**
 * Job lifecycle states and shared types for the image processing pipeline.
 */

export type JobStatus =
  | "pending"      // queued, not yet picked up
  | "downloading"  // downloading source image
  | "processing"   // applying transformations
  | "uploading"    // uploading to Firebase Storage
  | "completed"    // success — resultUrl populated
  | "failed";      // error — errorMessage populated

export type JobStep =
  | "queued"
  | "downloading"
  | "processing"
  | "uploading"
  | "completed";

export interface JobRecord {
  id: string;                  // BullMQ job id == Firestore doc id
  url: string;                 // source URL provided by client
  status: JobStatus;
  progress: number;            // 0..100
  currentStep: JobStep | null;
  resultUrl: string | null;    // public URL to transformed image in Firebase Storage
  errorMessage: string | null;
  createdAt: number;           // epoch ms
  updatedAt: number;           // epoch ms
  finishedAt: number | null;
  metadata: JobMetadata;
}

export interface JobMetadata {
  bytes?: number;              // size of downloaded image
  width?: number;              // pixel width after processing
  height?: number;
  format?: string;             // png / jpeg / webp
  attemptsMade?: number;
}

export interface CreateJobInput {
  url: string;
}

export interface ProgressUpdate {
  status: JobStatus;
  progress: number;
  currentStep?: JobStep | null;
  resultUrl?: string | null;
  errorMessage?: string | null;
  metadata?: Partial<JobMetadata>;
}

/** Patch that updates only metadata — no status/progress change. */
export interface MetadataPatch {
  metadata: Partial<JobMetadata>;
}
