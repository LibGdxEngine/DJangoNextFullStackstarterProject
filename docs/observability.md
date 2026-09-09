# Observability

Development and production Compose run an OpenTelemetry Collector, Grafana,
Loki (logs), Tempo (traces), and Prometheus (metrics). Grafana is exposed through
Caddy at `/observability/`. Ingestion and storage ports remain private. Browser
telemetry is not enabled.

## Start and sign in

```sh
docker compose up -d --build
docker compose exec backend python manage.py createsuperuser
```

Open `/observability/` on the site's normal origin. Sign in through the redirect
to `/admin/login/?next=/observability/`. This requires a Django admin session,
not the separate NextAuth application login. A user must be authenticated,
`is_staff`, `is_active`, and have account status `active`. Organization roles do
not grant access. Staff receive Grafana Viewer access; dashboards and data sources
are provisioned from the repository.

Production uses `make prod-build` and `make prod-up` with a populated `.env.prod`.
There are no host bindings for the observability services. Caddy authorizes every
Grafana HTTP request and WebSocket handshake against the current Django session.
Backend failure denies access. Staff removal blocks subsequent requests; an
already open WebSocket is authorized at its handshake, not continuously.

## Signals

Application logs include service, environment, release, severity, request ID,
trace/span IDs, and task ID where available. Django, Next.js server requests,
outgoing HTTP, database/cache operations, and Celery publishing/execution use W3C
trace context. Request IDs are separate support identifiers propagated to tasks.

Docker logs cover Django/Gunicorn, Celery worker/Beat, Next.js, Caddy, PostgreSQL,
Redis, and the telemetry storage/dashboard services. Collector diagnostics stay
in `docker compose logs otel-collector` to avoid feeding export errors into the
same export pipeline. Application logs are not also exported through SDKs.

HTTP/task metrics are independent of trace sampling. Runtime, Caddy, collector,
storage-service, and host disk metrics provide baseline operational visibility.
Dedicated PostgreSQL/Redis performance exporters and queue-lag metrics are not
included. Django audit records retain their existing storage and authorization.

Use Grafana dashboards and Explore to query each signal. Follow log trace IDs to
Tempo. Request/user/task identifiers are metadata, not metric or log-stream labels.

## Configuration and storage

| Setting | Development | Production |
| --- | --- | --- |
| `OTEL_ENABLED` | `true` in Compose | `true` in Compose |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | `0.1` |
| `APP_VERSION` | `development` | Deployed release/commit |
| Log retention | 7 days | 7 days |
| Trace retention | 3 days | 3 days |
| Prometheus retention | 15 days or 2 GB | 15 days or 2 GB |
| Docker log rotation | 10 MB × 3 per container | 10 MB × 3 per container |

Sampling respects the propagated parent decision. Logs and metrics remain
available for unsampled requests. SDK telemetry defaults to disabled outside
Compose. Set `APP_VERSION` at deployment and recreate containers after environment
changes. `NEXT_TELEMETRY_DISABLED=1` controls Next.js usage reporting separately.

The log reader targets Linux Docker Engine with the JSON-file driver. Verify the
daemon's data root using:

```sh
docker info --format '{{.DockerRootDir}} {{.LoggingDriver}}'
```

The container log directory is mounted read-only; no Docker socket is mounted.
Each service's logging options attach Compose project/service labels. Missing or
mismatched project labels are rejected. A custom daemon data root needs the
corresponding log-directory override. Docker Desktop and rootless Docker can
require host-specific mount and permission changes.

Docker alone manages log rotation. Recreate old containers to apply new logging
options; a restart does not change their logging driver settings. Persistent
volumes retain logs, traces, metrics, Grafana state, and collector read offsets.
Do not use `make clean` or `docker compose down -v` to restart observability:
these delete application database and telemetry volumes.

Retention is not a hard total disk cap for Loki/Tempo. Ingestion limits, bounded
export queues, memory limits, Docker rotation, and disk-space alerts limit
resource pressure. Size the host for the measured ingestion rate and check free
space before extending retention. Back up Grafana state and any history you need
to retain. This single-host deployment is not highly available.

## Sensitive data and access

Do not log request bodies, cookies, authorization headers, OTPs, passwords, raw
SQL, task arguments, or URL queries. Structured logging and export sanitizers
remove sensitive fields; known unsafe log sites are corrected at the source.
PostgreSQL statement/parameter logging and Caddy credential logging are disabled.
Exception messages require the same scrutiny as ordinary logs. Sentinel tests
exercise sanitization, but arbitrary free-text logging is not a safe channel for
secrets.

Grafana staff can read system-wide operational data. Keep host/network access
restricted to operators and never publish storage/ingestion ports as a workaround
for proxy login. Grafana does not accept anonymous access or independent login.

## Health and troubleshooting

- `/api/health/live/` checks that Django serves requests.
- `/api/health/ready/` uses bounded database/Redis checks and returns 503 when a
  required dependency is unavailable.
- Existing status endpoints no longer enqueue tasks or expose raw exceptions.
  The heartbeat indicates recent scheduler → broker → worker → cache success,
  rather than isolated Beat process health.

Application requests do not depend on a healthy collector. Exporters use bounded
asynchronous queues and retries; prolonged outages can drop signals. Docker
rotation can remove unread logs during long outages, so delivery is not lossless.

For missing data, inspect `docker compose ps`, collector logs, and destination
logs. Check project-label filtering, OTLP endpoint, enabled flag, sampling ratio,
and service/environment identity. Check that containers were recreated with the
new log settings. A missing production trace may be normal sampling.

For denied Grafana access, check Django admin login, staff/account flags, and
backend health. Do not enable anonymous access or trust client identity headers.
Initial access creates a Grafana Viewer record; continuing access is always
authorized by Django.

To disable SDK exports, set `OTEL_ENABLED=false` and recreate application
containers. Docker log collection is independent; stop the collector as well to
stop all ingestion. The application keeps serving traffic.

## Verification

```sh
docker compose config --quiet
python3 scripts/check-observability.py
make api-check
```

The proxy check creates temporary Django users/sessions, exercises actual Caddy
authorization and Django admin login, and removes its Django fixtures on exit.
It targets development; do not run fixture/outage tests against production.
Auto-provisioned Grafana Viewer records may remain without valid Django accounts.

Before production rollout, verify server-to-backend-to-task trace correlation,
each service's logs, secret redaction, metrics with zero trace sampling, collector
and storage outages/recovery, read offsets after restart, Docker rotation, disk
alerts, and worker completion. Validate production HTTPS and secure session
cookies with the deployed domain. Alert rules stay local; external notification
destinations require separate configuration and no messages are sent by default.
