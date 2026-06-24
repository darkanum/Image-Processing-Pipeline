import { useMemo, useState, type FormEvent } from "react";
import type { OutputFormat, TransformSpec } from "../types/job";
import { DEFAULT_TRANSFORM, DEFAULT_RESIZE, DEFAULT_WATERMARK, MAX_IMAGE_BYTES } from "../types/job";
import { ResizeSection } from "./ResizeSection";
import { CropSection } from "./CropSection";
import { WatermarkSection } from "./WatermarkSection";
import { RotateFlipSection } from "./RotateFlipSection";
import { Section, Slider } from "./controls";
import { apiRequest, ApiError } from "../lib/api";

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
  if (r.mode === "none") return "off";
  if (r.preset) return r.preset.split(" (")[0]!;
  if (r.aspectRatio) return r.aspectRatio;
  if (r.width || r.height) return `${r.width ?? "?"}×${r.height ?? "?"}`;
  return "on";
};

/** A few quick-pick URLs that always work in the demo (no auth, no rate limit). */
const QUICK_PICKS: { label: string; url: string }[] = [
  { label: "Picsum 800×600", url: "https://picsum.photos/800/600" },
  { label: "Picsum 1920×1080", url: "https://picsum.photos/1920/1080" },
  { label: "Picsum 600×600", url: "https://picsum.photos/600/600" },
];

/**
 * Cheap pre-flight check on the URL — we don't want the user to wait 20s
 * for the worker to download a 404, only to find out the URL is wrong.
 * This catches the obvious cases; the worker still does the real check.
 */
type UrlCheck = { kind: "idle" } | { kind: "ok"; host: string } | { kind: "warn"; reason: string } | { kind: "err"; reason: string };
const checkUrl = (raw: string): UrlCheck => {
  const v = raw.trim();
  if (!v) return { kind: "idle" };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { kind: "err", reason: "Not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { kind: "err", reason: `Protocol ${u.protocol.replace(":", "")} not allowed — use http(s)` };
  }
  // Heuristics that catch the most common 404s without doing a real HEAD.
  const host = u.hostname;
  if (host === "" || host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return { kind: "warn", reason: "Localhost URL — only works if the worker can reach it" };
  }
  return { kind: "ok", host };
};

export const JobForm = ({ apiUrl: _apiUrl, onCreated }: JobFormProps): JSX.Element => {
  void _apiUrl; // apiBase() in lib/api handles this now
  const [url, setUrl] = useState<string>("https://picsum.photos/800/600");
  const [transform, setTransform] = useState<TransformSpec>(DEFAULT_TRANSFORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<boolean>(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const urlCheck = useMemo(() => checkUrl(url), [url]);

  const setTransformPart = <K extends keyof TransformSpec>(key: K, value: TransformSpec[K]): void => {
    setTransform((prev) => ({ ...prev, [key]: value }));
  };

  const buildPayload = (): { url: string; transform: TransformSpec } => ({
    url: url.trim(),
    transform,
  });

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (urlCheck.kind === "err") {
      setError(urlCheck.reason);
      return;
    }
    setError(null);
    setRequestId(null);
    setSubmitting(true);
    try {
      const payload = buildPayload();
      const job = await apiRequest<{ id: string }>("/jobs", {
        method: "POST",
        body: payload,
      });
      onCreated?.(job);
      setUrl("");
    } catch (err) {
      if (err instanceof ApiError) {
        setRequestId(err.requestId ?? null);
        // Friendlier messages for common cases.
        let message = err.message;
        if (err.status === 401) {
          message = "API key missing or invalid. The backend rejected the request.";
        } else if (err.status === 429) {
          message = "Rate limit hit. Wait a moment and try again.";
        } else if (err.status >= 500) {
          message = `Server error (${err.status}). The team has been notified.`;
        }
        setError(message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled = submitting || urlCheck.kind === "err" || url.trim() === "";

  return (
    <form className="job-form" onSubmit={handleSubmit} noValidate>
      <div className="form-row">
        <label htmlFor="url-input" className="form-label">
          Image URL
        </label>
        <input
          id="url-input"
          className="form-input"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/image.jpg"
          aria-describedby="url-help"
          aria-invalid={urlCheck.kind === "err"}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <div id="url-help" className={`url-validation ${urlCheck.kind}`} aria-live="polite">
          {urlCheck.kind === "ok" && <>✓ Will fetch from {urlCheck.host}</>}
          {urlCheck.kind === "warn" && <>⚠ {urlCheck.reason}</>}
          {urlCheck.kind === "err" && <>✕ {urlCheck.reason}</>}
          {urlCheck.kind === "idle" && <>Paste any http(s) image URL — or pick one below</>}
        </div>
        <div className="preset-pills" aria-label="Quick picks">
          {QUICK_PICKS.map((p) => (
            <button
              key={p.url}
              type="button"
              className={`preset-pill ${url === p.url ? "active" : ""}`}
              onClick={() => setUrl(p.url)}
              aria-pressed={url === p.url}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="toggle-options"
        onClick={() => setShowOptions((v) => !v)}
        aria-expanded={showOptions}
        aria-controls="transform-options"
      >
        {showOptions ? "▾" : "▸"} Transform options{" "}
        <span className="muted">
          ({transform.outputFormat}, q{transform.quality}, {resizeBadge(transform.resize ?? DEFAULT_RESIZE)})
        </span>
      </button>

      {showOptions && (
        <div id="transform-options" className="options-panel">
          <Section title="Output" open onToggle={() => undefined}>
            <div className="form-row">
              <label htmlFor="format-select" className="form-label">Format</label>
              <select
                id="format-select"
                className="form-input"
                value={transform.outputFormat}
                onChange={(e) => setTransformPart("outputFormat", e.target.value as OutputFormat)}
              >
                <option value="original">Original</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
                <option value="avif">AVIF</option>
              </select>
            </div>
            <Slider
              label={`Quality (${transform.quality})`}
              min={1}
              max={100}
              value={transform.quality}
              onChange={(v) => setTransformPart("quality", v)}
            />
            <Slider
              label={`Opacity (${transform.opacity}%)`}
              min={1}
              max={100}
              value={transform.opacity}
              onChange={(v) => setTransformPart("opacity", v)}
            />
          </Section>

          <ResizeSection
            value={transform.resize ?? DEFAULT_RESIZE}
            onChange={(v) => setTransformPart("resize", v)}
          />
          <CropSection
            value={transform.crop ?? {}}
            onChange={(v) => setTransformPart("crop", v)}
          />
          <WatermarkSection
            value={transform.watermark ?? DEFAULT_WATERMARK}
            onChange={(v) => setTransformPart("watermark", v)}
          />
          <RotateFlipSection
            transform={transform}
            onChange={setTransform}
          />

          <div className="misc-row">
            <label className="form-checkbox">
              <input
                type="checkbox"
                checked={transform.grayscale}
                onChange={(e) => setTransformPart("grayscale", e.target.checked)}
              />
              Grayscale
            </label>
          </div>

          <div className="muted small">
            Max source size: {formatBytes(MAX_IMAGE_BYTES)} — larger payloads are
            rejected at the API.
          </div>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="primary" disabled={submitDisabled} aria-busy={submitting}>
          {submitting ? "Submitting…" : "Process image"}
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          ⚠ {error}
          {requestId && (
            <div className="error-requestid">Request id: <code>{requestId}</code></div>
          )}
        </div>
      )}
    </form>
  );
};
