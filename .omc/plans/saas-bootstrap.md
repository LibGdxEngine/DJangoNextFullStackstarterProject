# SaaS bootstrap: `make init`

Status: implementation plan only. No application changes made. Assumption: the Python-package prompt renames `backend/core` to the requested package, following the user's example.

## Requirements summary

Provide a one-time initializer for a fresh clone/copy of this starter. Running `make init` requires only Python 3 and Make; it must work before Docker, Django, npm dependencies, or a database are available. A direct Python invocation supports systems without Make.

```text
$ make init
Project name: Acme
Domain: acme.com
Python package [acme]: acme
Database name [acme]: acme
```

Derive and display a slug (`acme`) from the display name, with a `--slug` override. Use separate values for display name, slug, Python package, and database name. This command initializes the current clone; creating repositories, renaming the checkout directory, installing packages, starting containers, running migrations, deploying, and converting existing databases are outside v1.

## Repository findings

| Concern | Current evidence | Required treatment |
| --- | --- | --- |
| Make entry point | `Makefile:1`, `Makefile:9`, `Makefile:56` | Add `init`/help while retaining the existing default target. |
| Python project package | `backend/manage.py:8`, `backend/core/settings/base.py:35`, `backend/core/settings/base.py:49`, `backend/core/settings/base.py:67` | Rename `core` and update project imports and dotted settings references. |
| Worker/server entry points | `backend/core/celery.py:5`, `backend/core/celery.py:8`, `backend/gunicorn.conf.py:3`, `backend/Dockerfile.prod:6`, `backend/Dockerfile.prod:47`, `docker-compose.yml:89` | Update Celery, Gunicorn, settings, Docker commands, and instrumentation imports together. |
| Production static collection | `backend/entrypoint.sh:36` | Update the exact production-settings comparison so package renaming does not silently skip collectstatic. |
| Supporting commands/tests | `scripts/api-contract.sh:15`, `scripts/seed_dev_data.py:14`, `scripts/check-observability.py:26`, `backend/apps/common/tests/test_observability.py:233` | Include scripts, test imports, embedded Python snippets, and import/patch strings. |
| Dev DB values ignore env | `docker-compose.yml:17`, `docker-compose.yml:67` | Parameterize Postgres and all three Django services consistently, including DB health checks. |
| Docker names | `docker-compose.yml:13`, `docker-compose.prod.yml:13` | Remove fixed `starter_*` container names; scope generated resources by Compose project. |
| Domain routing | `caddy/Caddyfile:31`, `docker-compose.prod.yml:210`, `backend/core/settings/prod.py:9`, `backend/core/settings/prod.py:30` | Keep Caddy's existing domain variable and supply consistent production host/origin values. |
| Conflicting env instructions | `.env.example:3`, `README.md:114`, `backend/core/settings/dev.py:5`, `Makefile:3` | Standardize root `.env` for development and root `.env.prod` for production; reconcile direct Django loading. |
| Package/UI metadata | `frontend/package.json:2`, `frontend/src/app/layout.tsx:16` | Update package/lock root identity and visible metadata, including generic starter text. |
| Frontend brand surfaces | `frontend/src/app/page.tsx:25`, `frontend/src/lib/auth.ts:11`, `frontend/src/features/overview/components/ArchitectureGuide.tsx:110`, `frontend/package-lock.json:8` | Include heading, credentials-provider display, architecture guide, and lockfile root name. |
| Frontend telemetry | `frontend/src/lib/telemetry/logger.ts:30`, `frontend/src/lib/telemetry/server.ts:50`, `frontend/src/lib/telemetry/server.ts:69` | Update exported service/meter identities; retain internal variable names and context keys. |
| Docker log filtering | `observability/collector.yaml:27`, `docker-compose.yml:232` | Verify the collector receives the resolved Compose project name so renamed services still produce collected logs. |
| Cache/email/seed identity | `backend/core/settings/base.py:323`, `backend/core/settings/base.py:332`, `backend/core/settings/dev.py:47`, `scripts/seed_dev_data.py:31` | Update owned defaults, cache namespace, sender, and demo branding. |
| Observability identity | `backend/core/telemetry.py:159`, `observability/alerts.yaml:29`, `observability/grafana/dashboards/mobser.json:109` | Update metric producers, queries, dashboard identifiers, and service names as one mapping. |
| Generated API | `backend/core/settings/base.py:138`, `scripts/api-contract.sh:28` | Update API title and corresponding schema metadata without adding dependency installation to bootstrap. |
| Local secrets ignored | `.gitignore:2` | Generated secret-bearing files remain ignored; examples retain placeholders. |

These references describe the current, heavily modified worktree. Implementation must preserve existing work and refresh its inventory before editing.

## Implementation steps

### 1. Create a standalone command and explicit rewrite inventory

