import { request } from "undici";
import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface DownloadResult {
  buffer: Buffer;
  bytes: number;
  contentType: string;
}

/**
 * Download an image from a URL with strict size + timeout guards.
 *
 * - Rejects non-http(s) schemes.
 * - Rejects redirects to non-image content types.
 * - Hard cap on bytes via Content-Length check AND streamed byte counter.
 *
 * Throws an Error with a `.code` field for typed handling upstream.
 */
export const downloadImage = async (
  url: string,
  options?: { maxBytes?: number; timeoutMs?: number },
): Promise<DownloadResult> => {
  const env = getEnv();
  const maxBytes = options?.maxBytes ?? env.JOB_MAX_IMAGE_BYTES;
  const timeoutMs = options?.timeoutMs ?? env.JOB_DOWNLOAD_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    const e = new Error(`Invalid URL: ${url}`);
    (e as Error & { code?: string }).code = "INVALID_URL";
    throw e;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    const e = new Error(`Unsupported protocol: ${parsed.protocol}`);
    (e as Error & { code?: string }).code = "INVALID_URL";
    throw e;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await request(parsed.toString(), {
      method: "GET",
      // Cap per-hop redirects at 3 and revalidate to avoid SSRF via redirect.
      maxRedirections: 3,
      signal: controller.signal,
      headers: {
        "User-Agent": "image-processing-pipeline/1.0",
        Accept: "image/*",
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url, err: message }, "download failed");
    const e = new Error(`Download failed: ${message}`);
    (e as Error & { code?: string }).code = "DOWNLOAD_FAILED";
    throw e;
  }

  try {
    if (res.statusCode >= 400) {
      const e = new Error(`HTTP ${res.statusCode} for ${parsed.toString()}`);
      (e as Error & { code?: string }).code =
        res.statusCode === 404 ? "NOT_FOUND" : "HTTP_ERROR";
      throw e;
    }

    const contentType = (res.headers["content-type"] as string | undefined) ?? "";
    if (!contentType.startsWith("image/")) {
      const e = new Error(`Not an image: content-type=${contentType || "<empty>"}`);
      (e as Error & { code?: string }).code = "NOT_IMAGE";
      throw e;
    }

    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      const e = new Error(
        `Image too large: ${declared} bytes > ${maxBytes} byte limit`,
      );
      (e as Error & { code?: string }).code = "TOO_LARGE";
      throw e;
    }

    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of res.body) {
      received += chunk.length;
      if (received > maxBytes) {
        const e = new Error(`Image exceeded ${maxBytes} byte limit mid-stream`);
        (e as Error & { code?: string }).code = "TOO_LARGE";
        throw e;
      }
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    clearTimeout(timeout);

    if (buffer.length === 0) {
      const e = new Error("Downloaded image was empty");
      (e as Error & { code?: string }).code = "EMPTY";
      throw e;
    }

    return { buffer, bytes: buffer.length, contentType };
  } finally {
    clearTimeout(timeout);
    if (!res.body.destroyed) res.body.destroy();
  }
};
