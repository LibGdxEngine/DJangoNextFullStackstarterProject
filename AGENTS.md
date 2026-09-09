# Repository Guidelines

## Project Structure & Module Organization

- `backend/core/`: settings (`base`, `dev`, `prod`), URL routing, middleware, and Celery configuration.
- `backend/apps/`: reusable platform modules. App tests live in `tests/`; schema changes belong in `migrations/`.
- `backend/product/`: product-specific modules; follow its README for registration and tenant scoping.
- `frontend/src/`: routes in `app/`, shared UI in `components/`, feature code in `features/`, and shared hooks, utilities, and types in their named directories. Static assets live in `frontend/public/`.
- `scripts/`, `caddy/`, and root Compose files support seeding and deployment.

## Build, Test, and Development Commands

Run Make targets from the root. Container execution requires a running Docker Compose stack.

- `make build && make up`: build images and start the development stack; browse `http://localhost`.
- `make logs`: follow service logs.
- `make makemigrations` / `make migrate`: generate and apply Django migrations.
- `make check`: run Django system checks.
- `make test-backend`: run Django tests.
- `make test-frontend`: run ESLint only.
- From `frontend/`, run `npm ci`, then `npm run dev` for local development, `npm run build` for a production build, or `npx tsc --noEmit` for type checking.

## Coding Style & Naming Conventions

Use four-space Python indentation, snake_case functions/modules, and PascalCase classes. Match neighboring TypeScript formatting: shared UI uses two spaces, double quotes, and semicolons. Name components in PascalCase and hooks `useSomething`. Use `@/` for imports from `frontend/src/`. TypeScript strict mode and Next.js ESLint rules apply. Read `frontend/AGENTS.md` before frontend changes.

## Testing Guidelines

Place regression tests in `backend/apps/<app>/tests/test_*.py`, with `test_*` methods. Follow existing Django test cases and mock external services. Run a focused suite with `docker compose exec backend python manage.py test apps.accounts.tests`. Frontend transport tests use Vitest (`cd frontend && npm test`). Also run lint, type checking, and relevant browser flows; no coverage threshold is configured.

## API Contracts

Use domain API wrappers instead of raw HTTP in product code. Django defines request/response types: run `make api-generate` after contract changes and include both generated artifacts. Run `make api-check` before submitting. Preserve the shared error envelope and existing business codes.

## Commit & Pull Request Guidelines

Use short, action-oriented commit subjects, following history such as `celery enhancements`. PRs should explain changes, link issues, list validation, and include UI screenshots. Identify migrations and configuration changes.

## Security & Configuration

Use `.env.example` and `.env.prod.example` as configuration references. Keep credentials in ignored environment files. Avoid `make clean` unless deleting local database volumes is intended.
