# Preview deployment (quran.ic-mobile.tech)

Client-facing **demo** of the current working tree on the company VPS, served through
the company website's Caddy. It is not the CI test site and not customer production:
mail is discarded, OTP delivery is a black hole, and sign-in uses the demo code `123456`.

| Item | Value |
| --- | --- |
| Host | `root@168.231.116.193` (key auth) |
| Public URL | `https://quran.ic-mobile.tech` |
| State directory | `/srv/quran-preview/` (root, `0700`) |
| Compose project | `quran-preview`, gateway on `127.0.0.1:18090` |
| Edge network | `quran_preview_edge`, alias `quran-preview-gateway` |
| Company Caddy | container `mobser-prod-caddy-1`, Caddyfile `/opt/ic-mobile/current/caddy/Caddyfile` |

## Automatic deployment (GitHub Actions)

Every push to `master` runs `.github/workflows/preview.yml`: the full CI gate, then
`git archive HEAD` is streamed over SSH to the host, which unpacks, bootstraps and redeploys,
then the workflow smoke-checks `https://quran.ic-mobile.tech` and `https://ic-mobile.tech`.
Pushes are queued, never cancelled mid-rollout. **Run workflow** redeploys `master` on demand.
Only committed, pushed changes ship this way.

The workflow's SSH key is pinned in root's `authorized_keys` to a forced command:

```
restrict,command="/srv/quran-preview/ci-dispatch.sh" ssh-ed25519 AAAA... quran-preview-ci
```

`ci-dispatch.sh` accepts only `deploy <tag>` and hands stdin to `receive.sh`; there is no
shell, PTY or port forwarding. The deployed tree's `bootstrap.sh` and `compose.yml` still run
as root, so whoever can push to `master` controls the preview host: keep the `preview`
environment limited to `master`.

GitHub configuration (repository **Settings > Environments > `preview`**, deployment branch
`master` only):

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `PREVIEW_SSH_KEY` | Private half of the `quran-preview-ci` Ed25519 key |
| Secret | `PREVIEW_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 168.231.116.193` output, checked against the host |
| Variable (optional) | `PREVIEW_SSH_HOST` | Defaults to `168.231.116.193` |

To rotate the key, generate a new one, replace the `quran-preview-ci` line in
`/root/.ssh/authorized_keys`, and update `PREVIEW_SSH_KEY`.

## Manual deploy (working tree)

From the developer machine, with the tree you want clients to see checked out (including
uncommitted changes):

```bash
deploy/preview/push.sh
```

It tars the working tree (without `.git`, `node_modules`, `.next`, env files) and pipes it to
`receive.sh`, which unpacks it to `/srv/quran-preview/src` and runs `bootstrap.sh` (idempotent
host setup) and `redeploy.sh <tag>`: build both production images on the host, back up the
database, migrate once, roll the services, check readiness, and run `caddy-ensure.sh`. Expect
several minutes on 2 vCPU. The next push to `master` replaces a manual deploy.

## Rollback

```bash
ssh root@168.231.116.193 /srv/quran-preview/rollback.sh
```

Restarts the application services on the previous image pair. It does not restore the
database; `backups/<tag>.dump` holds a `pg_dump` taken before each migration.

## How the company Caddy is wired

`caddy-ensure.sh` (root systemd timer, every minute) attaches the company Caddy to
`quran_preview_edge` and appends `caddy-site.caddy` to the company Caddyfile **in place**
(the container bind-mounts that single file, so its inode must not change), then validates
and gracefully reloads. A company release recreates its Caddy from a new release directory,
dropping both; the timer repairs them within a minute. The durable fix is to carry the site
block and the external network in the company repository's `caddy/Caddyfile` and
`docker-compose.prod.yml`.

## Files

- `push.sh`: developer-side ship-and-deploy of the working tree.
- `receive.sh`: host-side unpack, bootstrap and redeploy of a tarball on stdin.
- `ci-dispatch.sh`: forced command for the GitHub Actions key.
- `bootstrap.sh`: host setup. Copies `deploy/compose.yml` and `deploy/gateway.Caddyfile`,
  generates `runtime.env` once with random secrets, installs the timer.
- `redeploy.sh`, `rollback.sh`: host-side release handling.
- `caddy-ensure.sh`, `caddy-site.caddy`, `quran-preview-caddy-ensure.{service,timer}`.
