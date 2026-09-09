# Reusable rate limiting for Mobser

Date: 2026-09-09  
Mode: implementation plan; application implementation has not started.  
Status: accepted by independent review; implementation not started.  
Complexity: high, because identity crosses two ingress paths and OTP protection crosses Redis/Postgres transactions.

## Context and objectives

Protect authentication, registration, recovery and verification from repeated attempts and message abuse; provide a reusable API baseline and explicit policies for expensive operations. Preserve existing API contracts and provide useful retry feedback. Implement six dependent, reviewable phases. Numeric limits below are provisional operating defaults, not measured capacity or availability guarantees.

### Repository evidence

Line references describe the working tree inspected on this date; parallel API-contract changes are in progress, so reconcile with their current content before editing.

| Evidence | Implication |
|---|---|
| `backend/core/settings/base.py:123` configures DRF without default throttles; `:319` configures Django Redis cache, default database `/1`; `backend/core/settings/dev.py:43` falls back to LocMem | Add explicit policies and a real Redis path for distributed security controls; do not mistake local cache tests for distributed verification. |
| `backend/core/urls.py:35` exposes legacy JWT endpoints; `:40` and `:43` mount authentication through two prefixes; `backend/apps/accounts/api/urls.py:23` enumerates account routes | Cover every alias with operation keys independent of route spelling. |
| `backend/apps/accounts/api/views/auth.py:51` performs password authentication; `backend/apps/accounts/selectors.py:27` and `backend/apps/accounts/phone.py:5` define identifier lookup | Admission must precede password hashing and use matching normalization. |
| `backend/apps/accounts/services/signup.py:42` creates a user inside a transaction; `:52` creates its challenge; `:61` enqueues on commit | Reserve send capacity before either creation; preserve on-commit dispatch. |
| `backend/apps/accounts/services/password.py:23` resolves accounts, `:27` creates fresh challenges, `:44` conditionally returns a challenge ID | Resend-only limits are insufficient; existing enumeration via response shape must be tracked explicitly. |
| `backend/apps/accounts/services/verification.py:80`, `:97`, `:123`, `:145` read/update counters without locks | Existing five-attempt/five-resend/60-second rules need concurrency-safe enforcement. |
| `backend/apps/accounts/services/profile.py:44`, `backend/apps/accounts/services/deletion.py:14` create further OTPs; profile `:85` and deletion `:46` consume before checking ownership | All send callers need shared recipient admission; purpose/ownership must be checked before consumption under the transaction. |
| `backend/apps/accounts/services/profile.py:111` changes email without sending verification; `backend/apps/messaging/tasks/verification.py:42` already guards delivery idempotency | Support email as a reusable channel, without inventing a new email-verification endpoint or charging worker retries. |
| `backend/apps/accounts/api/views/verification.py:38` accepts generic verification and only applies signup-specific updates | Explicitly bind each confirmation operation to supported purposes; do not let the generic route consume phone-change/reset/deletion challenges. No new deletion route is part of this work. |
| `backend/apps/common/views.py:19`, `:34`; `backend/apps/common/urls.py:7`; `backend/apps/common/observability.py:31`, `:37` | Concurrent work has already made status read-only with sanitized dependency503/no-store and added liveness/readiness probes. Preserve and test this; do not redo it or add a task trigger. |
| `backend/apps/integrations/hireagents/webhooks.py:40`, `:60`, `:91`, `:108` | Webhooks have their own authentication and deduplication; generic anonymous limits must not starve them. |
| `backend/core/api_errors.py:19`, `:97`; `backend/core/schema.py:176` | Reuse `throttled`, the shared envelope and header-preserving DRF handler; extend schema rather than introducing another error format. |
| `frontend/src/lib/api/client.ts:3`, `:106`, `:117`; `frontend/src/lib/auth.ts:17`, `:72` | Add retry metadata to the shared client and cover both credentials and social transport; retain 401-only session invalidation. |
| `frontend/src/app/api/auth/[...nextauth]/route.ts:4`, `frontend/src/lib/api/server.ts:5`, `frontend/src/lib/api/auth.ts:9` | Request-scoped trusted identity belongs in the server transport and NextAuth configuration; no mutable global request context. |
| `docker-compose.yml:58`, `:128`; `docker-compose.prod.yml:135`; `caddy/Caddyfile`, `caddy/Caddyfile.dev` | Development exposes direct backend/frontend ports; production exposes Caddy. Direct API and NextAuth backend calls have different hop counts. |
| `frontend/src/hooks/useSystemStatus.ts:43`; `frontend/src/features/auth/components/LoginForm.tsx:26`; `frontend/package.json`; `Makefile:123` | Update actual feature/transport code, test with Vitest, and regenerate/check both OpenAPI artifacts. |

