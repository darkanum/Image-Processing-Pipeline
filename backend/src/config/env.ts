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

  FIREBASE_PROJECT_ID: z.string().default("demo-image-pipeline"),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  FIREBASE_STORAGE_EMULATOR_HOST: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  JOB_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  JOB_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
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
