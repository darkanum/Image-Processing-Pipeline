import pino from "pino";
import { getEnv } from "../config/env.js";

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "image-processing-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
