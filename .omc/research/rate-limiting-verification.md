# Rate-limiting verification — 2026-09-09

Implemented in the shared working tree; concurrent API contract, observability, authentication-vault/session and bootstrap changes were preserved.

## Executed checks

- Full Django suite with `core.settings.test`, PostgreSQL 16 and Redis 7: **196 tests passed**, 37.157 seconds. All integration tags included; no skips. Log: `/tmp/mobser-rate-final.log`.
- Foundation/identity suite: **28 passed**, including real Redis rolling windows, 80 concurrent admissions limited to exactly seven, multi-bucket atomic rejection, TTL behavior, outages, independent IP/user baseline quotas, status aliases and health exemptions. Log: `/tmp/mobser-foundation-tests.log`.
- Account suite: **98 passed**, followed by **11 focused policy/subject tests passed** after the final additions. The full combined suite includes those additions. Real PostgreSQL tests cover simultaneous OTP attempts, one-time consumption, resends, transaction-owner outcomes, HTTP errors and ATOMIC_REQUESTS. Logs: `/tmp/mobser-account-rate-tests.log`, `/tmp/mobser-account-wiring-tests.log`.
- Frontend: **64 tests passed**, including the credential-vault Redis integration tests with `AUTH_VAULT_TEST_REDIS_URL` supplied. ESLint, TypeScript and Next.js production build passed. TypeScript was rechecked after API regeneration.
- OpenAPI and TypeScript artifacts regenerated through the offline schema settings; API drift check passed afterward.
- Development and production Compose configuration validation passed. Configured production Django system checks passed without contacting Redis. Unit tests verify invalid production settings and absent/development webhook credentials prevent startup.
- Live Caddy 2.11.4 smoke test: **eight requests passed**, using two source IPs across direct API, NextAuth, BFF and frontend routes. Forged canonical/proxy/XFF headers were replaced and source IPs remained independent. Used an isolated Caddy instance with echo upstreams; no live application services were restarted.
- Browser build scan found no private ingress token setting or forwarding headers in static assets.
- `git diff --check` passed.

## Independent review

The reviewer accepted the frontend, foundation, account/OTP and webhook implementation. The production webhook check initially accepted development credentials and lacked startup integration; that finding was fixed and independently re-reviewed as ACCEPT. Final combined integration tests passed after correcting a health-test assertion to match the existing shared error envelope.

## Remaining deployment gates

This is local functional and concurrency evidence, not measured production capacity. Provision the two rate-limit secrets and credentials for each exposed webhook connection; verify provider retry behavior, Redis operational settings, alert thresholds and staging capacity. Run a real browser login/retry flow in the deployed topology before rollout. AI spending/concurrency controls and CDN filtering remain explicit future work. Existing recovery-response enumeration is documented as a separate contract follow-up. No production deployment or commit was requested or performed.
