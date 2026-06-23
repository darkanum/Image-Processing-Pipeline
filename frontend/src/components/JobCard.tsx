import type { JobRecord, JobStatus, TransformSpec } from "../types/job";
import { STATUS_LABEL } from "../types/job";
import { ProgressBar } from "./ProgressBar";

interface JobCardProps {
  job: JobRecord;
}

const formatBytes = (bytes?: number): string => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatTime = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleTimeString();
};

/** Render a small chip-list of the non-default transform options. */
const TransformChips = ({ t }: { t: TransformSpec | null }): JSX.Element | null => {
  if (!t) return null;
  const chips: string[] = [];
  if (t.outputFormat !== "original") chips.push(t.outputFormat.toUpperCase());
  if (t.grayscale) chips.push("grayscale");
  if (t.resize && t.resize.mode !== "none") {
    if (t.resize.preset) chips.push(t.resize.preset.split(" ")[0]!);
    else if (t.resize.aspectRatio) chips.push(t.resize.aspectRatio);
    else if (t.resize.width || t.resize.height) {
      chips.push(`${t.resize.width ?? "?"}×${t.resize.height ?? "?"}`);
    }
    chips.push(t.resize.mode);
  }
  if (t.crop && (t.crop.width || t.crop.height || t.crop.aspectRatio)) {
    chips.push(`crop ${t.crop.aspectRatio ?? `${t.crop.width ?? "?"}×${t.crop.height ?? "?"}`}`);
  }
  if (t.watermark) {
    chips.push(`wm ${t.watermark.kind}`);
  }
  if (t.rotation !== 0) chips.push(`${t.rotation}°`);
  if (t.flipHorizontal) chips.push("flipH");
  if (t.flipVertical) chips.push("flipV");
  if (t.opacity < 100) chips.push(`${t.opacity}% opacity`);

  if (chips.length === 0) return null;
  return (
    <div className="transform-summary">
      {chips.map((c, i) => (
        <span key={`${c}-${i}`} className="chip">{c}</span>
      ))}
    </div>
  );
};

const STATUS_BG: Record<JobStatus, string> = {
  pending: "#94a3b8",
  downloading: "#3b82f6",
  processing: "#a855f7",
  uploading: "#06b6d4",
  completed: "#10b981",
  failed: "#ef4444",
};

export const JobCard = ({ job }: JobCardProps): JSX.Element => {
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <article className={`job-card ${isCompleted ? "done" : ""} ${isFailed ? "failed" : ""}`}>
      <header className="job-card-head">
        <div className="job-id" title={job.id}>{job.id.slice(0, 8)}…</div>
        <div className="job-time">{formatTime(job.createdAt)}</div>
      </header>

      <a className="job-url" href={job.url} target="_blank" rel="noreferrer">
        {job.url}
      </a>

      <ProgressBar status={job.status} progress={job.progress} />

      <div className="job-meta">
        {job.metadata.width && job.metadata.height && (
          <span>{job.metadata.width}×{job.metadata.height}</span>
        )}
        {job.metadata.format && <span>· {job.metadata.format.toUpperCase()}</span>}
        {job.metadata.bytes ? <span>· {formatBytes(job.metadata.bytes)}</span> : null}
        {job.metadata.attemptsMade ? <span>· attempt {job.metadata.attemptsMade}</span> : null}
      </div>

      <TransformChips t={job.transform} />

      {isCompleted && job.resultUrl && (
        <a className="result-link" href={job.resultUrl} target="_blank" rel="noreferrer">
          <img src={job.resultUrl} alt="Processed" loading="lazy" />
          <span>Open result →</span>
        </a>
      )}

      {isFailed && job.errorMessage && (
        <div className="error">⚠ {job.errorMessage}</div>
      )}

      {/* Hidden state data for debugging if needed */}
      <span style={{ display: "none" }} data-status-color={STATUS_BG[job.status]} data-status-label={STATUS_LABEL[job.status]} />
    </article>
  );
};