## Scope and guardrails

**Must have now:** Redis-backed ordinary DRF limits; a small atomic admission helper for auth/send/expensive policies; tested trusted IP transport; complete route/method coverage; shared recipient budgets; concurrent OTP correctness; consistent 429/503 responses; frontend retry behavior; read-only public health; webhook isolation; rollout controls, metrics and operational documentation.

**Must not have:** authentication or tenant-authorization replacements; a general policy engine; permanent account lockouts; raw email/phone/token keys or metrics; cache-wide clear/flush; new database tables/migrations without a demonstrated need; new email-verification/deletion/AI/diagnostic routes; an AI billing subsystem; a custom Caddy build or CDN deployment; automatic frontend replay of credential/message/mutation requests.

**Future work, specified but not implemented:** AI admission requires validated organization membership, independent user/organization request quotas, token/cost reservation before dispatch and reconciliation afterward, bounded input/output/provider spend, idempotency, concurrency leases with expiry/release, queue backpressure and cancellation accounting. No AI endpoint launches until these are implemented and verified against its provider. General rate counts cannot enforce spend. CDN/Caddy traffic filtering is a later outer layer with its own trusted-proxy tests; it must not replace application identity or resource budgets.

**Existing adjacent issue:** forgot-password response includes `challenge_id` only for an eligible account (`password.py:44`). Record a separate recovery-contract follow-up; do not claim enumeration is solved or silently redesign the recovery UI here. Avoid adding a new eligibility signal through recipient throttling: recipient-only denial returns the existing generic forgot-password response with no send; IP/identifier request limits apply identically before lookup and may return 429. A limiter outage returns the same sanitized 503 on this operation before eligibility lookup. Verify these semantics explicitly.

## Endpoint and method policy

`AUTH/` means **both** `/api/v1/auth/` and `/api/accounts/`. Every table row applies to every matching alias. Every independent bucket must pass. Baseline is 60/minute/anonymous IP and 300/minute/authenticated user across ordinary APIs. Explicit endpoint adapters must deliberately compose that baseline; setting `throttle_classes` replaces DRF defaults. Auth IP limits apply even when a caller attaches valid credentials.

Atomic periods are `(limit, window_seconds)` values; do not put unsupported strings such as `5/15min` into DRF rates. Initial login policy counts **all admitted login attempts**, successful and failed: it is deliberately simpler than the prior illustrative failed-login escalation. Rejected requests do not extend cooldown. Outcome-aware progressive escalation is deferred.

