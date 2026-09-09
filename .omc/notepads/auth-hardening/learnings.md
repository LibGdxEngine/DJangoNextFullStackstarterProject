
- Django auth uses persisted AuthSession families (`sid`, required `token_version`, `scope`). Refresh rotation serializes current generation/JTI under a PostgreSQL row lock and commits replay revocation before raising InvalidToken.
- User row locks and stale-version checks protect token issuance and sensitive mutations from creating/retaining sessions across concurrent credential changes. OTP failed-attempt writes must remain outside mutation rollback boundaries.
- Social users without verified phone receive only phone_onboarding scope: canonical GET auth:me and POST phone-change initiate/confirm. Other operations return 403 without destroying that session.
- This run's first PostgreSQL verification required test-only /tmp/mobser-auth-check harness because another workspace task temporarily imported unfinished rate-limit modules. No production fallback was added; final integration needs real limiter modules.

- Frontend credentials now live only in an AES-GCM Redis vault; the encrypted NextAuth cookie contains the independent vault ID and safe metadata, while session JSON exposes only an unrelated generation marker.
- Redis refresh leases alone do not prevent a spent-token retry after a crashed worker. Persist an encrypted in-flight marker before contacting Django, then atomically compare lock ownership and ciphertext when saving.
- NextAuth v4 swallows signOut event failures and clears cookies. The request-local wrapper must capture durable-denial failures and replace that response without Set-Cookie; never revoke before NextAuth validates its CSRF proof.
- Auth vault tests require AUTH_VAULT_TEST_REDIS_URL and use unique fixture IDs without flushing the shared database. Real Redis suite, frontend typecheck, lint, and production build passed.
- Final integration with real core.settings.test/core.urls and PostgreSQL passed all 68 accounts tests after composing the concurrent rate-limit refresh serializer with SessionTokenRefreshSerializer (the stock serializer would bypass session-family enforcement). Migration drift check passed without harness stubs.
