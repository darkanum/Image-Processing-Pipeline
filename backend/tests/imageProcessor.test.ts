import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { transformImage } from "../src/services/imageProcessor.js";

const buildTestImage = async (): Promise<Buffer> => {
  return sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      background: { r: 80, g: 140, b: 200 },
    },
  })
    .png()
    .toBuffer();
};

describe("transformImage", () => {
  it("resizes a PNG to the requested width keeping aspect ratio", async () => {
    const input = await buildTestImage();
    const result = await transformImage(input, { width: 400 });

    expect(result.format).toBe("png");
    expect(result.width).toBe(400);
    // Height should scale proportionally: 1200 * (400/1600) = 300
    expect(result.height).toBe(300);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("converts to JPEG when format=jpeg", async () => {
    const input = await buildTestImage();
    const result = await transformImage(input, { width: 200, format: "jpeg" });
    expect(result.format).toBe("jpeg");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("produces grayscale output when grayscale=true", async () => {
    const input = await buildTestImage();
    const result = await transformImage(input, { width: 300, grayscale: true });
    // Sharp keeps the color space label as 'srgb' but the actual channel
    // count drops to 1 (grey) for grayscale output. We verify by reading
    // the raw pixel data and checking the R,G,B channels are equal.
    const { data, info } = await sharp(result.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBeGreaterThanOrEqual(1);
    // Sample a few pixels and confirm R === G === B.
    let samplesChecked = 0;
    for (let i = 0; i < data.length; i += info.channels * 50) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // (channels === 1 means data[i+1] and data[i+2] are undefined)
      const rEqG = info.channels === 1 ? true : r === g;
      const gEqB = info.channels === 1 ? true : g === b;
      expect(rEqG).toBe(true);
      expect(gEqB).toBe(true);
      samplesChecked += 1;
      if (samplesChecked >= 5) break;
    }
    expect(samplesChecked).toBeGreaterThan(0);
  });

  it("adds a watermark that visibly changes the bytes (PNG)", async () => {
    const input = await buildTestImage();
    const clean = await transformImage(input, { width: 400, format: "png" });
    const wm = await transformImage(input, {
      width: 400,
      format: "png",
      watermarkText: "Mavis Pipeline",
    });
    expect(wm.bytes).not.toBe(clean.bytes);
    // Should be larger because the watermark adds content
    expect(wm.bytes).toBeGreaterThan(clean.bytes);
  });

  it("never enlarges images smaller than the target width", async () => {
    const tiny = await sharp({
      create: {
        width: 100,
        height: 80,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    const result = await transformImage(tiny, { width: 800 });
    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
  });

  it("rejects corrupt input that is not a real image", async () => {
    const notImage = Buffer.from("this is not an image at all");
    await expect(transformImage(notImage)).rejects.toThrow();
  });
});
