# Developer OCR API

Upload one PDF, PNG, or JPEG and receive a job ID. Django stores the file in
private quarantine and returns HTTP 202 after the upload completes. A dedicated
worker scans and validates it, calls your GPU endpoint, and records the result.
A separate worker delivers a signed completion webhook. The developer does not
keep an HTTP request open for the model's ten-minute processing time.

The implementation is in `backend/product/ocr`. The interactive contract is at
`/api/docs/`; Django generates `backend/openapi.json` and the frontend API types.

## Enable the deployment

OCR is disabled by default until the model and webhook signing key are configured.
Set these in the deployment's ignored environment file:

```dotenv
OCR_ENABLED=true
COMPOSE_PROFILES=ocr
OCR_UPLOAD_UPSTREAM=ocr_upload:8000
OCR_MODEL_URL=https://gpu.example.com/ocr
OCR_PROVIDER_KEY_ENCRYPTION_KEY=your-fernet-encryption-key
OCR_MODEL_FILE_FIELD=file
OCR_WEBHOOK_SIGNING_KEY=independently-generated-secret-at-least-32-bytes
OCR_WORKER_CONCURRENCY=1
```

Generate the signing master with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`.
Keep it stable and back it up securely. Each API key has a different derived webhook
secret. Rotating the master changes those secrets, including for pending events;
coordinate receiver updates before rotation. Revoking an API key does not stop
delivery of completion events for already accepted work.

For the provider credential pool, generate a separate encryption key with
`python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`.
Import the credentials as described in [Provider credential pool](ocr-provider-keys.md).
Keep this key stable and backed up separately from the database: losing it makes
the stored provider credentials unreadable. This environment value encrypts the
database; it is not an API key and is never sent to the OCR provider. Provider API
keys are selected from the database on every call, with no environment-token fallback.

Run `make prod-build` and `make prod-up` for the existing production stack. The
backend applies the OCR migrations, including the provider-pool migration `0002`,
through the existing entrypoint.
The upload service waits for those migrations instead of applying them concurrently.
PostgreSQL is required in production: admission, idempotency and task claims rely
on database row locks. Compose must support `extends` and the `!reset` tag used to
remove inherited development ports (Compose 2.24.4+).

The `ocr` profile adds:

| Service | Purpose |
| --- | --- |
| `ocr_upload` | Two Gunicorn processes with four threads each, dedicated to submission |
| `ocr_worker` | Scanning, document validation, and long GPU requests on the `ocr` queue |
| `ocr_webhooks` | Short outbound callback requests on `ocr-webhooks` |
| `clamav` | Private antivirus service with persistent, automatically updated signatures |

The existing general worker consumes the `maintenance` queue, and Celery Beat
recovers queued jobs, interrupted work and webhook attempts every minute. Run both.
Keep the scanner profile, `OCR_ENABLED`, and Caddy upstream setting in sync. No
ClamAV port is published. Reserve about 4 GiB for the scanner in addition to your
application, database and observability services. Do not expose Django's internal
port directly in production; Caddy enforces the upload request deadline and body cap.

All services processing sources share the `ocr_private` volume at `/app/private/ocr`.
It has no public route and is separate from media/static files. This filesystem
design supports one Compose host; use shared private storage or a dedicated object
storage upload/finalize flow before scaling workers across hosts.

## GPU adapter contract

Until the real model contract is supplied, `gpu.py` assumes:

- HTTPS `POST` to the server-configured URL, multipart file field `file` (configurable).
- Server-side bearer authentication using the next usable database key on each
  model request. The rotation position is persisted across workers and restarts.
- `Idempotency-Key: <job UUID>` forwarded to the model.
- A synchronous HTTP 200 response with `Content-Type: application/json` containing
  a JSON object or array, with a maximum response size of 20,000,000 bytes.
- At most 660 seconds waiting for a model response; no redirects or environment
  proxies. A dedicated task has a 1,000-second soft limit and 1,050-second hard limit.

Change this small adapter to match an upstream with different field names, auth,
response format or asynchronous jobs. Forwarding an idempotency header does not
prove the model supports it. Network timeouts or lost workers produce
`model_outcome_unknown` and are **not automatically resubmitted to the GPU**.
Exactly-once upstream work needs an upstream idempotency or reconciliation API.

## Developer API keys

An active, phone-verified organization owner or administrator uses their existing
session JWT to create a developer key:

```bash
curl "$BASE_URL/api/v1/ocr/keys/" \
  -H "Authorization: Bearer $SESSION_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"organization_id":"YOUR-ORGANIZATION-UUID","name":"Production OCR"}'
