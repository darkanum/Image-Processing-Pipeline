import { useEffect, useState } from "react";

type Status = "ok" | "degraded" | "unknown";

interface HealthState {
  status: Status;
  latencyMs?: number;
  checkedAt?: number;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls /health/ready to surface the API's state in the UI. The header
 * dot turns:
 *   green   — ready (HTTP 200)
 *   amber   — degraded (HTTP 503)
 *   grey    — unreachable / not yet checked
 *
 * The poll is paused while the tab is hidden so we don't waste cycles
 * on backgrounded tabs. Errors are swallowed — if the API is down the
 * job list will tell the user anyway; we don't need a banner for it.
 */
export const useApiHealth = (): HealthState => {
  const [state, setState] = useState<HealthState>({ status: "unknown" });

  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const check = async (): Promise<void> => {
      const start = performance.now();
      try {
        const res = await fetch("/health/ready", { cache: "no-store" });
        const latency = Math.round(performance.now() - start);
        if (cancelled) return;
        setState({
          status: res.ok ? "ok" : "degraded",
          latencyMs: latency,
          checkedAt: Date.now(),
        });
      } catch {
        if (cancelled) return;
        setState({ status: "unknown" });
      }
    };

    const schedule = (): void => {
      timer = window.setTimeout(() => {
        void check();
        schedule();
      }, POLL_INTERVAL_MS);
    };

    void check();
    schedule();

    const onVisibility = (): void => {
      if (document.hidden) {
        if (timer != null) window.clearTimeout(timer);
      } else {
        void check();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return (): void => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return state;
};
