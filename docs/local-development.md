# Local development

The Arabic homepage is served at **http://localhost:8080**. The frontend runs `next dev` in Docker with the repository bind-mounted, so saving frontend files refreshes the page automatically. Django also runs its development server.

This checkout uses a local Compose overlay because another local app occupies port 80 and the original telemetry subnet. Existing services and their data are left intact.

```bash
# Run from the repository root. Build only when dependencies change.
docker compose -f docker-compose.yml -f .omc/dev-compose.override.yml up -d

# Inspect and follow development services.
docker compose ps
docker compose logs -f frontend backend

# Stop this development stack without deleting its data.
docker compose -f docker-compose.yml -f .omc/dev-compose.override.yml stop
```

Use port 8080 for browser flows, including authentication. Port 3000 is the direct Next development server; the proxy on 8080 supplies the trusted request headers required by the existing authentication and API configuration.

Registration uses the existing WhatsApp verification contract. Sending a real verification message requires a configured messaging integration. The built-in development provider can mock dispatch without delivering a message. The homepage animation is an illustration; the OCR upload/results interface is separate work and is not presented as available on the account page.

The contact section accepts a configured contact address when available; no fictional email or team identities are supplied.

To add a real contact channel, set `NEXT_PUBLIC_CONTACT_EMAIL` in `frontend/.env.local`, then restart the frontend container. Use the real project address; this value is intentionally public.

Verification completed: frontend lint/typecheck/production build, all 66 frontend tests (including the Redis vault suite using a separate Redis database), backend system checks and three authentication API tests, and `make api-check`. Browser checks cover Arabic RTL, 360/768/1440 widths, navigation, animation pause/reduced motion, local login/signout, and observed hot reload.
