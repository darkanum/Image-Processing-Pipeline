import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";

// Extend zod with .openapi() metadata. Once called, every zod schema gains
// a `.openapi(ref, description)` method that registers it with our
// registry and attaches OpenAPI metadata (title, description, example).
extendZodWithOpenApi(z);

// ── Schemas ─────────────────────────────────────────────────────

const watermarkPosition = z
  .enum([
    "top-left", "top-center", "top-right",
    "middle-left", "middle-center", "middle-right",
    "bottom-left", "bottom-center", "bottom-right",
  ])
  .openapi("WatermarkPosition", {
    description: "9-zone position grid for the watermark overlay.",
  });

const watermarkSchema = z
  .object({
    kind: z.enum(["text", "image"]).openapi({ description: "Watermark source kind." }),
    text: z.string().max(512).optional().openapi({ description: "Text content (when kind=text)." }),
    imageUrl: z.string().url().max(2048).optional().openapi({ description: "Image URL (when kind=image)." }),
    position: watermarkPosition,
    margin: z.number().int().min(0).max(500).openapi({ description: "Distance from the chosen edge in pixels." }),
    opacity: z.number().int().min(0).max(100).openapi({ description: "Watermark opacity (0-100%)." }),
    size: z.number().int().min(8).max(2000).openapi({ description: "Font size (px) for text, or rendered width (px) for image." }),
  })
  .openapi("Watermark");

const resizeSchema = z
  .object({
    mode: z.enum(["fit", "crop", "pad", "none"]).openapi({
      description: "Resize mode. fit = scale to fit, pad to exact. crop = scale to cover, crop overflow. pad = same as fit, explicit bg color. none = no resize.",
    }),
    width: z.number().int().positive().max(20000).optional().openapi({ description: "Target width in pixels." }),
    height: z.number().int().positive().max(20000).optional().openapi({ description: "Target height in pixels." }),
    lockAspectRatio: z.boolean().openapi({ description: "Derive the missing dimension from the source aspect ratio." }),
    preset: z.string().max(64).optional(),
    aspectRatio: z.string().regex(/^\d+:\d+$/).optional().openapi({ description: 'Aspect ratio hint like "16:9" or "4:3".' }),
    padBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().openapi({ description: "Background color for mode=pad, hex like #ffffff." }),
  })
  .openapi("Resize");

const cropSchema = z
  .object({
    aspectRatio: z.string().regex(/^\d+:\d+$/).optional(),
    width: z.number().int().positive().max(20000).optional(),
    height: z.number().int().positive().max(20000).optional(),
    anchor: z.enum(["center", "top", "bottom", "left", "right", "attention"]).optional()
      .openapi({ description: 'Where to anchor the crop. "attention" uses smart-crop heuristics.' }),
  })
  .openapi("Crop");

const transformSchema = z
  .object({
    outputFormat: z.enum(["png", "jpeg", "webp", "original"]).default("original")
      .openapi({ description: "Output format. 'original' keeps the source format." }),
    quality: z.number().int().min(1).max(100).default(82)
      .openapi({ description: "Encoder quality (1-100). Higher = larger file, better fidelity." }),
    resize: resizeSchema.nullable().default(null),
    crop: cropSchema.nullable().default(null),
    grayscale: z.boolean().default(false),
    watermark: watermarkSchema.nullable().default(null),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0)
      .openapi({ description: "Rotation in degrees (0/90/180/270)." }),
    flipHorizontal: z.boolean().default(false),
    flipVertical: z.boolean().default(false),
    opacity: z.number().int().min(0).max(100).default(100)
      .openapi({ description: "Overall image opacity (0-100%)." }),
  })
  .openapi("Transform");

export const createJobRequestSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .openapi({ description: "http(s) URL of the source image." }),
    transform: transformSchema.optional(),
  })
  .openapi("CreateJobRequest");

