import { useState, type CSSProperties } from "react";
import type { JobRecord, JobStatus, TransformSpec } from "../types/job";
import { STATUS_LABEL } from "../types/job";
import { ProgressBar } from "./ProgressBar";
import { apiRequest, ApiError } from "../lib/api";

interface JobCardProps {
  job: JobRecord;
  onRetry?: (newJob: { id: string }) => void;
}

const formatBytes = (bytes?: number): string => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatTime = (ms: number): string => {
  return new Date(ms).toLocaleTimeString();
};

const elapsed = (createdAt: number, finishedAt: number | null): string => {
  const end = finishedAt ?? Date.now();
  const ms = Math.max(0, end - createdAt);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
};

/** A short human-readable description of the transform applied. */
const describeTransform = (t: TransformSpec | null): string[] => {
  if (!t) return [];
  const out: string[] = [];
  if (t.outputFormat !== "original") out.push(`output ${t.outputFormat.toUpperCase()}`);
  if (t.resize && t.resize.mode !== "none") {
    const what =
      t.resize.preset ??
      (t.resize.aspectRatio
        ? `${t.resize.aspectRatio} ratio`
        : `${t.resize.width ?? "?"}×${t.resize.height ?? "?"}`);
    out.push(`${t.resize.mode} ${what}`);
  }
  if (t.crop && (t.crop.width || t.crop.height || t.crop.aspectRatio)) {
    const what = t.crop.aspectRatio ?? `${t.crop.width ?? "?"}×${t.crop.height ?? "?"}`;
    out.push(`crop ${what}`);
  }
  if (t.grayscale) out.push("grayscale");
  if (t.watermark) {
    const kind = t.watermark.kind === "text"
      ? `text "${(t.watermark.text ?? "").slice(0, 24)}${(t.watermark.text ?? "").length > 24 ? "…" : ""}"`
      : `image ${(t.watermark.imageUrl ?? "").slice(0, 32)}`;
    out.push(`watermark ${kind} @ ${t.watermark.position} (${t.watermark.opacity}%)`);
  }
  if (t.rotation !== 0) out.push(`rotate ${t.rotation}°`);
  if (t.flipHorizontal) out.push("flip H");
  if (t.flipVertical) out.push("flip V");
  if (t.opacity < 100) out.push(`opacity ${t.opacity}%`);
  return out;
};

export const JobCard = ({ job, onRetry }: JobCardProps): JSX.Element => {
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";
  const [imgError, setImgError] = useState<boolean>(false);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const description = describeTransform(job.transform);
  const showImg = isCompleted && job.resultUrl && !imgError;

  const handleRetry = async (): Promise<void> => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      // Re-submit the same payload. The transform + URL are the source
      // of truth — anything else (job id, status) is per-attempt.
      const payload = { url: job.url, transform: job.transform ?? undefined };
      const newJob = await apiRequest<{ id: string }>("/jobs", {
        method: "POST",
        body: payload,
      });
      onRetry(newJob);
    } catch (err) {
      if (err instanceof ApiError) {
        setRetryError(err.message);
      } else {
        setRetryError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRetrying(false);
    }
  };

  const stateStyle: CSSProperties = {
    borderLeftColor: statusAccent(job.status),
  };

  return (
    <article
      className={`job-card ${isCompleted ? "done" : ""} ${isFailed ? "failed" : ""}`}
      style={stateStyle}
      aria-busy={job.status !== "completed" && job.status !== "failed"}
    >
      <header className="job-card-head">
        <div className="job-id" title={job.id}>#{job.id.slice(0, 8)}</div>
        <div className="job-time">
          {formatTime(job.createdAt)} · {elapsed(job.createdAt, job.finishedAt)}
        </div>
      </header>

      <a className="job-url" href={job.url} target="_blank" rel="noreferrer">
        {job.url}
      </a>

      <ProgressBar status={job.status} progress={job.progress} />

      {description.length > 0 && (
        <div className="job-description">
          <span className="job-description-label">Applied:</span>
          <ul>
            {description.map((d, i) => (
              <li key={`${d}-${i}`}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="job-meta">
        {job.metadata.width && job.metadata.height && (
          <span>{job.metadata.width}×{job.metadata.height}</span>
        )}
        {job.metadata.format && <span>· {job.metadata.format.toUpperCase()}</span>}
        {job.metadata.bytes ? <span>· {formatBytes(job.metadata.bytes)}</span> : null}
      </div>

      {isCompleted && job.resultUrl && (
        <div className="result-block">
          {showImg ? (
            <a className="result-link" href={job.resultUrl} target="_blank" rel="noreferrer">
              <img
                src={job.resultUrl}
                alt="Processed result"
                loading="lazy"
                onError={() => setImgError(true)}
              />
              <span>Open result ↗</span>
            </a>
          ) : (
            <div className="result-link result-link-broken">
              <span className="broken-icon">🖼</span>
              <span>
                {imgError ? "Preview unavailable — open the result URL directly." : "Awaiting upload…"}
              </span>
              <a className="open-link" href={job.resultUrl} target="_blank" rel="noreferrer">
                Open result ↗
              </a>
            </div>
          )}
        </div>
      )}

      {isFailed && (
        <div className="error">
          <div>⚠ {job.errorMessage || "Job failed."}</div>
          {onRetry && (
            <div className="error-actions">
              <button
                type="button"
                className="retry-button"
                onClick={handleRetry}
                disabled={retrying}
                aria-label="Re-submit this job with the same parameters"
              >
                {retrying ? "Retrying…" : "↻ Retry"}
              </button>
              {retryError && <span className="error-inline">{retryError}</span>}
            </div>
          )}
        </div>
      )}
    </article>
  );
};

function statusAccent(s: JobStatus): string {
  switch (s) {
    case "pending": return "#94a3b8";
    case "downloading": return "#3b82f6";
    case "processing": return "#a855f7";
    case "uploading": return "#06b6d4";
    case "completed": return "#10b981";
    case "failed": return "#ef4444";
  }
}

void STATUS_LABEL;
