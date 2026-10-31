# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The imported `AGENTS.md` holds the repository guidelines (structure, style, testing, API contracts, commit conventions). This file adds commands and architecture that span multiple files.

## Commands

Make targets run inside the Docker Compose stack (`make up` first); see `make help` for the full list.

- Backend tests, all: `make test-backend` (`docker compose exec backend python manage.py test`)
- Backend tests, one module/class/method: `docker compose exec backend python manage.py test product.browser_agent.tests.test_runner.ResumeRunTests`
- Non-Django test suites (run from repo root, as CI does): `python -m unittest discover -s deploy/tests -v` and `python -m unittest discover -s backend/tests -v`
- Migrations must be complete: CI runs `makemigrations --check --dry-run` and `scripts/ci-migrations.py`, which checks changed migrations for rolling-deploy compatibility.
- Prod settings check (CI): `python backend/manage.py check --deploy --fail-level WARNING --settings=core.settings.prod`
- Frontend, from `frontend/`: `npm run lint`, `npm test` (Vitest), `npm test -- src/lib/api/__tests__/<file>` for one file, `npm run typecheck`, `npm run build`
- API contract: `make api-generate` / `make api-check`. Without the backend container, pass `API_PYTHON=/path/to/python` (a venv with `backend/requirements.lock`).

`manage.py` defaults to `core.settings.dev`. `make init` references `scripts/init_project.py`, which is not present in this checkout.

## Architecture

### Backend (Django + DRF + Celery)

- **Platform vs product**: `backend/apps/*` are reusable SaaS modules (accounts with UUID `accounts.User`, organizations/tenancy, billing, notifications, audit, messaging, integrations, common). `backend/product/*` holds product-specific apps registered as `product.<name>` and mounted at `api/product/<name>/` in `core/urls.py`; product models extend `apps.common.models.BaseModel` and scope to `Organization`.
- **Error envelope**: `core/api_errors.py` is the DRF `EXCEPTION_HANDLER` (plus `core/middleware/api_errors.py`); every failure is `{"error": {code, message, fields, context?}}`. Keep business codes stable.
- **Auth**: SimpleJWT issued only by Django. NextAuth on the frontend wraps it; social login (Google) posts the provider ID token to `/api/v1/auth/social/google/`, with providers registered in `apps/accounts/services/social/registry.py`.
- **Celery queues**: `CELERY_TASK_ROUTES` in `core/settings/base.py` sends maintenance sweeps to `maintenance` and browser runs to `browser`. `celery_worker` consumes `celery,maintenance`; `celery_browser` (built from `Dockerfile.browser`, Chromium, `shm_size: 1gb`) consumes only `browser`. Beat uses `django_celery_beat`'s DatabaseScheduler, seeded from `CELERY_BEAT_SCHEDULE`. Each app's `tasks/` package must re-export task submodules from `__init__.py`, since autodiscovery imports only `<app>.tasks`.

### Browser agent product (`backend/product/browser_agent/`)

- `engine/` is a vendored copy of the upstream **cantrust** engine (LangChain Deep Agents + Patchright browser, task `packs/` with `Policy`/`PolicyGuard`). When syncing from upstream, keep imports relative and leave out `load_dotenv`; record the upstream commit in the commit message (see history: "Sync the browser agent engine with cantrust master (<sha>)").
- Each member gets a personal `BrowserProfile` per organization (`BrowserProfile.personal`, assigned in `AgentRunViewSet.perform_create` when no profile is named): a Chromium user-data dir under `AGENT_PROFILES_ROOT` plus the engine's `session_cookies.json`, so sign-ins persist across that member's runs. One run at a time may open a profile (`in_use`); a run that finds it busy raises `ProfileBusy` and the Celery task re-queues it after `AGENT_PROFILE_RETRY_S`.
- `services.execute_run` drives one `AgentRun`: claims it, opens a LangGraph checkpointer keyed by the run id, records `AgentRunEvent`s and `AgentArtifact`s under `AGENT_DATA_ROOT`, and heartbeats. Because state is checkpointed, a run can pause to ask the user a question and be re-queued with the answer, and `tasks.reap_stale_runs` re-queues runs whose worker died; both resume from the last finished step.
- `live.py` streams the browser screencast and handles user takeover of the browser via Redis keys (frames, control, queued input events).
- Model and network egress are configured by env in the `celery_browser` service (`OPENROUTER_API_KEY`, `MODEL`, proxy/static IP, `ALLOWED_DOMAINS`, `BRAVE_SEARCH_API_KEY`). `web_search` calls the Brave Search API when the key is set and falls back to a Bing/DuckDuckGo tab without it. `fetch_page` / `fetch_many` read pages over the browser context's HTTP client (cookies and proxy apply) with a per-host throttle, retries and an in-run cache (`BROWSER_THROTTLE_*`, `BROWSER_HTTP_CACHE_TTL_S`, `FETCH_MAX_PARALLEL`).

### Frontend (Next.js 16, App Router)

- Read `frontend/AGENTS.md`: this Next.js version has breaking changes; consult `frontend/node_modules/next/dist/docs/` before writing Next.js code.
- **API layer** (`src/lib/api/`): `client.ts` is the transport; `browser.ts` / `server.ts` bind it for client and server; domain wrappers (`auth.ts`, `agent.ts`, `system.ts`, ...) own endpoint paths and use types from the generated `generated.ts`. ESLint forbids `fetch`, `XMLHttpRequest`, axios, and importing the transport from `components/`, `features/`, `hooks/` or `app/`, so add a domain wrapper instead.
- Browser calls use `NEXT_PUBLIC_API_URL` (default `/api`); server calls use `BACKEND_API_URL`. Protected 401s invalidate the session; 403s and public login failures do not.
- Product UI lives in `src/features/wasel/` (landing, auth, dashboard); dashboard routes are under `src/app/dashboard/`.

### Deployment

- Caddy fronts everything (`caddy/Caddyfile.dev` in dev; browse `http://localhost`, API docs at `/api/docs/`).
- `deploy/controller.py` is a root-installed release controller for the shared VPS (fixed target, never executes artifact content), tested by `deploy/tests/`. Release flow and migration policy: `docs/deployment.md`; observability stack (Grafana/Loki/Tempo/Prometheus): `docs/observability.md`.
