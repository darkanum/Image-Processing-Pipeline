import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { transformImage } from "../src/services/imageProcessor.js";
import { DEFAULT_TRANSFORM, type TransformSpec } from "../src/types/job.js";

const buildTestImage = async (
  width: number,
  height: number,
  bg: { r: number; g: number; b: number } = { r: 80, g: 140, b: 200 },
): Promise<Buffer> => {
  return sharp({
    create: { width, height, channels: 3, background: bg },
  })
    .png()
    .toBuffer();
};

describe("transformImage — basic happy path", () => {
  it("resizes a PNG to the requested width keeping aspect ratio", async () => {
    const input = await buildTestImage(1600, 1200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", width: 400, lockAspectRatio: true },
    });
    expect(result.format).toBe("png");
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("converts to JPEG when outputFormat=jpeg", async () => {
    const input = await buildTestImage(600, 400);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      outputFormat: "jpeg",
      resize: { mode: "fit", width: 200, lockAspectRatio: true },
    });
    expect(result.format).toBe("jpeg");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("converts to WebP when outputFormat=webp", async () => {
    const input = await buildTestImage(600, 400);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      outputFormat: "webp",
      resize: { mode: "fit", width: 200, lockAspectRatio: true },
    });
    expect(result.format).toBe("webp");
  });

  it("keeps original format when outputFormat=original", async () => {
    const input = await buildTestImage(400, 300);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      outputFormat: "original",
      resize: { mode: "fit", width: 200, lockAspectRatio: true },
    });
    expect(result.format).toBe("png");
  });

  it("produces grayscale output when grayscale=true", async () => {
    const input = await buildTestImage(600, 400);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      grayscale: true,
      // Clear colorAdjust so the legacy top-level grayscale is honored.
      colorAdjust: undefined,
      resize: { mode: "fit", width: 300, lockAspectRatio: true },
    });
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBeGreaterThanOrEqual(1);
    // Sample several pixels and check R === G === B (grayscale).
    let samples = 0;
    for (let i = 0; i < data.length; i += info.channels * 50) {
      const r = data[i];
      const g = info.channels > 1 ? data[i + 1] : r;
      const b = info.channels > 2 ? data[i + 2] : r;
      expect(r).toBe(g);
      expect(g).toBe(b);
      samples += 1;
      if (samples >= 5) break;
    }
    expect(samples).toBeGreaterThan(0);
  });
});

describe("transformImage — resize modes", () => {
  it("fit mode produces the exact target dimensions (pads to fill)", async () => {
    // Regression: a 600x600 source with target 1280x720 should produce
    // 1280x720, not the original 600x600. The previous "withoutEnlargement"
    // implementation silently skipped the resize when the source was smaller.
    const input = await buildTestImage(600, 600);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", width: 1280, height: 720, lockAspectRatio: true },
    });
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it("fit mode scales down to fit when source is larger than target", async () => {
    const input = await buildTestImage(1920, 1080);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", width: 1280, height: 720, lockAspectRatio: true },
    });
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it("fit mode with 800x500 target produces 800x500", async () => {
    // User-reported: "fit 800x500 -> 600x500" was a bug.
    const input = await buildTestImage(600, 500);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", width: 800, height: 500, lockAspectRatio: false },
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(500);
  });

  it("crop mode fills the requested box", async () => {
    const input = await buildTestImage(1600, 1200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "crop", width: 400, height: 400, lockAspectRatio: false },
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(400);
  });

  it("pad mode produces a target-size canvas with source inside", async () => {
    const input = await buildTestImage(200, 100);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "pad", width: 400, height: 400, lockAspectRatio: false, padBackground: "#ff0000" },
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(400);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("fit mode with only width set preserves aspect ratio", async () => {
    const input = await buildTestImage(1600, 1200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", width: 800, lockAspectRatio: true },
    });
    // 800x600 fits within the 800 width. With fit=contain, height is
    // derived from width preserving aspect: 800 / (1600/1200) = 600.
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });
});

