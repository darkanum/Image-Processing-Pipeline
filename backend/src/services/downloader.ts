import { request } from "undici";
import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface DownloadResult {
  buffer: Buffer;
  bytes: number;
  contentType: string;
  /** Which strategy ultimately succeeded (useful for log analytics). */
  strategy: string;
}

/**
 * Download an image from a URL with size + timeout guards.
 *
 * Why multi-strategy: many image CDNs (HoYo, Twitter, Imgur, some Shopify
 * stores) reject requests with a `User-Agent: <botname>/<ver>` string
 * and/or missing standard browser headers. The first request uses a
 * Chrome-on-Windows profile; if that fails with a 403/429/503 we fall
 * through to Firefox and Safari profiles. This catches the most common
 * anti-bot checks (UA + Accept + Accept-Language + Sec-Fetch-*) without
 * needing a headless browser in the worker.
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

  // URL validation --------------------------------------------------
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

  // Build the strategy list. We try Chrome first (most common), then
  // Firefox, then Safari. Each strategy includes the full set of
  // headers a real browser would send. We add an Origin/Referer based
  // on the URL host because some CDNs (notably HoYo's fastcdn) only
  // serve content to requests that look like they originated from a
  // hoyoverse.com page.
  const strategies: { name: string; headers: Record<string, string> }[] = [
    {
      name: "chrome-windows",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
    },
    {
      name: "firefox-linux",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
        Accept: "image/avif,image/webp,*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
    },
    {
      name: "safari-macos",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        Accept: "image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
    },
  ];

  // Add a Referer that points to the URL's own origin. Some CDNs (HoYo
  // again) only serve to requests that include a referer matching the
  // expected host. If the URL is already on the expected host, leave it.
  for (const s of strategies) {
    s.headers["Referer"] = `${parsed.protocol}//${parsed.hostname}/`;
  }

  // Try each strategy. A strategy "fails" if the response status is in
  // the bot-detected bucket (403, 429, 503) or the content-type is not
  // an image. Other 4xx/5xx also trigger a retry since they often
  // indicate a transient block.
  const BOT_BLOCK = new Set([403, 429, 503]);
  const lastErrors: { strategy: string; status: number; reason: string }[] = [];

  for (const strategy of strategies) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await request(parsed.toString(), {
        method: "GET",
        maxRedirections: 3,
        signal: controller.signal,
        headers: strategy.headers,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      lastErrors.push({ strategy: strategy.name, status: 0, reason: message });
      logger.warn(
        { url, strategy: strategy.name, err: message },
        "download: network error, trying next strategy",
      );
      continue;
    }

    try {
      if (BOT_BLOCK.has(res.statusCode)) {
        lastErrors.push({
          strategy: strategy.name,
          status: res.statusCode,
          reason: "blocked",
        });
        logger.info(
          { url, strategy: strategy.name, status: res.statusCode },
          "download: bot-blocked, trying next strategy",
        );
        if (!res.body.destroyed) res.body.destroy();
        continue;
      }
      if (res.statusCode >= 400) {
        // Non-retryable 4xx (e.g., 404). Don't try other strategies —
        // they'll see the same response.
        clearTimeout(timer);
        if (!res.body.destroyed) res.body.destroy();
        const e = new Error(`HTTP ${res.statusCode} for ${parsed.toString()}`);
        (e as Error & { code?: string }).code =
          res.statusCode === 404 ? "NOT_FOUND" : "HTTP_ERROR";
        throw e;
      }

      const contentType = (res.headers["content-type"] as string | undefined) ?? "";
      if (!contentType.startsWith("image/")) {
        // Site returned an HTML error page or similar. Treat as bot block
        // and try the next strategy.
        lastErrors.push({
          strategy: strategy.name,
          status: res.statusCode,
          reason: `not-image (${contentType || "<empty>"})`,
        });
        logger.info(
          { url, strategy: strategy.name, contentType },
          "download: non-image response, trying next strategy",
        );
        if (!res.body.destroyed) res.body.destroy();
        continue;
      }

      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes) {
        clearTimeout(timer);
        if (!res.body.destroyed) res.body.destroy();
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
          clearTimeout(timer);
          if (!res.body.destroyed) res.body.destroy();
          const e = new Error(`Image exceeded ${maxBytes} byte limit mid-stream`);
          (e as Error & { code?: string }).code = "TOO_LARGE";
          throw e;
        }
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);
      clearTimeout(timer);

      if (buffer.length === 0) {
        lastErrors.push({
          strategy: strategy.name,
          status: res.statusCode,
          reason: "empty body",
        });
        continue;
      }

      logger.info(
        { url, strategy: strategy.name, status: res.statusCode, bytes: buffer.length },
        "download: success",
      );
      return { buffer, bytes: buffer.length, contentType, strategy: strategy.name };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // All strategies exhausted.
  const summary = lastErrors
    .map((e) => `${e.strategy}=${e.status || "network"}/${e.reason}`)
    .join(", ");
  logger.error({ url, attempts: lastErrors }, "download: all strategies failed");
  const e = new Error(
    `Download failed after ${strategies.length} strategies (${summary})`,
  );
  (e as Error & { code?: string }).code = "DOWNLOAD_FAILED";
  throw e;
};
