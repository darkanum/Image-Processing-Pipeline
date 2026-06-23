import type { JobStatus } from "../types/job";
import { STATUS_COLOR, STATUS_LABEL } from "../types/job";

interface ProgressBarProps {
  status: JobStatus;
  progress: number;
}

export const ProgressBar = ({ status, progress }: ProgressBarProps): JSX.Element => {
  const color = STATUS_COLOR[status];
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const failed = status === "failed";
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div
        className="progress-fill"
        style={{ width: `${pct}%`, backgroundColor: failed ? STATUS_COLOR.failed : color }}
      />
      <div className="progress-label">
        <span className="status-pill" style={{ backgroundColor: color }}>
          {STATUS_LABEL[status]}
        </span>
        <span className="pct">{pct}%</span>
      </div>
    </div>
  );
};
