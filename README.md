# Real-Time Image Processing Pipeline

A containerized full-stack image-processing pipeline. Users submit a URL via a React
UI, the URL hits an Express API that enqueues a BullMQ job, a worker downloads +
transforms the image with `sharp`, uploads the result to Firebase Storage, and
streams status updates to the UI through a Firestore real-time listener (no polling).

```
   ┌────────┐  POST /api/jobs   ┌────────┐   enqueue    ┌────────┐
   │React UI├──────────────────▶│Express │──────────────▶│ Redis  │
   │ +Firestore listener       │  API   │               │ (BullMQ│
   └────────┘                  └────┬───┘               │  queue)│
        ▲                          │                    └───┬────┘
        │ onSnapshot(Firestore)    │                        │
        │                          ▼                        ▼ consume
   ┌────┴────┐  write status  ┌────────────┐   fetch  ┌─────────────┐
   │Firestore│◀──────────────│   Worker    │◀────────│  BullMQ      │
   │+Storage │   upload OK   │ (sharp etc.)│         │  Worker      │
   └─────────┘               └────────────┘         └─────────────┘
```

## Stack

- **Backend**: Node.js 20, TypeScript, Express, BullMQ, firebase-admin, sharp, zod, pino
- **Frontend**: React 18, TypeScript, Vite, Firebase JS SDK (with `onSnapshot`)
- **Queue**: Redis 7
- **Storage / status DB**: Firebase Local Emulator Suite (Firestore + Storage + Auth)
- **Tests**: Vitest

## Architecture highlights

- Functional, typed service modules (`firebase.ts`, `queue.ts`, `imageProcessor.ts`,
  `downloader.ts`, `jobRepository.ts`) — each module owns a single concern and
  exports a small pure API.
- The API and the worker are **two entrypoints of the same backend codebase**
  (`src/server.ts` and `src/worker-entry.ts`). They share Redis and Firebase
  clients but run in separate containers for clean horizontal scaling.
- Each job's BullMQ id **is** its Firestore document id, so the worker only needs
  one identifier (`job.id`) to update status — no lookup join.
- Status updates flow in two channels: the Firestore document (drives the UI
  listener) and BullMQ `progress` (drives ops dashboards).
- `UnrecoverableError` is thrown for non-retryable failures (bad URL, non-image,
  too large) so BullMQ doesn't waste retries on deterministic errors.
- Strict input validation with `zod` in the API layer; max-bytes + timeout
  enforced in the downloader.

## Layout

```
.
├── backend/                # Node.js API + worker (TypeScript)
│   ├── src/
│   │   ├── api/            # Express routes
│   │   ├── services/       # firebase, queue, downloader, imageProcessor, jobRepository
│   │   ├── workers/        # imageWorker (job handler)
│   │   ├── types/          # JobRecord, JobStatus, etc.
│   │   ├── config/         # env loading + validation (zod)
│   │   ├── utils/          # logger
│   │   ├── server.ts       # API entrypoint
│   │   └── worker-entry.ts # worker entrypoint
│   ├── tests/              # vitest unit tests
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── frontend/               # React + Vite UI
│   ├── src/
│   │   ├── components/     # JobForm, JobList, JobCard, ProgressBar
│   │   ├── hooks/          # useJobs (Firestore onSnapshot)
│   │   ├── lib/            # firebase client init
│   │   ├── types/          # JobRecord mirror
│   │   ├── test/           # component test
│   │   ├── App.tsx, main.tsx, index.css
│   ├── public/             # favicon
│   ├── Dockerfile, nginx.conf
│   └── package.json
├── firebase/               # emulator config + Dockerfile
│   ├── firebase.json
│   ├── firestore.rules
│   └── storage.rules
├── docker-compose.yml      # api + worker + redis + firebase-emulator + frontend
├── .env.example
├── .gitignore
└── README.md
```

## Prerequisites

- Docker + Docker Compose (v2)
- **OR** Node.js 20+ and Redis 7+ for a non-containerized run

## Quick start (Docker)

```bash
git clone <this-repo>
cd "Real-Time Image Processing Pipeline"
docker compose up --build
```

Then open:

- **Frontend (DEMO)**: <http://localhost:8088>
- **Firebase emulator UI**: <http://localhost:4001>
- **API health**: <http://localhost:3100/health>

The full port map (host → container) lives at the top of `docker-compose.yml`.

The frontend is wired to talk to the API via host port 3100 and to the
Firestore/Storage emulators via host ports 8085/9200 (see `docker-compose.yml`
for the full map).

To stop and remove everything:

```bash
docker compose down -v
```

## Running tests

### Backend (Vitest)