| Method and endpoint(s) | Additional provisional limits | Charging, identity and behavior |
|---|---|---|
| POST `AUTH/login/`, `/api/token/` | 20/60s/IP; 10/900s/normalized identifier | Shared `login` operation. Legacy payload uses its real credential field, normalized through the same helper. Before password verification; no success reset. |
| POST `AUTH/signup/` | 5/3600s/IP | Plus shared recipient send budgets below; before user/challenge creation. |
| POST `AUTH/password/forgot/` | 10/3600s/IP; 3/3600s and 10/86400s/normalized submitted identifier | Both existing and nonexistent identifiers charged; actual destination also passes shared sends. Recipient-only rejection is suppressed as described above. |
| POST `AUTH/verification/resend/` | 10/3600s/IP | Resolve challenge, then shared destination send limits; retain max five resends/challenge and 60-second cooldown. |
| POST `AUTH/verification/confirm/`, `AUTH/password/reset/verify/`, `AUTH/phone/change/confirm/` | Shared confirmation budget 20/60s/IP; 20/60s/user where authenticated | Five actual attempts per challenge still enforced in Postgres across all routes, irrespective of Redis state. Purpose/ownership checks prevent cross-route consumption. |
| POST `AUTH/password/reset/` | 20/60s/IP; 5/900s/verified token subject | Validate token authenticity before trusting subject; never key on a raw token. Invalid token floods hit IP quota. |
| POST `AUTH/token/refresh/`, `/api/token/refresh/` | 60/60s/IP; 30/60s/verified token subject | One refresh operation across aliases. Never derive subject from unverified JWT claims; accommodates parallel tabs. |
| POST `/api/token/verify/` | 60/60s/IP | Dedicated token-validation policy; no raw JWT key. |
| POST `AUTH/social/<provider>/` | 20/60s/IP; 10/900s/verified provider+subject | IP admission before external verification; subject admission after verified identity, before user creation/token issue. No unverified claimed email/subject used. |
| GET `AUTH/social/providers/`, GET `AUTH/me/` | Baseline | Provider discovery and profile reads need no sensitive-operation quota. |
| POST `AUTH/logout/` | 60/60s/IP | Own operation, not blocked by login account budget; retain existing revocation behavior. |
| PATCH `AUTH/me/` | 30/60s/user | Ordinary profile update; no send admission. |
| POST `AUTH/password/change/`, `AUTH/email/change/`; DELETE `AUTH/me/`; POST `AUTH/phone/change/` | Shared sensitive-action 20/60s/IP and 5/900s/user | Before password checks or writes. Deletion and phone-change initiation additionally consume shared recipient send budget. Email change currently sends nothing. |
| All OTP creation/resend service calls, for WhatsApp or future email | **1/60s, 5/3600s, 10/86400s per normalized destination+channel** across purposes/routes | Shared budget includes signup, recovery, phone change, deletion and resends. A purpose-specific policy can only tighten it. Admission before DB writes/enqueue; workers never consume request/send budget again. |
| GET `/api/hello/`, `/api/common/hello/`; other ordinary public API methods | Baseline | Include schema/docs APIs and registered platform views; method exceptions require explicit inventory. |
| GET `/api/status/`, `/api/common/status/` | 30/60s/IP | Read-only, bounded health snapshot; no Celery enqueue. Use a separate lightweight internal liveness probe for orchestrators, outside user quotas. |
| GET `/api/health/live/`, `/api/health/ready/`; GET `/internal/observability/auth/` | Explicit operational exemptions from DRF user quotas | Existing Django views, not DRF: preserve liveness/readiness and private Grafana authorization semantics. Audit existing Caddy exposure, bounded readiness checks and internal auth restrictions; no exemption for unrelated routes. |
| POST `/api/v1/webhooks/hireagents/<connection>/` | Dedicated unauthenticated ingress 600/60s/IP; after provider authentication, 600/60s/configured connection for new events | Exclude ordinary anonymous/user baseline. Ingress runs first and may return 429/503 for any delivery, including a duplicate. After ingress passes, authenticate and acknowledge recognized duplicates without charging the new-work budget or enqueueing again. Invalid credentials cannot debit the trusted connection budget. Validate provider retry behavior before enforcing provisional throughput. |
| Future expensive endpoint | Reusable request policy default 5/60s/user; concurrency bound required when an actual job endpoint exists | Prove reusable admission through a test fixture now. Actual job launches require leases, release/expiry and queue backpressure; choose organization quota only after tenant membership validation. No unused diagnostic/job subsystem now. |

Where HEAD is already supported, it follows the corresponding GET admission without side effects. Preserve existing 405 behavior on views and operational probes that do not support HEAD; do not add method support as part of throttling. OPTIONS/preflight is exempt from per-operation business quotas and performs no work; coarse edge protection is deferred. Unsupported methods retain 405 behavior. Valid JSON with missing/malformed identifiers still hits IP admission; validation errors preserve their existing status and code.

## Technical design decisions

### Trusted client identity

Use a single explicit ingress contract, not a hardcoded `NUM_PROXIES` count:

- Caddy overwrites dedicated `X-Mobser-Client-IP` and `X-Mobser-Proxy-Token` headers on **both** frontend and backend upstreams. IP comes from Caddy's network peer for the current direct-edge topology, never a browser-supplied `X-Forwarded-For`. The token is a private, high-entropy environment secret shared only by Caddy and server processes.
- Django validates the token with constant-time comparison and parses the canonical IPv4/IPv6 address before using the forwarded identity. These headers and the secret must not enter responses, logs, browser bundles, or generated artifacts. In production only Caddy is publicly reachable; preserve the existing container boundary.
- NextAuth obtains and validates these headers per incoming request, through a request-scoped options factory/context that covers credentials **and OAuth callbacks**. `authApi`/server API wrappers accept this trusted server-only context and forward the same canonical identity. Do not store it on singleton clients or mutable module variables. Update any other NextAuth server callers to the same explicit context contract.
- Missing/invalid ingress provenance on protected production routes returns sanitized 503 before work. Ordinary reads can fall back to peer identity with a diagnostic metric, not trust unverified headers. Development direct mode is explicitly opt-in, uses a real socket peer where available and never trusts arbitrary headers; primary integration/browser tests run through Caddy. A direct NextAuth development request in App Router lacks a trustworthy socket peer: use a documented shared unknown-origin bucket only in explicitly relaxed development mode, preserving identifier/user/send budgets. End-to-end trusted-IP testing requires Caddy. This relaxation is prohibited in production.
- Treat the token as an internal ingress credential: document generation, coordinated rotation and redaction. Future CDN adoption must change the Caddy trusted-edge configuration and rerun spoofing/isolation tests before rollout.

