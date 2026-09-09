# CI/CD on a shared VPS

This repository uses GitHub Actions to test changes, publish immutable application
images to GHCR, and deploy an isolated Docker Compose application over SSH.

The configured test site is **https://mobser-test.2.24.9.126.sslip.io**. It shares
the VPS and its existing Caddy with other applications. Releases must never run
the legacy `docker-compose.prod.yml` on this shared host: that file owns public
ports and includes the optional full observability stack.

## Release flow

1. Open a pull request against `master`. The required `CI gate` covers backend
   tests and migration drift, frontend lint/tests/types/build, API contract drift,
   dependency checks, and deployment-controller tests.
2. After the checks pass, merge the pull request. The release workflow runs CI
   again on the merged commit, builds both production images, and tests those
   images together in an isolated runner stack.
3. The `Build and verify release` job publishes an immutable release manifest.
   Application images are selected by digest, never by `latest`.
4. The staging deployment job connects using a dedicated restricted key. It can
   request only `deploy <run_id> <run_attempt>` for the fixed test target.
5. The server independently checks GitHub run/job/artifact identity, the source
   SHA, image repository/digests, installed runtime configuration hash, and
   release ordering before changing containers.
6. Deployment backs up an existing database, applies forward migrations once,
   updates this application's services, and checks HTTPS readiness. The current
   release is recorded only after checks succeed.

Fork pull requests receive no deployment secrets. Image publication and deployment
are restricted to the trusted `master` release workflow. The SSH credential does
not grant an interactive shell, forwarding, general sudo, or Docker access.

## Repository configuration

The `staging` GitHub environment accepts deployments from `master` only.

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `VPS_HOST` | SSH host; currently `2.24.9.126` |
| Variable | `VPS_PORT` | SSH port; currently `22` |
| Variable | `VPS_USER` | Restricted account; currently `mobser-deploy` |
| Variable | `TEST_URL` | Public HTTPS origin for smoke checks |
| Secret | `VPS_SSH_KEY` | Dedicated Ed25519 private key |
| Secret | `VPS_KNOWN_HOSTS` | Pinned SSH host public key |

The workflow uses its short-lived `GITHUB_TOKEN` for the GitHub API and GHCR.
The server uses a temporary private Docker credential directory and removes it
after the operation. A personal GitHub token and a root SSH password are not
needed for routine deployments.

Enable the `CI gate` branch protection check on `master`, require the branch to
be up to date, and prohibit force pushes and branch deletion. `CODEOWNERS`
identifies the maintainer for workflow, deployment, and migration changes.
An agent must not bypass failed checks or remove tests to obtain a green result.

## Host ownership and runtime

| Path or resource | Owner / role |
| --- | --- |
| `/srv/mobser-test/` | Root-owned application deployment state |
| `/srv/mobser-test/runtime.env` | Runtime secrets; mode `0600` |
| `/srv/mobser-test/config.json` | Fixed deployment origin and capacity settings |
| `/srv/mobser-test/compose.yml` | Reviewed installed runtime definition |
| `/srv/mobser-test/gateway.Caddyfile` | Private application routing |
| `/srv/mobser-test/state.json` | Current/previous/candidate release and stage |
| `/srv/mobser-test/backups/` | Per-release PostgreSQL custom-format backups |
| `/usr/local/sbin/mobser-deploy` | Privileged, fixed-target controller |
| `/usr/local/bin/mobser-ssh-dispatch` | Forced-command SSH argument validation |
| `mobser-test` | Compose project; separate database/cache/media volumes |
| `mobser_test_edge` | Dedicated network between shared Caddy and app gateway |

Only the app gateway joins the edge network. PostgreSQL, Redis, workers, and web
applications remain on the project's private network. The gateway's host port is
bound to loopback only. The existing `search_caddy` continues to own 80/443 and
routes the test hostname to the unique `mobser-test-gateway` alias.

