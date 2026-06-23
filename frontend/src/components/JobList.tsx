import { useState, useMemo } from "react";
import type { JobRecord, JobStatus } from "../types/job";
import { JobCard } from "./JobCard";

interface JobListProps {
  refreshSignal: number;
}

type TabKey = "queue" | "executing" | "completed" | "failed";

interface TabDef {
  key: TabKey;
  label: string;
  match: (s: JobStatus) => boolean;
}

const TABS: TabDef[] = [
  { key: "queue", label: "Queue", match: (s) => s === "pending" },
  { key: "executing", label: "Executing", match: (s) => s === "downloading" || s === "processing" || s === "uploading" },
  { key: "completed", label: "Completed", match: (s) => s === "completed" },
  { key: "failed", label: "Failed", match: (s) => s === "failed" },
];

export const JobList = ({ refreshSignal: _refreshSignal }: JobListProps): JSX.Element => {
  void _refreshSignal; // kept for API stability
  const { jobs, loading, error } = useJobsLite(50);
  const [tab, setTab] = useState<TabKey>("queue");

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
        <div className="empty error">Failed to subscribe: {error}</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>No {tabsWithCounts.find((t) => t.key === tab)?.label.toLowerCase()} jobs.</p>
          <p className="empty-hint">Submit a URL above to create one.</p>
        </div>
      ) : (
        <div className="job-cards">
          {visible.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Lightweight wrapper around the useJobs hook — reuses the same logic but
 * allows this component to be self-contained.
 */
import { useEffect, useState as useReactState, useCallback } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import type { JobRecord as JobRecordType } from "../types/job";

interface UseJobsLiteResult {
  jobs: JobRecordType[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const useJobsLite = (maxJobs: number): UseJobsLiteResult => {
  const [jobs, setJobs] = useReactState<JobRecordType[]>([]);
  const [loading, setLoading] = useReactState(true);
  const [error, setError] = useReactState<string | null>(null);
  const [tick, setTick] = useReactState(0);

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
          const items: JobRecordType[] = [];
          snap.forEach((d) => {
            items.push({ id: d.id, ...(d.data() as Omit<JobRecordType, "id">) });
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