DRF authenticates requests before running throttles. These controls do not provide pre-application DDoS protection or bound every Session/Basic/JWT authentication cost. Preserve protected endpoint authentication; any decision to disable irrelevant authentication on a public auth view must retain tested behavior. Prove login rejection occurs before body-credential password checking. Outer traffic protection remains future CDN/Caddy work.

### Reusable admission primitives

Add `backend/apps/common/rate_limits.py` for policy values, HMAC key derivation and atomic Redis admission; `throttling.py` for DRF adapters/composition; `client_identity.py` for trusted ingress parsing. These are small modules with no import-time network calls.

Ordinary DRF anonymous/user baselines use the configured Redis cache and are explicitly approximate under concurrency. Strict controls use the existing `redis` dependency through a lazily created client with connection/read timeouts, not private Django-cache internals. Configure a limiter URL/cache alias and versioned `mobser:rl:v1:` namespace; existing `/1` can be shared without flushing Celery cache/lock state. All processes use the same configured store. Validate production requires real Redis; local tests may inject an explicit test adapter, never silently downgrade enforcement to LocMem. Schema generation must run without database, broker, Redis or secrets.

Use an atomic sliding-window Lua operation for strict admission: Redis time, bounded sorted sets of admitted request IDs, expiry after the longest relevant window; prune expired entries, check all applicable buckets, then add to all only if accepted. Return the maximum wait among blocked buckets, rounded up to whole seconds. Tests must prove all-or-nothing debit within that helper and no boundary burst above the declared rolling-window cap. No locks implemented through separate GET/SET. Document standalone Redis assumption; a future cluster requires compatible key-slot design.

Identity dimensions are independent IP, normalized submitted identifier, verified account/subject, and destination/channel. Hash/HMAC sensitive identifiers (including IP) using a stable dedicated secret and version; bounded-length keys and TTL on every key. Use existing email lowercase/strip and phone normalization semantics; no provider-specific Gmail-style rewriting. Alias changes never create new operation scopes. An identifier budget covers that identifier, not a promise that unrelated email/phone aliases share one account bucket; stronger outcome-aware account mapping is deferred.

Attempt admission may remain consumed if later validation or processing fails; that is intentional abuse accounting. Send admission is consumed once before transaction writes and queueing, after request validation. Signup must reserve before `User.objects.create_user`; other callers reserve before challenge create/resend. Use one service orchestration point or an internal admission receipt so a caller and lower-level challenge helper cannot double-charge. Only trusted server code can supply such a receipt. Rejected sends create/update no user/challenge and enqueue nothing. If the following DB/queue operation fails, conservatively retain admission until TTL rather than unsafe refunds. Preserve existing message task idempotency across retries.

### OTP transaction boundaries

Apply `transaction.atomic()` and `select_for_update()` to challenge attempt/resend state. Hold the lock through purpose/ownership/expiry/consumed checks and state changes. A successful consume and its supported business state update commit together. Resolve lock ordering consistently when also locking user rows.

For incorrect codes, save the attempt increment and return a failure result from the transaction; map it to the existing validation error **after the owning outermost transaction commits**. Merely moving `raise ValidationError` outside an inner savepoint is insufficient if a caller's outer transaction rolls back. Audit all callers and any `ATOMIC_REQUESTS` behavior, using service outcomes across outer boundaries. Verify failed increments survive real HTTP error handling and nested caller transactions. Never weaken five attempts, five resends or 60-second cooldown. Concurrent resends cannot bypass either the row cap or destination budget; reset attempts only for an admitted new code. Do not introduce a deletion confirmation endpoint as part of locking this service.

### Errors, outages and privacy

