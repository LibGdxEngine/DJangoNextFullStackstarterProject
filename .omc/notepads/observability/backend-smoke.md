# Backend observability verification — 2026-09-09

## Live development stack

A disposable `docker compose exec -T backend python -` process loaded `core.wsgi`, then used Django's test Client with a temporary in-memory URLConf. Its GET view queued the existing harmless `apps.common.tasks.ping` task, waited for the actual prefork worker, and returned `pong`. No production debug endpoint or application data was created.

- Sampled trace: `6c7a8cda69b645318afc4890f01e3d7b`.
- Upstream parent: `619bb987d9684e81`.
- Django server: `0dfa60fe73b8e6e7`.
- Celery publish: `c4551785ca90e83c`.
- Celery execution: `0b845a9ebc4af2f9`.
- Task: `55e2950b-a9c8-4c9c-b8f7-6d4c433012d3`; result `pong`.
- Request: `3f8352d8-8082-49f8-ab14-440a57bfb23b`.

Tempo returned 12 spans. Assertions verified the three parent edges and shared trace ID. The exported trace contained no secret query sentinel. Loki returned the worker completion log with the same request, trace, span, and task IDs.

A second request used unsampled W3C context: trace `ef33d4bd6d1b4c0796efdb1c24fdbb26`, task `5892a599-95a4-415f-b556-fcea115ceb8e`, result `pong`. Tempo returned 404 as expected. Prometheus recorded both executions: `mobser_task_executions_total{task_name="apps.common.tasks.ping",task_state="SUCCESS"}=2`. `max_over_time(mobser_http_requests_total[10m])` returned two `http_route="otel-smoke/"` process series of 1 each, confirming HTTP metrics independent of sampling. Historical querying was necessary because the collector was restarted during parallel configuration verification.

Artifacts: `/tmp/mobser-backend-otel-smoke.py`, sampled/unsampled `.log` files, `/tmp/mobser-backend-tempo-smoke.json`, `/tmp/mobser-backend-task-metrics.json`, `/tmp/mobser-backend-http-metrics.json`, `/tmp/mobser-backend-loki-smoke.json`.

## Checks

- Full backend tests: 109 passed before final focused additions.
- Revised observability tests: 20 passed before startup guard additions.
- Revised telemetry privacy/lifecycle tests: 9 passed, including malformed/nonfinite/out-of-range sampler inputs and startup failure handling.
- Real unreachable collector test passed without mocked exporters; request still returned 200.
- Django checks, Gunicorn config validation, changed module AST parsing, and whitespace checks passed.

## Lessons

Celery prefork parent must never initialize process-global SDK providers, including at worker_ready: replacement children fork later. Initialize execution children via worker_process_init and Beat separately. Use a fresh bounded psycopg probe for readiness; half-open reused connections defeat simple server statement deadlines. Invoke entrypoints through `sh` because bind mounts and COPY can restore non-executable source modes.
