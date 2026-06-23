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

/** Compact badge describing what a resize spec produces. */
const resizeBadge = (r: NonNullable<TransformSpec["resize"]>): string => {
  if (r.preset) return r.preset.split(" (")[0]!;
  if (r.aspectRatio) return r.aspectRatio;
  if (r.width || r.height) return `${r.width ?? "?"}×${r.height ?? "?"}`;
  return "on";
};

export const JobForm = ({ apiUrl, onCreated }: JobFormProps): JSX.Element => {
  const [url, setUrl] = useState<string>("https://picsum.photos/800/600");
  const [transform, setTransform] = useState<TransformSpec>(DEFAULT_TRANSFORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<boolean>(false);

  // Each section is collapsible; only one open at a time to keep the page calm.
  const [openSection, setOpenSection] = useState<string | null>(null);
  const toggleSection = (s: string): void => setOpenSection((cur) => (cur === s ? null : s));

  const updateTransform = (patch: Partial<TransformSpec>): void => {
    setTransform((t) => ({ ...t, ...patch }));
  };

  const buildPayload = (): { url: string; transform: TransformSpec } => {
    const cleanWatermark =
      transform.watermark &&
      ((transform.watermark.kind === "text" && (transform.watermark.text ?? "").trim() !== "") ||
        (transform.watermark.kind === "image" && (transform.watermark.imageUrl ?? "").trim() !== ""))
        ? transform.watermark
        : null;
    const cleanResize =
      transform.resize && transform.resize.mode !== "none" ? transform.resize : null;
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
      setUrl("");
    } catch (err) {
      const message =
        err instanceof TypeError && err.message === "Failed to fetch"
          ? "Failed to fetch — backend unreachable. Is the API container running?"
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
      {/* --- URL row (primary) --- */}
      <div className="form-row">
        <label htmlFor="job-url" className="form-label">Source image URL</label>
        <div className="url-row">
          <input
            id="job-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/cat.jpg"
            required
            disabled={submitting}
            className="url-input"
          />
          <button type="submit" className="submit-btn" disabled={submitting || url.trim().length === 0}>
            {submitting ? "Submitting…" : "Process image"}
          </button>
        </div>
        <div className="size-note">
          ⚠ Source images larger than <strong>{formatBytes(MAX_IMAGE_BYTES)}</strong> are rejected before processing.
        </div>
        {error && <div className="error">⚠ {error}</div>}
      </div>

      {/* --- Output format (always visible, primary concern) --- */}
      <div className="form-row">
        <label className="form-label">Output format</label>
        <div className="format-row">
          <label className="select">
            <select
              value={transform.outputFormat}
              onChange={(e) => updateTransform({ outputFormat: e.target.value as OutputFormat })}
              className="format-select"
            >
              <option value="original">Same as source</option>
              <option value="png">PNG (lossless, supports transparency)</option>
              <option value="jpeg">JPEG (smaller files)</option>
              <option value="webp">WebP (modern, balanced)</option>
            </select>
          </label>
          {(transform.outputFormat === "jpeg" || transform.outputFormat === "webp") && (
            <div className="quality-block">
              <Slider
                label="Quality"
                value={transform.quality}
                onChange={(n) => updateTransform({ quality: n })}
                min={1}
                max={100}
              />
            </div>
          )}
        </div>
      </div>

      {/* --- Advanced options toggle --- */}
      <button
        type="button"
        className="options-toggle"
        onClick={() => setShowOptions((v) => !v)}
      >
        {showOptions ? "▾ Hide" : "▸ Show"} processing options
        {(transform.resize || transform.crop || transform.grayscale || transform.watermark ||
          transform.rotation !== 0 || transform.flipHorizontal || transform.flipVertical ||
          transform.opacity < 100) && (
          <span className="options-active-dot">●</span>
        )}
      </button>

      {showOptions && (
        <div className="options-body">
          <Section
            title="Resize"
            open={openSection === "resize"}
            onToggle={() => toggleSection("resize")}
            badge={
              transform.resize && transform.resize.mode !== "none"
                ? resizeBadge(transform.resize)
                : "off"
            }
          >
            <ResizeSection
              value={
                transform.resize ?? { mode: "none", lockAspectRatio: true }
              }
              onChange={(v) => updateTransform({ resize: v.mode === "none" ? null : v })}
            />
          </Section>

          <Section
            title="Crop"
            open={openSection === "crop"}
            onToggle={() => toggleSection("crop")}
            badge={transform.crop ? "on" : "off"}
          >
            <CropSection
              value={transform.crop ?? {}}
              onChange={(v) => updateTransform({ crop: v.width || v.height || v.aspectRatio ? v : null })}
            />
          </Section>

          <Section
            title="Grayscale"
            open={openSection === "grayscale"}
            onToggle={() => {
              updateTransform({ grayscale: !transform.grayscale });
              setOpenSection((cur) => (cur === "grayscale" ? null : "grayscale"));
            }}
            badge={transform.grayscale ? "on" : "off"}
          >
            <div className="row">
              <span>Convert the image to grayscale.</span>
            </div>
          </Section>

          <Section
            title="Watermark"
            open={openSection === "watermark"}
            onToggle={() => toggleSection("watermark")}
            badge={transform.watermark ? `${transform.watermark.kind} ${transform.watermark.position}` : "off"}
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
            open={openSection === "rotate"}
            onToggle={() => toggleSection("rotate")}
            badge={
              transform.rotation !== 0 || transform.flipHorizontal || transform.flipVertical
                ? "on"
                : "off"
            }
          >
            <RotateFlipSection transform={transform} onChange={(v) => updateTransform(v)} />
          </Section>

          <Section
            title="Overall opacity"
            open={openSection === "opacity"}
            onToggle={() => toggleSection("opacity")}
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
              Fades the whole image. PNG keeps the alpha channel; JPEG/WebP darkens via blend.
            </div>
          </Section>
        </div>
      )}
    </form>
  );
};
