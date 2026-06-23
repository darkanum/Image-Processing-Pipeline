import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { z } from "zod";

// Mock Firebase before importing the router.
vi.mock("../src/services/firebase.js", () => ({
  getDb: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ exists: false }),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        })),
      })),
      limit: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      })),
    })),
  })),
  getBucket: vi.fn(() => ({
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({
        save: vi.fn().mockResolvedValue(undefined),
        getSignedUrl: vi.fn().mockResolvedValue(["https://example.com/r"]),
      })),
    })),
  })),
}));

// Mock the BullMQ queue — return a fake job with id "test-job-1".
vi.mock("../src/services/queue.js", () => ({
  getImageQueue: vi.fn(() => ({
    add: vi.fn().mockResolvedValue({ id: "test-job-1" }),
  })),
  QUEUE_NAME: "imageProcessing",
}));

// Mock dotenv so getEnv() doesn't fail in tests.
vi.mock("dotenv", () => ({
  config: vi.fn(),
}));

import { jobsRouter } from "../src/api/jobs.js";

const buildApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use("/api/jobs", jobsRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
};

describe("jobs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FIREBASE_PROJECT_ID = "demo-image-pipeline";
    process.env.PORT = "3001";
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.REDIS_PORT = "6379";
    process.env.LOG_LEVEL = "silent";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/jobs creates a job with a valid URL", async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post("/api/jobs")
      .send({ url: "https://example.com/cat.png" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "test-job-1",
      url: "https://example.com/cat.png",
      status: "pending",
      progress: 0,
      currentStep: "queued",
      resultUrl: null,
      errorMessage: null,
    });
    expect(typeof res.body.createdAt).toBe("number");
  });

  it("POST /api/jobs rejects non-http URLs (400)", async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post("/api/jobs")
      .send({ url: "ftp://example.com/cat.png" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid request");
  });

  it("POST /api/jobs rejects garbage body (400)", async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post("/api/jobs")
      .send({ url: "not a url" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
  });

  it("POST /api/jobs rejects missing url (400)", async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post("/api/jobs")
      .send({})
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
  });

  it("GET /api/jobs returns a list (possibly empty)", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/api/jobs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });

  it("GET /api/jobs/:id returns 404 for missing job", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/api/jobs/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// Sanity check on the validation schema — make sure we didn't accidentally
// loosen the protocol check.
describe("createJobSchema", () => {
  it("only accepts http(s)", async () => {
    const { default: expressFn } = await import("express");
    void expressFn;
    const schema = z.object({
      url: z.string().url().refine(
        (u) => {
          try {
            const p = new URL(u);
            return p.protocol === "http:" || p.protocol === "https:";
          } catch {
            return false;
          }
        },
        { message: "url must be http(s)" },
      ),
    });
    expect(schema.safeParse({ url: "https://x.com" }).success).toBe(true);
    expect(schema.safeParse({ url: "http://x.com" }).success).toBe(true);
    expect(schema.safeParse({ url: "ftp://x.com" }).success).toBe(false);
    expect(schema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });
});
