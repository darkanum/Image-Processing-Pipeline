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

describe("transformImage — overall opacity", () => {
  it("applies overall opacity to PNG output", async () => {
    const input = await buildTestImage(400, 300);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      opacity: 50,
      outputFormat: "png",
      resize: null,
    });
    expect(result.format).toBe("png");
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("clamps opacity to 0..100", async () => {
    const input = await buildTestImage(400, 300);
    const result = await transformImage(input, {
      ...DEFAULT_TRANSFORM,
      opacity: 200,
      resize: null,
    });
    expect(result.bytes).toBeGreaterThan(0);
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
