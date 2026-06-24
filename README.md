# Real-Time Image Processing Pipeline

A containerized full-stack image-processing pipeline built to production standards.
Users submit a URL via a React UI, the URL hits an Express API that enqueues a
BullMQ job, a worker downloads + transforms the image with `sharp`, uploads the
result to Firebase Storage, and streams status updates to the UI through a
Firestore real-time listener (no polling).

This codebase demonstrates what a small but production-ready service looks like —
not a toy demo. The frontend, API, worker, and storage layers are wired for
horizontal scaling, real observability, and operational hygiene.

---

## Table of contents

- [Architecture](#architecture)
- [Features](#features)
- [Quick start](#quick-start)
- [API reference](#api-reference)
- [Configuration reference](#configuration-reference)
- [Operations](#operations)
- [Security model](#security-model)
- [Scaling](#scaling)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Known limitations](#known-limitations)

---

## Architecture

```
   Browser (React + Firestore listener)
        │
        │  1. POST /api/jobs
        │  2. onSnapshot(jobs) — real-time updates
        ▼
   ┌──────────────────────────────────────┐    enqueue    ┌─────────────┐
   │  API (Express + zod + helmet)        │──────────────▶│  Redis      │
   │  ─ /health, /health/ready, /live     │               │  (BullMQ)   │
   │  ─ /metrics (Prometheus)             │               └──────┬──────┘
   │  ─ rate-limited + API-key guarded    │                      │
   │  ─ structured logs + request IDs     │                      │ consume
   └──────────────────────────────────────┘                      ▼
                                              ┌──────────────────────────────────┐
                                              │  Worker (BullMQ consumer)        │
                                              │  ─ download → transform → upload │
                                              │  ─ hard timeouts + structured    │
                                              │    logs + Prometheus metrics     │
                                              │  ─ graceful SIGTERM drain        │
                                              └────────┬──────────────┬──────────┘
                                                       │              │
                                              write    │              │   write
                                                       ▼              ▼
                                              ┌──────────────┐  ┌──────────────┐
                                              │  Firestore   │  │   Storage    │
                                              │  (job state) │  │  (results)   │
                                              └──────────────┘  └──────────────┘
                                                       ▲              │
                                                       │              │ serve
                                                       └──────────────┘
                                                            Browser
```

**Why this shape:**
- The React UI subscribes to Firestore (not the API), so the worker is the
  only thing that ever talks to Firebase for state — a clean write/read
  split with no polling.
- BullMQ is the right primitive for thousands of in-flight jobs: at-least-once
  delivery, exponential backoff, dead-letter behavior, and per-job
  observability.
- A periodic cleanup loop in the worker reaps job records and storage objects
  past their TTL — without this, the storage layer grows unbounded.

---

## Features

### Functional
- **One-shot image transform pipeline**: output format, quality, resize (fit /
  crop / pad), crop, grayscale, watermark (text **or** image URL with 9-zone
  positioning + margin), rotation, horizontal/vertical flip, overall opacity.
- **Real-time status streaming** from worker to UI via Firestore
  (`onSnapshot` — no polling).
- **Cursor-paginated job list** with segmented Queue / Executing / Completed /
  Failed tabs.
- **One-click retry** for failed jobs that re-submits with the same parameters.
- **Live API health indicator** in the header (green / amber / grey).

### Reliability
- Per-job hard timeout (default 120s) to keep the worker from being held
  hostage by a stuck download.
- Exponential-backoff retries with `UnrecoverableError` for failures that
  can't be retried (bad URL, non-image, too large, transform fail).
- Graceful SIGTERM shutdown for both API and worker (drain in-flight, then
  force-exit after grace).
- Periodic cleanup of old Firestore docs and Storage objects.

### Security
- Optional API-key auth (`X-Api-Key` header) with constant-time compare and
  fail-closed defaults for unsafe placeholders.
- CORS lockdown to an explicit origin allow-list.
- `helmet` security headers (CSP, HSTS in production, X-Frame-Options, etc.).
- Per-IP rate limiting (30 writes/min, 300 reads/min).
- Request body size limit (64 KB).
- `x-powered-by` header disabled.
- Container hardening: `no-new-privileges`, non-root user, memory caps.

### Observability
- Structured JSON logs (`pino`) with per-request `requestId` correlation.
- Prometheus `/metrics` endpoint: HTTP latency histogram, request counter,
  enqueue counter, completed counter, active gauge, processing duration,
  image bytes processed, plus all `prom-client` default Node metrics.
- K8s-style probes: `/health/live` (am I running?) and `/health/ready` (am I
  serving?).
- `X-Request-Id` response header on every request.

### Performance
- Code-split frontend bundle: main chunk 163 KB (52 KB gzipped) + lazy
  `JobList` chunk that includes the Firebase SDK.
- `1-year immutable` cache on hashed Vite assets; `no-cache` on `index.html`.
- `WORKER_CONCURRENCY` tunable per environment.

---

## Quick start

```bash
# 1. From the project root
docker compose up --build

# 2. Open the app
#    Frontend:  http://localhost:8088
#    API:       http://localhost:3100
#    Firebase:  http://localhost:4001  (UI for browsing Firestore/Storage)
```

The first build takes a few minutes (libvips is compiled). Subsequent rebuilds
are cached.

Submit any image URL on the form, watch the job appear in the **Queue** tab
and progress to **Executing** → **Completed** with a preview of the result.

---

## API reference

All endpoints are JSON. Errors come back as `{ error, requestId, code? }`.
The `requestId` is the same as the `X-Request-Id` response header — include
it in support tickets so logs can be found.

### `POST /api/jobs` — submit a job

```bash
curl -X POST http://localhost:3100/api/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://picsum.photos/800/600",
    "transform": {
      "outputFormat": "jpeg",
      "quality": 82,
      "resize": { "mode": "fit", "width": 1024, "lockAspectRatio": true },
      "watermark": {
        "kind": "text",
        "text": "Mavis",
        "position": "bottom-right",
        "margin": 32,
        "opacity": 70,
        "size": 28
      },
      "rotation": 0
    }
  }'
```

**Response 201:** the full `JobRecord` (see `GET /api/jobs/:id`).

**Possible errors:**
- `400 VALIDATION_FAILED` — invalid `url` or `transform` (zod issues in `details`).
- `401` — missing / invalid API key.
- `429` — rate limit hit.
- `5xx` — server error.

### `GET /api/jobs` — list recent jobs

Query params: `limit` (1-200, default 50), `cursor` (last job id from prev page).

```bash
curl 'http://localhost:3100/api/jobs?limit=10'
```

**Response 200:** `{ jobs: JobRecord[], nextCursor: string | null }`.

### `GET /api/jobs/:id` — get a single job

Returns the same `JobRecord` shape.

### `GET /health` — basic liveness

Returns `{ status: 'ok', uptime, ts }` — used by Docker's default healthcheck.

### `GET /health/live` — K8s liveness probe

Returns 200 if the process is responding. Use this to decide whether to
**restart** the pod.

### `GET /health/ready` — K8s readiness probe

Returns 200 with sub-checks (memory, uptime) — 503 if any sub-check fails.
Use this to decide whether to **route traffic** to the pod.

### `GET /metrics` — Prometheus scrape endpoint

Standard Prometheus text format. Scraped by Prometheus at a typical 15s
interval.

---

## JobRecord shape

```ts
{
  id: string;             // BullMQ job id == Firestore doc id
  url: string;
  status: "pending" | "downloading" | "processing" | "uploading" | "completed" | "failed";
  progress: number;       // 0..100
  currentStep: string;    // e.g. "downloading source", "transforming"
  resultUrl: string|null; // present once status == "completed"
  errorMessage: string|null;
  createdAt: number;      // epoch ms
  updatedAt: number;
  finishedAt: number|null;
  transform: TransformSpec | null;
  metadata: {
    bytes?: number;
    format?: string;      // "jpeg" | "png" | "webp" | "avif" | "gif"
    width?: number;
    height?: number;
  };
}
```

---

## Configuration reference

All values are read at process start and validated by zod. Missing required
values fail fast at boot.

| Env var                  | Default            | Notes                                                   |
| ------------------------ | ------------------ | ------------------------------------------------------- |
| `PORT`                   | `3001`             | API listen port                                         |
| `NODE_ENV`               | `development`      | `production` enables HSTS, security warnings, etc.      |
| `LOG_LEVEL`              | `info`             | `fatal`/`error`/`warn`/`info`/`debug`/`trace`            |
| `API_KEY`                | *(unset)*          | If set, all `POST /api/jobs` requests must include `X-Api-Key: …`. Empty = open (dev only). |
| `ALLOWED_ORIGINS`        | *(unset)*          | Comma-separated CORS allow-list. Empty = permissive.    |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | BullMQ backend                                     |
| `WORKER_CONCURRENCY`     | `4`                | Concurrent jobs per worker process                      |
| `JOB_MAX_IMAGE_BYTES`    | `10485760`         | Reject source images larger than this at the API        |
| `JOB_DOWNLOAD_TIMEOUT_MS`| `20000`            | Source download timeout                                 |
| `JOB_HARD_TIMEOUT_MS`    | `120000`           | End-to-end per-job timeout (download → upload)          |
| `JOB_TTL_HOURS`          | `24`               | Firestore records older than this are swept             |
| `STORAGE_TTL_HOURS`      | `24`               | Result files older than this are swept                  |
| `FIREBASE_PROJECT_ID`    | `demo-image-pipeline` |                                                       |
| `FIREBASE_STORAGE_BUCKET` | *(unset)*         | Required for real Firebase                              |
| `FIRESTORE_EMULATOR_HOST` | *(unset)*        | When set, the Firebase Admin SDK talks to the emulator  |
| `FIREBASE_STORAGE_EMULATOR_HOST` | *(unset)*  | Same for Storage                                        |
| `FIREBASE_AUTH_EMULATOR_HOST` | *(unset)*     | Same for Auth                                           |

---

## Operations

### Health & observability

```bash
# Health (cheap, no auth)
curl http://localhost:3100/health/ready | jq

# Metrics
curl http://localhost:3100/metrics | head -20
```

Add to your Prometheus config:

```yaml
scrape_configs:
  - job_name: 'image-pipeline-api'
    static_configs:
      - targets: ['api:3001']
    metrics_path: /metrics
```

### Logs

Both services log structured JSON to stdout. Pipe to your log shipper
(loki, datadog, etc.) — the format includes a stable `requestId` field for
correlation.

```bash
docker compose logs -f api worker
```

### Common operator tasks

```bash
# Tail the BullMQ queue
docker compose exec redis redis-cli
> KEYS bull:*
> LRANGE bull:imageProcessing:wait 0 5

# Clear the queue (kills pending jobs)
docker compose exec redis redis-cli FLUSHDB

# Force-rebuild a single service
docker compose up -d --build --no-deps api
```

### Running tests

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

---

## Security model

This codebase is built for production but ships with safe-by-default dev
settings. To deploy it for real, do **at minimum** the following:

1. **Set `API_KEY`** to a strong random secret (≥ 16 chars). Pass it to the
   frontend via the `VITE_API_KEY` build arg (or your secret manager).
2. **Set `ALLOWED_ORIGINS`** to your real frontend origin (e.g.
   `https://app.example.com`).
3. **Switch off Firebase emulators** — set `FIREBASE_PROJECT_ID` to a real
   project, `FIREBASE_STORAGE_BUCKET` to a real bucket, and mount
   `GOOGLE_APPLICATION_CREDENTIALS` with a service account JSON.
4. **Set `NODE_ENV=production`** in the API and worker env.
5. **Add a TLS terminator** (nginx, Caddy, ALB) in front of the API. The
   containers are HTTP only.
6. **Set up a Prometheus scraper** and an alert on `rate(http_requests_total{status=~"5.."}[5m]) > 0`.
7. **Restrict Storage bucket access** — public read for result files is
   fine, but make sure write is only via the service account.

The startup-time security warnings (`logSecurityWarnings`) will print to the
container logs if any of these are missing in `production` mode.

---

## Scaling

The pipeline scales horizontally along three axes:

- **API**: stateless — scale by adding replicas. Rate limit is per-instance;
  in production swap to a Redis-backed store via `rate-limit-redis`.
- **Worker**: stateless consumer — scale by adding worker processes (or
  pods). The `WORKER_CONCURRENCY` env var controls per-process concurrency;
  total throughput is `instances × concurrency`. Cleanup sweeps currently
  run in every worker — for large clusters, gate it on a leader-election
  lock or move it to a CronJob.
- **Redis**: the single biggest bottleneck under load. For >10k in-flight
  jobs, move to a managed Redis with the cluster API; BullMQ supports it
  out of the box.
- **Firestore**: throughput scales with the project quota. For very high
  write rates, batch updates in the worker (write every Nth progress
  change rather than every one).

A reasonable starting profile for ~1000 jobs/min:

| Service  | CPU  | Memory | Replicas |
| -------- | ---- | ------ | -------- |
| API      | 0.5  | 256 MB | 2-4      |
| Worker   | 2    | 1 GB   | 2-3      |
| Redis    | 1    | 1 GB   | 1 (HA)   |
| Storage  | n/a  | n/a    | managed  |

---

## Project layout

```
.
├── backend/                # Express API + BullMQ worker (shared image)
│   ├── src/
│   │   ├── api/            # routes (health, jobs)
│   │   ├── middleware/     # security, error handler, rate limit
│   │   ├── observability/  # metrics, request logger
│   │   ├── services/       # queue, image processor, downloader, cleanup
│   │   ├── workers/        # the BullMQ consumer
│   │   ├── config/         # zod-validated env loader
│   │   ├── types/          # shared type defs
│   │   ├── server.ts       # API entry point
│   │   └── worker-entry.ts # worker entry point
│   └── tests/              # vitest
├── frontend/               # React + Vite SPA
│   ├── src/
│   │   ├── components/     # JobForm, JobList, JobCard, HealthIndicator…
│   │   ├── hooks/          # useApiHealth
│   │   ├── lib/            # api (fetch wrapper), firebase
│   │   └── test/           # vitest + Testing Library
│   └── nginx.conf          # cache-control, gzip
├── firebase/               # Local Emulator Suite container
└── docker-compose.yml      # the whole stack
```

---

## Testing

- **Backend:** `npm test` (vitest). 39 tests covering image transforms, the
  downloader, the worker happy/error paths, and the API surface.
- **Frontend:** `npm test` (vitest + Testing Library). 13 tests covering the
  JobForm, the progress bar, and the API wrapper.

End-to-end smoke test: `docker compose up --build`, open
<http://localhost:8088>, submit `https://picsum.photos/800/600`, verify the
job completes in <5s with a previewable result.

---

## Known limitations

- The cleanup loop runs in **every** worker — fine for a small cluster, but
  in a 20-worker fleet this would 20x the Firestore read cost. Move it to a
  CronJob or use a leader-election lock for big deployments.
- The rate limiter is **in-memory** per instance — multiple API replicas
  will let an attacker `replicas × 30` jobs/min. Swap for
  `rate-limit-redis` to share state.
- Result URLs are **publicly readable** in the Storage emulator (and in
  production if you leave the bucket public). For private results, mint
  signed URLs on demand.
- The React app currently has no authentication — the API key is a single
  shared secret. For multi-tenant use, swap for OAuth2 / mTLS / signed JWT.
- No tracing (OpenTelemetry). Add `auto-instrumentations-node` to each
  service when you wire it into your tracing backend.
- Image moderation is not implemented. If the source URL points at
  user-uploaded content, run it through an ML moderation service before
  storage.