Add `scripts/init_project.py`, using the Python standard library (`argparse`, `json`, `pathlib`, `secrets`, `keyword`, `tokenize`, and temporary-file utilities). Add a small explicit inventory of supported files/transforms inside the script rather than recursively replacing text throughout the checkout.

Support `--name`, `--domain`, `--package`, `--database`, `--slug`, `--dry-run`, and `--yes`. With a terminal, prompt for missing fields and show the non-secret result/file summary before applying. Without a terminal, require explicit values and `--yes` for writes; incomplete input exits with a useful error instead of hanging. Document direct invocation for CI, rather than interpolating arbitrary user input into a Make shell command.

Validate all inputs before any writes: nonempty single-line display name; lowercase ASCII slug with hyphens allowed; ASCII Python identifier that is not a keyword, stdlib shadow, or existing top-level package (except the original `core` package); conservative lowercase PostgreSQL identifier up to 63 characters; bare DNS hostname without scheme, port, credentials, path, whitespace, or control characters. Permit subdomains; derive HTTPS origins from the hostname. Derive underscore-safe package/database/metric defaults from the slug. Serialize values according to their destination format. Explicit `--package core` retains the directory and skips project-package import rewrites.

### 2. Implement preflight, preview, and rerun behavior

Build every proposed file edit and directory move in memory, verify expected source markers and collisions, then show the change summary. Dry-run changes nothing and does not print or generate secrets. Reject conflicting/unrecognized existing `.env`/`.env.prod` files instead of overwriting them. Reject symlink targets and paths outside the repository.

Write a non-secret `.bootstrap.json` containing generator version and resolved identity only after success. A completed identical invocation is a no-op, retaining secrets; a request for a different identity fails with guidance to use a fresh copy. A plain second `make init` detects completion before prompting. No general rebranding or `--force` escape hatch in v1.

Preflight relevant dirty tracked files and untracked target collisions; refuse application on conflicts, while allowing preview. Stage writes and retain original bytes/modes during apply so ordinary write/rename failures can roll back. Use a temporary journal to identify interrupted runs and refuse silent continuation; document recovery. Do not promise filesystem-wide atomicity. Ignore `.git`, `.omc`, virtual environments, dependencies, caches, binaries, user media, and data volumes.

Git is optional: use dirty-file checks only when Git metadata and the CLI are available. For copied directories without Git, retain expected-marker, environment-file, path-collision, and rerun checks and explain that change-history checking is unavailable.

### 3. Rename and rebrand only owned application content

Rename `backend/core/` to `backend/<package>/`. Use token-aware import changes and narrowly scoped string transformations for project-owned import paths: settings, middleware, exception handlers, schema hooks, logging factories, Celery, Gunicorn, ASGI/WSGI, scripts, tests, and docs. Preserve `django.core`, third-party modules, Django app labels (`accounts`, `billing`, etc.), migration history, task names, API paths, and database tables.

Update application display names and owned identifiers across frontend/backend/docs, not every occurrence of the substring `core`. Update `frontend/package.json` name to `<slug>-frontend` and the matching top-level and root-package lockfile names without resolving dependencies or changing integrity/version data. Follow `frontend/AGENTS.md:4` and installed Next documentation before frontend edits.

Keep branding changes finite: existing text, metadata, demo names, owned links, cache/storage namespaces, reset-token salt, and exported telemetry identifiers. Do not invent a new logo, external repository URL, integration endpoint, or product copy. Preserve third-party provider identities and upstream attribution links. Preserve internal `mobserTelemetry*` variable names and `mobser.request_id` context key as explicitly allowed implementation identifiers. Use the underscore-safe metric prefix in both instrumentation and Prometheus/Grafana queries; use the slug for service/dashboard names. Rename the dashboard JSON filename and update any references to that path.

Update OpenAPI `info.title`/description using JSON-aware edits alongside the settings title, keeping operation/schema contracts stable. Never replace strings wholesale inside generated API types. Run the canonical generator during implementation verification to prove both artifacts match; include any resulting changes to both generated artifacts as required by repository guidance.

### 4. Make generated configuration effective

Generate root `.env` and `.env.prod` from the updated examples, with fresh independent secrets for Django, NextAuth, OTP, and database credentials as appropriate to each environment. Use restrictive local file permissions. Leave optional integration credentials empty; do not copy credentials from an existing deployment. Keep examples free of generated secrets.

For Acme production, set `DOMAIN_NAME=acme.com`, `ALLOWED_HOSTS=acme.com`, `NEXTAUTH_URL=https://acme.com`, `NEXT_PUBLIC_API_URL=https://acme.com/api`, and CORS/CSRF origins to `https://acme.com`. Preserve internal Docker URLs such as `http://backend:8000/api`; local development retains localhost URLs. Include `DEFAULT_FROM_EMAIL` and every generated backend secret in Compose's explicit environment wiring, not just in the file.