429 remains `error.code = "throttled"` in the existing envelope, with HTTP `Retry-After` and a numeric `error.context.retry_after_seconds` if needed for NextAuth transport. Preserve existing business codes, authentication headers and the current 429 regression test. Use sanitized `503` / `rate_limit_unavailable` for protected limiter failures with a short bounded retry hint; never misreport infrastructure failure as exhausted quota. Schema documents both statuses and retry metadata/header.

Strict auth/message/expensive policies and baseline mutations fail closed on unavailable/invalid Redis admission. Ordinary read-only baselines fail open with a metric. Health reports sanitized dependency state instead of exception strings. Both webhook ingress and new-work admission fail closed with 503 so the provider can retry. A duplicate bypasses only the new-work quota after ingress has passed; it can still receive ingress429/503, including during a total Redis outage. Do not create rows or enqueue after failed admission. Ensure exception handling does not accidentally convert these failures to 400 or 500.

Expose only low-cardinality policy/outcome/route-template metrics: allow, reject, would-reject, limiter-error, fallback, latency. Never include identifiers, IPs, tokens, secrets, challenge IDs, or arbitrary paths in metric labels. HMAC keys still require bounded retention. Redis restart/eviction loses counters: document that these limits are not durable spending guarantees; retain independent DB OTP counters and provider delivery/spending safeguards. Configure capacity monitoring and an explicit memory/eviction posture before production enforcement.

## Task flow: six implementation phases

Every phase is a reviewable PR-sized change with tests. Shared contract/settings files have one integration owner; workers are not alone in this working tree and must preserve concurrent API-contract work. Parallel work is allowed only on explicitly disjoint owned files, and dependent phases wait for the referenced interfaces.

### 1. Establish trusted identity and reusable limiter foundation

**Depends on:** current API-error work reconciled; no previous phase.  
**Owner/files:** platform/ingress owner: new common rate-limit/identity/throttle modules and tests; `backend/core/settings/{base,dev,prod}.py`; both Compose/Caddy configurations; `.env.example`, `.env.prod.example`; request-scoped NextAuth route/options and server wrapper plumbing, coordinated with frontend owner. Read `frontend/AGENTS.md` first.

Implement ingress contract, lazy Redis helper, named settings, environment modes, typed outcomes and production configuration checks. Keep ordinary rates in valid DRF notation and strict periods explicit. No external traffic enforcement until identity tests pass.

**Acceptance:** two different clients keep distinct IP buckets through both paths; simultaneous NextAuth requests cannot leak context; spoofed forwarding/custom headers cannot select another IP; IPv4/IPv6 and missing identity tested; strict rolling-window admission is exact under concurrent Redis clients; denied multi-bucket checks debit no bucket; TTL/wait/reset tested; no cache flush; production rejects LocMem strict mode; schema imports work offline.

### 2. Apply endpoint policies and complete alias coverage

**Depends on:** phase 1.  
**Owner/files:** accounts API owner: `backend/apps/accounts/api/views/{auth,verification,profile,social}.py`, `api/urls.py`, new local JWT view adapters if needed, `backend/core/urls.py`, accounts/common regression tests; platform owner integrates central settings and error classes.

Compose defaults with operation policies from the table; replace bare SimpleJWT route views with behavior-preserving adapters. Add admission before password/provider/token work at the correct verified-identity boundary. Inventory registered routes/methods so all public/sensitive APIs have a policy or documented exemption. Attach reusable expensive policy only to existing work-producing actions.

**Acceptance:** parametrized tests exhaust each policy through alternating aliases; attaching authentication cannot bypass auth IP limits; normalized phone/email variations share identifier buckets; separate IPs still hit identifier limits; missing/malformed identity retains validation behavior and consumes IP admission; endpoint classes retain expected baseline; 429 wait uses the limiting bucket; all limits expire automatically; unknown/nonexistent account behavior is covered; existing success payloads/business codes remain intact.

### 3. Enforce service-level sends and serialize OTP state changes

**Depends on:** phase 1; coordinate phase 2 view integration.  
**Owner/files:** account service owner: `services/{verification,signup,password,profile,deletion}.py`, their tests, verification view orchestration where needed; messaging tasks/tests only for admission/idempotency integration; models unchanged unless proven necessary.

Move common send admission to the service path used by every create/resend caller. Reserve signup delivery before user creation. Preserve on-commit dispatch and worker retry semantics. Implement locked challenge transitions and successful consume/business action atomicity; return failure outcomes across owning transaction boundaries before raising public errors. Close generic confirmation purpose bypass without adding product flows. Preserve recipient-only forgot-password suppression.