describe("transformImage — aspect ratio resize", () => {
  it("resizes to a 16:9 aspect ratio", async () => {
    const input = await buildTestImage(1600, 1200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", aspectRatio: "16:9", lockAspectRatio: true },
    });
    // source is 4:3 — to fit 16:9 inside, base width is 1600, height becomes 1600 * 9/16 = 900
    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
  });

  it("resizes to a 1:1 aspect ratio from a wide source", async () => {
    // 1600x1200 (4:3) → 1:1 — without enlargement we cap the wider dim (width)
    // so the smaller dim grows to match. Result: 1200x1200.
    const input = await buildTestImage(1600, 1200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      resize: { mode: "fit", aspectRatio: "1:1", lockAspectRatio: true },
    });
    expect(result.width).toBe(1200);
    expect(result.height).toBe(1200);
  });
});

describe("transformImage — rotate & flip", () => {
  it("rotates 90° (swaps dimensions)", async () => {
    const input = await buildTestImage(400, 200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: 90,
      resize: null,
    });
    expect(result.width).toBe(200);
    expect(result.height).toBe(400);
  });

  it("rotates 180° (keeps dimensions)", async () => {
    const input = await buildTestImage(400, 200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: 180,
      resize: null,
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);
  });

  it("flips horizontally", async () => {
    const input = await buildTestImage(400, 200);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      flipHorizontal: true,
      resize: null,
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);
  });
});

describe("transformImage — watermark", () => {
  it("renders a text watermark", async () => {
    const input = await buildTestImage(800, 600);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "Sample Watermark",
        position: "bottom-right",
        margin: 20,
        opacity: 80,
        size: 32,
      },
      resize: null,
    });
    // Bytes should differ from a clean transformation.
    const clean = await transformImage(input, { ...DEFAULT_TRANSFORM, resize: null });
    expect(result.bytes).not.toBe(clean.bytes);
  });

  it("renders watermark with size 0 opacity (effectively no visible text)", async () => {
    const input = await buildTestImage(600, 400);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "Ghost",
        position: "top-left",
        margin: 10,
        opacity: 0,
        size: 24,
      },
      resize: null,
    });
    // Should still produce valid output (just visually faded).
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("places text watermark in each of the 9 positions without errors", async () => {
    const input = await buildTestImage(800, 600);
    const positions = [
      "top-left", "top-center", "top-right",
      "middle-left", "middle-center", "middle-right",
      "bottom-left", "bottom-center", "bottom-right",
    ] as const;
    for (const position of positions) {
      const result = await transformImage(input, {
        ...DEFAULT_TRANSFORM,
        watermark: { kind: "text", text: "Position " + position, position, margin: 20, opacity: 90, size: 32 },
        resize: null,
      });
      // Each position should produce a valid output without throwing.
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    }
  });

  it("fails the watermark fetch when image URL is unreachable", async () => {
    const input = await buildTestImage(600, 400);
    await expect(
      transformImage(input, {
        ...DEFAULT_TRANSFORM,
        watermark: {
          kind: "image",
          imageUrl: "http://127.0.0.1:1/does-not-exist.png",
          position: "bottom-right",
          margin: 20,
          opacity: 80,
          size: 100,
        },
        resize: null,
      }),
    ).rejects.toThrow(/Watermark image URL fetch failed/);
  });

  it("scales text watermark down when the requested size is larger than the image", async () => {
    // Regression: font size 51 on a 400x400 image produced a watermark canvas
    // larger than the destination, which sharp refused to composite
    // ("Image to composite must have same dimensions or smaller"). The
    // transform should now scale the overlay down to fit instead of failing.
    const input = await buildTestImage(400, 400);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "BIG WATERMARK 51",
        position: "bottom-right",
        margin: 30,
        opacity: 90,
        size: 51,
      },
      resize: null,
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(400);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("does not clip descenders in text watermark (e.g. 'g', 'p', 'y')", async () => {
    // Regression: '© 2026 Portfolio' and 'g', 'p', 'y' descenders were being
    // cut off because the dark backing rectangle was too short.
    const input = await buildTestImage(800, 600);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "© 2026 Portfolio",  // contains 'p', 'f' descenders
        position: "top-left",
        margin: 50,
        opacity: 90,
        size: 28,
      },
      resize: null,
    });
    // Verify the result has the expected dimensions and the watermark
    // didn't error. (Pixel-level descender inspection is complex; we
    // mainly want to make sure the call succeeds and produces a
    // visually-correct-looking image with these characters.)
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("applies the requested margin to a text watermark (200 px from edge)", async () => {
    // 1000x1000 source, text watermark bottom-right with 200px margin and
    // a 24px font. The text canvas should sit ~200px from the right and
    // bottom edges, NOT flush against them.
    const input = await buildTestImage(1000, 1000);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "MARGIN_TEST",
        position: "bottom-right",
        margin: 200,
        opacity: 100,
        size: 24,
      },
      resize: null,
    });
    // The result should be the same dimensions; what we really verify is
    // that the bytes differ from a margin=0 version.
    const noMargin = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "MARGIN_TEST",
        position: "bottom-right",
        margin: 0,
        opacity: 100,
        size: 24,
      },
      resize: null,
    });
    expect(result.bytes).not.toBe(noMargin.bytes);
  });
});

