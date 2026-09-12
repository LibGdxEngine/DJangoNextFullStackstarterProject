# Rate limiting

Mobser uses approximate DRF limits for ordinary traffic and atomic Redis admission for authentication, verification messages, webhook work, and explicitly expensive operations. Operation keys are shared across `/api/v1/auth/`, `/api/accounts/`, and the legacy token routes. Changing a route spelling does not provide a fresh budget.

## Configuration

Production requires two independently generated secrets, at least 32 characters long: `RATE_LIMIT_PROXY_TOKEN` authenticates internal forwarding; `RATE_LIMIT_KEY_SECRET` derives opaque counter keys. Generate each with `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` and store them in the ignored production environment or secret manager. Never use the documented development defaults in production. All backend processes share the same counter secret and Redis URL. Caddy, NextAuth, and Django share the proxy token; neither secret belongs in a `NEXT_PUBLIC_*` variable.

`RATE_LIMIT_REDIS_URL` selects the shared standalone Redis store (Compose uses database 1). `RATE_LIMIT_REDIS_TIMEOUT` bounds connect/read waits to 0.3 seconds each by default. Counter namespaces are separate from cache/task/session keys; do not flush Redis to reset a quota. Redis restart or eviction can lose counters. PostgreSQL OTP attempt/consumption state remains independent, but this is not durable financial accounting.

`RATE_LIMIT_MODE=enforce` enables security policies. Production configuration checks reject disabling them. `RATE_LIMIT_BASELINE_MODE=observe` can measure ordinary traffic before enforcing its baseline. Observation counters have a separate namespace. Observe mode is not protection for exposed security endpoints.

The approximate DRF defaults are `RATE_LIMIT_ANONYMOUS=60/min`, `RATE_LIMIT_USER=300/min`, and `RATE_LIMIT_STATUS=30/min`. Django, Gunicorn, and Celery production initialization validates configuration before serving work. Offline schema and regression-test settings explicitly disable admission; real integration tests enable it.

`RATE_LIMIT_POLICIES` accepts JSON overrides of named policies, with arrays of `[requests, seconds]` windows. For example:

```dotenv
RATE_LIMIT_POLICIES={"login_ip":[[20,60]],"login_identifier":[[10,900]]}
```

Keep independent IP and identifier limits; never combine those identities into a single bucket. Initial login limits count admitted successful and failed attempts and expire automatically. They are not permanent account lockouts. Shared message limits are one/minute, five/hour, and ten/day per normalized destination/channel, across creation, resends, and purposes. Worker retries do not consume send admission again. A failed database/queue operation conservatively retains its already-reserved allowance until expiry.

Signup admission allows ten attempts/minute and sixty/hour per IP, including invalid submissions. This gives users room to correct form errors and accommodates users sharing an IP, while retaining burst and sustained limits. Verification-message limits remain separate and unchanged; increasing signup admission does not increase a recipient's message allowance.

The policy registry in `backend/core/settings/rate_limits.py` is the source of truth for initial values. Tune specific policies from observed legitimate traffic, shared-NAT behavior and provider capacity. Do not add an unbounded production bypass.

## Trusted ingress

Caddy overwrites `X-Mobser-Client-IP` and `X-Mobser-Proxy-Token` on upstream API/frontend requests. NextAuth and the server API transport preserve only validated request-scoped identity. Django does not infer identity from a browser-supplied forwarding chain. Current client-IP handling assumes Caddy is the public edge; adding a CDN requires explicitly trusting that edge and rerunning spoofing tests.

Production uses trusted ingress and rejects protected work if provenance is missing. Direct local development can explicitly use `RATE_LIMIT_TRUST_PROXY=false` and `RATE_LIMIT_ALLOW_DIRECT=true`; App Router has no reliable original socket peer, so direct NextAuth development uses a shared backend peer bucket. Identity, user and recipient limits still apply. Use Caddy for end-to-end verification and production-like testing.

Rotate the proxy token in Caddy, frontend and Django together; mismatched tokens make protected actions unavailable. Rotate counter-key secrets deliberately: changing them starts a new key space. Keep headers/secrets out of logs, tracing, browser responses and bundles. Existing observability authorization and liveness/readiness endpoints retain their own access rules and are exempt from user quotas.