```

HTTP 201 returns `api_key` and `webhook_signing_secret` **once**. Store both securely
on your server. Only a digest of the random API-key secret is stored in Django.
Keys expire after 90 days by default. `GET /api/v1/ocr/keys/` lists metadata;
`DELETE /api/v1/ocr/keys/{key_id}/` revokes one immediately. Rotate by creating a
replacement and switching clients before revoking the old key. Removing or
demoting the issuing administrator, or disabling their account or organization,
also makes their keys unusable.

Developer keys can submit and read jobs belonging to their organization; they
cannot manage keys or call the website's session-authenticated APIs. Other active
keys in the same organization can retrieve existing results after key rotation.

## Submit and retrieve

```bash
curl "$BASE_URL/api/v1/ocr/jobs/" \
  -H "Authorization: Bearer $OCR_API_KEY" \
  -H 'Idempotency-Key: invoice-import-000123' \
  -F 'file=@invoice.pdf' \
  -F 'webhook_url=https://developer.example.com/webhooks/ocr'
```

The request must contain exactly `file` and `webhook_url`. The maximum file size is
**150,000,000 bytes (150 decimal MB)**. Caddy allows 151,000,000 bytes including
multipart framing and limits body reading to five minutes. Rejected file types,
empty files, duplicate parts and oversized uploads never reach the model.

HTTP 202 contains `id`, `status`, `result_url` and other job metadata, plus a
`Location` header for status polling:

```bash
curl "$BASE_URL/api/v1/ocr/jobs/$JOB_ID/" -H "Authorization: Bearer $OCR_API_KEY"
curl "$BASE_URL/api/v1/ocr/jobs/$JOB_ID/result/" -H "Authorization: Bearer $OCR_API_KEY"
```

States are `queued`, `processing`, `succeeded`, `failed`, and `expired`. A result
response is `{ "id": "job UUID", "result": <model JSON> }`. Results are treated as
untrusted content: escape OCR text when rendering it in HTML.

Reuse an idempotency key only for the same file content and webhook URL. Within an
organization this returns the existing job; changing those inputs returns 409.
Admission still reserves temporary upload capacity for a replay, so it may return
429 when quotas are full. If you already received a job ID, poll that job instead
of uploading again. Jobs retain their idempotency metadata after result expiration;
use a new key only when intentionally requesting new processing.

## Completion webhooks

Callbacks contain metadata, not document text:

```json
{
  "id": "stable-event-UUID",
  "type": "ocr.job.succeeded",
  "created_at": "2026-09-09T15:00:00+00:00",
  "data": {
    "job_id": "job-UUID",
    "status": "succeeded",
    "error_code": "",
    "result_url": "/api/v1/ocr/jobs/job-UUID/result/"
  }
}
```

Failure events use `ocr.job.failed` with a safe `error_code`. Fetch the result
from your configured Mobser API base URL with your developer key. Each delivery
includes `X-OCR-Event-ID`, `X-OCR-Timestamp`, and `X-OCR-Signature: v1=<hex digest>`.
Verify the HMAC against the **exact raw body** before parsing or accepting it:

```python
import hashlib
import hmac
import time

