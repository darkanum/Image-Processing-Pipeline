export type JobStatus =
  | "pending"
  | "downloading"
  | "processing"
  | "uploading"
  | "completed"
  | "failed";

export type JobStep = "queued" | "downloading" | "processing" | "uploading" | "completed";

export interface JobMetadata {
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
  attemptsMade?: number;
}

export interface JobRecord {
  id: string;
  url: string;
  status: JobStatus;
  progress: number;
  currentStep: JobStep | null;
  resultUrl: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  metadata: JobMetadata;
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Queued",
  downloading: "Downloading",
  processing: "Processing",
  uploading: "Uploading",
  completed: "Completed",
  failed: "Failed",
};

export const STATUS_COLOR: Record<JobStatus, string> = {
  pending: "#94a3b8",
  downloading: "#3b82f6",
  processing: "#a855f7",
  uploading: "#06b6d4",
  completed: "#10b981",
  failed: "#ef4444",
};