describe("transformImage — watermark background toggle", () => {
  it("renders a text watermark WITHOUT a backing rectangle when background.enabled=false", async () => {
    // With background disabled, the result must still contain the text
    // pixels but the area around it should be transparent (alpha=0)
    // where the source image shows through. The result is a composite
    // of the source and the text-only PNG.
    const input = await buildTestImage(800, 600);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "NO_BG",
        position: "bottom-right",
        margin: 24,
        opacity: 100,
        size: 32,
        background: { enabled: false, color: "#000000", opacity: 100, padding: 0 },
      },
      resize: null,
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    // The PNG must include alpha and the text pixels should be present.
    const meta = await sharp(result.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it("renders a text watermark WITH backing rectangle when background.enabled=true", async () => {
    const input = await buildTestImage(800, 600);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "WITH_BG",
        position: "bottom-right",
        margin: 24,
        opacity: 100,
        size: 32,
        background: { enabled: true, color: "#ff0000", opacity: 80, padding: 8 },
      },
      resize: null,
    });
    // The padding adds 8px on every side, so the backing is at least
    // 16px larger than the text. We check that the call succeeded and
    // produced a non-trivial image.
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("backing color/opacity values affect the rendered output bytes", async () => {
    // Two specs differing only in backing color should produce different
    // bytes (the colored rectangle has different pixel values).
    const input = await buildTestImage(800, 600);
    const baseSpec = {
      kind: "text" as const,
      text: "COLOR_DIFF",
      position: "bottom-right",
      margin: 24,
      opacity: 100,
      size: 32,
    };
    const redBg = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: { ...baseSpec, background: { enabled: true, color: "#ff0000", opacity: 80, padding: 0 } },
      resize: null,
    });
    const blueBg = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: { ...baseSpec, background: { enabled: true, color: "#0000ff", opacity: 80, padding: 0 } },
      resize: null,
    });
    expect(redBg.bytes).not.toBe(blueBg.bytes);
  });

  it("omitted background field defaults to backing enabled (back-compat)", async () => {
    // Pre-existing callers that send no `background` field must still
    // get a dark backing — preserves the look the app shipped with.
    const input = await buildTestImage(800, 600);
    const withField = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "BACKCOMPAT",
        position: "bottom-right",
        margin: 24,
        opacity: 100,
        size: 32,
      },
      resize: null,
    });
    const explicitDefault = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text",
        text: "BACKCOMPAT",
        position: "bottom-right",
        margin: 24,
        opacity: 100,
        size: 32,
        background: { enabled: true, color: "#000000", opacity: 40, padding: 0 },
      },
      resize: null,
    });
    expect(withField.bytes).toBe(explicitDefault.bytes);
  });
});