## Responses and failure behavior

Quota exhaustion returns HTTP 429, `error.code="throttled"`, and `Retry-After` seconds. Protected limiter failures return sanitized HTTP 503, `rate_limit_unavailable`, and a short retry hint. The existing error envelope is retained. Frontend clients retain input and retry information; they do not automatically replay POST requests or invalidate a session on 429/503. Current login/social forms show a bounded countdown. Future forms should use the same retry metadata/hook.

Ordinary read limits fail open on cache errors; writes, authentication, sending and expensive work fail closed. Public health remains read-only and reports real dependency state. Webhooks have separate ingress and authenticated-connection budgets. Ingress may reject duplicates with 429/503; after ingress and authentication pass, a stored duplicate bypasses the new-work quota. Ensure the provider retries these responses. Exposed production connections require configured authentication credentials.

For each exposed `auth` and `support` HireAgents connection, configure `HIREAGENTS_<AUTH|SUPPORT>_WEBHOOK_API_KEY`, `HIREAGENTS_<AUTH|SUPPORT>_WEBHOOK_SIGNING_SECRET`, or both. Missing credentials and the published development defaults prevent production startup. Connections explicitly disabled in Django's connection registry return 404.

OTP services serialize challenge transitions using PostgreSQL locks. Failed-attempt accounting must commit before a public validation exception is raised. Callers already owning a database transaction must use the outcome API and unwrap it after their outer commit. A rollback of an arbitrary enclosing transaction cannot preserve writes inside it; do not hide that boundary with an inner savepoint.

## Validation and rollout

Run regression tests with `make test-backend`, strict integration tests with `make test-rate-limits`, and frontend tests/lint/typecheck/build from `frontend/`. Integration tests require PostgreSQL and Redis and must run in CI/staging as an explicit gate. The Make target supplies `RATE_LIMIT_TEST_REDIS_URL=redis://redis:6379/1`; override that environment variable for another test service. Direct test runs must supply it explicitly. Tests use isolated test databases/key namespaces. Do not use `FLUSHDB`, `FLUSHALL`, or `make clean` on shared services.

Run `make api-generate` after contract changes and `make api-check` before handoff. Include both generated artifacts. Schema generation stays independent of Redis, a database, a broker and production credentials.

Before rollout, record: proxy topology and secret owner, Redis memory/eviction/restart posture, connection timeouts and measured admission latency, selected rates, and the webhook provider's retry/backoff behavior. Gate release on two-path identity isolation/spoofing tests, alias coverage, real Redis/PostgreSQL concurrency races, denied-request side-effect checks and simulated outages. Deploy related aliases and service protections together. Begin ordinary baselines in observation if needed; enforce security and send policies before exposure.

Rollback presentation or individual limits independently while retaining protected admission and PostgreSQL challenge correctness. Prefer correcting an overly strict named policy over disabling all throttling. A faulty trusted-ingress configuration should be repaired rather than bypassed. Do not erase counters to recover from an outage.

Metrics use `mobser.rate_limit.requests` and `mobser.rate_limit.duration` (seconds), with bounded `rate_limit.policy` and `rate_limit.outcome` labels. Outcomes include `allow`, `reject`, `would-reject`, `limiter-error`, and `fallback`. Watch rejection rates per policy, any protected limiter errors, baseline fallbacks, and admission latency. No IP, recipient, token, or user identifier enters those labels. Configure alert thresholds from traffic and availability objectives before rollout.

## Explicit follow-ups

The existing forgot-password response can distinguish eligible accounts by its challenge identifier. Recipient-only denial suppresses sending with a generic response; this does not claim to solve the pre-existing recovery-contract issue. A separate contract/UX change must address uniform responses and verification behavior.

No AI endpoints, AI billing subsystem, new diagnostic route, or CDN deployment are introduced here. Before exposing AI or queued expensive work, require verified tenant membership, request and resource budgets, token/cost reservation and reconciliation, idempotency, concurrency leases, queue bounds, and provider spending caps. Ordinary request limits alone cannot enforce a spending ceiling.
