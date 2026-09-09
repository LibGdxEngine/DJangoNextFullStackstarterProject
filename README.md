# Mobser Full-Stack Platform (Next.js + Django)

A production-ready platform template structured around decoupled reusable platform modules and dedicated product modules. Incorporates a modern Next.js frontend, Django REST Framework backend, Celery task workers, Redis caching, PostgreSQL persistence, and an automated HTTPS reverse proxy via Caddy.

## Tech Stack
*   **Frontend**: [Next.js](https://nextjs.org/) (React 19, TypeScript, Tailwind CSS v4, NextAuth.js)
*   **Backend**: [Django 5.x](https://www.djangoproject.com/) (REST Framework, SimpleJWT, WhiteNoise, drf-spectacular)
*   **Database**: [PostgreSQL 16](https://www.postgresql.org/)
*   **Caching & Broker**: [Redis 7](https://redis.io/)
*   **Task Queue**: [Celery 5.4](https://docs.celeryq.dev/en/stable/)
*   **Reverse Proxy**: [Caddy 2](https://caddyserver.com/)

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

### 2. Run the Development Server
From the root of the project, execute:
```bash
make up
```
Or to build and launch from scratch:
```bash
make build && make up
```
This starts PostgreSQL (`db`), Redis (`redis`), Django (`backend`), Celery (`celery_worker`), Next.js (`frontend`), and Caddy (`caddy`) in the background.

To watch all logs:
```bash
make logs
```

### 3. Verify
Open your browser and navigate to:
*   **Web Dashboard**: [http://localhost](http://localhost)
*   **Interactive API Docs (Swagger)**: [http://localhost/api/docs/](http://localhost/api/docs/)
*   **Django API Status**: [http://localhost/api/status/](http://localhost/api/status/)
*   **Django Admin Console**: [http://localhost/admin/](http://localhost/admin/)

### 4. Create a Superuser
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
