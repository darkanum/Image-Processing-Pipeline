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
  format: "png" | "jpeg" | "webp" | "avif";
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
 *   3. flipH / flipV
 *   4. color adjustments (grayscale / brightness / saturation / sepia / invert)
 *
 *   Then, depending on `spec.watermark.placement` (when a watermark is
 *   configured), the order of the final three steps is:
 *
 *     placement = "pre-rotation"  (default — watermark rotates with image):
 *       5. watermark  (positioned on the pre-rotation canvas)
 *       6. rotation   (rotates the image AND the watermark together)
 *       7. opacity    (overall alpha fade, sized to the post-rotation canvas)
 *
 *     placement = "post-rotation"  (watermark stays upright on the final image):
 *       5. opacity    (overall alpha fade, sized to the pre-rotation canvas)
 *       6. rotation   (rotates the image)
 *       7. watermark  (positioned on the post-rotation canvas — upright)
 *
 *   8. format / quality encode
 *
 * The two placements give the user a real choice: "glue the watermark to
 * the image" vs "stamp the watermark on the final output". For rotation
 * 0 both paths produce the same result.
 */
export const transformImage = async (
  input: Buffer,
  spec: TransformSpec,
): Promise<TransformResult> => {
  // Step 0: resolve target dimensions BEFORE building the pipeline so we
  // can position the watermark / crop focal point correctly.
  const sourceMeta: Metadata = await sharp(input).metadata();
  const srcW = sourceMeta.width ?? 0;
  const srcH = sourceMeta.height ?? 0;
  if (srcW === 0 || srcH === 0) {
    throw new Error("Could not read source image dimensions");
  }

  // Resize returns target W/H before rotate/crop. Crop further reduces
  // dimensions. Both happen BEFORE rotation, so `postCropW/H` are the
  // dimensions of the image as it stands at the watermarking stage for
  // pre-rotation placement. (Earlier code applied a 90/270 swap here so
  // the dimensions matched the post-rotation canvas, but that placed
  // the watermark OFF the actual pre-rotation image — fixed by using
  // the real pre-rotation dimensions throughout.)
  const { width: postResizeW, height: postResizeH } = computePostResizeDims(
    srcW,
    srcH,
    spec.resize ?? null,
  );
  const rot = normalizeRotation(spec.rotation);
  const { width: postCropW, height: postCropH } = computePostCropDims(
    postResizeW,
    postResizeH,
    spec.crop ?? null,
  );

  // Step 1: resize
  let pipeline: Sharp = applyResize(sharp(input, { failOn: "error" }), spec.resize, srcW, srcH);

  // Step 2: flip (horizontal / vertical) — applied first because it
  // commutes with every other operation; doing it before crop / watermark
  // / rotate keeps the semantics simple ("flip means flip the image
  // first, then do everything else to the flipped image").
  if (spec.flipHorizontal) pipeline = pipeline.flop();
  if (spec.flipVertical) pipeline = pipeline.flip();

  // Step 3: color adjustments. We resolve the effective spec from the
  // new `colorAdjust` field, falling back to the legacy `grayscale` flag
  // for back-compat. `modulate` is applied for brightness/saturation, then
  // `grayscale` / `recomb` for sepia, then `negate` for invert.
  //
  // IMPORTANT: when `colorAdjust` is present, it owns grayscale (and every
  // other color flag) — the top-level `grayscale` is treated as deprecated
  // and ignored. This is the cleanest semantic for new clients: spread
  // DEFAULT_TRANSFORM and toggle colorAdjust.grayscale directly. Old
  // clients that don't know about colorAdjust still get their top-level
  // `grayscale: true` honored because they don't send colorAdjust at all.
  const ca = spec.colorAdjust;
  const useGrayscale = ca ? ca.grayscale : spec.grayscale;
  if (ca && (ca.brightness !== 100 || ca.saturation !== 100)) {
    // Sharp's `modulate` requires brightness > 0. We clamp at 0.001
    // (≈ 0.1% — effectively black but not a validation error). The
    // frontend slider caps at 200 so the user can never hit exactly 0
    // in practice.
    const safeBrightness = Math.max(0.001, ca.brightness / 100);
    pipeline = pipeline.modulate({
      brightness: safeBrightness,
      saturation: ca.saturation / 100,         // 0 = grayscale, 1 = no change, 2 = over-saturated
    });
  }
  if (useGrayscale) pipeline = pipeline.grayscale();
  if (ca && ca.sepia > 0) {
    // Sepia: apply a tint after grayscale. We pipe to greyscale then
    // overlay a warm sepia tone using a `tint` recombination. Sharp's
    // .tint() requires the image to be in RGB, so we re-enable color
    // channels for the tint step.
    pipeline = pipeline.recomb([
      [0.393, 0.769, 0.189],
      [0.349, 0.686, 0.168],
      [0.272, 0.534, 0.131],
    ]);
    // Modulate the sepia strength: blend the sepia result with the
    // original by applying `modulate` with a tint. For simplicity we
    // just fade the sepia intensity by mapping 0..100 to a less-saturated
    // output via a single-channel linear transformation.
    if (ca.sepia < 100) {
      // Mild sepia: scale all channels by 0.5 + 0.5*(1-strength) to
      // blend with the grayscale version. Implemented by another recomb.
      const k = ca.sepia / 100;
      pipeline = pipeline.recomb([
        [1 - 0.5 * k, 0.5 * k, 0],
        [0, 1 - 0.5 * k, 0.5 * k],
        [0.5 * k, 0, 1 - 0.5 * k],
      ]);
    }
  }
  if (ca && ca.invert) pipeline = pipeline.negate({ alpha: false });

  // Step 4: explicit crop. Done before watermark so the user can crop
  // the image without affecting the watermark placement; done before
  // rotation so the crop coords are in the pre-rotation image's space.
  if (spec.crop) {
    pipeline = applyCrop(pipeline, spec.crop, postResizeW, postResizeH);
  }

  // Steps 5–7: watermark + rotation + opacity. The order depends on the
  // user's watermark placement preference.
  const postRot = computeRotatedDims(postCropW, postCropH, rot);
  const placement: "pre-rotation" | "post-rotation" =
    spec.watermark?.placement ?? "pre-rotation";

  if (placement === "post-rotation" && spec.watermark) {
    // Post-rotation: opacity → rotate → watermark. The watermark is
    // positioned on the post-rotation canvas at the user-specified
    // position so it lands exactly in the corner the user picked on
    // the final image, without rotating with the image.
    if (spec.opacity < 100) {
      pipeline = applyOpacity(
        pipeline,
        spec.opacity,
        spec.outputFormat as OutputFormat,
        postCropW,
        postCropH,
      );
    }
    if (rot !== 0) {
      pipeline = pipeline.rotate(rot);
    }
    pipeline = await compositeWatermark(pipeline, spec.watermark, postRot.w, postRot.h);
  } else {
    // Pre-rotation (default): watermark → rotate → opacity. The
    // watermark is placed on the pre-rotation image so the rotation
    // rotates the image AND the watermark together — the watermark
    // stays glued to the image.
    //
    // Why this default: rotating the image first would enlarge the
    // canvas for non-90/270 angles (e.g. an 800×600 image rotated 37°
    // becomes ~1000×960), and the "bottom-right" of that larger canvas
    // would be somewhere off the actual image. Placing the watermark
    // before the rotation means the bottom-right of the unrotated image
    // stays at the bottom-right of the rotated image, just at an angle.
    if (spec.watermark) {
      pipeline = await compositeWatermark(pipeline, spec.watermark, postCropW, postCropH);
    }
    if (rot !== 0) {
      pipeline = pipeline.rotate(rot);
    }
    if (spec.opacity < 100) {
      // The opacity SVG is sized to the post-rotation canvas (because
      // rotation just happened), so the fade covers the full rotated
      // image — not just the pre-rotation rectangle.
      pipeline = applyOpacity(
        pipeline,
        spec.opacity,
        spec.outputFormat as OutputFormat,
        postRot.w,
        postRot.h,
      );
    }
  }

  // Step 8: encode
  const sourceFormat = (sourceMeta.format ?? "png") as "png" | "jpeg" | "webp" | "avif";
  const outFormat: "png" | "jpeg" | "webp" | "avif" =
    spec.outputFormat === "original" ? sourceFormat : (spec.outputFormat as OutputFormat);

  switch (outFormat) {
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: spec.quality ?? DEFAULT_QUALITY, mozjpeg: true });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: spec.quality ?? DEFAULT_QUALITY });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: spec.quality ?? DEFAULT_QUALITY });
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
  // Mode semantics:
  //   fit  — "fit" the image INTO the target box preserving aspect, then
  //          pad to the exact target size (white background). Result is
  //          always exactly the target dimensions.
  //   crop — scale to COVER the target box and crop the overflow. Always
  //          exactly the target dimensions.
  //   pad  — same as fit, but with an explicit background color.
  //   none — no resize (handled by caller, never reaches this function).
  switch (resize.mode) {
    case "fit":
    case "pad": {
      const bg = parseColor(resize.padBackground ?? "#ffffff");
      return pipeline.resize({
        width,
        height,
        fit: "contain",
        background: bg,
      });
    }
    case "crop":
      return pipeline.resize({ width, height, fit: "cover", position: "attention" });
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

/**
 * Normalize a rotation value to a finite number in [-360, 360]. Negative
 * values and out-of-range values are wrapped; non-numbers become 0.
 * Sharp accepts any rotation angle, but we clamp to keep the watermark
 * positioning math sane.
 */
const normalizeRotation = (r: unknown): number => {
  if (typeof r !== "number" || !Number.isFinite(r)) return 0;
  // Wrap into [-360, 360] so users can type "720" without surprises.
  const wrapped = ((r % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
};

/**
 * Compute the bounding box of an image of size (W, H) after being
 * rotated by `angleDeg` degrees. This is the size of the canvas that
 * sharp's `.rotate(angle)` will produce.
 *
 * For 0/180/360: width and height are unchanged.
 * For 90/270: width and height swap.
 * For other angles: the bounding box is W*|cos|+H*|sin|.
 */
const computeRotatedDims = (W: number, H: number, angleDeg: number): { w: number; h: number } => {
  if (angleDeg === 0) return { w: W, h: H };
  const norm = ((angleDeg % 360) + 360) % 360;
  if (norm === 180) return { w: W, h: H };
  if (norm === 90 || norm === 270) return { w: H, h: W };
  const rad = (angleDeg * Math.PI) / 180;
  const w = Math.ceil(Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad)));
  const h = Math.ceil(Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad)));
  return { w, h };
};

