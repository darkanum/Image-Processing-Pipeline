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

export type OutputFormat = "png" | "jpeg" | "webp";

/** 9-zone grid position for watermarks / cropping focal point. */
export type WatermarkPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type WatermarkKind = "text" | "image";

export type ResizeMode = "fit" | "crop" | "pad" | "none";

export type Rotation = 0 | 90 | 180 | 270;

export interface ResizeSpec {
  mode: ResizeMode;
  /** Target width in pixels (omit for auto-fit by height). */
  width?: number;
  /** Target height in pixels (omit for auto-fit by width). */
  height?: number;
  /** When true, deriving one dimension derives the other to preserve aspect. */
  lockAspectRatio: boolean;
  /** Optional named preset — one of the keys of `RESOLUTION_PRESETS`. */
  preset?: string;
  /** Optional named ratio — one of the keys of `ASPECT_RATIOS`. */
  aspectRatio?: string;
  /** Background color for `pad` mode. Defaults to white. */
  padBackground?: string;
}

export interface CropSpec {
  /** Optional named ratio — one of the keys of `ASPECT_RATIOS`. */
  aspectRatio?: string;
  /** Crop width in pixels (omit to derive from aspectRatio + height). */
  width?: number;
  /** Crop height in pixels. */
  height?: number;
  /** Crop anchor when both dims not specified (smart + center strategies). */
  anchor?: "center" | "top" | "bottom" | "left" | "right" | "attention";
}

export interface WatermarkSpec {
  kind: WatermarkKind;
  /** For kind=text: the text to draw. For kind=image: a URL to fetch. */
  text?: string;
  imageUrl?: string;
  position: WatermarkPosition;
  /** Pixel margin from the chosen corner/edge. */
  margin: number;
  /** Watermark opacity 0-100. */
  opacity: number;
  /** Text size in px, or image render width in px (height keeps aspect). */
  size: number;
}

export interface TransformSpec {
  outputFormat: OutputFormat | "original";
  quality: number;
  resize: ResizeSpec | null;
  crop: CropSpec | null;
  grayscale: boolean;
  watermark: WatermarkSpec | null;
  rotation: Rotation;
  flipHorizontal: boolean;
  flipVertical: boolean;
  /** Overall output image opacity 0-100. */
  opacity: number;
}

/** Resolution presets (px). */
export const RESOLUTION_PRESETS = {
  "HD 720p": { width: 1280, height: 720 },
  "Full HD 1080p": { width: 1920, height: 1080 },
  "4K UHD": { width: 3840, height: 2160 },
  "Instagram Square 1080": { width: 1080, height: 1080 },
  "Instagram Portrait 1080x1350": { width: 1080, height: 1350 },
  "Twitter Header 1500x500": { width: 1500, height: 500 },
  "Facebook Cover 820x312": { width: 820, height: 312 },
  "iPhone Wallpaper 1170x2532": { width: 1170, height: 2532 },
} as const;
export type ResolutionPresetKey = keyof typeof RESOLUTION_PRESETS;

/** Aspect ratios. */
export const ASPECT_RATIOS = {
  "16:9": { w: 16, h: 9, uses: "Widescreen video, TV, YouTube" },
  "9:16": { w: 9, h: 16, uses: "Vertical video, TikTok, Instagram Reels" },
  "4:3": { w: 4, h: 3, uses: "Traditional TV, old movies, iPad" },
  "1:1": { w: 1, h: 1, uses: "Square, social media posts" },
  "3:2": { w: 3, h: 2, uses: "DSLR photography, standard photo prints" },
  "4:5": { w: 4, h: 5, uses: "Portrait, Instagram feed photos" },
  "21:9": { w: 21, h: 9, uses: "Cinematic widescreen, ultrawide monitors" },
} as const;
export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

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
  /** Echo of the transform spec used, so the UI can show what was applied. */
  transform: TransformSpec | null;
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
  transform?: TransformSpec | null;
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

/** Default transform applied when the request omits one. */
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