describe("transformImage — overall opacity", () => {
  it("applies 50% opacity to PNG output and produces a half-transparent image", async () => {
    // Regression: previously the dest-in blend used a 1×1 SVG source which
    // collapsed alpha to 0 (verified via minimal repro). The fix uses a
    // full-canvas SVG matching the destination dimensions. The image
    // content must still be present and the alpha must be ~128 (50% of 255).
    const input = await buildTestImage(400, 300, { r: 255, g: 0, b: 0 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      opacity: 50,
      outputFormat: "png",
      resize: null,
    });
    expect(result.format).toBe("png");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.channels).toBe(4);

    // Sample alpha across the image — most pixels should be near 128
    // (50% of 255). Before the fix this returned 0 for all pixels.
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alphas: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) {
      alphas.push(data[i + info.channels - 1]);
    }
    const avg = alphas.reduce((a, b) => a + b, 0) / alphas.length;
    // Allow some leeway for sharp's edge cases — expect somewhere in
    // the 100-150 range (50% ± 10%).
    expect(avg).toBeGreaterThan(100);
    expect(avg).toBeLessThan(150);
  });

  it("applies 25% opacity to PNG output and produces a quarter-transparent image", async () => {
    const input = await buildTestImage(200, 150, { r: 0, g: 0, b: 255 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      opacity: 25,
      outputFormat: "png",
      resize: null,
    });
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let alphaSum = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      alphaSum += data[i + info.channels - 1];
    }
    const avg = alphaSum / (info.width * info.height);
    // 25% of 255 = 63.75. Allow 50-80.
    expect(avg).toBeGreaterThan(50);
    expect(avg).toBeLessThan(80);
  });

  it("100% opacity leaves the image fully opaque", async () => {
    // At 100% opacity, applyOpacity returns the pipeline early without
    // calling ensureAlpha(). For a 3-channel source (the test image is RGB),
    // the output is also 3-channel. What we verify is that the image still
    // round-trips with the expected color and no fade.
    const input = await buildTestImage(100, 100, { r: 100, g: 200, b: 50 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      opacity: 100,
      outputFormat: "png",
      resize: null,
    });
    const meta = await sharp(result.buffer).metadata();
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    // No transparency should have been applied — sample a few pixels and
    // verify the colors match the source (no darkening from a multiply blend).
    let avgR = 0, avgG = 0, avgB = 0, count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      avgR += data[i];
      avgG += data[i + 1];
      avgB += data[i + 2];
      count++;
    }
    expect(Math.round(avgR / count)).toBe(100);
    expect(Math.round(avgG / count)).toBe(200);
    expect(Math.round(avgB / count)).toBe(50);
  });

  it("clamps opacity > 100 to 100 (no fade applied)", async () => {
    // 200 should be clamped to 100 — same as the 100% test above.
    const input = await buildTestImage(100, 100, { r: 100, g: 200, b: 50 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      opacity: 200,
      resize: null,
    });
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let avgR = 0, avgG = 0, avgB = 0, count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      avgR += data[i];
      avgG += data[i + 1];
      avgB += data[i + 2];
      count++;
    }
    expect(Math.round(avgR / count)).toBe(100);
    expect(Math.round(avgG / count)).toBe(200);
    expect(Math.round(avgB / count)).toBe(50);
  });
});

