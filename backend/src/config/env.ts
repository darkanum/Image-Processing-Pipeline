import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  REDIS_HOST: z.string().min(1).default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // API key authentication. Empty string disables auth (dev-only).
  // In any non-emulator / non-dev environment, set a strong random value.
  API_KEY: z.string().optional(),

  // CORS allowed origins. Comma-separated. Empty list = permissive (dev only).
  ALLOWED_ORIGINS: z.string().optional(),

  // Job record TTL (Firestore). Defaults to 24h.
  JOB_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // Storage object TTL (Firebase Storage). Defaults to 24h.
  STORAGE_TTL_HOURS: z.coerce.number().int().positive().default(24),

  FIREBASE_PROJECT_ID: z.string().default("demo-image-pipeline"),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  JOB_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  JOB_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Per-job end-to-end timeout. If exceeded the job is marked failed.
  JOB_HARD_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export const getEnv = (): AppEnv => {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
};

/** True when the app is configured to talk to Firebase local emulators. */
export const isEmulatorMode = (): boolean => {
  const env = getEnv();
  return Boolean(
    env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST,
  );
};

/** Log a one-time security warning at startup. */
export const logSecurityWarnings = (logger: { warn: (o: object, m: string) => void }): void => {
  const env = getEnv();
  if (env.NODE_ENV === "production" && (!env.API_KEY || env.API_KEY.length < 16)) {
    logger.warn(
      { apiKeySet: Boolean(env.API_KEY) },
      "SECURITY: production deploy with no/short API_KEY — POST /api/jobs is open to anyone",
    );
  }
  if (!env.ALLOWED_ORIGINS && env.NODE_ENV === "production") {
    logger.warn(
      {},
      "SECURITY: production deploy with no ALLOWED_ORIGINS — CORS is permissive",
    );
  }
};
