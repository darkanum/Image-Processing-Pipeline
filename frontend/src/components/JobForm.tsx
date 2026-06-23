import { useState, type FormEvent } from "react";
import type { OutputFormat, TransformSpec } from "../types/job";
import { DEFAULT_TRANSFORM, MAX_IMAGE_BYTES } from "../types/job";
import { ResizeSection } from "./ResizeSection";
import { CropSection } from "./CropSection";
import { WatermarkSection } from "./WatermarkSection";
import { RotateFlipSection } from "./RotateFlipSection";
import { Section, Slider } from "./controls";

interface JobFormProps {
  apiUrl: string;
  onCreated?: (job: { id: string }) => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const JobForm = ({ apiUrl, onCreated }: JobFormProps): JSX.Element => {
  const [url, setUrl] = useState<string>("https://picsum.photos/800/600");
  const [transform, setTransform] = useState<TransformSpec>(DEFAULT_TRANSFORM);
  const [showOptions, setShowOptions] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Collapsible sections
  const [openResize, setOpenResize] = useState<boolean>(true);
  const [openCrop, setOpenCrop] = useState<boolean>(false);
  const [openWatermark, setOpenWatermark] = useState<boolean>(false);
  const [openRotateFlip, setOpenRotateFlip] = useState<boolean>(false);
  const [openOpacity, setOpenOpacity] = useState<boolean>(false);

  const updateTransform = (patch: Partial<TransformSpec>): void => {
    setTransform((t) => ({ ...t, ...patch }));
  };

  const buildPayload = (): { url: string; transform: TransformSpec } => {
    // Strip empty/null sub-specs so the backend uses defaults cleanly.
    const cleanWatermark =
      transform.watermark &&
      ((transform.watermark.kind === "text" && (transform.watermark.text ?? "").trim() !== "") ||
        (transform.watermark.kind === "image" && (transform.watermark.imageUrl ?? "").trim() !== ""))
        ? transform.watermark
        : null;
    const cleanResize = transform.resize && transform.resize.mode !== "none" ? transform.resize : null;
    const cleanCrop = transform.crop ? transform.crop : null;

    return {
      url: url.trim(),
      transform: {
        ...transform,
        watermark: cleanWatermark,
        resize: cleanResize,
        crop: cleanCrop,
      },
    };
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = buildPayload();
      const res = await fetch(`${apiUrl}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const job = (await res.json()) as { id: string };
      onCreated?.(job);
      // Reset URL only; keep transform options so users can re-submit similar jobs quickly.
      setUrl("");
    } catch (err) {
      const message =
        err instanceof TypeError && err.message === "Failed to fetch"
          ? "Failed to fetch — backend unreachable. Is the API service running?"
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="job-form" onSubmit={handleSubmit}>
      <label htmlFor="job-url">Image URL</label>
      <div className="row">
        <input
          id="job-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/cat.jpg"
          required
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || url.trim().length === 0}>
          {submitting ? "Submitting…" : "Process image"}
        </button>
      </div>

      <div className="size-note">
        ⚠ Source images larger than <strong>{formatBytes(MAX_IMAGE_BYTES)}</strong> are rejected before processing.
      </div>

      {error && <div className="error">⚠ {error}</div>}

      <div className="format-row">
        <label className="select">
          <span>Output format</span>
          <select
            value={transform.outputFormat}
            onChange={(e) => updateTransform({ outputFormat: e.target.value as OutputFormat })}
          >
            <option value="original">Same as source</option>
            <option value="png">PNG (lossless, supports transparency)</option>
            <option value="jpeg">JPEG (smaller files)</option>
            <option value="webp">WebP (modern, balanced)</option>
          </select>
        </label>
        {(transform.outputFormat === "jpeg" || transform.outputFormat === "webp") && (
          <Slider
            label="Quality"
            value={transform.quality}
            onChange={(n) => updateTransform({ quality: n })}
            min={1}
            max={100}
          />
        )}
      </div>

      <button
        type="button"
        className="options-toggle"
        onClick={() => setShowOptions((v) => !v)}
      >
        {showOptions ? "▾ Hide" : "▸ Show"} processing options
      </button>

      {showOptions && (
        <div className="options-body">
          <Section
            title="Resize"
            open={openResize}
            onToggle={() => setOpenResize((v) => !v)}
            badge={transform.resize && transform.resize.mode !== "none" ? "active" : undefined}
          >
            <ResizeSection
              value={
                transform.resize ?? { mode: "fit", lockAspectRatio: true }
              }
              onChange={(v) => updateTransform({ resize: v })}
            />
          </Section>

          <Section
            title="Crop"
            open={openCrop}
            onToggle={() => setOpenCrop((v) => !v)}
            badge={transform.crop ? "active" : undefined}
          >
            <CropSection
              value={transform.crop ?? {}}
              onChange={(v) => updateTransform({ crop: v })}
            />
          </Section>

          <Section
            title="Grayscale"
            open={false}
            onToggle={() => updateTransform({ grayscale: !transform.grayscale })}
            badge={transform.grayscale ? "active" : "off"}
          >
            <div className="row"><span>Convert the image to grayscale.</span></div>
          </Section>

          <Section
            title="Watermark"
            open={openWatermark}
            onToggle={() => setOpenWatermark((v) => !v)}
            badge={transform.watermark ? "active" : undefined}
          >
            <WatermarkSection
              value={
                transform.watermark ?? {
                  kind: "text",
                  text: "Mavis Pipeline",
                  position: "bottom-right",
                  margin: 20,
                  opacity: 80,
                  size: 32,
                }
              }
              onChange={(v) => updateTransform({ watermark: v })}
            />
          </Section>

          <Section
            title="Rotate & Flip"
            open={openRotateFlip}
            onToggle={() => setOpenRotateFlip((v) => !v)}
            badge={
              transform.rotation !== 0 || transform.flipHorizontal || transform.flipVertical
                ? "active"
                : "off"
            }
          >
            <RotateFlipSection transform={transform} onChange={(v) => updateTransform(v)} />
          </Section>

          <Section
            title="Overall opacity"
            open={openOpacity}
            onToggle={() => setOpenOpacity((v) => !v)}
            badge={transform.opacity < 100 ? `${transform.opacity}%` : "100%"}
          >
            <Slider
              label="Output opacity"
              value={transform.opacity}
              onChange={(n) => updateTransform({ opacity: n })}
              min={0}
              max={100}
              unit="%"
            />
            <div className="hint">
              Applies a fade / alpha mask to the whole image (PNG keeps the alpha channel).
            </div>
          </Section>
        </div>
      )}
    </form>
  );
};