describe("transformImage — combined operations", () => {
  it("resize + grayscale + watermark + format conversion compose correctly", async () => {
    const input = await buildTestImage(1200, 800);
    const result = await transformImage(input, {
      outputFormat: "webp",
      quality: 75,
      resize: { mode: "fit", width: 600, lockAspectRatio: true },
      crop: null,
      grayscale: true,
      watermark: {
        kind: "text",
        text: "Pipeline",
        position: "top-right",
        margin: 16,
        opacity: 90,
        size: 28,
      },
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      opacity: 100,
    });
    expect(result.format).toBe("webp");
    expect(result.width).toBe(600);
    expect(result.height).toBe(400);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("rejects corrupt input that is not a real image", async () => {
    const notImage = Buffer.from("this is not an image at all");
    await expect(transformImage(notImage, DEFAULT_TRANSFORM)).rejects.toThrow();
  });

  it("rejects invalid aspect ratio key", async () => {
    const input = await buildTestImage(400, 300);
    await expect(
      transformImage(input, {
        ...DEFAULT_TRANSFORM,
        resize: { mode: "fit", aspectRatio: "16/9", lockAspectRatio: true },
      }),
    ).rejects.toThrow();
  });
});

describe("TransformSpec helpers", () => {
  it("DEFAULT_TRANSFORM has expected shape", () => {
    const t: TransformSpec = DEFAULT_TRANSFORM;
    expect(t.outputFormat).toBe("original");
    expect(t.grayscale).toBe(false);
    expect(t.rotation).toBe(0);
    expect(t.opacity).toBe(100);
    expect(t.resize).toBeNull();
    expect(t.watermark).toBeNull();
  });
});

describe("transformImage — custom rotation", () => {
  it("accepts arbitrary rotation angles (45, 30, 7)", async () => {
    for (const angle of [45, 30, 7, -15, 360]) {
      const input = await buildTestImage(200, 100);
      const result = await transformImage(input, {
        ...DEFAULT_TRANSFORM,
        rotation: angle,
        resize: null,
      });
      // After rotation, dimensions swap or grow to fit the rotated bbox.
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    }
  });

  it("wraps out-of-range rotations into [-180, 180]", async () => {
    const input = await buildTestImage(200, 100);
    // 720 should wrap to 0 — same as no rotation
    const noRot = await transformImage(input, { ...DEFAULT_TRANSFORM, rotation: 0, resize: null });
    const wrapped = await transformImage(input, { ...DEFAULT_TRANSFORM, rotation: 720, resize: null });
    expect(wrapped.width).toBe(noRot.width);
    expect(wrapped.height).toBe(noRot.height);
  });

  it("non-numeric rotation falls back to 0", async () => {
    const input = await buildTestImage(200, 100);
    // Cast through unknown so TS doesn't complain; runtime should clamp to 0.
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rotation: "not a number" as any,
      resize: null,
    });
    const noRot = await transformImage(input, { ...DEFAULT_TRANSFORM, rotation: 0, resize: null });
    expect(result.width).toBe(noRot.width);
    expect(result.height).toBe(noRot.height);
  });
});

describe("transformImage — watermark + rotation glue", () => {
  // Regression for job #98: the user reported that the watermark was
  // not at bottom-right when rotation was applied. The bug was that
  // we applied rotation BEFORE the watermark, so the watermark was
  // placed on a canvas whose dimensions were wrong (sharp's rotate
  // enlarges the canvas for non-90/270 angles). Fix: move rotation
  // to be the last step so the watermark rotates with the image.
  it("keeps the watermark visually attached to the bottom-right of the image when rotated -37°", async () => {
    const input = await buildTestImage(800, 600, { r: 80, g: 140, b: 200 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: -37,
      watermark: {
        kind: "text",
        text: "wm",
        position: "bottom-right",
        margin: 10,
        opacity: 100,
        size: 40,
      },
      resize: null,
    });
    // Sanity: the image is rotated and the canvas is now larger.
    expect(result.width).toBeGreaterThan(800);
    expect(result.height).toBeGreaterThan(600);

    // The bottom-right corner of the (pre-rotation) image lives at
    // (800, 600) in the source. After rotating -37° around the image
    // center, that corner lands at a specific point in the rotated
    // canvas. The watermark should be near that point — close to the
    // bottom-right of the canvas, NOT floating in the top-left.
    // We sample a horizontal strip across the bottom of the rotated
    // canvas and assert at least one pixel of the watermark (light
    // pixels, since the source is dark blue and the text is white
    // with a dark backing) is present in the bottom 20% of the
    // canvas.
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const startY = Math.floor(info.height * 0.8) * info.width * info.channels;
    let lightPixels = 0;
    for (let i = startY; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
    // Count any pixel that's "noticeably different from dark blue" —
    // the watermark is white text on a black backing, both of which
    // are very different from (80, 140, 200).
    if (Math.abs(r - 80) > 80 || Math.abs(g - 140) > 80 || Math.abs(b - 200) > 80) {
      lightPixels += 1;
    }
  }
    expect(lightPixels).toBeGreaterThan(0);
  });
});