The shared Caddy configuration is a single-file bind mount at
`/root/home/ILM_SHAMELA/caddy/Caddyfile`. Administrative changes must preserve that
file's inode, back up the existing content, validate the complete configuration,
and use a graceful reload. Do not replace or recreate the shared Caddy container.
The Mobser edge-network ensure timer repairs its network attachment if that
container is recreated by its owning application.

Application updates do not edit Caddy, firewall rules, network definitions, or
host deployment scripts. Changing `deploy/compose.yml` or
`deploy/gateway.Caddyfile` requires an administrator to install the reviewed files
before the matching release can deploy. A configuration-hash mismatch is a
deliberate fail-closed condition.

The test runtime limits memory, CPU, processes, worker concurrency, and log size.
It disables OTEL export and does not start a second Grafana/Loki/Tempo/Prometheus
stack. The repository's existing observability configurations remain available
for a separately provisioned deployment.

## Migrations and recovery

Production container startup does not run migrations. The controller invokes one
named migration container under the deployment lock, with bounded execution and
database lock/statement timeouts.

Use expand/contract changes: introduce compatible nullable fields or new tables,
deploy compatible readers/writers, backfill separately, and retire old schema in
a later reviewed operation. The CI migration policy rejects destructive or
arbitrary migration operations cumulatively since the reviewed baseline
`b56dce1ce5b76aaaf2bf54b73e473609f30299a8`, including migrations from failed
releases. It permits only new `CreateModel`, `AddIndex`, and nullable or safe
database-default `AddField` operations. Changes or deletions to existing migrations
fail the gate. Advancing this baseline requires an explicit review of the host
schema and compatibility with the stored rollback release. A migration-policy check
does not replace review of business behavior or queued Celery task compatibility.

If migration or container rollout completion is uncertain, the controller quarantines
deployment. An administrator must reconcile pending Docker operations, running
container image selection, and database migration state before resolving the
quarantine; a retry or a higher workflow attempt does not clear it.

Root-only application rollback uses the stored previously verified release:

```sh
sudo /usr/local/sbin/mobser-deploy rollback
```

This restores application image digests, not database contents. The administrator
must confirm that the previous application still understands the current schema.
The highest accepted release number remains recorded, so CI cannot use a valid
historical artifact to bypass the administrator-only rollback boundary.

Never automatically restore a database backup after a failed release: it could
discard customer writes. To test a backup, restore it into a separate disposable
database and verify the expected records. Keep off-VPS copies for real customer
data; backups on the same VPS do not protect against loss of that VPS.

Do not use `make clean`, `docker compose down -v`, or host-wide Docker prune as
part of deployment or recovery. They can destroy persistent data or affect other
applications on this server.

## Test-site behavior and production promotion

The test site has independent signing keys and database credentials. Email is
discarded and external messaging/Google integrations are unconfigured. It does
not seed a public administrator account or known login password. Automated login
checks create temporary fixtures and remove them afterward.

Browser API calls use `/api`; server-side calls use the runtime
`BACKEND_API_URL`. NextAuth routes `/api/auth/*` reach Next.js before the general
Django `/api/*` route. HTTPS is terminated at the shared edge; backend services
have no public port. Secure cookies remain enabled.

For a customer-facing production instance, provision a separate target,
credentials, database, volumes, edge alias, hostname, backup destination, and
protected GitHub environment. Configure real mail/messaging and any required
authenticated media storage. Promote the tested image pair; do not rebuild it
with different browser API origins. Review fixed controller identifiers and
capacity limits for each cloned template rather than reusing this test target.

## Verification evidence

Use the workflow run for the exact commit and the host's current release manifest
as the source of truth. A successful image build alone does not demonstrate a
working deployment. Release acceptance includes HTTPS readiness, frontend/auth
routing, background-job heartbeat, data persistence, application rollback, backup
restore into an isolated database, and unchanged existing VPS applications.

CI provides a repeatable deployment gate. It cannot guarantee availability during
host failure, provider outages, expired credentials, or incompatible manually
applied schema changes. Investigate a failing gate rather than bypassing it.
