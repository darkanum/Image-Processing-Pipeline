import { useMemo, useState, type FormEvent } from "react";
import type { OutputFormat, ResizeMode, TransformSpec, WatermarkSpec } from "../types/job";
import {
  DEFAULT_TRANSFORM,
  DEFAULT_RESIZE,
  DEFAULT_WATERMARK,
  DEFAULT_WATERMARK_BACKGROUND,
  MAX_IMAGE_BYTES,
  formatSupportsAlpha,
} from "../types/job";
import { apiRequest, ApiError } from "../lib/api";
import { ColorHexInput } from "./ColorHexInput";

interface JobFormProps {
  apiUrl: string;
  onCreated?: (job: { id: string }) => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Live dimension calculator. Returns the post-resize / post-rotate
 * dimensions given the source and the current transform spec. Mirrors
 * the backend's `resolveResizeTarget` + rotation math. */
const computeResultDims = (
  srcW: number,
  srcH: number,
  spec: TransformSpec,
): { w: number; h: number; scale: number } => {
  let w = srcW;
  let h = srcH;
  const r = spec.resize;
  if (r && r.mode !== "none" && (r.width || r.height || r.aspectRatio)) {
    if (r.width && r.height) {
      w = r.width;
      h = r.height;
    } else if (r.width && !r.height && r.lockAspectRatio) {
      h = Math.max(1, Math.round((r.width * srcH) / srcW));
      w = r.width;
    } else if (r.height && !r.width && r.lockAspectRatio) {
      w = Math.max(1, Math.round((r.height * srcW) / srcH));
      h = r.height;
    } else if (r.width) {
      w = r.width;
    } else if (r.height) {
      h = r.height;
    }
  }
  if (spec.rotation === 90 || spec.rotation === 270) {
    [w, h] = [h, w];
  }
  const scale = srcW > 0 ? w / srcW : 1;
  return { w, h, scale };
};

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
  const host = u.hostname;
  if (host === "" || host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return { kind: "warn", reason: "Localhost URL — only works if the worker can reach it" };
  }
  return { kind: "ok", host };
};

const QUICK_PICKS: { label: string; url: string }[] = [
  { label: "Picsum 800×600", url: "https://picsum.photos/800/600" },
  { label: "Picsum 1920×1080", url: "https://picsum.photos/1920/1080" },
  { label: "Picsum 600×600", url: "https://picsum.photos/600/600" },
];

const RESIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "Custom", w: 0, h: 0 },
  { label: "HD 720p", w: 1280, h: 720 },
  { label: "FHD 1080p", w: 1920, h: 1080 },
  { label: "4K UHD", w: 3840, h: 2160 },
  { label: "Instagram Post", w: 1080, h: 1080 },
  { label: "Instagram Story", w: 1080, h: 1920 },
  { label: "Twitter Post", w: 1200, h: 675 },
  { label: "Email banner", w: 600, h: 200 },
];

const RESIZE_MODES: { value: ResizeMode; label: string; hint: string }[] = [
  { value: "none", label: "Off", hint: "No resize" },
  { value: "fit", label: "Fit", hint: "Scale to fit, pad to exact" },
  { value: "crop", label: "Fill", hint: "Scale to cover, crop overflow" },
  { value: "pad", label: "Pad", hint: "Scale to fit, colored pad" },
];