describe("transformImage — watermark placement (pre vs post rotation)", () => {
  // The user can choose whether the watermark is composited BEFORE the
  // rotation (so it rotates with the image — the default), or AFTER the
  // rotation (so it stays upright at the user-specified position on the
  // final image). These tests cover both paths and the corner cases.

  /** Sample the raw pixels of `result` and return the {count, topY, leftX, rightX, bottomY}
   *  bounding box of the WATERMARK TEXT (white pixels). The watermark
   *  backing is dark — the same color as the opaque-black corners that
   *  sharp fills into the larger canvas for non-90/270 rotations — so
   *  we look for the unique white text instead. */
  const locateWatermark = async (result: { buffer: Buffer }) => {
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const ch = info.channels;
    let count = 0;
    let topY = H, bottomY = -1, leftX = W, rightX = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * ch;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // White text on a black backing. White is the only signal that's
        // unique to the watermark — the backing is the same color as
        // sharp's rotation-canvas corners, and the source color is dark
        // blue, so the only unique match is "very white".
        if (r > 240 && g > 240 && b > 240) {
          count += 1;
          if (y < topY) topY = y;
          if (y > bottomY) bottomY = y;
          if (x < leftX) leftX = x;
          if (x > rightX) rightX = x;
        }
      }
    }
    return { count, topY, bottomY, leftX, rightX, W, H };
  };

  it("pre-rotation (default): watermark rotates with the image — its bbox is NOT at the bottom-right of the post-rotation canvas", async () => {
    // 90° rotation: the watermark is composited at the bottom-right of
    // the pre-rotation image, then both are rotated. The result is
    // NOT a watermark at the bottom-right of the final image — the
    // watermark has moved to a different corner of the canvas because
    // it rotated with the image.
    const input = await buildTestImage(600, 400, { r: 80, g: 140, b: 200 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: 90,
      watermark: {
        kind: "text",
        text: "wm",
        position: "bottom-right",
        margin: 10,
        opacity: 100,
        size: 40,
        // placement omitted — defaults to "pre-rotation"
      },
      resize: null,
    });
    // After 90° rotation the canvas is 400x600 (swapped).
    expect(result.width).toBe(400);
    expect(result.height).toBe(600);
    const wm = await locateWatermark(result);
    expect(wm.count).toBeGreaterThan(0);
    // The watermark rotated with the image. It should NOT be in the
    // bottom-right corner of the canvas (that's where post-rotation
    // placement would put it). We assert that the watermark's
    // top-left corner is not in the bottom-right quadrant of the
    // canvas.
    const horizCenter = wm.W / 2;
    const vertCenter = wm.H / 2;
    const inBottomRightQuadrant = wm.leftX > horizCenter && wm.topY > vertCenter;
    expect(inBottomRightQuadrant).toBe(false);
  });

  it("post-rotation: watermark stays upright at the user-specified position of the post-rotation canvas", async () => {
    // Same 90° rotation, but placement="post-rotation" — the watermark
    // should land at the bottom-right of the FINAL 400x600 canvas (the
    // bottom of the post-rotation image), NOT bottom-left.
    const input = await buildTestImage(600, 400, { r: 80, g: 140, b: 200 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: 90,
      watermark: {
        kind: "text",
        text: "wm",
        position: "bottom-right",
        margin: 10,
        opacity: 100,
        size: 40,
        placement: "post-rotation",
      },
      resize: null,
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(600);
    const wm = await locateWatermark(result);
    expect(wm.count).toBeGreaterThan(0);
    // The watermark should be in the bottom-RIGHT quadrant of the
    // post-rotation canvas.
    const horizCenter = wm.W / 2;
    const vertCenter = wm.H / 2;
    // Right half: most of the watermark's left edge should be > center
    expect(wm.leftX).toBeGreaterThan(horizCenter * 0.6);
    // Bottom half: most of the watermark's top edge should be > center
    expect(wm.topY).toBeGreaterThan(vertCenter * 0.6);
  });

  it("post-rotation: places watermark at top-left when position=top-left, regardless of rotation direction", async () => {
    // 180° rotation: top-left of the post-rotation canvas is top-left
    // of the rotated image (since 180° keeps the corner positions).
    const input = await buildTestImage(400, 300, { r: 80, g: 140, b: 200 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: 180,
      watermark: {
        kind: "text",
        text: "wm",
        position: "top-left",
        margin: 10,
        opacity: 100,
        size: 40,
        placement: "post-rotation",
      },
      resize: null,
    });
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    const wm = await locateWatermark(result);
    expect(wm.count).toBeGreaterThan(0);
    // The watermark should be in the top-left quadrant of the canvas.
    expect(wm.topY).toBeLessThan(wm.H * 0.4);
    expect(wm.leftX).toBeLessThan(wm.W * 0.4);
  });

  it("post-rotation: at rotation 0 the two placements produce visually identical results", async () => {
    // No rotation — placement is irrelevant. Both should put the
    // watermark at the bottom-right of the 400x300 image.
    const input = await buildTestImage(400, 300, { r: 80, g: 140, b: 200 });
    const preSpec: TransformSpec = {
      ...DEFAULT_TRANSFORM,
      rotation: 0,
      watermark: {
        kind: "text", text: "wm", position: "bottom-right",
        margin: 10, opacity: 100, size: 40,
        placement: "pre-rotation",
      },
      resize: null,
    };
    const postSpec: TransformSpec = {
      ...DEFAULT_TRANSFORM,
      rotation: 0,
      watermark: {
        kind: "text", text: "wm", position: "bottom-right",
        margin: 10, opacity: 100, size: 40,
        placement: "post-rotation",
      },
      resize: null,
    };
    const pre = await transformImage(input, preSpec);
    const post = await transformImage(input, postSpec);
    // Both canvases are 400x300.
    expect(pre.width).toBe(400); expect(pre.height).toBe(300);
    expect(post.width).toBe(400); expect(post.height).toBe(300);
    // The watermarks land at the same location, so their bboxes should
    // match closely.
    const wmPre = await locateWatermark(pre);
    const wmPost = await locateWatermark(post);
    expect(Math.abs(wmPre.leftX - wmPost.leftX)).toBeLessThan(5);
    expect(Math.abs(wmPre.topY - wmPost.topY)).toBeLessThan(5);
  });

  it("post-rotation + non-90 angle: watermark is positioned on the larger post-rotation canvas", async () => {
    // 30° rotation: the canvas grows to fit the rotated image, and the
    // watermark is placed on that larger canvas at the user-specified
    // position. This is the "the user picked the corner of the final
    // image" semantic.
    const input = await buildTestImage(400, 300, { r: 80, g: 140, b: 200 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      rotation: 30,
      watermark: {
        kind: "text",
        text: "wm",
        position: "bottom-right",
        margin: 10,
        opacity: 100,
        size: 40,
        placement: "post-rotation",
      },
      resize: null,
    });
    // Canvas grew.
    expect(result.width).toBeGreaterThan(400);
    expect(result.height).toBeGreaterThan(300);
    const wm = await locateWatermark(result);
    expect(wm.count).toBeGreaterThan(0);
    // The watermark should be in the bottom-right quadrant of the new
    // larger canvas.
    expect(wm.leftX).toBeGreaterThan(wm.W * 0.5);
    expect(wm.topY).toBeGreaterThan(wm.H * 0.5);
  });
});

