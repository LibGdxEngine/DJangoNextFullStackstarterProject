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

## Deploy or update

From the developer machine, with the tree you want clients to see checked out:

```bash
deploy/preview/push.sh
```

It tars the working tree (without `.git`, `node_modules`, `.next`, env files), unpacks it to
`/srv/quran-preview/src`, runs `bootstrap.sh` (idempotent host setup) and `redeploy.sh <tag>`:
build both production images on the host, back up the database, migrate once, roll the
services, check readiness, and run `caddy-ensure.sh`. Expect several minutes on 2 vCPU.

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

- `push.sh`: developer-side ship-and-deploy.
- `bootstrap.sh`: host setup. Copies `deploy/compose.yml` and `deploy/gateway.Caddyfile`,
  generates `runtime.env` once with random secrets, installs the timer.
- `redeploy.sh`, `rollback.sh`: host-side release handling.
- `caddy-ensure.sh`, `caddy-site.caddy`, `quran-preview-caddy-ensure.{service,timer}`.