**Acceptance:** with real Postgres and Redis, 20 simultaneous wrong-code attempts yield exactly five counted attempts and no success; two simultaneous valid confirmations apply the supported side effect once; wrong owner/purpose cannot consume a challenge; racing resends produce at most one accepted send inside the cooldown and never exceed five/challenge; alternating creation/resend/purposes routes cannot exceed destination limits; failed HTTP attempts persist their DB increments, including outer transaction tests; rejected signup creates no user; all rejected sends leave challenge state/queue untouched; transaction rollback sends nothing and retains conservative Redis debit; duplicate worker delivery does not charge or send twice under the existing idempotency contract.

### 4. Preserve operational health and isolate webhook admission

**Depends on:** phase 1; phase 2 baseline contract.  
**Owner/files:** common/integrations owner: `backend/apps/common/{views,urls,observability,health}.py` only if policy integration needs changes, health/expensive-policy fixture tests, `backend/apps/integrations/hireagents/webhooks.py` and tests; frontend owner updates `useSystemStatus`/`SystemDiagnostics` in phase 5.

Preserve the already-landed non-enqueueing status GETs, sanitized dependency503 responses and no-store headers. Preserve `/api/health/live/`, `/api/health/ready/` and private observability authorization as explicit operational exemptions; verify existing exposure and bounds. Prove expensive-operation admission with a fixture that asserts rejected work is never called; do not add a production endpoint or concurrency subsystem without an existing caller. Explicitly override global throttles for webhook ingress, then authenticate, detect duplicates, and apply per-connection admission only for new work. Both admission stages fail closed. Preserve retry/deduplication behavior. Add a production configuration/exposure check requiring each enabled webhook connection to have at least one nonempty API key or signing secret; configuring neither must fail that check, because the current view conditionally skips both validations.

**Acceptance:** repeated or automatically mounted status GETs enqueue zero tasks; health dependency failures retain503/no-store; future-expensive policy fixture rejection invokes no work; production checks reject enabled webhook connections with neither credential; invalid webhooks cannot consume connection budget; duplicates that pass ingress acknowledge without a second task or a new-work debit; ingress quota/outage returns retryable 429/503 for duplicates and new events alike; new-work quota rejection creates no event/task; consuming ordinary public quota cannot block webhook delivery or internal liveness.

### 5. Integrate retry UX and regenerate API contracts

**Depends on:** phase 2–4 response shapes and phase 1 request context.  
**Owner/files:** frontend/contract integration owner: `frontend/src/lib/api/{client,auth,server,system}.ts`, relevant transport tests, `frontend/src/lib/auth.ts`, NextAuth route/context types, `frontend/src/features/auth/components/LoginForm.tsx` and other affected auth forms, `useSystemStatus`/`SystemDiagnostics`; `backend/core/{api_errors,schema}.py`, backend contract tests, `backend/openapi.json`, `frontend/src/lib/api/generated.ts`. Reconcile current files instead of assuming earlier raw-fetch helpers still exist.

Parse `Retry-After` seconds or HTTP date into bounded retry metadata; preserve status/code/fields/context. Propagate through credentials and OAuth failures using a safe typed/allowlisted NextAuth error mapping. Display a useful temporary wait in login/signup/recovery/verification/sensitive-action forms; retain the form state, and enable submission after expiry. A backend 429 is authoritative; UI countdown is assistance. Preserve the current read-only system-status/heartbeat UI introduced by concurrent work; do not restore the removed task trigger. Include 503 UX. Expose `Retry-After` through configured CORS where cross-origin callers are supported.

**Acceptance:** Vitest covers 429/503, missing/malformed/date/seconds retry header, NextAuth mapping and no context crossover; 429/503 never clear a valid session or trigger 401 refresh/logout behavior; no automatic mutation/send replay; UI shows bounded countdown/recovery without losing typed input; social rejection does not create a session; route/context secrets absent from client bundle and error URLs; system diagnostics mount and explicit heartbeat check only read; shared envelope/business codes remain unchanged; generated contract artifacts are clean and reproducible.

### 6. Verify integration and stage enforcement with an operational runbook

**Depends on:** all earlier phases.  
**Owner/files:** verification/operations owner: focused integration tests, project documentation/runbook and configuration examples; integration owner resolves fixes in original ownership lanes.

