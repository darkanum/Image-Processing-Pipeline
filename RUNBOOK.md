# Operations Runbook

Common scenarios and what to do.

## "Jobs are stuck in Queue and never Execute"

**Symptom:** `http://api/health/ready` returns 200, but new jobs sit in the
**Queue** tab for >1 minute.

**Likely cause:** the worker isn't running, can't reach Redis, or the queue
is paused.

**Steps:**

1. Check the worker is up:
   ```bash
   docker compose ps worker
   docker compose logs --tail=50 worker
   ```
   Look for `imageProcessing worker ready`. If you see Redis connection
   errors, check that `redis` is healthy: `docker compose ps redis`.

2. Check the queue isn't paused:
   ```bash
   docker compose exec redis redis-cli GET "bull:imageProcessing:meta:paused"
   ```
   The value should be empty / missing. If it's `1`, unpause:
   ```bash
   docker compose exec redis redis-cli DEL "bull:imageProcessing:meta:paused"
   ```

3. If the worker is alive but jobs aren't being consumed, restart it:
   ```bash
   docker compose restart worker
   ```

## "Jobs are failing with 'Hard timeout exceeded'"

**Symptom:** jobs flip to **Failed** within ~2 minutes of being picked up
with the error `Hard timeout exceeded (120000ms)`.

**Likely cause:** the source image download or transform is genuinely slow,
or the worker is starved (e.g. all 4 concurrent slots occupied by huge
images).

**Steps:**

1. Inspect the worker's structured logs for the failing job id.
2. If the source URL is unusually large, raise the per-job timeout:
   ```yaml
   environment:
     JOB_HARD_TIMEOUT_MS: 300000   # 5 min
   ```
3. If the worker is CPU/memory-starved, scale up the worker replicas or
   bump its `mem_limit` in `docker-compose.yml`.

## "API is returning 401 even with the right key"

**Symptom:** `POST /api/jobs` returns `{ error: "Invalid API key" }`.

**Steps:**

1. Confirm `API_KEY` is set in the API container:
   ```bash
   docker compose exec api env | grep API_KEY
   ```
2. Confirm the frontend was built with the same key:
   ```bash
   docker compose exec frontend printenv VITE_API_KEY
   ```
   These must match exactly. If they differ, rebuild the frontend with
   the right `VITE_API_KEY` build arg.
3. If `API_KEY` is one of the unsafe placeholders (`changeme`, `demo`,
   `test`, `dev`, `secret`), the API returns `503`. Pick a real secret.

## "Storage is filling up"

**Symptom:** Firestore / Storage quota alarms fire.

**Steps:**

1. Lower the TTLs:
   ```yaml
   environment:
     JOB_TTL_HOURS: 6
     STORAGE_TTL_HOURS: 6
   ```
2. Manually run a one-off cleanup (inside the worker container):
   ```bash
   docker compose exec worker node -e '
     import("./dist/services/cleanup.js").then(m => m.startCleanupScheduler(0));
   '
   ```
3. For a one-shot purge of everything older than 1h:
   ```bash
   docker compose exec firebase-emulator firebase emulators:exec \
     "node -e '...'"
   ```
   (adapt as needed for your real Firebase project)

## "Need to scale workers for a burst"

```bash
# Bring up 4 more worker replicas
docker compose up -d --scale worker=6

# Verify they're all consuming
docker compose logs -f worker | grep "worker ready"
```

(BullMQ load-balances jobs across consumers automatically.)

## "Suspected API compromise"

1. Rotate `API_KEY` immediately (set a new value, redeploy).
2. Drain the queue to halt further processing:
   ```bash
   docker compose exec redis redis-cli SET "bull:imageProcessing:meta:paused" 1
   ```
3. Check `/metrics` for unusual `rate(jobs_enqueued_total[1m])` spikes.
4. Tail the structured logs for repeated 401/429 (rejected calls).
5. Once the issue is contained, unpause and resume normal operation.

## "Worker process is leaking memory"

**Symptom:** `process_resident_memory_bytes` in `/metrics` climbs past
500 MB on a single worker, never returns.

**Steps:**

1. Restart the worker — `sharp` can occasionally hold onto libvips
   references after processing very large images:
   ```bash
   docker compose restart worker
   ```
2. If the issue is frequent, lower `WORKER_CONCURRENCY` to 2 (less memory
   pressure per process) and run more replicas.
3. File a bug with the specific job ids / image dimensions.
