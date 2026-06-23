import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

// vi.mock factories are hoisted — they must not reference top-level vars.
// Use vi.hoisted to declare mock fns in a way the hoisted factories can see.
const {
  mockDownload,
  mockTransform,
  mockUpdate,
  mockUpdateMetadata,
  mockMarkFailed,
  mockUpload,
} = vi.hoisted(() => ({
  mockDownload: vi.fn(),
  mockTransform: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue(undefined),
  mockUpdateMetadata: vi.fn().mockResolvedValue(undefined),
  mockMarkFailed: vi.fn().mockResolvedValue(undefined),
  mockUpload: vi.fn(),
}));

vi.mock("../src/services/downloader.js", () => ({
  downloadImage: mockDownload,
}));

vi.mock("../src/services/imageProcessor.js", () => ({
  transformImage: mockTransform,
}));

vi.mock("../src/services/jobRepository.js", () => ({
  updateJobRecord: mockUpdate,
  updateJobMetadata: mockUpdateMetadata,
  markJobFailed: mockMarkFailed,
  uploadResult: mockUpload,
}));

vi.mock("dotenv", () => ({ config: vi.fn() }));

import { processImageJob } from "../src/workers/imageWorker.js";
import type { Job } from "bullmq";

const makeJob = (id: string, payload: unknown, attemptsMade = 0): Job =>
  ({
    id,
    data: payload,
    attemptsMade,
  } as unknown as Job);

const buildTestImage = async (): Promise<Buffer> => {
  return sharp({
    create: { width: 600, height: 400, channels: 3, background: { r: 50, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
};

describe("processImageJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the full happy path and ends with progress=100, completed", async () => {
    const buf = await buildTestImage();
    mockDownload.mockResolvedValue({ buffer: buf, bytes: buf.length, contentType: "image/png" });
    mockTransform.mockResolvedValue({
      buffer: buf,
      format: "png",
      width: 400,
      height: 300,
      bytes: buf.length,
    });
    mockUpload.mockResolvedValue("https://storage.example.com/r.png");

    const job = makeJob("job-1", { url: "https://x.com/img.png" });
    await processImageJob(job, job.data as { url: string });

    // Last update should be the terminal "completed" call.
    const calls = mockUpdate.mock.calls.map((c) => c[1]);
    const last = calls[calls.length - 1];
    expect(last).toMatchObject({
      status: "completed",
      progress: 100,
      currentStep: "completed",
      resultUrl: "https://storage.example.com/r.png",
    });

    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("marks failed (no retry) for INVALID_URL", async () => {
    const e = new Error("Invalid URL");
    (e as Error & { code?: string }).code = "INVALID_URL";
    mockDownload.mockRejectedValue(e);

    const job = makeJob("job-2", { url: "not-a-url" });
    await expect(processImageJob(job, job.data as { url: string })).rejects.toThrow(/Invalid URL/);
    expect(mockMarkFailed).toHaveBeenCalledWith("job-2", expect.stringContaining("Invalid URL"));
  });

  it("marks failed (no retry) for NOT_IMAGE", async () => {
    const e = new Error("Not an image");
    (e as Error & { code?: string }).code = "NOT_IMAGE";
    mockDownload.mockRejectedValue(e);

    const job = makeJob("job-3", { url: "https://x.com/page.html" });
    await expect(processImageJob(job, job.data as { url: string })).rejects.toThrow(/UnrecoverableError|Not an image/);
    expect(mockMarkFailed).toHaveBeenCalledWith("job-3", expect.stringContaining("Not an image"));
  });

  it("marks failed (no retry) for TOO_LARGE", async () => {
    const e = new Error("Image too large");
    (e as Error & { code?: string }).code = "TOO_LARGE";
    mockDownload.mockRejectedValue(e);

    const job = makeJob("job-4", { url: "https://x.com/huge.png" });
    await expect(processImageJob(job, job.data as { url: string })).rejects.toThrow();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-4", expect.stringContaining("too large"));
  });

  it("rethrows (retryable) for transient download errors", async () => {
    mockDownload.mockRejectedValue(new Error("ECONNRESET"));
    const job = makeJob("job-5", { url: "https://x.com/img.png" });
    await expect(processImageJob(job, job.data as { url: string })).rejects.toThrow("ECONNRESET");
    expect(mockMarkFailed).toHaveBeenCalled();
  });

  it("fails when payload is missing url", async () => {
    const job = makeJob("job-6", {});
    await expect(processImageJob(job, {} as { url: string })).rejects.toThrow();
    expect(mockMarkFailed).toHaveBeenCalledWith("job-6", expect.stringContaining("url"));
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("fails when transformImage throws (unrecoverable)", async () => {
    const buf = await buildTestImage();
    mockDownload.mockResolvedValue({ buffer: buf, bytes: buf.length, contentType: "image/png" });
    mockTransform.mockRejectedValue(new Error("sharp exploded"));

    const job = makeJob("job-7", { url: "https://x.com/img.png" });
    await expect(processImageJob(job, job.data as { url: string })).rejects.toThrow(/UnrecoverableError|sharp exploded/);
    expect(mockMarkFailed).toHaveBeenCalledWith("job-7", expect.stringContaining("Transform failed"));
  });
});