Make development Postgres/worker/beat/backend read matching DB name/user/password values, and update the Postgres healthcheck for those values. Retain service names (`db`, `backend`, etc.) for internal DNS. Replace fixed container names with default Compose resource naming and set separate generated project defaults (`acme-dev`, `acme-prod`) so volumes/networks are scoped by project and environment. Preserve explicit deployment overrides. This is resource naming isolation; fixed host ports and configured observability subnets still need overrides for concurrent stacks.

Reconcile direct local Django dotenv loading with root `.env`, ensuring it loads before environment-dependent base settings. Keep externally supplied environment values authoritative and document DB_HOST/ports for host-run processes. Production retains the Makefile's explicit `.env.prod` selection and deployment-injected environment option. Keep Caddy's variable-based domain configuration; no duplicate hard-coded domain needed.

### 5. Document and verify the fresh-project path

Update README, frontend/product READMEs, Make help, and owned operational documentation to show clone/copy → `make init` → review generated configuration → `make build && make up` → `make migrate`. Update package paths in the README tree and project guidance after rename. Explain that DB_NAME initializes a fresh database and cannot rename an existing database or recover old Compose volumes.

Add `scripts/tests/test_init_project.py` with isolated temporary repository fixtures and a `test-init` Make target. Keep bootstrap tests independent of Docker and application dependencies. Add one integration fixture copied from the actual current template, including relevant new source files, to detect inventory drift.

## Acceptance criteria and verification

1. `make init` and equivalent noninteractive Python invocation produce the same non-secret Acme configuration from fresh fixtures, requiring no application dependencies or running services.
2. `--dry-run`, invalid fields, package collisions, dirty target conflicts, existing environment conflicts, and cancellation leave file content and paths unchanged. No secret appears in stdout, dry-run output, examples, or the manifest.
3. Renamed code compiles/imports using `acme.settings.*`; project-owned references to `core` are gone from active code/scripts/config, while `django.core` remains intact. Test `core` as an explicit keep-package input too.
4. Successful reruns preserve secrets and are no-ops; a different identity is rejected without changes. Simulated apply failures restore original content/modes; interrupted-run journal handling is exercised.
5. Test a display name containing spaces, apostrophes, and ampersands and a hyphenated slug to prove JSON/Python/TS/env/metric serialization is correct; reject newline, shell syntax, invalid domains, reserved names, and path traversal inputs.
6. On a generated fixture, run `docker compose --env-file .env config --quiet` and `docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet`. Parse resolved config in-memory to assert matching DB credentials/name across services, separate project names, correct URLs, secret wiring, and unchanged internal service hosts; avoid printing resolved secrets.
7. With dependencies available, run Django checks and the backend suite after rename, then frontend tests, lint, typecheck, and production build. Run `make api-generate` and `make api-check` on the generated fixture; unexpected schema changes fail verification.
8. Build/start an isolated generated development stack with nonconflicting ports/subnets, migrate, and verify frontend metadata, registration/login, backend readiness, Celery worker/beat, and observable metrics with matching dashboard/alert queries. Stop only the fixture stack afterward.
9. Validate production Compose and Caddy syntax using the generated domain; production images must build with the renamed package. Verify the production entrypoint invokes collectstatic under `<package>.settings.prod`, and that collected admin/static assets are present. Do not deploy or claim DNS/TLS issuance is tested.
10. Add a residual-identity check restricted to owned active content: no stale Mobser branding, `starter_*` fixed container names, or stale project-package imports. Explicitly allow the internal telemetry identifiers listed above, upstream attribution, bootstrap source mappings/tests, historical documents, and unrelated third-party identifiers.

Implementation completion requires an independent verifier pass, with failures corrected before reporting success. Planning verification only checks coverage, references, and executability of this plan; it does not claim the future command works.

## Risks and mitigations

- Package rename misses an import string: explicit transform inventory, residual scan, compile/import checks, backend tests, and generated-stack smoke tests.
- Generated env values have no runtime effect: inspect resolved Compose settings and exercise DB/auth flows; dotenv load order is part of implementation scope.
- Rebranding breaks monitoring: rename metrics, alerts, dashboards, and owned links together; verify emitted names against queries.
- Existing data becomes inaccessible after project/DB renaming: v1 is initialization-only, has no migration/destructive commands, and documents fresh-volume behavior.
- Updates overwrite local work or secrets: fresh-copy scope, conflict preflight, dry run, staged rollback, restrictive permissions, and rerun marker.
- Excessive generator maintenance: standard-library command and bounded inventory now; postpone a separate cookiecutter/copier template distribution until repeated upstream syncing becomes a concrete requirement.

## External references

- [Docker Compose project naming](https://docs.docker.com/compose/how-tos/project-name/): project scoping and override precedence.
- [Compose interpolation and `.env`](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/): file selection and variable interpolation.
- [Container environment configuration](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/): explicit environment wiring is necessary for values consumed inside containers.
