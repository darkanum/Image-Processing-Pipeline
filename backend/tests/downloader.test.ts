import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked undici module — factory hoisted before the import below.
vi.mock("undici", () => ({
  request: vi.fn(),
}));

import { downloadImage } from "../src/services/downloader.js";
import { request } from "undici";
const mockedRequest = vi.mocked(request);

// A Readable-like body with .destroy() and an async iterator so the
// for-await-of stream loop in the downloader reads it correctly.
const createMockResponse = (status: number, contentType: string) => {
  const buf = contentType.startsWith("image/") ? buildPng() : Buffer.from("<html>blocked</html>");
  return {
    statusCode: status,
    headers: { "content-type": contentType, "content-length": String(buf.length) },
    body: {
      destroyed: false,
      destroy() { this.destroyed = true; },
      [Symbol.asyncIterator]() {
        return { next: () => ({ value: buf, done: true }) };
      },
    },
  };
};

function buildPng(): Buffer {
  // 1x1 transparent PNG.
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
    0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00,
    0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
}

describe("downloadImage — multi-strategy anti-bot", () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  // Helper that returns a fresh response object for each call. We
  // rebuild the body on every call so that the stream isn't shared
  // across strategies (which would cause "Mock exhausted" if the
  // downloader iterates twice).
  const makeRes = (status: number, contentType: string) => {
    const buf = contentType.startsWith("image/") ? buildPng() : Buffer.from("<html>blocked</html>");
    return {
      statusCode: status,
      headers: { "content-type": contentType, "content-length": String(buf.length) },
      body: {
        destroyed: false,
        destroy() { this.destroyed = true; },
        [Symbol.asyncIterator]: async function* () { yield buf; },
      },
    };
  };

  it("succeeds on the first strategy when the server returns 200 + image", async () => {
    mockedRequest.mockResolvedValueOnce(makeRes(200, "image/png") as never);
    const result = await downloadImage("https://example.com/cat.png");
    expect(result.strategy).toBe("chrome-windows");
    expect(result.bytes).toBeGreaterThan(0);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next strategy when the first gets a 403 (bot block)", async () => {
    mockedRequest.mockResolvedValueOnce(makeRes(403, "text/html") as never);
    mockedRequest.mockResolvedValueOnce(makeRes(200, "image/png") as never);
    const result = await downloadImage("https://example.com/cat.png");
    expect(result.strategy).toBe("firefox-linux");
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("walks all 3 strategies when the server keeps blocking", async () => {
    mockedRequest.mockResolvedValueOnce(makeRes(403, "text/html") as never);
    mockedRequest.mockResolvedValueOnce(makeRes(429, "text/html") as never);
    mockedRequest.mockResolvedValueOnce(makeRes(503, "text/html") as never);
    await expect(downloadImage("https://example.com/cat.png")).rejects.toMatchObject({
      code: "DOWNLOAD_FAILED",
    });
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 404 (real 404 is not a bot block, it's missing)", async () => {
    mockedRequest.mockResolvedValueOnce(makeRes(404, "text/html") as never);
    await expect(downloadImage("https://example.com/missing.png")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("retries a non-image content type (suggests an HTML error page from a bot block)", async () => {
    mockedRequest.mockResolvedValueOnce(makeRes(200, "text/html") as never);
    mockedRequest.mockResolvedValueOnce(makeRes(200, "image/png") as never);
    const result = await downloadImage("https://example.com/cat.png");
    expect(result.strategy).toBe("firefox-linux");
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("sends realistic browser headers (User-Agent, Accept, Sec-Fetch-*)", async () => {
    mockedRequest.mockResolvedValueOnce(makeRes(200, "image/png") as never);
    await downloadImage("https://example.com/cat.png");
    const call = mockedRequest.mock.calls[0]!;
    const headers = (call[1]?.headers ?? {}) as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Chrome");
    expect(headers["Accept"]).toContain("image/");
    expect(headers["Sec-Fetch-Dest"]).toBe("image");
    expect(headers["Referer"]).toBe("https://example.com/");
  });
});
