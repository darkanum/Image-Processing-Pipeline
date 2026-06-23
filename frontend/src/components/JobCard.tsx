import type { JobRecord } from "../types/job";
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

      {isCompleted && job.resultUrl && (
        <a className="result-link" href={job.resultUrl} target="_blank" rel="noreferrer">
          <img src={job.resultUrl} alt="Processed" loading="lazy" />
          <span>Open result →</span>
        </a>
      )}

      {isFailed && job.errorMessage && (
        <div className="error">⚠ {job.errorMessage}</div>
      )}
    </article>
  );
};