def valid_signature(raw_body, timestamp, signature, signing_secret):
    if not timestamp or len(timestamp) > 12 or not timestamp.isascii() or not timestamp.isdigit():
        return False
    if abs(time.time() - int(timestamp)) > 300:
        return False
    expected = hmac.new(
        signing_secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest("v1=" + expected, signature or "")
```

Keep receiver clocks synchronized. Persist each event ID with a unique constraint
and queue downstream work durably before returning 2xx quickly. Delivery is
at least once: a response can be lost after your handler commits. Duplicate event
IDs should return 2xx without repeating side effects. The signed event body ID
should agree with `X-OCR-Event-ID`.

Callbacks require an ASCII HTTPS public DNS hostname on port 443; credentials,
fragments and IP-literal URLs are rejected. DNS is rechecked for every attempt,
all answers must be public, and TLS connects to the checked IP with the original
hostname verified. Redirects are not followed. Transient failures retry with
exponential backoff and jitter, at most eight attempts; permanent 4xx responses
(except 408/429) and redirects stop delivery. Polling remains available if callback
delivery ends in `failed`.

## Admission, cleanup, and operational limits

Defaults per organization: five uploading/queued/processing jobs, 1.5 GB of
accepted input over a rolling 24 hours, and 1.5 GB of retained source bytes.
Global defaults: 50 uploading/queued/processing jobs and 7.5 GB of source storage.
Reservations conservatively account for a maximum-size file before reading the
body. Limits are checked under a shared database lock. Failed security-validation
jobs count toward daily accepted-byte quota so malicious resubmission is not free.
The platform's existing request throttles apply as an additional protection.

Source files are deleted after terminal processing; cleanup failures are retried.
Old unreferenced quarantine files are swept after twice the job lease duration
(40 minutes by default). Completed model results expire after 24 hours and are
removed by maintenance. Job IDs, fingerprints, callback URLs and event metadata
remain for idempotency and delivery history; include these in your data-retention
policy. Monitor free disk space, queue age, callback failures, scanner freshness,
and processing latency. Allow extra disk for concurrent temporary uploads and
orphan files; quotas alone cannot enforce a filesystem-wide disk limit.

Start with one OCR worker slot until you measure GPU capacity. If one request
occupies one GPU slot for ten minutes, that slot completes roughly six jobs per
hour. Adding Django workers does not increase GPU throughput. Additional GPU
capacity or bounded admission is needed to keep queue wait times acceptable.

## Upload security boundary

Content signatures and extension agreement are checked in the upload path.
ClamAV must explicitly report clean; scanner timeouts/errors and scan limits fail
closed. A separate parser process rejects encrypted/active/attached-content PDFs,
overly complex documents, images over 40 million pixels, animation and malformed
content. PDF page count is capped at 500. Linux CPU/memory/time limits and seccomp
restrictions constrain parser execution; the parser receives only its read-only
document descriptor after imports, with filesystem opens/mutations, network and
cross-process access denied. Containers run with dropped capabilities and OCR
processing uses a read-only root filesystem.

These controls reduce risk; no file scanner guarantees safety. Keep parser and
scanner dependencies current. The GPU service must independently isolate its own
PDF/image decoding, limit pages/pixels/time/memory, and avoid exposing file contents
or credentials in logs. The gateway does not sanitize or rasterize accepted PDFs,
so validation cannot remove every possible exploit for a different downstream
parser. Restrict outbound webhook worker traffic at the network layer as another
boundary where your hosting platform supports it.

Design references: [OWASP file uploads](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html),
[OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
[Celery task behavior](https://docs.celeryq.dev/en/stable/userguide/tasks.html),
[ClamAV Docker operation](https://docs.clamav.net/manual/Installing/Docker.html), and
[urllib3 TLS hostname configuration](https://urllib3.readthedocs.io/en/stable/advanced-usage.html#custom-sni-hostname).
