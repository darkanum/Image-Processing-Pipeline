import sharp, { type Metadata, type Sharp } from "sharp";
import type {
  CropSpec,
  OutputFormat,
  ResizeSpec,
  TransformSpec,
  WatermarkSpec,
} from "../types/job.js";

export interface TransformResult {
  buffer: Buffer;
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  bytes: number;
}

const DEFAULT_QUALITY = 82;

/**
 * Apply a full TransformSpec to a source image buffer.
 *
 * The pipeline is composed in this fixed order so the operations compose
 * predictably:
 *   1. resize (fit/crop/pad/none)
 *   2. crop (post-resize; anchored to center by default)
 *   3. rotate 90/180/270°
 *   4. flipH / flipV
 *   5. grayscale
 *   6. watermark (text or fetched image, position + margin + opacity)
 *   7. overall opacity fade
 *   8. format / quality encode
 */
export const transformImage = async (
  input: Buffer,
  spec: TransformSpec,
): Promise<TransformResult> => {
  // Step 1: resolve target dimensions BEFORE building the pipeline so we
  // can position the watermark / crop focal point correctly.
  const sourceMeta: Metadata = await sharp(input).metadata();
  const srcW = sourceMeta.width ?? 0;
  const srcH = sourceMeta.height ?? 0;
  if (srcW === 0 || srcH === 0) {
    throw new Error("Could not read source image dimensions");
  }

  // Resize returns target W/H before rotate/crop. Rotate 90/270 swaps them.
  // Crop further reduces dimensions. The final dimensions BEFORE watermark
  // and encode are what the watermark overlay must match.
  const { width: postResizeW, height: postResizeH } = computePostResizeDims(
    srcW,
    srcH,
    spec.resize ?? null,
  );
  const swapOnRotate = spec.rotation === 90 || spec.rotation === 270;
  const preCropW = swapOnRotate ? postResizeH : postResizeW;
  const preCropH = swapOnRotate ? postResizeW : postResizeH;
  const { width: postCropW, height: postCropH } = computePostCropDims(
    preCropW,
    preCropH,
    spec.crop ?? null,
  );

  // Step 1+2: resize
  let pipeline: Sharp = applyResize(sharp(input, { failOn: "error" }), spec.resize, srcW, srcH);

  // Step 3+4: rotate / flip
  if (spec.rotation !== 0) {
    pipeline = pipeline.rotate(spec.rotation);
  }
  if (spec.flipHorizontal) pipeline = pipeline.flop();
  if (spec.flipVertical) pipeline = pipeline.flip();

  // Step 5: grayscale
  if (spec.grayscale) pipeline = pipeline.grayscale();

  // Step 6: explicit crop
  if (spec.crop) {
    pipeline = applyCrop(pipeline, spec.crop, preCropW, preCropH);
  }

  // Step 7: watermark — built with POST-rotate-and-crop dimensions. We
  // compute the explicit (left, top) of the overlay from the 9-zone
  // position + margin (Sharp's gravity-based composite has no built-in
  // margin offset, so we do it manually).
  if (spec.watermark) {
    const overlay = await buildWatermark(spec.watermark, postCropW, postCropH);
    if (overlay) {
      const { left, top } = computeWatermarkPosition(
        spec.watermark.position,
        spec.watermark.margin,
        postCropW,
        postCropH,
        overlay.width,
        overlay.height,
      );
      pipeline = pipeline.composite([{ input: overlay.buffer, left, top }]);
    }
  }

  // Step 7: overall opacity fade. Only PNG can carry alpha; for jpeg/webp we
  // approximate by multiplying RGB channels (visual fade).
  if (spec.opacity < 100) {
    pipeline = applyOpacity(pipeline, spec.opacity, spec.outputFormat);
  }

  // Step 8: encode
  const sourceFormat = (sourceMeta.format ?? "png") as "png" | "jpeg" | "webp";
  const outFormat: "png" | "jpeg" | "webp" =
    spec.outputFormat === "original" ? sourceFormat : (spec.outputFormat as OutputFormat);

  switch (outFormat) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: spec.quality ?? DEFAULT_QUALITY, mozjpeg: true });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: spec.quality ?? DEFAULT_QUALITY });
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
    width: outMeta.width ?? postCropW,
    height: outMeta.height ?? postCropH,
    bytes: buffer.length,
  };
};

// --- Resize / crop helpers -------------------------------------------------

const applyResize = (
  pipeline: Sharp,
  resize: ResizeSpec | null,
  srcW: number,
  srcH: number,
): Sharp => {
  if (!resize || resize.mode === "none") return pipeline;
  const { width, height } = resolveResizeTarget(resize, srcW, srcH);
  // `cover` is used when both dimensions are explicit OR an aspect ratio was
  // requested — Sharp will scale to fill the box and crop the excess so the
  // output lands on the exact target aspect ratio. `inside` is used when only
  // one dimension is set: Sharp preserves aspect ratio and fits within.
  const fillBox = !!(resize.aspectRatio || (resize.width && resize.height));

  switch (resize.mode) {
    case "fit":
      return pipeline.resize({
        width,
        height,
        fit: fillBox ? "cover" : "inside",
        withoutEnlargement: true,
      });
    case "crop":
      return pipeline.resize({ width, height, fit: "cover", position: "attention" });
    case "pad": {
      const bg = parseColor(resize.padBackground ?? "#ffffff");
      return pipeline.resize({
        width,
        height,
        fit: "contain",
        background: bg,
      });
    }
  }
};

