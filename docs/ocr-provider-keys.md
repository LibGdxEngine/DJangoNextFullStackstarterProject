# OCR provider credential pool

`product.ocr.api_key_service.get_api_key()` selects the next usable key from the
database on every call. These are **upstream provider credentials**,
separate from the API keys developers use to access Mobser and the secrets that
sign completion webhooks.

## Selection behavior

Each call reactivates exhausted keys whose 30-day cooldown has elapsed, marks any
explicitly supplied `exhausted` key as exhausted, and advances to the next nonblank
active credential in source-ID order. All duplicate rows containing an exhausted credential
are marked together. `in_progress` rows are not selected or automatically reclaimed.
If an exhausted row has no `exhausted_at`, the original `updated_at` fallback is
used. Exhaustion is committed even when no replacement exists and the function
raises `NoUsableApiKey`.

The position is stored in the database and advanced atomically, so consecutive
calls and concurrent workers receive different keys when alternatives exist.
Duplicate CSV rows representing one credential occupy a single position in the
rotation. After the last usable credential, rotation wraps to the beginning.
If only one usable credential remains, it is reused after that one-key cycle;
if none remain, the service raises `NoUsableApiKey`. PostgreSQL row locking
serializes selection across workers and restarts. Calling the service does not
itself mark a key as exhausted or claim that its allowance has been consumed.

```python
from product.ocr.api_key_service import get_api_key, NoUsableApiKey

key = get_api_key()
next_key = get_api_key()  # Next distinct usable database credential, if available.
# After the provider explicitly confirms this credential's allowance is exhausted:
replacement = get_api_key(exhausted=key)
```

The gateway does not infer credit exhaustion from a generic HTTP 429, timeout or
authentication failure. Provider-specific exhaustion handling requires that
provider's documented error contract. It also does not calculate dollar balances
or prove that an upstream provider has renewed an allowance after 30 days.

## Storage and import

The `ocr_ocrproviderkey` table preserves all ten source columns: source ID, email,
account status, API key, API-key status, lease owner and expiry, creation/update
times, and exhaustion time. Keys are stored as authenticated encrypted ciphertext;
the internal model's `api_key` property decrypts them when needed. A digest supports
duplicate-key matching without decrypting the entire pool. Original timestamps
are preserved as instants; naive timestamps use UTC, as in the supplied service.
Empty keys and failed/in-progress rows are retained. No public endpoint or admin
registration exposes this table.

Set `OCR_PROVIDER_KEY_ENCRYPTION_KEY` to a Fernet-generated key in the ignored
environment file or deployment secret store before import. Never commit the CSV,
database or encryption key. Do not replace the encryption key after importing
without a deliberate re-encryption migration and backup.

Local commands from the repository root:

```bash
python backend/manage.py migrate ocr
python backend/manage.py import_ocr_provider_keys /secure/email_variants.csv --dry-run
python backend/manage.py import_ocr_provider_keys /secure/email_variants.csv
```

For a running production Compose deployment, the same import accepts stdin so
credentials do not need to be copied into the image or passed as command arguments:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend \
  python manage.py import_ocr_provider_keys - < /secure/email_variants.csv
```

Imports are atomic. Every row is validated; output contains counts or safe
line-number errors only. Importing the same source again skips existing identical
rows and preserves subsequent runtime exhaustion changes. A source ID with
different imported content fails the whole import instead of silently replacing
credentials or resetting cooldowns. Rows are never deduplicated by email or key.
The source CSV remains unchanged.

## OCR and webhook boundaries

`gpu.run_model()` obtains the next key from the database immediately before sending the validated document to the
server-configured model URL. Empty or undecryptable pools fail the job safely
with `provider_keys_unavailable`; no credential is sent to an alternate endpoint.
There is no static API-key environment fallback. `OCR_PROVIDER_KEY_ENCRYPTION_KEY`
only decrypts stored credentials locally and is never sent to the provider.

Future provider status requests can use the same internal service once their
endpoint and authentication contract are known. Incoming provider webhook
verification may require a stable signing secret or the credential originally
associated with the job; choosing a different pool key is not a substitute for
that verification. Mobser's existing outgoing developer webhooks continue to use
their own HMAC signing secrets and never include a provider credential.
