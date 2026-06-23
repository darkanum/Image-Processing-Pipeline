import { useEffect, useState, useCallback } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { getDb } from "../lib/firebase";
import type { JobRecord } from "../types/job";

interface UseJobsResult {
  jobs: JobRecord[];
  loading: boolean;
  error: string | null;
  /** Manually trigger a one-shot refresh (the listener also pushes new data). */
  refresh: () => void;
}

/**
 * Subscribe to the Firestore `jobs` collection in real time.
 *
 * We rely on `onSnapshot` (no polling). Falls back to an empty array when the
 * listener errors so the UI keeps rendering.
 */
export const useJobs = (maxJobs = 50): UseJobsResult => {
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
          console.error("[useJobs] snapshot error", err);
          setError(err.message);
          setLoading(false);
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setLoading(false);
    }

    return () => {
      if (unsub) unsub();
    };
  }, [maxJobs, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  return { jobs, loading, error, refresh };
};