Run production-like Postgres/Redis tests, backend suite, frontend transport/lint/type/build checks, contract checks and browser paths through Caddy. Perform controlled load using tiny isolated test limits. Document policy tuning, secret rotation, Redis sizing/failure behavior, alerts and a deployment matrix. Observe mode has a separate namespace from enforcement to avoid double-charge/counter contamination. Security/send policies must be enforced before affected exposure; ordinary baseline can observe first. Do not use the existence of a flag as authorization to bypass security in production.

**Acceptance:** all verification below recorded with commands/results; no pending review findings; zero missed alias/method policies; no user-specific metric labels; can distinguish 429 from limiter 503; production configuration passes checks; a controlled load proves at most configured strict admissions and no rejected side effects; independent reviewer approves plan implementation evidence; rollout/rollback instructions tested in staging; AI/CDN deferrals are explicit in documentation.

## Verification commands and evidence

Planning only: **none of these checks have been run for an implementation in this turn**. Test names below are proposed modules to add in phases 1–4; use their final implemented names if adjusted.

Use an isolated test stack/database and unique limiter key namespace. Never `FLUSHDB`, `FLUSHALL` or `make clean` against shared services. Concurrency tests require Postgres `TransactionTestCase`, independent DB connections and a real shared Redis; assert these prerequisites or fail clearly instead of silently skipping in CI.

```bash
make check
docker compose exec backend python manage.py test apps.common.tests.test_rate_limits apps.accounts.tests.test_throttling apps.accounts.tests.test_verification_concurrency
docker compose exec backend python manage.py test apps.accounts.tests apps.common.tests
make test-backend
make api-generate
make api-check
```

From `frontend/`:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

`make test-frontend` currently runs lint only; it does not replace the frontend commands above. `make api-generate` must preserve broker/database/Redis-free schema generation and include both generated artifacts (`Makefile:123`, `scripts/api-contract.sh`).

Required recorded scenarios:

- **Unit/contract:** threshold and TTL, exact sliding window, independent bucket composition, alias normalization, valid/invalid JWT identity boundaries, validation before side effects, header rounding/parsing, exact existing error envelope and 429 header retention, no secret/PII in keys/log labels, OPTIONS/HEAD/405 handling.
- **Postgres + Redis concurrency:** multi-process shared counters; all-or-nothing admission; attempt/resend/success races; persisted failed increments through real view handling and outer transactions; destination sharing across fresh challenges and purposes; no dispatch on rollback or denial; existing worker idempotency and retries; future concurrency-lease launch criteria remain documented.
- **Outage:** Redis refusal/timeout/script error; strict auth/send/write/expensive 503 before work; generic read fallback plus metric; forgot-password outage independent of eligibility; webhook ingress503 on both duplicate and new deliveries, followed by correct acknowledgement/deduplication after recovery; limiter key loss does not reset DB challenge limits.
- **Browser/ingress:** Caddy direct API plus NextAuth credentials and OAuth; two client identities and concurrent requests; spoofed headers; login wait and retry; registration/forgot/resend recovery; phone/deletion initiation denial; valid session survives429; public status mount enqueues nothing; read-only heartbeat check; cross-origin retry header visibility where configured.
- **Observability/load:** representative staging traffic with per-policy allow/reject/error metrics; record p95/p99 added admission latency and maximum accepted strict requests in a window. Set deployment timeout/latency alert thresholds from measured staging results before enforcement; no numeric capacity claim without evidence. Monitor shared-NAT rejection rates, message volume, Redis memory/latency/eviction/restarts and webhook retries.

## Failure modes, rollout and rollback

