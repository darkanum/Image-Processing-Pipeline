import { lazy, Suspense, useState } from "react";
import { JobForm } from "./components/JobForm";
import { HealthIndicator } from "./components/HealthIndicator";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./hooks/useTheme";

// Code-split the job list — it pulls in the Firebase SDK which is the
// single largest contributor to the bundle. Loading it on-demand drops
// initial paint to a fraction of the full size.
const JobList = lazy(() =>
  import("./components/JobList").then((m) => ({ default: m.JobList })),
);

const API_DISPLAY =
  (import.meta.env.VITE_API_URL as string | undefined)
    ? `${import.meta.env.VITE_API_URL}/api`
    : "/api";

const App = (): JSX.Element => {
  // Initialize the theme once at the root so the first paint is already
  // styled correctly (no flash of light theme in dark mode).
  useTheme();
  const [refreshSignal, setRefreshSignal] = useState<number>(0);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 64 64" width="36" height="36">
              <rect width="64" height="64" rx="12" fill="#0ea5e9" />
              <path d="M16 20 L48 20 L48 44 L16 44 Z" fill="none" stroke="white" strokeWidth="3" />
              <circle cx="26" cy="28" r="4" fill="white" />
              <path d="M16 40 L26 32 L34 38 L44 30 L48 34 L48 44 L16 44 Z" fill="white" />
            </svg>
          </div>
          <div>
            <h1>Image Processing Pipeline</h1>
            <p>BullMQ · Firebase · Realtime</p>
          </div>
        </div>
        <div className="header-meta">
          <HealthIndicator />
          <ThemeToggle />
          <span className="api-line">API: <code>{API_DISPLAY}</code></span>
        </div>
      </header>

      <main className="container">
        <section className="card" aria-labelledby="submit-heading">
          <h2 id="submit-heading">Submit URL</h2>
          <JobForm
            apiUrl={API_DISPLAY === "/api" ? "" : API_DISPLAY}
            onCreated={() => setRefreshSignal((n) => n + 1)}
          />
        </section>

        <section className="card" aria-labelledby="jobs-heading">
          <div className="row-between">
            <h2 id="jobs-heading">Live jobs</h2>
            <span className="muted">Updates stream from Firestore — no polling</span>
          </div>
          <Suspense fallback={<div className="loading-block">Loading job list…</div>}>
            <JobList
              refreshSignal={refreshSignal}
              onJobCreated={() => setRefreshSignal((n) => n + 1)}
            />
          </Suspense>
        </section>
      </main>

      <footer className="app-footer">
        Built with React + Vite · TypeScript · Firebase Emulator
      </footer>
    </div>
  );
};

export default App;
