import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import type { JobRecord, JobStatus } from "../types/job";
import { JobCard } from "./JobCard";

interface JobListProps {
  refreshSignal: number;
  /** Notify parent when a new job is created (e.g. from a retry). */
  onJobCreated?: (job: { id: string }) => void;
}

type InProgressKey = "queue" | "executing";
type ArchiveKey = "completed" | "failed";

/** Jobs that should always be visible (top half). */
const IN_PROGRESS: { key: InProgressKey; label: string; match: (s: JobStatus) => boolean }[] = [
  { key: "queue", label: "Queue", match: (s) => s === "pending" },
  {
    key: "executing",
    label: "Executing",
    match: (s) => s === "downloading" || s === "processing" || s === "uploading",
  },
];

/** Jobs that live behind a toggle (bottom half). */
const ARCHIVE: { key: ArchiveKey; label: string; match: (s: JobStatus) => boolean }[] = [
  { key: "completed", label: "Completed", match: (s) => s === "completed" },
  { key: "failed", label: "Failed", match: (s) => s === "failed" },
];

const MAX_JOBS = 50;

export const JobList = ({ refreshSignal: _refreshSignal, onJobCreated }: JobListProps): JSX.Element => {
  void _refreshSignal; // accepted for API stability
  const { jobs, loading, error, refresh } = useJobsLite(MAX_JOBS);
  // Which archive tab is selected. Default to "completed" (more common).
  const [archiveTab, setArchiveTab] = useState<ArchiveKey>("completed");

  // Group jobs by their bucket.
  const grouped = useMemo(() => {
    const inProgress: Record<InProgressKey, JobRecord[]> = { queue: [], executing: [] };
    const archive: Record<ArchiveKey, JobRecord[]> = { completed: [], failed: [] };
    for (const job of jobs) {
      const ip = IN_PROGRESS.find((t) => t.match(job.status));
      if (ip) inProgress[ip.key].push(job);
      const a = ARCHIVE.find((t) => t.match(job.status));
      if (a) archive[a.key].push(job);
    }
    return { inProgress, archive };
  }, [jobs]);

  const counts = {
    queue: grouped.inProgress.queue.length,
    executing: grouped.inProgress.executing.length,
    completed: grouped.archive.completed.length,
    failed: grouped.archive.failed.length,
  };

  // Tiny "live" pulse on the executing column when its count grows —
  // gives a visual cue that work is happening. Fires once per increase.
  const prevExecCountRef = useRef(counts.executing);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (counts.executing > prevExecCountRef.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 600);
      prevExecCountRef.current = counts.executing;
      return () => clearTimeout(t);
    }
    prevExecCountRef.current = counts.executing;
  }, [counts.executing]);

  return (
    <div className="job-list">
      {/* ── Top half: always-visible in-progress columns ────────── */}
      <div className="in-progress-grid">
        {IN_PROGRESS.map((col) => (
          <InProgressColumn
            key={col.key}
            label={col.label}
            jobs={grouped.inProgress[col.key]}
            loading={loading}
            pulse={col.key === "executing" && pulse}
          />
        ))}
      </div>

      {/* ── Bottom half: archive with a 2-way toggle ──────────── */}
      <div className="archive-section">
        <div className="archive-tabs" role="tablist">
          {ARCHIVE.map((t) => (
            <button
              type="button"
              key={t.key}
              role="tab"
              aria-selected={archiveTab === t.key}
              className={`archive-tab ${archiveTab === t.key ? "active" : ""} ${grouped.archive[t.key].length > 0 ? "has-jobs" : ""}`}
              onClick={() => setArchiveTab(t.key)}
            >
              <span>{t.label}</span>
              {grouped.archive[t.key].length > 0 && (
                <span className="tab-count">{grouped.archive[t.key].length}</span>
              )}
            </button>
          ))}
        </div>

        {error ? (
          <div className="empty error">
            <p>Failed to subscribe: {error}</p>
            <button type="button" className="retry-button" onClick={refresh}>
              ↻ Retry connection
            </button>
          </div>
        ) : grouped.archive[archiveTab].length === 0 ? (
          <div className="empty">
            <p>No {archiveTab} jobs yet.</p>
            <p className="empty-hint">
              {archiveTab === "completed"
                ? "Completed jobs will appear here with the result URL."
                : "Failed jobs will appear here with their error message and a retry button."}
            </p>
          </div>
        ) : (
          <div className="job-cards">
            {grouped.archive[archiveTab].map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onRetry={
                  job.status === "failed" && onJobCreated
                    ? onJobCreated
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface InProgressColumnProps {
  label: string;
  jobs: JobRecord[];
  loading: boolean;
  /** Trigger a brief pulse animation on the count badge. */
  pulse: boolean;
}

const InProgressColumn = ({ label, jobs, loading, pulse }: InProgressColumnProps): JSX.Element => {
  return (
    <div className="in-progress-col">
      <div className="in-progress-head">
        <span className="in-progress-title">{label}</span>
        <span className={`in-progress-count ${pulse ? "pulse" : ""} ${jobs.length > 0 ? "has-jobs" : ""}`}>
          {jobs.length}
        </span>
      </div>
      <div className="in-progress-body">
        {jobs.length === 0 ? (
          loading ? (
            <div className="empty small">Loading…</div>
          ) : (
            <div className="empty small">
              {label === "Queue"
                ? "Submit a URL above to enqueue your first job."
                : "Nothing is running right now."}
            </div>
          )
        ) : (
          jobs.map((job) => (
            <JobCard key={job.id} job={job} compact />
          ))
        )}
      </div>
    </div>
  );
};

interface UseJobsLiteResult {
  jobs: JobRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Subscribes to the `jobs` collection. The list refreshes live via
 * Firestore's `onSnapshot` (no polling), with a small `tick` counter to
 * let the parent force a reconnect.
 */
const useJobsLite = (maxJobs: number): UseJobsLiteResult => {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let unsub: (() => void) | null = null;
    try {
      const q = query(
        collection(getDb(), "jobs"),
        orderBy("createdAt", "desc"),
        limit(maxJobs),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const items: JobRecord[] = [];
          snap.forEach((d) => {
            items.push({ id: d.id, ...(d.data() as Omit<JobRecord, "id">) });
          });
          setJobs(items);
          setLoading(false);
        },
        (err) => {
          // eslint-disable-next-line no-console
          console.error("[JobList] snapshot error", err);
          setError(err.message);
          setLoading(false);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [maxJobs, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { jobs, loading, error, refresh };
};