```bash
cd backend
npm install
npm test
```

Covers:

- `transformImage` — resize, grayscale, watermark, format conversion, error path
- `POST /api/jobs` — happy path, invalid URL, missing url, http(s)-only
- `GET /api/jobs` and `GET /api/jobs/:id` — 200 and 404 paths
- Worker happy path + every error branch (invalid url, not-image, too-large,
  transient network, transform failure, missing payload)

### Frontend (Vitest + Testing Library)

```bash
cd frontend
npm install
npm test
```

Covers the `<ProgressBar>` component (status labels, percentage clamp, failure).

## Local dev (without Docker)

```bash
# 1. Start Redis
docker run --rm -p 6379:6379 redis:7-alpine
# Or: redis-server

# 2. Start Firebase emulators
cd firebase
docker build -t firebase-emulator .
docker run --rm -p 4001:4000 -p 8085:8080 -p 9200:9199 -p 9095:9099 firebase-emulator
# Or: firebase emulators:start --project demo-image-pipeline --config firebase.json

# 3. Backend API
cd ../backend
cp .env.example .env
# .env defaults assume the docker port map (REDIS_HOST=127.0.0.1:6390 etc.)
npm install
npm run dev               # http://localhost:3100

# 4. Backend worker (separate terminal)
npm run dev:worker

# 5. Frontend
cd ../frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

## API

| Method | Path             | Description                              |
| ------ | ---------------- | ---------------------------------------- |
| POST   | `/api/jobs`      | Create a job. Body: `{ "url": "..." }`   |
| GET    | `/api/jobs`      | List recent jobs (newest first, max 50)  |
| GET    | `/api/jobs/:id`  | Fetch a single job                       |
| GET    | `/health`        | Health probe                             |

### Job record shape

```ts
{
  id: string,                  // BullMQ id == Firestore doc id
  url: string,
  status: 'pending' | 'downloading' | 'processing' | 'uploading' | 'completed' | 'failed',
  progress: number,            // 0..100
  currentStep: 'queued' | 'downloading' | 'processing' | 'uploading' | 'completed' | null,
  resultUrl: string | null,    // public URL to transformed image (Firebase Storage)
  errorMessage: string | null,
  createdAt: number,           // epoch ms
  updatedAt: number,
  finishedAt: number | null,
  metadata: { bytes?, width?, height?, format?, attemptsMade? }
}
```

## Test cases (from the spec)

| # | Scenario | Expected |
| - | -------- | -------- |
| 1 | Valid PNG/JPG URL | job reaches `completed`, `resultUrl` populated |
| 2 | Invalid URL (404) | `status=failed`, `errorMessage` describes HTTP 404 |
| 3 | Non-image URL | `status=failed`, `errorMessage` mentions content-type |
| 4 | Very large image (>10 MB) | rejected by `downloader` (`TOO_LARGE`) before sharp runs |
| 5 | Multiple simultaneous jobs | `WORKER_CONCURRENCY` (default 4) processed in parallel |
| 6 | Redis connection failure recovery | BullMQ retries with exponential backoff; `maxRetriesPerRequest=null` allows reconnect |

Each case is exercised by the test suite or by submitting the corresponding
input through the UI.

## Configuration

All config is via environment variables — see `backend/.env.example` and
`frontend/.env.example`. Notable knobs:

- `WORKER_CONCURRENCY` — how many jobs a worker process handles in parallel
- `JOB_MAX_IMAGE_BYTES` — hard cap on downloaded image size (default 10 MB)
- `JOB_DOWNLOAD_TIMEOUT_MS` — request timeout for downloads
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` — Redis location
- `FIRESTORE_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST`
  — when set, the backend points at the local emulator (no real credentials)

## Production deployment (sketch)

1. Provision a real Firebase project + service account JSON.
2. Set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json` and **unset** the
   emulator host vars.
3. Run `api` and `worker` containers pointing at a managed Redis (e.g.
   Upstash, Elasticache).
4. The frontend should NOT set `VITE_FIRESTORE_EMULATOR_HOST` etc. — let it
   talk to real Firebase. Use real `VITE_FIREBASE_*` config values.

## Notes

- Image transforms applied: **resize to 800 px (aspect-preserving)**, **grayscale**,
  and **text watermark "Mavis Pipeline"** (bottom-right, SVG overlay — no font files).
- `sharp` runs natively in the container via `libvips42`.
- The Firebase emulator image ships with OpenJDK 17 because the Firebase CLI's
  emulator suite is JVM-based.
- Real Firebase mode and emulator mode are **the same code path** — the Admin SDK
  automatically uses emulator hosts when those env vars are set.
