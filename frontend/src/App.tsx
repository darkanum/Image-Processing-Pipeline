import { useState } from "react";
import { JobForm } from "./components/JobForm";
import { JobList } from "./components/JobList";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

const App = (): JSX.Element => {
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
        <div className="meta">
          API: <code>{API_URL}</code>
        </div>
      </header>

      <main className="container">
        <section className="card">
          <h2>Submit URL</h2>
          <JobForm
            apiUrl={API_URL === "/api" ? "" : API_URL}
            onCreated={() => setRefreshSignal((n) => n + 1)}
          />
        </section>

        <section className="card">
          <div className="row-between">
            <h2>Live jobs</h2>
            <span className="muted">Updates stream from Firestore — no polling</span>
          </div>
          <JobList refreshSignal={refreshSignal} />
        </section>
      </main>

      <footer className="app-footer">
        Built with React + Vite · TypeScript · Firebase Emulator
      </footer>
    </div>
  );
};

export default App;
