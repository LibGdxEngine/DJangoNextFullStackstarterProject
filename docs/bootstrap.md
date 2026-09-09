# Initializing a new SaaS

`make init` wraps `python3 scripts/init_project.py`. Run it once in a fresh clone or
copy, before adding local environment files or editing template files. It requires
Python 3.10+; Django, Node, Docker and Git are not needed to initialize a copy.

The command separates the display name, slug, Python package and database name.
The domain is a bare hostname such as `acme.com`, without a scheme, port or path.
Package and database defaults replace slug hyphens with underscores. The display name
can contain spaces, apostrophes and ampersands. Use `--help` for the full interface.

## Environment files

Root `.env` is the development configuration used by Compose and direct Django runs.
Root `.env.prod` is selected by production Make targets. Each file receives separate
random Django, NextAuth, OTP, database and rate-limit secrets and should stay out of Git. Example
files contain placeholders, and `.bootstrap.json` contains only the selected identity.

Compose explicitly passes the configured values to each service. Host-run Django
processes need a reachable `DB_HOST` (usually `localhost`) and the published database
port instead of the internal `db` hostname. Explicit process environment values take
precedence over dotenv values. Configure Redis endpoints similarly when running workers
outside Docker. Production Caddy consumes `DOMAIN_NAME`; development keeps localhost.

The default Compose projects are `mobser-dev` and `mobser-prod` before initialization.
The initializer substitutes the new slug. Existing deployments can retain their old
project name via `docker compose -p ...` or `COMPOSE_PROJECT_NAME`. Fixed container
names are no longer used. Project-name changes select different volumes; they do not
move data. Plan an explicit migration separately for an existing deployment.

## Preview and recovery

`--dry-run` previews changes without writing files or generating secrets. Applying in
a noninteractive shell requires all four identity values and `--yes`. Existing `.env`
or `.env.prod` files, unexpected template markers, symlink targets and dirty target
files are conflicts. Preserve those files separately or start from a fresh copy.

The initializer stages changes, records recovery information, and rolls back ordinary
write or rename failures. An interrupted operation leaves a recovery journal; the next
run stops and identifies it. Follow the recovery paths reported by the command. Keep
the interrupted copy, including its recovery directory, until its original files have
been restored or a fresh copy has been verified. Do not delete the journal and rerun
against partially transformed files. There is no force-overwrite or rebranding mode.

For manual recovery, `.bootstrap-journal/recovery.json` records each original path,
its numbered backup (or `null` when the file was newly created), its original numeric
permission mode, and planned source/destination moves. Work from a copy of the
interrupted directory. First undo completed moves in reverse order: move the destination
back only when the destination exists and the original source does not. Then restore
each numbered backup to its recorded original path and restore its permission mode;
remove a recorded path only when its backup is `null` (it did not exist originally).
If both sides of a move exist, or a required backup is missing, stop and recover from
your original clone instead of guessing. Verify the restored files before removing
the journal. A fresh clone is also a valid recovery path; preserve any unrelated
work from the interrupted copy separately.

## Verification

`make test-init` runs the standard-library test suite against temporary copies and
does not initialize this checkout. After initializing a fresh copy:

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet
make build && make up
make migrate
make check
make test-backend
make api-check
```

For frontend checks, install dependencies with `npm ci` in `frontend`, then run
`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. Verify the
homepage, registration/login, readiness, workers and monitoring in the generated app.
Production image and Caddy validation do not prove that DNS or TLS issuance is ready.