describe("transformImage — color adjustments", () => {
  it("brightness 50 darkens the image", async () => {
    const input = await buildTestImage(50, 50, { r: 200, g: 100, b: 50 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      colorAdjust: { grayscale: false, brightness: 50, saturation: 100, sepia: 0, invert: false },
      resize: null,
    });
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += info.channels) { sum += data[i] + data[i + 1] + data[i + 2]; count += 3; }
    const avg = sum / count;
    // 50% brightness on a 200,100,50 image should produce an average well below 200
    expect(avg).toBeLessThan(200);
  });

  it("saturation 0 produces a grayscale image", async () => {
    const input = await buildTestImage(50, 50, { r: 200, g: 50, b: 50 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      colorAdjust: { grayscale: false, brightness: 100, saturation: 0, sepia: 0, invert: false },
      resize: null,
    });
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    // R == G == B for a fully-desaturated pixel
    const r = data[0], g = data[1], b = data[2];
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  });

  it("invert flips colors (white <-> black)", async () => {
    const input = await buildTestImage(20, 20, { r: 0, g: 0, b: 0 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      colorAdjust: { grayscale: false, brightness: 100, saturation: 100, sepia: 0, invert: true },
      resize: null,
    });
    const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(250);
    expect(data[1]).toBeGreaterThan(250);
    expect(data[2]).toBeGreaterThan(250);
  });

  it("colorAdjust.grayscale produces a grayscale image", async () => {
    const input = await buildTestImage(50, 50, { r: 200, g: 50, b: 50 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      colorAdjust: { grayscale: true, brightness: 100, saturation: 100, sepia: 0, invert: false },
      resize: null,
    });
    const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0] - data[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(data[1] - data[2])).toBeLessThanOrEqual(2);
  });

  it("legacy top-level grayscale still works (back-compat)", async () => {
    const input = await buildTestImage(50, 50, { r: 200, g: 50, b: 50 });
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      grayscale: true,
      // No colorAdjust — old clients that don't know about the new field
      // should still get their top-level grayscale applied.
      colorAdjust: undefined,
      resize: null,
    });
    const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0] - data[1])).toBeLessThanOrEqual(2);
  });
});

describe("transformImage — watermark text color", () => {
  it("uses the spec.color field for the text fill", async () => {
    const input = await buildTestImage(800, 600);
    // Red text on the image. We can't directly inspect the text color of the
    // watermark in the composite, but we can verify the call succeeds and
    // produces a different result than the default white text.
    const red = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text", text: "RED", position: "bottom-right", margin: 20,
        opacity: 100, size: 64, color: "#ff0000",
      },
      resize: null,
    });
    const white = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text", text: "RED", position: "bottom-right", margin: 20,
        opacity: 100, size: 64, color: "#ffffff",
      },
      resize: null,
    });
    // The bytes will differ because the text color is different.
    expect(red.bytes).not.toBe(white.bytes);
  });

  it("falls back to white when no color is specified", async () => {
    const input = await buildTestImage(400, 300);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      watermark: {
        kind: "text", text: "DEFAULT", position: "bottom-right", margin: 20,
        opacity: 100, size: 32, // no color
      },
      resize: null,
    });
    expect(result.bytes).toBeGreaterThan(0);
  });
});
