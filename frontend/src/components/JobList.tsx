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

type TabKey = "queue" | "executing" | "completed" | "failed";

interface TabDef {
  key: TabKey;
  label: string;
  match: (s: JobStatus) => boolean;
}

const TABS: TabDef[] = [
  { key: "queue", label: "Queue", match: (s) => s === "pending" },
  {
    key: "executing",
    label: "Executing",
    match: (s) => s === "downloading" || s === "processing" || s === "uploading",
  },
  { key: "completed", label: "Completed", match: (s) => s === "completed" },
  { key: "failed", label: "Failed", match: (s) => s === "failed" },
];

const EMPTY_HINTS: Record<TabKey, string> = {
  queue: "Submit a URL above to enqueue your first job.",
  executing: "Nothing is running right now — your jobs will appear here as they start.",
  completed: "Completed jobs will appear here with the result URL.",
  failed: "Failed jobs will appear here with their error message and a retry button.",
};

const MAX_JOBS = 50;

export const JobList = ({ refreshSignal: _refreshSignal, onJobCreated }: JobListProps): JSX.Element => {
  void _refreshSignal; // accepted for API stability
  const { jobs, loading, error, refresh } = useJobsLite(MAX_JOBS);
  const [tab, setTab] = useState<TabKey>("queue");

  // Auto-jump to the most interesting tab only ONCE, on the very first
  // snapshot. We track this with a ref so the effect doesn't re-fire on
  // every Firestore update. Important: this MUST NOT run on user clicks
  // — once the user has picked a tab, stay there.
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (autoSwitchedRef.current) return;
    if (loading) return;
    if (jobs.length === 0) return;
    autoSwitchedRef.current = true;
    // If the default "queue" tab is empty, jump to a tab that has content.
    const counts = {
      queue: 0,
      executing: 0,
      completed: 0,
      failed: 0,
    };
    for (const j of jobs) {
      const t = TABS.find((tDef) => tDef.match(j.status));
      if (t) counts[t.key] += 1;
    }
    if (counts.queue > 0) return;
    if (counts.executing > 0) setTab("executing");
    else if (counts.completed > 0) setTab("completed");
    else if (counts.failed > 0) setTab("failed");
  }, [jobs, loading]);

  const grouped = useMemo(() => {
    const buckets: Record<TabKey, JobRecord[]> = {
      queue: [],
      executing: [],
      completed: [],
      failed: [],
    };
    for (const job of jobs) {
      const t = TABS.find((tabDef) => tabDef.match(job.status));
      if (t) buckets[t.key].push(job);
    }
    return buckets;
  }, [jobs]);

  const tabsWithCounts = TABS.map((t) => ({ ...t, count: grouped[t.key].length }));
  const visible = grouped[tab];
  const activeTab = tabsWithCounts.find((t) => t.key === tab)!;

  return (
    <div className="job-list">
      <div className="job-tabs" role="tablist">
        {tabsWithCounts.map((t) => (
          <button
            type="button"
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`job-tab ${tab === t.key ? "active" : ""} ${t.count > 0 ? "has-jobs" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span>{t.label}</span>
            {t.count > 0 && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {loading && jobs.length === 0 ? (
        <div className="empty">Connecting to Firestore…</div>
      ) : error ? (
        <div className="empty error">
          <p>Failed to subscribe: {error}</p>
          <button type="button" className="retry-button" onClick={refresh}>
            ↻ Retry connection
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>No {activeTab.label.toLowerCase()} jobs.</p>
          <p className="empty-hint">{EMPTY_HINTS[tab]}</p>
        </div>
      ) : (
        <div className="job-cards">
          {visible.map((job) => (
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