export const JobForm = ({ apiUrl: _apiUrl, onCreated }: JobFormProps): JSX.Element => {
  void _apiUrl;
  const [url, setUrl] = useState<string>("https://picsum.photos/800/600");
  const [transform, setTransform] = useState<TransformSpec>(DEFAULT_TRANSFORM);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const urlCheck = useMemo(() => checkUrl(url), [url]);

  // Resolved resize — defaults to the current resize spec, or a fresh
  // DEFAULT_RESIZE if null. We work on a concrete object so the inputs
  // always have a value to read.
  const r = transform.resize ?? DEFAULT_RESIZE;

  const setTransformPart = <K extends keyof TransformSpec>(key: K, value: TransformSpec[K]): void => {
    setTransform((prev) => ({ ...prev, [key]: value }));
  };

  const handleResize = (patch: Partial<typeof r>): void => {
    setTransform((prev) => ({
      ...prev,
      resize: { ...(prev.resize ?? DEFAULT_RESIZE), ...patch },
    }));
  };

  const handlePreset = (label: string): void => {
    const preset = RESIZE_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    if (preset.w === 0) {
      // Custom — keep current width/height, just signal via mode.
      handleResize({});
      return;
    }
    handleResize({ width: preset.w, height: preset.h, lockAspectRatio: true });
  };

  const activePreset = RESIZE_PRESETS.find(
    (p) => p.w === r.width && p.h === r.height,
  )?.label ?? "Custom";

  const setMode = (mode: ResizeMode): void => {
    if (mode === "none") {
      setTransform((prev) => ({ ...prev, resize: null }));
    } else {
      handleResize({ mode });
    }
  };

  // Live preview of the source dimensions: try the URL, but for the
  // initial default (picsum.photos/800/600) we know it's 800×600.
  const sourceDims = useMemo<{ w: number; h: number }>(() => {
    // Best-effort: only known Picsum URLs are predictable. Otherwise
    // we show "?" and let the backend compute it.
    const m = url.match(/^https?:\/\/picsum\.photos\/(\d+)(?:\/(\d+))?/);
    if (m) return { w: Number(m[1]), h: Number(m[2] ?? m[1]) };
    return { w: 0, h: 0 };
  }, [url]);

  const resultDims = computeResultDims(sourceDims.w, sourceDims.h, transform);

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
      const payload: { url: string; transform: TransformSpec } = {
        url: url.trim(),
        transform,
      };
      const job = await apiRequest<{ id: string }>("/jobs", { method: "POST", body: payload });
      onCreated?.(job);
      setUrl("");
    } catch (err) {
      if (err instanceof ApiError) {
        setRequestId(err.requestId ?? null);
        let message = err.message;
        if (err.status === 401) message = "API key missing or invalid. The backend rejected the request.";
        else if (err.status === 429) message = "Rate limit hit. Wait a moment and try again.";
        else if (err.status >= 500) message = `Server error (${err.status}). The team has been notified.`;
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
    <form className="job-form v2" onSubmit={handleSubmit} noValidate>
      {/* ── Source URL ───────────────────────────────────────────────── */}
      <div className="form-block">
        <label className="form-label" htmlFor="url-input">Image URL</label>
        <div className="url-row">
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
          <button
            type="submit"
            className="primary"
            disabled={submitDisabled}
            aria-busy={submitting}
          >
            {submitting ? "Submitting…" : "Process image"}
          </button>
        </div>
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

      {/* ── Output format & quality ─────────────────────────────────── */}
      <div className="form-block two-col">
        <div className="form-field">
          <label className="form-label" htmlFor="format-select">Format</label>
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
        <SliderField
          label={`Quality · ${transform.quality}`}
          min={1}
          max={100}
          value={transform.quality}
          onChange={(v) => setTransformPart("quality", v)}
        />
      </div>

      {/* ── Resize ───────────────────────────────────────────────────── */}
      <div className="form-block">
        <div className="form-block-head">
          <span className="form-block-title">Resize</span>
          <span className="form-block-aside">
            {sourceDims.w > 0
              ? <>Result: <b>{resultDims.w}×{resultDims.h}</b> <span className="muted">(from {sourceDims.w}×{sourceDims.h}, {Math.round(resultDims.scale * 100)}%)</span></>
              : <span className="muted">Result will be computed when the job runs</span>}
          </span>
        </div>

        <div className="mode-buttons" role="radiogroup" aria-label="Resize mode">
          {RESIZE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={r.mode === m.value}
              className={`mode-btn ${r.mode === m.value ? "active" : ""}`}
              onClick={() => setMode(m.value)}
            >
              <span className="mode-btn-label">{m.label}</span>
              <span className="mode-btn-hint">{m.hint}</span>
            </button>
          ))}
        </div>

        {r.mode !== "none" && (
          <div className="size-row">
            <div className="size-inputs">
              <div className="size-field">
                <label htmlFor="resize-w">Width</label>
                <input
                  id="resize-w"
                  className="form-input"
                  type="number"
                  min={1}
                  max={20000}
                  value={r.width ?? ""}
                  onChange={(e) => {
                    const n = e.target.value ? Number(e.target.value) : undefined;
                    handleResize({ width: n });
                  }}
                  placeholder="auto"
                />
                <span className="suffix">px</span>
              </div>
              <button
                type="button"
                className={`link-btn ${r.lockAspectRatio ? "active" : ""}`}
                onClick={() => handleResize({ lockAspectRatio: !r.lockAspectRatio })}
                title={r.lockAspectRatio ? "Aspect locked — click to unlock" : "Aspect unlocked — click to lock"}
                aria-pressed={r.lockAspectRatio}
              >
                {r.lockAspectRatio ? "🔗" : "⛓️‍💥"}
              </button>
              <div className="size-field">
                <label htmlFor="resize-h">Height</label>
                <input
                  id="resize-h"
                  className="form-input"
                  type="number"
                  min={1}
                  max={20000}
                  value={r.height ?? ""}
                  onChange={(e) => {
                    const n = e.target.value ? Number(e.target.value) : undefined;
                    handleResize({ height: n });
                  }}
                  placeholder="auto"
                />
                <span className="suffix">px</span>
              </div>
            </div>
            <div className="size-presets">
              <label className="form-label-inline" htmlFor="resize-preset">Preset</label>
              <select
                id="resize-preset"
                className="form-input"
                value={activePreset}
                onChange={(e) => handlePreset(e.target.value)}
              >
                {RESIZE_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Padding background — visible whenever the resize mode may produce
            padding (fit pads when source aspect != target; pad always pads). */}
        {(r.mode === "fit" || r.mode === "pad") && (
          <div className="pad-bg-block">
            <div className="pad-bg-head">
              <span className="pad-bg-title">Padding background</span>
              <span className="pad-bg-hint">
                {r.mode === "fit"
                  ? "Used when the source aspect ratio doesn't match the target box."
                  : "Fills the area around the scaled image to the target size."}
              </span>
            </div>
            <div className="pad-bg-row">
              <input
                type="color"
                value={r.padBackground ?? "#ffffff"}
                onChange={(e) => handleResize({ padBackground: e.target.value })}
                aria-label="Padding background color"
              />
              <ColorHexInput
                className="form-input color-hex"
                value={r.padBackground ?? "#ffffff"}
                onChange={(v) => handleResize({ padBackground: v })}
                aria-label="Padding background hex"
              />
              <div className="pad-bg-presets">
                {[
                  { label: "White", value: "#ffffff" },
                  { label: "Black", value: "#000000" },
                  { label: "Red", value: "#ef4444" },
                  { label: "Blue", value: "#3b82f6" },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`preset-pill ${r.padBackground === p.value ? "active" : ""}`}
                    onClick={() => handleResize({ padBackground: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Watermark ────────────────────────────────────────────────── */}
      <div className="form-block">
        <div className="form-block-head">
          <label className="form-block-toggle">
            <input
              type="checkbox"
              checked={transform.watermark !== null}
              onChange={(e) =>
                setTransformPart("watermark", e.target.checked ? { ...DEFAULT_WATERMARK } : null)
              }
            />
            <span>Watermark</span>
          </label>
          {transform.watermark && (
            <span className="form-block-aside muted">drag the 3×3 grid to position</span>
          )}
        </div>

        {transform.watermark && (
          <WatermarkEditor
            value={transform.watermark}
            onChange={(v) => setTransformPart("watermark", v)}
          />
        )}
      </div>

      {/* ── Adjust ───────────────────────────────────────────────────── */}
      <div className="form-block">
        <div className="form-block-head">
          <span className="form-block-title">Adjust</span>
        </div>
        <div className="adjust-row">
          <div className="adjust-field">
            <span className="form-label">Rotate</span>
            <div className="seg-buttons">
              {[0, 90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  type="button"
                  className={`seg-btn ${transform.rotation === deg ? "active" : ""}`}
                  onClick={() => setTransformPart("rotation", deg)}
                  aria-pressed={transform.rotation === deg}
                >
                  {deg}°
                </button>
              ))}
            </div>
            <div className="rotate-custom">
              <span className="rotate-custom-label">Custom</span>
              <input
                type="number"
                className="form-input rotate-custom-input"
                min={-180}
                max={180}
                step={1}
                value={Math.round(transform.rotation)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setTransformPart("rotation", Math.max(-180, Math.min(180, n)));
                }}
                aria-label="Custom rotation angle in degrees"
              />
              <span className="rotate-custom-suffix">°</span>
              <input
                type="range"
                className="form-input slider rotate-slider"
                min={-180}
                max={180}
                step={1}
                value={transform.rotation}
                onChange={(e) => setTransformPart("rotation", Number(e.target.value))}
                aria-label="Custom rotation slider"
              />
            </div>
          </div>
          <div className="adjust-field">
            <span className="form-label">Flip</span>
            <div className="seg-buttons">
              <button
                type="button"
                className={`seg-btn ${transform.flipHorizontal ? "active" : ""}`}
                onClick={() => setTransformPart("flipHorizontal", !transform.flipHorizontal)}
                aria-pressed={transform.flipHorizontal}
              >
                ⇆ H
              </button>
              <button
                type="button"
                className={`seg-btn ${transform.flipVertical ? "active" : ""}`}
                onClick={() => setTransformPart("flipVertical", !transform.flipVertical)}
                aria-pressed={transform.flipVertical}
              >
                ⇅ V
              </button>
            </div>
          </div>
        </div>

        {/* ── Color filters (new) ──────────────────────────────── */}
        <div className="color-filters">
          <div className="color-filters-head">
            <span className="form-block-title">Color</span>
            <span className="muted small">Apply one or more color filters</span>
          </div>
          <div className="color-filter-chips">
            <label className={`filter-chip ${transform.colorAdjust.grayscale ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={transform.colorAdjust.grayscale}
                onChange={(e) => setTransformPart("colorAdjust", { ...transform.colorAdjust, grayscale: e.target.checked })}
              />
              <span>B&amp;W</span>
              <span className="filter-chip-hint">Grayscale</span>
            </label>
            <label className={`filter-chip ${transform.colorAdjust.invert ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={transform.colorAdjust.invert}
                onChange={(e) => setTransformPart("colorAdjust", { ...transform.colorAdjust, invert: e.target.checked })}
              />
              <span>Invert</span>
              <span className="filter-chip-hint">Negate colors</span>
            </label>
            <label className={`filter-chip ${transform.colorAdjust.sepia > 0 ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={transform.colorAdjust.sepia > 0}
                onChange={(e) => setTransformPart("colorAdjust", { ...transform.colorAdjust, sepia: e.target.checked ? 80 : 0 })}
              />
              <span>Sepia</span>
              <span className="filter-chip-hint">Warm tint</span>
            </label>
          </div>
          <div className="color-filter-sliders">
            <label className="form-field">
              <span className="form-label">Brightness · <b>{transform.colorAdjust.brightness}%</b></span>
              <input
                type="range"
                className="form-input slider"
                min={0}
                max={200}
                step={1}
                value={transform.colorAdjust.brightness}
                onChange={(e) => setTransformPart("colorAdjust", { ...transform.colorAdjust, brightness: Number(e.target.value) })}
                aria-label="Brightness"
              />
            </label>
            <label className="form-field">
              <span className="form-label">Saturation · <b>{transform.colorAdjust.saturation}%</b></span>
              <input
                type="range"
                className="form-input slider"
                min={0}
                max={200}
                step={1}
                value={transform.colorAdjust.saturation}
                onChange={(e) => setTransformPart("colorAdjust", { ...transform.colorAdjust, saturation: Number(e.target.value) })}
                aria-label="Saturation"
              />
            </label>
            {transform.colorAdjust.sepia > 0 && (
              <label className="form-field">
                <span className="form-label">Sepia strength · <b>{transform.colorAdjust.sepia}%</b></span>
                <input
                  type="range"
                  className="form-input slider"
                  min={0}
                  max={100}
                  step={1}
                  value={transform.colorAdjust.sepia}
                  onChange={(e) => setTransformPart("colorAdjust", { ...transform.colorAdjust, sepia: Number(e.target.value) })}
                  aria-label="Sepia strength"
                />
              </label>
            )}
          </div>
        </div>

        {/* Image opacity — only meaningful for alpha-capable output formats */}
        {formatSupportsAlpha(transform.outputFormat) && (
          <div className="adjust-opacity">
            <label className="form-label">
              Image opacity <span className="form-label-value">{transform.opacity}%</span>
            </label>
            <input
              type="range"
              className="form-input slider"
              min={0}
              max={100}
              value={transform.opacity}
              onChange={(e) => setTransformPart("opacity", Number(e.target.value))}
              aria-label="Image opacity"
            />
            <div className="hint">
              Fades the whole image. <code>{transform.outputFormat === "original" ? "Source format" : transform.outputFormat.toUpperCase()}</code> preserves alpha; other formats approximate by darkening.
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          ⚠ {error}
          {requestId && (
            <div className="error-requestid">Request id: <code>{requestId}</code></div>
          )}
        </div>
      )}

      <div className="muted small form-footer-note">
        Max source size: {formatBytes(MAX_IMAGE_BYTES)} — larger payloads are
        rejected at the API. Results expire after 24h.
      </div>
    </form>
  );
};

// ── Local sub-components (kept in this file for cohesion) ─────────────

interface SliderFieldProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}

const SliderField = ({ label, min, max, value, onChange }: SliderFieldProps): JSX.Element => (
  <div className="form-field">
    <label className="form-label">{label}</label>
    <input
      className="form-input slider"
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  </div>
);

interface WatermarkEditorProps {
  value: NonNullable<TransformSpec["watermark"]>;
  onChange: (next: NonNullable<TransformSpec["watermark"]>) => void;
}

const POSITIONS: { key: string; label: string }[] = [
  { key: "top-left", label: "↖" }, { key: "top-center", label: "↑" }, { key: "top-right", label: "↗" },
  { key: "middle-left", label: "←" }, { key: "middle-center", label: "·" }, { key: "middle-right", label: "→" },
  { key: "bottom-left", label: "↙" }, { key: "bottom-center", label: "↓" }, { key: "bottom-right", label: "↘" },
];

const WatermarkEditor = ({ value, onChange }: WatermarkEditorProps): JSX.Element => {
  const update = (patch: Partial<typeof value>): void => {
    onChange({ ...value, ...patch });
  };
  const bg: NonNullable<WatermarkSpec["background"]> = value.background ?? DEFAULT_WATERMARK_BACKGROUND;
  const updateBg = (patch: Partial<NonNullable<WatermarkSpec["background"]>>): void => {
    update({ background: { ...bg, ...patch } });
  };
  return (
    <div className="wm-editor">
      <div className="wm-type-tabs">
        <button
          type="button"
          className={`seg-btn ${value.kind === "text" ? "active" : ""}`}
          onClick={() => update({ kind: "text" })}
          aria-pressed={value.kind === "text"}
        >
          Text
        </button>
        <button
          type="button"
          className={`seg-btn ${value.kind === "image" ? "active" : ""}`}
          onClick={() => update({ kind: "image" })}
          aria-pressed={value.kind === "image"}
        >
          Image URL
        </button>
      </div>
      {value.kind === "text" ? (
        <input
          className="form-input"
          type="text"
          value={value.text ?? ""}
          onChange={(e) => update({ text: e.target.value })}
          placeholder="Watermark text"
          maxLength={512}
        />
      ) : (
        <input
          className="form-input"
          type="url"
          value={value.imageUrl ?? ""}
          onChange={(e) => update({ imageUrl: e.target.value })}
          placeholder="https://example.com/logo.png"
        />
      )}

      {/* Text color (only meaningful for kind=text) */}
      {value.kind === "text" && (
        <div className="color-field">
          <span>Text color</span>
          <div className="color-row">
            <input
              type="color"
              value={value.color ?? "#ffffff"}
              onChange={(e) => update({ color: e.target.value })}
              aria-label="Watermark text color"
            />
            <ColorHexInput
              className="form-input color-hex"
              value={value.color ?? "#ffffff"}
              onChange={(v) => update({ color: v })}
              aria-label="Watermark text color hex"
            />
            <div className="pad-bg-presets">
              {[
                { label: "White", value: "#ffffff" },
                { label: "Black", value: "#000000" },
                { label: "Red", value: "#ef4444" },
                { label: "Blue", value: "#3b82f6" },
                { label: "Yellow", value: "#facc15" },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`preset-pill ${value.color === p.value ? "active" : ""}`}
                  onClick={() => update({ color: p.value })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="wm-position-picker" role="radiogroup" aria-label="Watermark position">
        {POSITIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={value.position === p.key}
            className={`wm-cell ${value.position === p.key ? "active" : ""}`}
            onClick={() => update({ position: p.key as typeof value.position })}
            title={p.key}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="wm-sliders">
        <div className="form-field">
          <label className="form-label">Margin · {value.margin}px</label>
          <input
            className="form-input slider"
            type="range"
            min={0}
            max={500}
            value={value.margin}
            onChange={(e) => update({ margin: Number(e.target.value) })}
          />
        </div>
        <div className="form-field">
          <label className="form-label">
            {value.kind === "text" ? "Font size" : "Image width"} · {value.size}px
          </label>
          <input
            className="form-input slider"
            type="range"
            min={value.kind === "text" ? 8 : 24}
            max={value.kind === "text" ? 200 : 2000}
            value={value.size}
            onChange={(e) => update({ size: Number(e.target.value) })}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Opacity · {value.opacity}%</label>
          <input
            className="form-input slider"
            type="range"
            min={0}
            max={100}
            value={value.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
          />
        </div>
      </div>

      {/* ── Backing rectangle controls ───────────────────────────── */}
      <div className="wm-bg-block">
        <div className="wm-bg-head">
          <span className="wm-bg-title">Backing rectangle</span>
          <span className="wm-bg-hint">
            Optional fill behind the watermark for legibility on busy backgrounds.
          </span>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={bg.enabled}
            onChange={(e) => updateBg({ enabled: e.target.checked })}
            aria-label="Add backing rectangle"
          />
          <span className="toggle-label">Add backing rectangle</span>
          <span className="toggle-hint">
            {bg.enabled ? "On" : "Off — transparent around watermark"}
          </span>
        </label>
        {bg.enabled && (
          <div className="wm-bg-controls">
            <div className="color-field">
              <span>Backing color</span>
              <div className="color-row">
                <input
                  type="color"
                  value={bg.color}
                  onChange={(e) => updateBg({ color: e.target.value })}
                  aria-label="Backing color"
                />
                <ColorHexInput
                  className="form-input color-hex"
                  value={bg.color}
                  onChange={(v) => updateBg({ color: v })}
                  aria-label="Backing color hex"
                />
                <div className="pad-bg-presets">
                  {[
                    { label: "Black", value: "#000000" },
                    { label: "White", value: "#ffffff" },
                    { label: "Red", value: "#ef4444" },
                    { label: "Blue", value: "#3b82f6" },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`preset-pill ${bg.color === p.value ? "active" : ""}`}
                      onClick={() => updateBg({ color: p.value })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="wm-sliders">
              <div className="form-field">
                <label className="form-label">Backing opacity · {bg.opacity}%</label>
                <input
                  className="form-input slider"
                  type="range"
                  min={0}
                  max={100}
                  value={bg.opacity}
                  onChange={(e) => updateBg({ opacity: Number(e.target.value) })}
                />
              </div>
              <div className="form-field">
                <label className="form-label">Backing padding · {bg.padding}px</label>
                <input
                  className="form-input slider"
                  type="range"
                  min={0}
                  max={64}
                  value={bg.padding}
                  onChange={(e) => updateBg({ padding: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