const applyCrop = (pipeline: Sharp, crop: CropSpec, currentW: number, currentH: number): Sharp => {
  // Determine crop box. If width/height omitted, derive from aspect ratio.
  const { width, height } = resolveCropTarget(crop, currentW, currentH);
  if (width >= currentW && height >= currentH) {
    // requested crop larger than image — nothing to do
    return pipeline;
  }
  return pipeline.extract({
    left: Math.floor((currentW - width) / 2),
    top: Math.floor((currentH - height) / 2),
    width,
    height,
  });
};

const computePostResizeDims = (
  srcW: number,
  srcH: number,
  resize: ResizeSpec | null,
): { width: number; height: number } => {
  return resize ? resolveResizeTarget(resize, srcW, srcH) : { width: srcW, height: srcH };
};

const computePostCropDims = (
  currentW: number,
  currentH: number,
  crop: CropSpec | null,
): { width: number; height: number } => {
  if (!crop) return { width: currentW, height: currentH };
  return resolveCropTarget(crop, currentW, currentH);
};

const resolveResizeTarget = (
  resize: ResizeSpec,
  srcW: number,
  srcH: number,
): { width: number; height: number } => {
  // 1. Both dims explicit
  if (resize.width && resize.height) {
    return { width: resize.width, height: resize.height };
  }
  // 2. Aspect ratio only — derive the missing dim from the source bounds.
  //    Strategy: cap the dimension that would ENLARGE. The other dim grows
  //    (if needed) to land on the target aspect, but we never upscale.
  if (resize.aspectRatio && !resize.width && !resize.height) {
    const r = parseAspectRatio(resize.aspectRatio);
    const targetAspect = r.w / r.h;
    const sourceAspect = srcW / srcH;
    if (sourceAspect > targetAspect) {
      // Source is wider — cap by source height (don't shrink width).
      // The new width is derived from the source height, which may make it
      // smaller than the source (we crop the sides).
      const h = srcH;
      const w = Math.max(1, Math.round(h * targetAspect));
      return { width: w, height: h };
    }
    // Source is taller — cap by source width. Height is derived and may shrink.
    const w = srcW;
    const h = Math.max(1, Math.round(w / targetAspect));
    return { width: w, height: h };
  }
  // 3. Lock aspect: if only one dim, derive the other.
  if (resize.lockAspectRatio) {
    if (resize.width && !resize.height) {
      return { width: resize.width, height: Math.max(1, Math.round((resize.width * srcH) / srcW)) };
    }
    if (resize.height && !resize.width) {
      return { width: Math.max(1, Math.round((resize.height * srcW) / srcH)), height: resize.height };
    }
  }
  // 4. Only one dim given, no lock — fit to it (keep aspect)
  if (resize.width) {
    return { width: resize.width, height: Math.max(1, Math.round((resize.width * srcH) / srcW)) };
  }
  if (resize.height) {
    return { width: Math.max(1, Math.round((resize.height * srcW) / srcH)), height: resize.height };
  }
  return { width: srcW, height: srcH };
};

const resolveCropTarget = (
  crop: CropSpec,
  currentW: number,
  currentH: number,
): { width: number; height: number } => {
  if (crop.width && crop.height) return { width: crop.width, height: crop.height };
  if (crop.aspectRatio) {
    const r = parseAspectRatio(crop.aspectRatio);
    // Default to the smaller dimension as base, fit aspect inside current bounds.
    if (r.w >= r.h) {
      // Wider — cap by current width
      const w = Math.min(currentW, currentW);
      const h = Math.round((w * r.h) / r.w);
      return { width: w, height: h };
    } else {
      const h = Math.min(currentH, currentH);
      const w = Math.round((h * r.w) / r.h);
      return { width: w, height: h };
    }
  }
  return { width: currentW, height: currentH };
};

const parseAspectRatio = (key: string): { w: number; h: number } => {
  const parts = key.split(":").map((n) => Number(n));
  const w = parts[0];
  const h = parts[1];
  if (w === undefined || h === undefined || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`Invalid aspect ratio: ${key}`);
  }
  return { w, h };
};

const parseColor = (hex: string): { r: number; g: number; b: number; alpha: number } => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255, alpha: 1 };
  const num = parseInt(m[1]!, 16);
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff, alpha: 1 };
};

// --- Watermark helpers -----------------------------------------------------

interface WatermarkOverlay {
  /** PNG buffer for the overlay. */
  buffer: Buffer;
  /** Actual width of the overlay in pixels (post-rendering). */
  width: number;
  /** Actual height of the overlay in pixels (post-rendering). */
  height: number;
}

