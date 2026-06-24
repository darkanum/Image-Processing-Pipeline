# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased] — production-readiness pass

### Added
- **Security**
  - Optional API key auth (`X-Api-Key`) with constant-time compare and
    fail-closed defaults for unsafe placeholders.
  - CORS lockdown to an explicit origin allow-list (`ALLOWED_ORIGINS`).
  - `helmet` security headers (CSP, HSTS in production, X-Frame-Options,
    Referrer-Policy, X-Content-Type-Options).
  - Per-IP rate limiting: 30 submissions/min, 300 reads/min.
  - Request body size cap (64 KB).
  - `x-powered-by` disabled.
  - Container hardening: `no-new-privileges`, non-root user, memory caps.
- **Observability**
  - Prometheus `/metrics` endpoint with HTTP latency histogram, request
    counter, enqueue counter, completed counter, active gauge, processing
    duration, image bytes processed, plus all `prom-client` default Node
    metrics.
  - K8s-style probes: `/health/live` and `/health/ready`.
  - Structured JSON logs (`pino`) with per-request `requestId` correlation.
  - `X-Request-Id` response header.
  - Periodic 60s metrics snapshot in worker logs.
- **Reliability**
  - Per-job hard timeout (`JOB_HARD_TIMEOUT_MS`, default 120s).
  - Graceful SIGTERM shutdown for both API and worker (drain in-flight,
    force-exit after grace period).
  - Periodic cleanup loop for old Firestore docs and Storage objects
    (configurable via `JOB_TTL_HOURS` / `STORAGE_TTL_HOURS`).
  - Cursor-paginated job list (`?limit=&cursor=`).
- **UX**
  - Live API health indicator in the header (green / amber / grey).
  - URL pre-flight validation (protocol allow-list, localhost warning).
  - Quick-pick URL pills for the demo.
  - Per-tab empty states with actionable hints.
  - Failed-job retry button (re-submits with the same parameters).
  - Friendly error messages for 401 / 429 / 5xx with the request id.
  - Toggling "Add watermark" without instantiating a full spec.
- **Performance**
  - Code-split the frontend bundle: main 163 KB (52 KB gzipped) + lazy
    JobList chunk that includes the Firebase SDK.
  - `1-year immutable` cache on hashed Vite assets, `no-cache` on
    `index.html`.
- **Documentation**
  - Comprehensive `README.md` with architecture, scaling notes, security
    model, and operator runbook.
  - `SECURITY.md` threat model and hardening checklist.
  - `RUNBOOK.md` with common operator scenarios.
  - `.github/workflows/ci.yml` running typecheck + tests on PR.
- **Testing**
  - 39 backend tests (image transforms, downloader, worker, API surface).
  - 13 frontend tests (JobForm, ProgressBar, api wrapper).
  - 52 tests total, all green.

### Fixed
- `sharp` watermark margin was being ignored — now uses explicit `left` /
  `top` from the 9-zone position + margin.
- `sharp` watermark text was rendered on a full-destination canvas and
  therefore always flush against the edge — now uses a tight canvas.
- Watermark size default now adjusts when toggling between text and image
  kinds.
- Frontend bundle was a single 515 KB chunk — now split as described.
- Watermark `text` field no longer leaks into the URL when not set.

### Changed
- Frontend now sends `X-Api-Key` from the `VITE_API_KEY` build arg.
- `POST /api/jobs` returns 400 with zod issue details on invalid input.
- API errors return `{ error, requestId, code? }` consistently.

## [0.1.0] — initial submission

- End-to-end image-processing pipeline: React UI, Express API, BullMQ
  worker, Firebase (Firestore + Storage), Redis.
- Transforms: output format, quality, resize (fit/crop/pad), crop,
  grayscale, watermark (text/image, 9 positions, margin, opacity, size),
  rotation, horizontal/vertical flip, overall opacity.
- Real-time status updates via Firestore `onSnapshot` (no polling).
- 6 service ports mapped to free host ports and bound to IPv4 only
  (Windows Docker IPv6 workaround).
- Containerized deployment with `docker compose up --build`.