const jobRecordSchema = z
  .object({
    id: z.string().openapi({ description: "Job id (matches BullMQ job id and Firestore doc id)." }),
    url: z.string(),
    status: z.enum(["pending", "downloading", "processing", "uploading", "completed", "failed"])
      .openapi({ description: "Current job state." }),
    progress: z.number().int().min(0).max(100),
    currentStep: z.string().openapi({ description: "Human-readable current operation, e.g. 'transforming'." }),
    resultUrl: z.string().nullable().openapi({ description: "Public URL of the result image (when status=completed)." }),
    errorMessage: z.string().nullable(),
    createdAt: z.number().openapi({ description: "epoch ms" }),
    updatedAt: z.number(),
    finishedAt: z.number().nullable(),
    transform: transformSchema.nullable(),
    metadata: z
      .object({
        bytes: z.number().optional(),
        format: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
      .openapi("JobMetadata"),
  })
  .openapi("JobRecord");

const errorResponseSchema = z
  .object({
    error: z.string().openapi({ description: "Human-readable error message." }),
    code: z.string().optional().openapi({ description: "Machine-readable error code (e.g. VALIDATION_FAILED)." }),
    requestId: z.string().optional().openapi({ description: "Server-assigned request id; quote this in support tickets." }),
  })
  .openapi("ErrorResponse");

const jobListResponseSchema = z
  .object({
    jobs: z.array(jobRecordSchema),
    nextCursor: z.string().nullable().openapi({ description: "Pass as `?cursor=<id>` to fetch the next page." }),
  })
  .openapi("JobListResponse");

// Re-export the zod schemas so the routes can keep validating request
// bodies against them. Single source of truth: one schema, used by both
// the runtime validator and the OpenAPI doc generator.
export {
  watermarkSchema,
  resizeSchema,
  cropSchema,
  transformSchema,
  jobRecordSchema,
  errorResponseSchema,
  jobListResponseSchema,
};

// ── Registry + paths ────────────────────────────────────────────

const registry = new OpenAPIRegistry();

registry.register("CreateJobRequest", createJobRequestSchema);
registry.register("JobRecord", jobRecordSchema);
registry.register("ErrorResponse", errorResponseSchema);
registry.register("JobListResponse", jobListResponseSchema);

registry.registerPath({
  method: "post",
  path: "/api/jobs",
  summary: "Submit a new image-processing job",
  description:
    "Creates a Firestore job record, enqueues a BullMQ job, and returns the full job record. " +
    "The worker downloads the source image, applies the transform, and uploads the result to " +
    "Firebase Storage. The result URL is available in the job's `resultUrl` once status=completed.",
  tags: ["jobs"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createJobRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Job created and enqueued. The job record is the response body.",
      content: { "application/json": { schema: jobRecordSchema } },
    },
    400: {
      description: "Invalid request body (zod validation failed).",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    401: {
      description: "Missing or invalid API key.",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    429: {
      description: "Rate limit exceeded for this IP.",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    500: {
      description: "Internal server error.",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/jobs",
  summary: "List recent jobs",
  description: "Returns the most recent jobs (newest first), with cursor-based pagination.",
  tags: ["jobs"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional()
        .openapi({ description: "Page size, default 50, max 200." }),
      cursor: z.string().optional()
        .openapi({ description: "The last job id from the previous page; pass to fetch the next page." }),
    }),
  },
  responses: {
    200: {
      description: "List of jobs with a cursor for the next page.",
      content: { "application/json": { schema: jobListResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/jobs/{id}",
  summary: "Get a single job by id",
  description: "Returns the full job record, including the result URL if completed.",
  tags: ["jobs"],
  security: [{ ApiKeyAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Job id." }),
    }),
  },
  responses: {
    200: {
      description: "The job record.",
      content: { "application/json": { schema: jobRecordSchema } },
    },
    404: {
      description: "No job with that id.",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Liveness probe",
  description: "Returns 200 if the process is running. Use for liveness checks (restart vs don't).",
  tags: ["ops"],
  security: [],
  responses: {
    200: { description: "Process is alive." },
  },
});

registry.registerPath({
  method: "get",
  path: "/health/live",
  summary: "Kubernetes liveness probe",
  tags: ["ops"],
  security: [],
  responses: { 200: { description: "Alive." } },
});

registry.registerPath({
  method: "get",
  path: "/health/ready",
  summary: "Kubernetes readiness probe",
  description: "Returns 200 if all sub-checks pass; 503 otherwise. Use to decide whether to route traffic to this pod.",
  tags: ["ops"],
  security: [],
  responses: {
    200: { description: "All sub-checks pass." },
    503: { description: "One or more sub-checks failed." },
  },
});

registry.registerPath({
  method: "get",
  path: "/metrics",
  summary: "Prometheus metrics",
  description: "Standard Prometheus text-format scrape endpoint.",
  tags: ["ops"],
  security: [],
  responses: {
    200: { description: "Metrics payload in Prometheus text format." },
  },
});

// ── Document generation ─────────────────────────────────────────

registry.registerComponent("securitySchemes", "ApiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-Api-Key",
  description:
    "Required when the API_KEY env var is set on the server. Send as the `X-Api-Key` header.",
});

/** Returns the OpenAPI 3.0.3 document as a plain object — ready to be
 *  served as JSON. The document is regenerated on every request so
 *  any runtime change to the schemas is reflected immediately. */
export const buildOpenApiDocument = (): Record<string, unknown> => {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Image Processing Pipeline API",
      version: "1.0.0",
      description:
        "REST API for the Real-Time Image Processing Pipeline. Submit an image URL and a " +
        "transform; a BullMQ worker downloads, transforms, and uploads the result. " +
        "Status updates stream to the SPA via Firestore.",
    },
    servers: [
      { url: "http://localhost:3100", description: "Local development" },
    ],
  }) as unknown as Record<string, unknown>;
};