/** Compute the (left, top) where an overlay should be placed. */
const computeWatermarkPosition = (
  position: WatermarkSpec["position"],
  margin: number,
  destW: number,
  destH: number,
  wmW: number,
  wmH: number,
): { left: number; top: number } => {
  const m = Math.max(0, Math.floor(margin));
  const col = position.includes("left") ? 0 : position.includes("right") ? 2 : 1;
  const row = position.includes("top") ? 0 : position.includes("bottom") ? 2 : 1;

  // For left/right edges we anchor to the edge; for middle we center.
  const left =
    col === 0 ? m : col === 2 ? destW - wmW - m : Math.round((destW - wmW) / 2);
  const top =
    row === 0 ? m : row === 2 ? destH - wmH - m : Math.round((destH - wmH) / 2);

  return { left: Math.max(0, left), top: Math.max(0, top) };
};

/**
 * Render a watermark overlay (image or text) and return the rendered
 * buffer with its actual dimensions. The caller is responsible for
 * positioning via `left` / `top` in the composite call.
 */
const buildWatermark = async (
  spec: WatermarkSpec,
  _imageW: number,
  _imageH: number,
): Promise<WatermarkOverlay | null> => {
  const opacity = Math.max(0, Math.min(100, spec.opacity)) / 100;
  const size = Math.max(8, spec.size);

  if (spec.kind === "image" && spec.imageUrl) {
    try {
      const res = await fetch(spec.imageUrl, {
        headers: { "User-Agent": "image-processing-pipeline/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        throw new Error(`Not an image (content-type=${contentType || "<empty>"})`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error("Empty response body");

      const resized = await sharp(buf)
        .resize({ width: size, withoutEnlargement: false })
        .png()
        .toBuffer();
      const wmMeta = await sharp(resized).metadata();
      const wmW = wmMeta.width ?? size;
      const wmH = wmMeta.height ?? size;

      let overlay = resized;
      if (opacity < 1) {
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${wmW}" height="${wmH}">
             <rect width="100%" height="100%" fill="white" fill-opacity="${opacity}"/>
           </svg>`,
        );
        overlay = await sharp(resized)
          .ensureAlpha()
          .composite([{ input: mask, blend: "dest-in" }])
          .png()
          .toBuffer();
      }
      return { buffer: overlay, width: wmW, height: wmH };
    } catch (err) {
      throw new Error(
        `Watermark image URL fetch failed: ${(err as Error).message}`,
      );
    }
  }

  const safeText = (spec.text ?? "").replace(/[<>&]/g, "");
  if (safeText.length === 0) return null;

  // Render the text on a tight canvas. We let sharp compute the text
  // dimensions so we can position the overlay exactly.
  const fontSize = size;
  const fontFamily = "sans-serif";
  const padding = Math.round(fontSize * 0.4);

  // First render the text on a transparent canvas just big enough.
  const textSvg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <style>
        .wm { font: ${fontSize}px ${fontFamily}; fill: rgba(255,255,255,${opacity});
              stroke: rgba(0,0,0,${Math.min(0.6, opacity * 0.6)}); stroke-width: 1;
              paint-order: stroke; }
      </style>
      <text class="wm" x="0" y="${fontSize}">${safeText}</text>
    </svg>`;
  const textBuf = await sharp(Buffer.from(textSvg))
    .png()
    .toBuffer();
  const textMeta = await sharp(textBuf).metadata();
  const textW = textMeta.width ?? fontSize * safeText.length;
  const textH = textMeta.height ?? fontSize + padding * 2;

  // Compose with a dark backing rectangle for legibility, sized to fit the
  // text + padding. This canvas's own dimensions become the overlay size
  // so the caller can position it via left/top.
  const backingW = textW + padding * 2;
  const backingH = textH + padding;
  const canvasW = Math.max(1, Math.round(backingW));
  const canvasH = Math.max(1, Math.round(backingH));
  const composed = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: opacity * 0.4 },
    },
  })
    .composite([{ input: textBuf, left: padding, top: Math.round(padding / 2) }])
    .png()
    .toBuffer();

  return { buffer: composed, width: canvasW, height: canvasH };
};

// --- Opacity helper --------------------------------------------------------

const applyOpacity = (
  pipeline: Sharp,
  opacityPct: number,
  outputFormat: TransformSpec["outputFormat"],
): Sharp => {
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  if (a >= 1) return pipeline;
  // For PNG (or anything that supports alpha) we apply a global alpha fade by
  // multiplying the alpha channel. For jpeg/webp we fake it with a multiply
  // blend against black, which darkens proportionally.
  if (outputFormat === "png" || outputFormat === "original") {
    return pipeline.ensureAlpha().composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">
            <rect width="1" height="1" fill="white" fill-opacity="${a}" />
          </svg>`,
        ),
        blend: "dest-in",
      },
    ]);
  }
  // For jpeg/webp we approximate with a multiply blend against black.
  return pipeline.composite([
    {
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">
          <rect width="1" height="1" fill="black" fill-opacity="${1 - a}" />
        </svg>`,
      ),
      blend: "multiply",
    },
  ]);
};
