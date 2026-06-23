import sharp, { type Metadata } from "sharp";

export interface TransformOptions {
  /** Output width in pixels — image is resized keeping aspect ratio. */
  width?: number;
  /** Convert to grayscale. */
  grayscale?: boolean;
  /** Add a text watermark (bottom-right). */
  watermarkText?: string;
  /** Output format; defaults to the input format. */
  format?: "png" | "jpeg" | "webp";
  /** JPEG/WebP quality 1..100. */
  quality?: number;
}

export interface TransformResult {
  buffer: Buffer;
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  bytes: number;
}

const DEFAULT_WIDTH = 800;

/**
 * Pure image transformation pipeline built on sharp.
 *
 * - Resizes (preserving aspect ratio) to `width` px (default 800).
 * - Converts to grayscale when requested.
 * - Composites a text watermark via SVG overlay (no font files needed).
 * - Re-encodes to the requested format (defaults to the source format).
 *
 * Rejecting on a non-image input is the caller's job — this function
 * assumes `input` is a valid encoded image.
 */
export const transformImage = async (
  input: Buffer,
  options: TransformOptions = {},
): Promise<TransformResult> => {
  const targetFormat = options.format;
  const width = options.width ?? DEFAULT_WIDTH;

  // Compute target dimensions BEFORE building the pipeline so the watermark
  // SVG matches the resized area exactly (avoids "composite must have same
  // dimensions or smaller" errors).
  const sourceMeta0: Metadata = await sharp(input).metadata();
  const srcW = sourceMeta0.width ?? width;
  const srcH = sourceMeta0.height ?? width;
  const aspect = srcH / srcW;
  let targetW = Math.min(width, srcW);
  let targetH = Math.round(targetW * aspect);
  if (targetH > width) {
    targetH = width;
    targetW = Math.round(targetH / aspect);
  }

  let pipeline = sharp(input, { failOn: "error" }).resize({
    width,
    withoutEnlargement: true,
    fit: "inside",
  });

  if (options.grayscale) {
    pipeline = pipeline.grayscale();
  }

  if (options.watermarkText && options.watermarkText.length > 0) {
    const svg = buildWatermarkSvg(targetW, targetH, options.watermarkText);
    pipeline = pipeline.composite([{ input: svg, gravity: "southeast" }]);
  }

  // Determine output format from explicit option or input metadata.
  const sourceFormat = (sourceMeta0.format ?? "png") as "png" | "jpeg" | "webp";
  const outFormat: "png" | "jpeg" | "webp" = targetFormat ?? sourceFormat;

  switch (outFormat) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: options.quality ?? 82, mozjpeg: true });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: options.quality ?? 82 });
      break;
    case "png":
    default:
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
  }

  const buffer = await pipeline.toBuffer();
  const outMeta = await sharp(buffer).metadata();

  return {
    buffer,
    format: outFormat,
    width: outMeta.width ?? targetW,
    height: outMeta.height ?? targetH,
    bytes: buffer.length,
  };
};

/** Build an SVG with a text watermark. */
const buildWatermarkSvg = (
  width: number,
  height: number,
  text: string,
): Buffer => {
  const fontSize = Math.max(14, Math.round(width / 30));
  const padding = Math.round(fontSize * 0.6);
  const safe = String(text).replace(/[<>&]/g, "");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>
        .wm { font: ${fontSize}px sans-serif; fill: rgba(255,255,255,0.85);
              stroke: rgba(0,0,0,0.55); stroke-width: 1; }
      </style>
      <rect x="0" y="${height - fontSize - padding * 2}"
            width="${width}" height="${fontSize + padding * 2}"
            fill="rgba(0,0,0,0.35)"/>
      <text class="wm" x="${padding}" y="${height - padding}">${safe}</text>
    </svg>`;
  return Buffer.from(svg);
};