/** Returns true if the perceived luminance of a color is "light" (>= 0.5). */
const isLightColor = (rgb: { r: number; g: number; b: number }): boolean => {
  // Standard relative luminance per WCAG.
  const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return lum >= 0.5;
};

const parseColor = (hex: string): { r: number; g: number; b: number; alpha: number } => {
  // Accept 6-char hex (#rrggbb), 3-char hex (#rgb → expand to 6), and 8-char
  // hex with alpha (#rrggbbaa — alpha is dropped here, callers use parseColor
  // for solid backgrounds). Anything else falls back to white. Returning a
  // parseable color even for partial input prevents the silent "user typed
  // #abc but result is white" surprise.
  const m6 = /^#([0-9a-f]{6})[0-9a-f]{0,2}$/i.exec(hex);
  if (m6) {
    const num = parseInt(m6[1]!, 16);
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff, alpha: 1 };
  }
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m3) {
    const r = parseInt(m3[1]! + m3[1]!, 16);
    const g = parseInt(m3[2]! + m3[2]!, 16);
    const b = parseInt(m3[3]! + m3[3]!, 16);
    return { r, g, b, alpha: 1 };
  }
  return { r: 255, g: 255, b: 255, alpha: 1 };
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
 * Render a watermark overlay and composite it onto the given sharp
 * pipeline at the user-specified position. Auto-scales the overlay
 * down if it would otherwise overflow the destination. Returns the
 * pipeline with the watermark composited (or unchanged if the overlay
 * is null/empty).
 *
 * Implementation note: returns a fresh pipeline that has been
 * "materialized" to a buffer first. Sharp has a known issue where
 * chaining `pipeline.composite()` and then `pipeline.rotate()` (or
 * other geometric ops) on the same pipeline drops the composited
 * overlay. Calling `toBuffer()` here forces the composite to be baked
 * in, so the caller can safely chain further operations.
 */
