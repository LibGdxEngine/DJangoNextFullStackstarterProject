# Bootstrap implementation verification — 2026-09-09

Implemented `scripts/init_project.py`, Make `init`/`test-init`, environment and Compose wiring,
early root dotenv loading, setup/recovery documentation, and regression tests.
The workspace retains `backend/core` and has no `.bootstrap.json` or `.bootstrap-journal`.

## Passed

- Final `make test-init`: 15 tests, including interactive cancellation/application, dry-run,
  validation and package collisions, Git conflicts, symlinks, rollback, secret permissions,
  repeated initialization, quoted display names, production collectstatic selection,
  dependency lock preservation, and real-template rename coverage.
- Independent code review: approved, no remaining bootstrap findings. Additional review
  approved the two missing optional lock entries; all existing lockfile entries were unchanged.
- Generated Acme development/production `docker compose config`: matching DB credentials,
  renamed settings packages, distinct project names, collector project-name propagation.
  Separate review confirmed explicit `-p` overrides still propagate correctly.
- Generated frontend: TypeScript, ESLint, 46 tests, and a production webpack build.
- Clean npm 10 install passed after adding only missing optional `@emnapi/core` and
  `@emnapi/runtime` lock entries (23 lines; no existing dependency upgrades).
- Final generated production Docker images both built successfully:
  `bootstrap-validation-prod-backend` and `bootstrap-validation-prod-frontend`.
- Production frontend container returned HTTP 200 and `<title>Acme</title>` on an
  ephemeral localhost port. The temporary container was removed afterward.
- Caddy production configuration validated with the generated domain; no deployment,
  DNS changes, or TLS issuance was attempted.
- `git diff --check` passed. Actual workspace `--dry-run` passed and reported existing
  modified/untracked targets without applying changes.

## Remaining application verification limitations

Concurrent authentication/rate-limit work is changing this shared repository.
The uninitialized source itself fails `manage.py check` with:

```text
ModuleNotFoundError: No module named 'core.settings.rate_limits'
```

The generated source has the equivalent missing `acme.settings.rate_limits` module.
The latest committed snapshot at the time (`b56dce1`) was also tested separately; it
failed because `apps.accounts.models.AuthSession` was not yet exported in that snapshot.
These failures precede application startup and prevent the backend suite, canonical
API regeneration/check, database migrations, end-to-end authentication, real worker/beat
smoke checks, and verification of collected static assets. The initializer's production
entrypoint selection is tested independently, but complete backend runtime success is
not claimed. Re-run those checks after the separate backend work is complete.

Final generated fixture used for Docker builds: `/tmp/mobser-bootstrap-final-bhznckdu`.
Build output: `/tmp/bootstrap-image-build.log`. Final bootstrap tests:
`/tmp/bootstrap-final-tests.log`. These temporary files may be removed by the host.
