# Security Policy

## Reporting a vulnerability

Please email `security@example.com` with a description of the issue. Do not
file a public GitHub issue. We aim to acknowledge within 1 business day and
ship a fix within 7 days for high-severity issues.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < latest| :x:                |

## Threat model

The pipeline accepts untrusted image URLs from end users. The threats we
specifically defend against:

| Threat                                  | Defense                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| URL pointing at internal services (SSRF) | URL allowlist + DNS resolution check (TODO)                |
| Oversized payload DoS                   | `JOB_MAX_IMAGE_BYTES` (10 MB) + per-job hard timeout       |
| Flood of submissions                    | Per-IP rate limit (30/min) + global API key                |
| Cross-origin abuse                      | CORS allow-list + CSP headers                              |
| XSS in result preview                   | CSP `object-src 'none'` + `frame-ancestors 'none'`         |
| Out-of-disk from infinite storage       | TTL sweeper (24h default, configurable)                    |
| Stuck workers holding jobs hostage      | Per-job hard timeout (120s) + SIGTERM drain                |
| Leaked secrets in logs                  | Structured logging never includes `Authorization` / `X-Api-Key` |

## Hardening checklist for production

- [ ] Generate a strong `API_KEY` and set it in the API env and the
      frontend build arg.
- [ ] Set `ALLOWED_ORIGINS` to your real frontend origin.
- [ ] Set `NODE_ENV=production`.
- [ ] Terminate TLS in front of the API.
- [ ] Mount a service account with Firebase and switch off the emulators.
- [ ] Restrict the Storage bucket to public-read, service-account-write.
- [ ] Add a Prometheus scraper + alert on 5xx rate.
- [ ] Back up Firestore exports nightly (`gcloud firestore export`).
- [ ] Rotate the `API_KEY` every 90 days.
- [ ] Run a load test to size your worker replicas before launch.
