# OCR gateway verification — 2026-09-09

Implemented `backend/product/ocr`, private upload validation, API keys and tenant
admission, asynchronous GPU processing, signed durable webhooks, deployment
services, and developer documentation. Existing unrelated workspace changes were
preserved. No production deployment or external GPU invocation was performed.

## Evidence

- 224 backend tests passed on disposable PostgreSQL 16, covering platform apps
  and OCR; integration-tagged external-service tests excluded. Command:
  `python backend/manage.py test apps product.ocr --settings=mobser_ocr_test_settings --exclude-tag=integration --noinput`.
  Temporary settings used schema defaults, isolated PostgreSQL and fast test
  password hashing; no deployment credentials were loaded.
- Three PostgreSQL concurrency tests proved global admission serialization,
  idempotent acceptance under races, and a single GPU invocation under competing
  task claims. Included in the broad run.
- 27 upload/parser/transport tests passed inside the production Docker image as
  its non-root user with `--network none --read-only --cap-drop ALL` and
  `--security-opt no-new-privileges:true`.
- Real ClamAV 1.4, using the committed `security/clamd.conf`, accepted clean
  input and a full 150,000,000-byte stream and rejected the harmless EICAR
  antivirus test signature as `unsafe_document`. Its configured health probe
  returned PONG.
- Production Docker build passed. Development and production Compose configurations
  validated with the OCR profile. Caddy 2.11.4 adapted and validated the production
  configuration with the upload upstream enabled.
- Isolated entrypoint smoke tests verified that the upload service waits for
  migrations without running them, the primary backend owns migrations/static
  collection, and Beat preserves its existing migration wait.
- `make api-generate` and `make api-check` passed using the isolated runtime.
  Both generated contract artifacts were updated.
- `npx tsc --noEmit`, migration drift check, and `git diff --check` passed.
- Independent security review approved the final code and deployment change;
  independently ran 18 parser/transport tests successfully. Review identified
  and confirmed fixes for parser filesystem/process isolation and large-upload
  worker timeouts. Runtime dependency audit found no known application dependency
  vulnerabilities at verification time.

## Limits

- The actual GPU endpoint, authentication and result schema were not supplied.
  The configurable adapter currently expects HTTPS multipart POST, optional bearer
  authentication and a bounded synchronous JSON result. No model accuracy or
  state-of-the-art claim was assessed.
- No ten-minute live model request, production load test, or external customer
  webhook was sent. Transport behavior uses controlled mocks; scanner and parser
  behavior were additionally tested against real local processes/containers.
- Capacity-full idempotent reuploads may return 429 because uploads still require
  bounded admission. Polling accepted jobs remains available; this tradeoff is
  documented in `docs/ocr-api.md`.
- Gateway validation reduces file risk, but the GPU service must independently
  isolate its decoder. Job/callback metadata retention and physical disk limits
  need deployment-specific policy.
