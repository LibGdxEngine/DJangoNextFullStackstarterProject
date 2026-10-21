# Imam Malek Academy deployment (malek.ic-mobile.tech)

Dedicated instance for **Imam Malek Academy / أكاديمية الإمام مالك** on the company VPS, served
through the company website's Caddy. It sits next to the preview (`deploy/preview/`,
`quran.ic-mobile.tech`) and shares nothing with it but the host and the company Caddy.

| Item | Value |
| --- | --- |
| Host | `root@168.231.116.193` (key auth) |
| Public URL | `https://malek.ic-mobile.tech` |
| State directory | `/srv/malek-academy/` (root, `0700`) |
| Compose project | `malek-academy`, gateway on `127.0.0.1:18100` |
| Edge network | `malek_academy_edge`, alias `malek-academy-gateway` |
| Company Caddy | container `mobser-prod-caddy-1`, Caddyfile `/opt/ic-mobile/current/caddy/Caddyfile` |
| Academy tenant | Organization slug `imam-malek`, created by `manage.py ensure_academy` on every deploy |

## Deploy or update

From the developer machine (Git Bash on Windows), on the `malek-academy` branch:

```bash
deploy/malek/push.sh
```

It ships the working tree as it is on disk (including uncommitted changes) to
`/srv/malek-academy/src`, runs `bootstrap.sh`, then `redeploy.sh <tag>`: build both images on
the host, back up the database, migrate, run `ensure_academy`, roll the services, check
readiness and run `caddy-ensure.sh`. Override the target with `MALEK_SSH=user@host`.

## Rollback

```bash
ssh root@168.231.116.193 /srv/malek-academy/rollback.sh
```

Restarts the application services on the previous image pair. It does not restore the
database; `backups/<tag>.dump` holds a `pg_dump` taken before each migration.

## Enabling email / WhatsApp delivery

`bootstrap.sh` writes `/srv/malek-academy/runtime.env` once, with random secrets, and leaves
delivery unconfigured (dummy mail backend, HireAgents pointed at a black hole). To enable it,
edit that file on the host (`EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`,
`EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, or the `HIREAGENTS_*` values), then rerun
`/srv/malek-academy/redeploy.sh <tag>` with the tag from `images.env`, or push again.
The file is never overwritten by later pushes.

## Company Caddy wiring

Same mechanism as the preview (see `deploy/preview/README.md`): a one-minute root timer
(`malek-academy-caddy-ensure.timer`) attaches the company Caddy to `malek_academy_edge` and
appends `caddy-site.caddy` (marker `# malek-academy`) in place. Unlike the preview, it validates
the combined Caddyfile inside the container *before* appending, so a bad block is never written.
