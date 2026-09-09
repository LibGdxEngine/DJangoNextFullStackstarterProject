# Authentication and session lifecycle

The browser authenticates to Next.js with an encrypted HttpOnly NextAuth cookie.
Next.js holds Django credentials in a private Redis vault and sends access tokens
to Django on the server. Django is the authority for user eligibility, session
expiry, refresh rotation, and revocation.

```mermaid
sequenceDiagram
    participant B as Browser
    participant N as Next.js / NextAuth
    participant R as Private Redis vault
    participant D as Django / PostgreSQL
    B->>N: Sign in (NextAuth CSRF protocol)
    N->>D: Credentials or verified provider token exchange
    D-->>N: Access + refresh JWTs for a new session family
    N->>R: Store encrypted credentials and absolute expiry
    N-->>B: HttpOnly encrypted cookie containing session reference
    B->>N: Same-origin /api/bff request + cookie
    N->>R: Read credentials; lock session if refresh is needed
    opt Access token near expiry
        N->>D: Refresh current generation
        D->>D: Lock family, consume generation, rotate atomically
        D-->>N: New token pair (same absolute session limit)
        N->>R: Save only while lock owner and session still active
    end
    N->>D: Allowlisted API request + server bearer token
    D->>D: Check user, token version, family and expiry
    D-->>N: Domain response
    N-->>B: JSON response without Django credentials
```

## Storage and expiry

| Item | Storage and policy |
| --- | --- |
| Django access token | Server-only encrypted Redis record; 15-minute lifetime, capped at family expiry |
| Django refresh token | Same server-only record; rotated on use, never returned in NextAuth session JSON |
| Browser cookie | NextAuth encrypted JWT containing a random vault reference and safe metadata; HttpOnly, SameSite=Lax, Secure on HTTPS |
| Browser session JSON | User metadata and authentication state; no access token, refresh token, or vault credential |
| Absolute lifetime | Seven days from login; refreshing or reading the NextAuth session cannot extend it |
| Django session family | PostgreSQL record binding user, token version, current refresh generation and revocation state |

Each login creates a separate family. Logging out one family does not log out
other devices. Password reset/change and existing account security changes bump
the user-wide `token_version`, invalidating access and refresh credentials across
families. Tokens without the required session/version claims are rejected.

## Refresh, concurrency and reuse

Next.js refreshes before using a nearly expired access token. Redis coordinates
requests across Next.js processes; credentials are updated only by the current
lock owner and cannot be recreated after logout. PostgreSQL serializes refresh
generation changes independently of the frontend lock.

Reusing an authentic consumed refresh generation revokes its whole family. The
revocation is committed before returning the error. Both the successor refresh
token and already-issued access tokens then fail. External API clients must
serialize their own refresh requests: two concurrent uses of the same refresh
token are treated as reuse, not as two successful refreshes.

An uncertain refresh result cannot safely be retried with the old token. The
frontend denies that session and requests family revocation. Protected mutations
are not automatically replayed after a 401.

## Logout and outages

NextAuth signout denies the vault session and calls Django logout. Django revokes
the family, so access JWTs stop working on subsequent authentication checks;
requests already authenticated and executing are not retroactively cancelled.
Logout accepts an authentic consumed refresh token as revocation proof and is
idempotent.

If Django cannot be reached, local access remains denied and Redis retains an
encrypted pending revocation for the Next.js retry worker. Remote revocation is
not immediate during that outage. Keep the Next.js service running so pending
revocations can be retried. Redis is required; there is no process-local fallback.

If Redis cannot persist local denial, the NextAuth signout route returns 503 and
preserves the cookie; the UI reports that signout could not be completed. It does
not report successful logout while a copied cookie could become usable again
after Redis recovers.

## HTTP boundary and account policy

Browser domain calls use `/api/bff/`. The gateway allows specific methods and
paths, supplies its own backend Authorization header, refuses redirects, and
does not relay browser cookies or arbitrary headers to Django. Mutation requests
must pass trusted-origin and custom-header checks. NextAuth retains its own CSRF
protocol. Do not add token-returning Django endpoints to the gateway without
explicitly handling their credentials on the server.

Signup verification responses are sanitized by the gateway. Any token pair
minted by that response is stored and immediately revoked through the same
durable mechanism; users then sign in through NextAuth. The browser never adopts
the Django credentials from the verification response.

Caddy routes `/api/auth/*` and `/api/bff/*` to Next.js. Other Django API routes
remain available for non-browser API consumers and retain their explicit JWT
contract. Application components must use the browser domain wrappers rather
than call Django's token endpoints directly.

Password login, including the legacy `/api/token/` route, enforces phone
verification and account eligibility. DRF does not offer Basic/Session auth as
an alternative around JWT policy; Django admin retains its own session auth.
Social accounts awaiting phone verification receive only an onboarding scope
for profile inspection and phone verification, not ordinary application access.

## Configuration and rollout

Set these server-only variables on every Next.js instance:

- `NEXTAUTH_SECRET`: shared encryption secret for cookies and vault records.
- `NEXTAUTH_URL`: canonical browser origin, HTTPS in production.
- `BACKEND_API_URL`: private Django API base (Docker: `http://backend:8000/api`).
- `AUTH_SESSION_REDIS_URL`: private Redis URL shared by all frontend instances
  (Docker default: `redis://auth_sessions:6379/0`; host development: `redis://localhost:6380/0`).

The dedicated `auth_sessions` Redis service is separate from Celery and Django
cache, with a persistent volume and append-only persistence using `appendfsync
always`. Production exposes no host port; development exposes only loopback port
6380. An external Redis replacement must preserve acknowledged revocations and
in-flight refresh markers across restarts and failover; do not use an evicting
cache or restore old session backups into a live deployment. Changing `NEXTAUTH_SECRET` invalidates
cookies and makes existing vault records unreadable.

Apply the accounts session migration before starting the updated application,
install the updated frontend dependencies, and restart Next.js and the proxy.
Existing JWTs and NextAuth cookies from the former token-bearing architecture
require users to sign in again. Regenerate both API artifacts with
`make api-generate` after contract changes and verify with `make api-check`.

## Verification

Regression coverage must include session JSON token non-exposure, CSRF and path
restrictions, expiry, serialized refresh, logout during refresh, family reuse,
account revocation, and both normal and legacy login eligibility. PostgreSQL
tests exercise row-lock behavior; SQLite tests alone cannot prove it.

References: [NextAuth callbacks](https://next-auth.js.org/configuration/callbacks),
[NextAuth options](https://next-auth.js.org/configuration/options),
[SimpleJWT settings](https://django-rest-framework-simplejwt.readthedocs.io/en/stable/settings.html).
