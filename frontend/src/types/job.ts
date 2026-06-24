export type JobStatus =
  | "pending"
  | "downloading"
  | "processing"
  | "uploading"
  | "completed"
  | "failed";

export type JobStep = "queued" | "downloading" | "processing" | "uploading" | "completed";

export type OutputFormat = "png" | "jpeg" | "webp" | "original";

export type WatermarkPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type WatermarkKind = "text" | "image";

export type ResizeMode = "fit" | "crop" | "pad" | "none";

export type Rotation = 0 | 90 | 180 | 270;

export interface ResizeSpec {
  mode: ResizeMode;
  width?: number;
  height?: number;
  lockAspectRatio: boolean;
  preset?: string;
  aspectRatio?: string;
  padBackground?: string;
}

export interface CropSpec {
  aspectRatio?: string;
  width?: number;
  height?: number;
  anchor?: "center" | "top" | "bottom" | "left" | "right" | "attention";
}

export interface WatermarkSpec {
  kind: WatermarkKind;
  text?: string;
  imageUrl?: string;
  position: WatermarkPosition;
  margin: number;
  opacity: number;
  size: number;
}

export interface TransformSpec {
  outputFormat: OutputFormat;
  quality: number;
  resize: ResizeSpec | null;
  crop: CropSpec | null;
  grayscale: boolean;
  watermark: WatermarkSpec | null;
  rotation: Rotation;
  flipHorizontal: boolean;
  flipVertical: boolean;
  opacity: number;
}

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
  transform: TransformSpec | null;
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

export const DEFAULT_TRANSFORM: TransformSpec = {
  outputFormat: "original",
  quality: 82,
  resize: null,
  crop: null,
  grayscale: false,
  watermark: null,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  opacity: 100,
};

/** A neutral "resize off" spec the form can hand to ResizeSection. */
export const DEFAULT_RESIZE: ResizeSpec = {
  mode: "none",
  lockAspectRatio: true,
};

/** A neutral watermark spec the form can hand to WatermarkSection. */
export const DEFAULT_WATERMARK: WatermarkSpec = {
  kind: "text",
  text: "watermark",
  position: "bottom-right",
  margin: 24,
  opacity: 70,
  size: 32,
};

export const RESOLUTION_PRESETS = {
  "HD 720p (1280×720)": { width: 1280, height: 720 },
  "Full HD 1080p (1920×1080)": { width: 1920, height: 1080 },
  "4K UHD (3840×2160)": { width: 3840, height: 2160 },
  "Instagram Square (1080×1080)": { width: 1080, height: 1080 },
  "Instagram Portrait (1080×1350)": { width: 1080, height: 1350 },
  "Twitter Header (1500×500)": { width: 1500, height: 500 },
  "Facebook Cover (820×312)": { width: 820, height: 312 },
  "iPhone Wallpaper (1170×2532)": { width: 1170, height: 2532 },
} as const;
export type ResolutionPresetKey = keyof typeof RESOLUTION_PRESETS;

export const ASPECT_RATIOS = {
  "16:9 — Widescreen (YouTube, TV)": "16:9",
  "9:16 — Vertical (TikTok, Reels)": "9:16",
  "4:3 — Traditional (iPad, TV)": "4:3",
  "1:1 — Square (Instagram)": "1:1",
  "3:2 — DSLR / photo prints": "3:2",
  "4:5 — Portrait (Instagram feed)": "4:5",
  "21:9 — Cinematic / ultrawide": "21:9",
} as const;
export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

/** Maximum download size we accept (must match backend JOB_MAX_IMAGE_BYTES). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const POSITION_GRID: { value: WatermarkPosition; label: string }[] = [
  { value: "top-left", label: "↖" },
  { value: "top-center", label: "↑" },
  { value: "top-right", label: "↗" },
  { value: "middle-left", label: "←" },
  { value: "middle-center", label: "•" },
  { value: "middle-right", label: "→" },
  { value: "bottom-left", label: "↙" },
  { value: "bottom-center", label: "↓" },
  { value: "bottom-right", label: "↘" },
];
