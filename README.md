# Mobser Full-Stack Platform (Next.js + Django)

A production-ready platform template structured around decoupled reusable platform modules and dedicated product modules. Incorporates a modern Next.js frontend, Django REST Framework backend, Celery task workers, Redis caching, PostgreSQL persistence, and an automated HTTPS reverse proxy via Caddy.

## Tech Stack
*   **Frontend**: [Next.js](https://nextjs.org/) (React 19, TypeScript, Tailwind CSS v4, NextAuth.js)
*   **Backend**: [Django 5.x](https://www.djangoproject.com/) (REST Framework, SimpleJWT, WhiteNoise, drf-spectacular)
*   **Database**: [PostgreSQL 16](https://www.postgresql.org/)
*   **Caching & Broker**: [Redis 7](https://redis.io/)
*   **Task Queue**: [Celery 5.4](https://docs.celeryq.dev/en/stable/)
*   **Reverse Proxy**: [Caddy 2](https://caddyserver.com/)
*   **Observability**: OpenTelemetry, Grafana, Loki, Tempo, and Prometheus. See the [operations guide](docs/observability.md) for setup, staff-only access, retention, and validation.

---

## Project Structure

```text
Mobser/
├── backend/                        # Django backend
│   ├── core/                       # Core configuration & gateways
│   │   ├── settings/               # Split settings (base, dev, prod)
│   │   ├── middleware/             # Core middleware (Request ID tracing)
│   │   ├── celery.py               # Celery application initialization
│   │   └── urls.py                 # Central URL aggregation & API routing
│   ├── apps/                       # Reusable horizontal platform modules
│   │   ├── accounts/               # Custom User model (UUID), JWT & profiles
│   │   ├── organizations/          # Multi-tenancy, workspaces & roles
│   │   ├── billing/                # Plans, customers & subscriptions
│   │   ├── notifications/          # In-app notifications & Celery dispatchers
│   │   ├── audit/                  # Audit logging service & security events
│   │   └── common/                 # Base models (UUID, timestamps), pagination & health
│   ├── product/                    # Dedicated domain-specific product modules
│   │   └── README.md               # Product extension guidelines
│   ├── Dockerfile                  # Development container definition
│   ├── Dockerfile.prod             # Production hardened container definition
│   ├── entrypoint.sh               # DB connectivity check & automated migration
│   └── requirements.txt            # Python dependencies
├── frontend/                       # Next.js frontend
│   ├── src/
│   │   ├── app/                    # Next.js App Router (pages & layouts)
│   │   ├── components/             # Reusable UI kit components (Button, Card, Badge)
│   │   ├── features/               # Feature-sliced modules (auth, system, overview)
│   │   ├── lib/                    # Shared API client, auth options & utilities
│   │   ├── hooks/                  # Custom React hooks (useSystemStatus, useDebounce)
│   │   └── types/                  # Domain TypeScript interfaces & NextAuth types
│   ├── Dockerfile                  # Dev frontend image configuration
│   └── Dockerfile.prod             # Multi-stage standalone production build
├── caddy/                          # Reverse proxy configuration
│   ├── Caddyfile                   # Production routing & automated TLS
│   └── Caddyfile.dev               # Development proxy routing
├── scripts/                        # Automation & database seeding scripts
│   └── seed_dev_data.py            # Development database seed script
├── docker-compose.yml              # Development Docker Compose
├── docker-compose.prod.yml         # Production Docker Compose
├── Makefile                        # Central developer operations CLI
├── .env.example                    # Complete environment variables template
├── .env.dev                        # Development environment variables
└── .env.prod                       # Production environment variables
```

---

## Quick Start (Development)

### 1. Prerequisites
Ensure you have Docker and Docker Compose installed:
*   [Docker Engine](https://docs.docker.com/engine/install/)
*   [Docker Compose](https://docs.docker.com/compose/install/)

### 2. Initialize a New SaaS

In a fresh clone or copy, run `make init` (Python 3.10+ and Make). On systems without
Make, use `python3 scripts/init_project.py`. The initializer asks for a project name,
production domain, Python package, and database name, then previews the files it
will change before applying them.

```text
Project name: Acme
Domain: acme.com
Python package [acme]: acme
Database name [acme]: acme
```

For a scripted preview, and then application:

```bash
python3 scripts/init_project.py --name Acme --domain acme.com --package acme --database acme --dry-run
python3 scripts/init_project.py --name Acme --domain acme.com --package acme --database acme --yes
```

Use `--slug acme-tools` to override the derived slug or `--package core` to retain
the starter's Python package. The command renames project imports, updates branding,
package metadata and monitoring, and creates ignored root `.env` and `.env.prod`
files with independent secrets. Review these files and supply any optional integration
credentials. Development stays on localhost; the supplied domain configures production.
The command does not install dependencies or start services.

Run it before modifying the template or creating environment files. It refuses
conflicting target files and existing environment files; it never overwrites deployment
credentials. Git is optional; without it, only content and collision checks are available.
A successful run writes a non-secret `.bootstrap.json`. Repeating the command preserves
the files and secrets; use another fresh copy for a different product.

This initializes a fresh database and Compose project. It does not rename an existing
database or migrate old volumes. Different project names separate resources, but running
multiple stacks on one host also requires distinct published ports and observability subnets.
See [bootstrap recovery and validation](docs/bootstrap.md) for failure recovery and checks.

### 3. Run the Development Server
From the root of the project, execute:
```bash
make up
```
Or to build and launch from scratch:
```bash
make build && make up
make migrate
```
This starts PostgreSQL (`db`), Redis (`redis`), Django (`backend`), Celery (`celery_worker`), Next.js (`frontend`), and Caddy (`caddy`) in the background.

To watch all logs:
```bash
make logs
```

### 4. Verify
Open your browser and navigate to:
*   **Web Dashboard**: [http://localhost](http://localhost)
*   **Interactive API Docs (Swagger)**: [http://localhost/api/docs/](http://localhost/api/docs/)
*   **Django API Status**: [http://localhost/api/status/](http://localhost/api/status/)
*   **Django Admin Console**: [http://localhost/admin/](http://localhost/admin/)

### 5. Create a Superuser
To create a superuser for dashboard authentication, run:
```bash
make createsuperuser
```

---

## Google Sign-In (Optional)

Google sign-in ships wired end-to-end and stays hidden until credentials are supplied.
No code changes are needed to switch it on.

1.  **Create an OAuth client**: In the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials), create an *OAuth 2.0 Client ID* of type **Web application**.
    *   Authorized JavaScript origin: `http://localhost` (production: `https://yourdomain.com`)
    *   Authorized redirect URI: `http://localhost/api/auth/callback/google`

    The redirect URI must always be `<NEXTAUTH_URL>/api/auth/callback/google`.

2.  **Add the credentials to your environment**:
    *   Development: put them in a `.env` file at the repository root, which Docker Compose loads automatically.
    *   Production: add them to `.env.prod` alongside the other secrets.
    ```env
    GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=your-client-secret
    ```

3.  **Restart the stack** with `make restart` (or `make prod-up`). A "Continue with Google" button now appears on the sign-in form.

**How it works**: NextAuth performs the OAuth handshake, then posts Google's ID token to
`POST /api/v1/auth/social/google/`. Django verifies the token signature, audience and expiry
against Google's public keys, requires a verified email, resolves or creates the user, and
returns the same access/refresh pair as password login — so the backend remains the only
issuer of application tokens.

Google accounts have no phone number, so users created this way are activated on their
verified email and the login response carries `requires_phone: true`. An account that already
signed up with a password is linked to the same user when the Google email matches.

Adding another provider means registering it in `apps/accounts/services/social/registry.py`
and adding one entry to `PROVIDER_META` in `SocialAuthButtons.tsx`.

---

## Deployment (Production)

To spin up the production environment:

1.  **Create and configure the production environment file**:
    ```bash
    cp .env.prod.example .env.prod
    ```
    In PowerShell:
    ```powershell
    Copy-Item .env.prod.example .env.prod
    ```
    Replace every placeholder in `.env.prod` with production values. This file is ignored by Git and must not be committed.
2.  **Run the production stack**:
    ```bash
    make prod-build && make prod-up
    ```
3.  **Logs verification**:
    ```bash
    docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f
    ```

### Deploying with injected secrets

CI/CD and managed hosting platforms that inject all required environment variables can omit the local file:
```bash
make PROD_ENV_FILE= prod-build
make PROD_ENV_FILE= prod-up
```
When `.env.prod` is used, deployment-provided environment variables take precedence over values in the file.

### Production Best Practices Implemented:
*   **Security Policies**: Django is run under a non-root system user (`django`) and Next.js under a non-root node user (`nextjs`).
*   **Django Hardening**: SECURE COOKIES, HSTS, SSL redirects, and strict CORS/CSRF configurations are loaded dynamically in `core.settings.prod`.
*   **Next.js Standalone**: Docker builds utilize multi-stage caching and output `standalone` folder tracking, yielding production images under 150MB.
*   **Caddy Routing**: Automated HTTPS management, SSL redirection, static compression (gzip and zstd), and logging to file.
*   **WhiteNoise**: Compresses and creates unique hashes for Django static files (`CompressedManifestStaticFilesStorage`) to leverage browser caching.

---

## API Contracts and Frontend Requests

Django serializers and OpenAPI annotations define the HTTP contract. The exported
`backend/openapi.json` and `frontend/src/lib/api/generated.ts` are generated artifacts;
do not edit them by hand. Include both regenerated files when an API contract changes.

```bash
make api-generate   # validate Django's schema and regenerate TypeScript
make api-check      # fail if either committed artifact is stale; writes only temporary files
```

Install frontend dependencies with `cd frontend && npm ci` before generating types.
Start the backend container for the default commands. For an isolated local Python
environment with `backend/requirements.txt` installed, use
`make api-check API_PYTHON=/absolute/path/to/venv/bin/python` (the same override works
with `api-generate`).
The commands use fixed schema settings and fail on schema warnings. Frontend builds
consume the committed types and do not need a running Django server.

Product code calls domain APIs such as `systemApi.status()` and `authApi.login(...)`.
Domain wrappers own endpoint paths and use generated request/response types. The shared
client in `frontend/src/lib/api/` owns HTTP methods, query parameters, JSON bodies,
decoding, bearer tokens, and errors. ESLint prevents components from bypassing this layer.
Keep NextAuth's own sign-in and session protocol calls in its SDK.

Browser calls use `NEXT_PUBLIC_API_URL` (default `/api`); server calls use
`BACKEND_API_URL`, falling back to an absolute public URL or `http://localhost/api`.
Never put internal backend addresses or secrets in browser configuration. Requests time
out after 10 seconds by default, accept cancellation, and are not retried automatically.
A 204 returns `undefined`. Protected 401 responses invalidate the affected session and
show a sign-in message; public login failures and 403 responses do not sign the user out.

API failures use one envelope:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid input.",
    "fields": { "email": ["Enter a valid email address."] }
  }
}
```

`fields` maps dotted field paths (including numeric list indexes) to message arrays;
object-level errors use `non_field_errors`. Non-validation failures have empty fields.
Existing business codes, including `PHONE_VERIFICATION_REQUIRED`, stay stable. Optional
`error.context` carries verification email/masked-phone metadata. Successful payloads and
HTTP status codes are unchanged. `ApiError` exposes the envelope plus HTTP status and
distinguishes HTTP failures from network, timeout, cancellation, and JSON-decoding errors.

Run `make test-backend` for Django regressions. From `frontend/`, run `npm test`,
`npm run lint`, `npx tsc --noEmit`, and `npm run build`; also run `make api-check`
before submitting contract changes.

## Service Verification Endpoints

### 1. Hello World API
Route: `GET /api/hello/`
Returns a simple JSON payload showing backend connection success.

### 2. Health & Connections API
Route: `GET /api/status/`
Performs dynamic, runtime connection validation:
1.  **Database Connection**: Attempts a raw check to ensure PostgreSQL is up.
2.  **Redis Connection**: Sets and gets a temporary cache key to verify Redis is operational.
3.  **Celery Worker Integration**: Fires an async Celery task (`test_celery_task.delay(4, 5)`) to verify background queue processing.
4.  **Celery Beat Heartbeat**: Reads the heartbeat key refreshed every minute by the scheduler, so a dead beat container is visible without reading logs.

---

## Scheduled Jobs (Celery Beat)

Two background containers back the queue:

| Service | Command | Role |
| --- | --- | --- |
| `celery_worker` | `celery -A core worker -l info -Q celery,maintenance` | Executes tasks from both the default and maintenance queues |
| `celery_beat` | `celery -A core beat -l info` | Enqueues recurring jobs on schedule |

Maintenance sweeps are routed to a dedicated `maintenance` queue via `CELERY_TASK_ROUTES`, so a long cleanup never delays latency-sensitive work such as OTP delivery. The worker must therefore consume both queues.

### Recurring jobs

| Task | Default cadence | Retention setting |
| --- | --- | --- |
| `apps.accounts.tasks.purge_expired_jwt_tokens` | Daily 03:00 UTC | `EXPIRED_TOKEN_RETENTION_DAYS` |
| `apps.accounts.tasks.purge_expired_verification_challenges` | Daily 03:15 UTC | `VERIFICATION_CHALLENGE_RETENTION_DAYS` |
| `apps.common.tasks.cleanup_expired_sessions` | Daily 03:30 UTC | Uses each session's own `expire_date` |
| `apps.common.tasks.cleanup_temp_uploads` | Daily 03:45 UTC | `TEMP_UPLOAD_RETENTION_HOURS` |
| `apps.common.tasks.cleanup_task_records` | Daily 04:00 UTC | `TASK_RECORD_RETENTION_DAYS` |
| `apps.organizations.tasks.expire_pending_invitations` | Hourly | `INVITATION_EXPIRY_DAYS` (applied at creation) |
| `apps.billing.tasks.sync_subscriptions` | Every 6 hours | `SUBSCRIPTION_PAST_DUE_GRACE_HOURS` |
| `apps.notifications.tasks.send_scheduled_reports` | Mondays 07:00 UTC | `SCHEDULED_REPORT_PERIOD_DAYS` |
| `apps.common.tasks.beat_heartbeat` | Every 60 seconds | — |

### Changing a schedule

Defaults live in `CELERY_BEAT_SCHEDULE` in `core/settings/base.py`. Because the project uses `django_celery_beat`'s `DatabaseScheduler`, those defaults are synced into the database on beat startup and can then be retimed, paused, or disabled from the Django admin under **Periodic Tasks** without a redeploy.

Retention windows are environment variables — see `.env.example`.

```bash
make logs-beat      # confirm jobs are being scheduled
make logs-worker    # confirm jobs are being executed
```

### Extending

Tasks live in a `tasks/` package per app, and every submodule that defines a task must be re-exported from that package's `__init__.py` — `autodiscover_tasks()` only imports `<app>.tasks`.

`sync_subscriptions` moves a subscription through `ACTIVE`/`TRIALING` → `PAST_DUE` → `CANCELED` using only local period data. `charge_via_provider` in `apps/billing/tasks/subscriptions.py` is the integration point for a real payment processor.

## CI/CD deployment

See [the shared-VPS deployment guide](docs/deployment.md) for GitHub Actions, restricted SSH deployment, migration policy, and recovery.