const compositeWatermark = async (
  pipeline: Sharp,
  watermark: WatermarkSpec,
  destW: number,
  destH: number,
): Promise<Sharp> => {
  let overlay = await buildWatermark(watermark, destW, destH);
  if (!overlay) return pipeline;
  // Sharp refuses to composite an overlay that is larger than the
  // destination in either dimension. If the user's font size / text
  // length / margin makes the overlay bigger than the image, scale it
  // down to fit. This keeps the watermark visible on small images
  // instead of failing the whole job.
  if (overlay.width > destW || overlay.height > destH) {
    const scale = Math.min(destW / overlay.width, destH / overlay.height);
    const newW = Math.max(1, Math.floor(overlay.width * scale));
    const newH = Math.max(1, Math.floor(overlay.height * scale));
    const resized = await sharp(overlay.buffer).resize(newW, newH).toBuffer();
    overlay = { buffer: resized, width: newW, height: newH };
  }
  const { left, top } = computeWatermarkPosition(
    watermark.position,
    watermark.margin,
    destW,
    destH,
    overlay.width,
    overlay.height,
  );
  // IMPORTANT: bake the composite to a buffer before returning, so
  // that subsequent rotate/flip/etc. on the returned pipeline don't
  // drop the overlay (sharp's chained-geometry-op bug).
  const baked = await pipeline
    .composite([{ input: overlay.buffer, left, top }])
    .toBuffer();
  return sharp(baked, { failOn: "error" });
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

      // Optional backing rectangle for image watermarks. Same semantics
      // as the text path: enabled=true paints a coloured rectangle
      // behind the image; enabled=false returns the image as-is on a
      // transparent canvas.
      const bg = spec.background ?? null;
      const bgEnabled = bg?.enabled !== false;
      if (!bgEnabled) {
        return { buffer: overlay, width: wmW, height: wmH };
      }
      const bgColor = bg?.color ?? "#000000";
      const bgOpacity = (bg?.opacity ?? 40) / 100;
      const bgPad = Math.max(0, Math.round(bg?.padding ?? 0));
      const bgRgb = parseColor(bgColor);
      const backingW = wmW + bgPad * 2;
      const backingH = wmH + bgPad * 2;
      const composed = await sharp({
        create: {
          width: backingW,
          height: backingH,
          channels: 4,
          background: { r: bgRgb.r, g: bgRgb.g, b: bgRgb.b, alpha: bgOpacity },
        },
      })
        .composite([{ input: overlay, left: bgPad, top: bgPad }])
        .png()
        .toBuffer();
      return { buffer: composed, width: backingW, height: backingH };
    } catch (err) {
      throw new Error(
        `Watermark image URL fetch failed: ${(err as Error).message}`,
      );
    }
  }

  const safeText = (spec.text ?? "").replace(/[<>&]/g, "");
  if (safeText.length === 0) return null;

  const fontSize = size;
  const fontFamily = "sans-serif";
  // No `sharp.metadata().width` measurement — that returns the *tight* glyph
  // bounding box and was clipping both the last character (right edge) and
  // descenders (bottom edge). Instead, allocate a fixed-size canvas with
  // generous safe-space for the full character cell (cap + descender) and
  // any anti-aliasing fringe on the right. The text is rendered inside the
  // canvas with the same safe padding, so no measurement is needed.
  const charCellW = fontSize * 0.65; // average char width incl. tracking
  const textRunW = Math.ceil(safeText.length * charCellW);
  const padX = Math.round(fontSize * 0.5);
  const padY = Math.round(fontSize * 0.4);
  const baselineY = Math.round(fontSize * 0.85); // baseline ~85% down the cell
  const canvasW = textRunW + padX * 2;
  // Cell height: cap height + descender + stroke room.
  const cellH = Math.round(fontSize * 1.35);
  const canvasH = cellH + padY * 2;

  // Backing configuration. When `background.enabled === false` we render
  // the text on a transparent canvas — the source image shows through.
  const bg = spec.background ?? null;
  const bgEnabled = bg?.enabled !== false; // default ON for back-compat
  const bgColor = bg?.color ?? "#000000";
  const bgOpacity = (bg?.opacity ?? 40) / 100;
  const bgPad = Math.max(0, Math.round(bg?.padding ?? 0));

  // Text color: parse the user's spec (default white). The stroke color
  // is automatically chosen to be the opposite luminance (black stroke for
  // light text, white stroke for dark text) so the watermark stays
  // legible without the user having to pick a stroke color.
  const textRgb = parseColor(spec.color ?? "#ffffff");
  const strokeLight = isLightColor(textRgb);
  const strokeRgb = strokeLight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const strokeOpacity = Math.min(0.6, opacity * 0.6);

  const textSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
      <style>
        .wm { font: ${fontSize}px ${fontFamily}; fill: rgba(${textRgb.r},${textRgb.g},${textRgb.b},${opacity});
              stroke: rgba(${strokeRgb.r},${strokeRgb.g},${strokeRgb.b},${strokeOpacity}); stroke-width: 1;
              paint-order: stroke; }
      </style>
      <text class="wm" x="${padX}" y="${padY + baselineY}">${safeText}</text>
    </svg>`;
  const textBuf = await sharp(Buffer.from(textSvg))
    .png()
    .toBuffer();

  if (!bgEnabled) {
    // No backing — return the text-only PNG on a transparent canvas. The
    // source image shows through wherever the text doesn't paint.
    return { buffer: textBuf, width: canvasW, height: canvasH };
  }

  // Backing is enabled. Render the text on top of a coloured rectangle
  // sized to the canvas plus the requested padding. The colour, opacity
  // and padding all come from the spec so the user can match the look
  // to the underlying image.
  const bgRgb = parseColor(bgColor);
  const backingW = canvasW + bgPad * 2;
  const backingH = canvasH + bgPad * 2;
  const composed = await sharp({
    create: {
      width: backingW,
      height: backingH,
      channels: 4,
      background: { r: bgRgb.r, g: bgRgb.g, b: bgRgb.b, alpha: bgOpacity },
    },
  })
    .composite([{ input: textBuf, left: bgPad, top: bgPad }])
    .png()
    .toBuffer();

  return { buffer: composed, width: backingW, height: backingH };
};

// --- Opacity helper --------------------------------------------------------

const applyOpacity = (
  pipeline: Sharp,
  opacityPct: number,
  outputFormat: OutputFormat,
  currentW: number,
  currentH: number,
): Sharp => {
  const a = Math.max(0, Math.min(100, opacityPct)) / 100;
  if (a >= 1) return pipeline;
  // For PNG (or anything that supports alpha) we apply a global alpha fade by
  // multiplying the alpha channel via a `dest-in` blend against a full-canvas
  // white rect with the desired opacity. `dest-in` keeps the destination's
  // pixels where the source is opaque — so when the source has uniform
  // alpha `a` everywhere, the result's alpha is multiplied by `a`.
  //
  // NOTE: the SVG MUST match the destination's actual dimensions. A 1×1 SVG
  // fails — sharp's compositing of a 1×1 source with `dest-in` collapses
  // alpha to 0 for some reason (verified via minimal repro). Full-size SVGs
  // give exactly the expected alpha (e.g. 0.5 → alpha=128).
  //
  // For jpeg/webp we fake transparency with a multiply blend against black
  // (no alpha channel, so the only way to suggest "fading" is to darken).
  // The "original" case is resolved upstream — the caller passes the
  // concrete format that "original" resolved to.
  if (outputFormat === "png" || outputFormat === "avif") {
    return pipeline.ensureAlpha().composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${currentW}" height="${currentH}">
            <rect width="100%" height="100%" fill="white" fill-opacity="${a}" />
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
        `<svg xmlns="http://www.w3.org/2000/svg" width="${currentW}" height="${currentH}">
          <rect width="100%" height="100%" fill="black" fill-opacity="${1 - a}" />
        </svg>`,
      ),
      blend: "multiply",
    },
  ]);
};