| Failure | Prevention/detection | Rollback or response |
|---|---|---|
| Every NextAuth login shares one proxy IP, or forged IPs evade controls | Shared ingress contract, two-path isolation/spoofing tests and missing-provenance metrics gate strict IP enforcement | Correct/redeploy trusted context; retain identifier/recipient and DB OTP controls. If provenance cannot be trusted, stop the protected action with503 rather than silently opening it. |
| Shared NAT or automation hits provisional limits | Separate identifiers/users from IP, short expiries, observe ordinary traffic and inspect aggregate reject rates | Raise the particular environment-configured limit with recorded rationale; retain tighter independent dimensions. No global throttle-disable switch. |
| Redis outage, eviction or restart undermines protection | Explicit per-policy failure behavior, memory/error/restart metrics, independent DB attempt counters | Fail closed protected work; restore Redis/config; ordinary reads remain available. Counter reset is documented, not advertised as a durable spend limit. Never clear shared cache to recover. |
| OTP failure increments roll back or two requests consume once-only state twice | Owning transaction outcome design, row locking and real Postgres races | Stop affected verification action; revert transition change only to an independently reviewed safe version. Keep Redis admission and avoid reopening concurrent consumption. |
| New challenge or worker retry bypasses/double-charges sends | One service admission across callers; reserve before writes; existing delivery idempotency | Revert orchestration to the last verified implementation while blocking sends if necessary; do not refund counters or flush them blindly. |
| Public status or webhook policy creates a task flood/retry storm | GET no enqueue, expensive policy fixture, own provider budget, deduplication tests | Keep operational reads side-effect-free; raise provider-specific quota after authenticated retry analysis; preserve public baseline isolation and deduplication. |
| Contract or NextAuth regression hides retry reasons or logs users out | Shared client/envelope, generated schema, Vitest/browser tests | Revert presentation/transport mapping independently while retaining server enforcement and HTTP429/Retry-After. Coordinate proxy-token changes across all server roles. |

Deploy foundation and ingress validation first, then endpoint/service controls as one coherent release once phases 2–5 pass integration. Do not leave only some aliases enforced. Start ordinary baselines in observe mode for a defined staging/production traffic sample, review rejection/latency/NAT metrics, then enforce per policy. Auth/send/expensive-operation protection is enforced at launch of that release; a staging-only observe test is not production protection. Record chosen rates and mode in deployment notes. Rollback is policy-specific/configuration-first and preserves DB security controls; schema changes and migrations are not expected.

## Completion checklist

- [x] Independent review accepted this plan.
- [ ] Six phases implemented with coordinated file ownership and no overwritten concurrent contract work.
- [ ] All table endpoints, aliases and methods have tested policy coverage or explicit exemption.
- [ ] Canonical identity is trustworthy through Caddy and NextAuth; private ingress token is server-only.
- [ ] Real Redis enforces strict atomic limits; ordinary DRF approximation is documented.
- [ ] Every send is admitted once before writes/enqueue; OTP races and outer-transaction rollback tests pass.
- [ ] Shared error codes/envelope,429 header,503 behavior and frontend recovery pass tests.
- [ ] Public health enqueues nothing; operational exemptions, reusable expensive policy and provider webhook policies work.
- [ ] Both generated artifacts committed; API drift check, backend and frontend checks pass.
- [ ] Staging load, outages, spoofing and browser checks have recorded evidence and independent verification.
- [ ] Runbook, policy modes/rates, metrics, secret rotation and rollback are documented.
- [ ] AI/CDN launch criteria and existing recovery-enumeration follow-up remain visible; no claim these are implemented.

## Decisions to carry forward

Paths for newly introduced modules and tests in this document are proposed. No product preference blocks this plan. Provisional rates are recommended implementation defaults, then tuned from evidence. The next implementation request can use this document directly; no application changes have been made by this planning task.

Before production rollout, record these operational decisions in the runbook: ingress secret provisioning/rotation owner; actual proxy topology; Redis memory, eviction and restart posture; measured limiter latency and connection/read timeouts; and HireAgents retry/backoff behavior for429/503. These are deployment gates, not reasons to delay building and testing the implementation locally. The separate recovery-contract follow-up must decide a uniform challenge response and verification behavior for eligible, ineligible and suppressed requests; this plan does not claim to fix existing enumeration.

## Primary technical references

- [DRF throttling](https://www.django-rest-framework.org/api-guide/throttling/): supported hooks, cache configuration, request identity and the built-in concurrency limitation. The strict helper above is a project design decision, not a guarantee of the built-in throttles.
- [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy): upstream header control and trusted proxy handling. The shared private-token ingress contract above is the selected Mobser design.
- [Redis rate limiter](https://redis.io/docs/latest/develop/use-cases/rate-limiter/): distributed admission and atomic scripting.
- [Django row locking](https://docs.djangoproject.com/en/5.2/ref/models/querysets/#select-for-update): transaction requirements and real transaction testing for locks.
- [OWASP resource consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/): resource and provider spending controls supporting the future AI launch requirements.

## Review changes

The separate review clarified that webhook duplicates bypass only the connection new-work budget, added a production credential check, preserved unsupported HEAD behavior, removed an unavailable handoff command, and incorporated the concurrent read-only health and frontend API-contract changes. Application tests are specified above and remain implementation work.
