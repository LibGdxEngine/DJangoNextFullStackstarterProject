# Provider key pool verification — 2026-09-09

## Imported data

- Source: `/home/ahmed/Documents/ocr_new/email_variants.csv`, read without modification.
- Destination: configured local development SQLite database `backend/db.sqlite3`,
  table `ocr_ocrproviderkey`; no production database was accessed.
- Imported all 36,858 rows, including 8,249 blank-key rows and 67 duplicate
  nonblank-key rows. Preserved source IDs, email/status fields, lease metadata,
  and timestamps. Decrypted values were compared in memory against all ten CSV
  columns; no credential or email values were printed.
- Nonblank credentials are encrypted with Fernet; the generated key is in the
  ignored `.env` file with restrictive permissions. A pre-migration database
  backup is under ignored `backend/private/db-backups/`.
- Re-import: zero inserts and 36,858 identical rows skipped.
- Compared database selection against the supplied Python service with an
  in-memory, non-writing source adapter. Results matched. Database lifecycle
  changes made by this comparison were rolled back; source file hash unchanged.
  This verified the initial import implementation; the user's subsequent
  correction intentionally replaces lowest-key reuse with per-call rotation.
- Removed the populated local database from Git tracking while retaining the
  working file. Database paths are now ignored.

## Code and checks

- New migration creates the provider credential table and a singleton lock table.
- Each call now selects the next distinct usable database credential and persists
  the rotation cursor. A stored fingerprint prevents immediate repeats when
  reactivation changes a duplicate credential's canonical row ID. Rotation wraps
  after the final usable credential; a one-key pool reuses its sole credential.
- Duplicate exhaustion and 30-day cooldown behavior remains intact, including
  the legacy updated_at fallback and exhausted-state commit when no replacement
  remains.
- OCR's upstream model operation always selects its bearer key from the database.
  Static-token settings, environment samples, Compose entries and fallback code
  were removed. The remaining environment encryption key is never sent upstream.
- Migration0003 was applied locally. Three consecutive calls against the imported
  pool returned three distinct credentials without exposing them; audit changes
  were rolled back and all36,858 imported rows remain.
- Updated pool/import regression suite:27 PostgreSQL tests passed. Independent
  review approved the rotation fix, including its duplicate-cooldown regression.
- 247 backend tests passed on isolated PostgreSQL, including provider-pool
  concurrency and import regression tests. Independent review ran 30 passing
  tests with one PostgreSQL-only skip on SQLite and found no blocking findings.
- API contract check, both OCR-profile Compose configurations, migration drift
  check and whitespace validation passed.
- No real provider credential was sent to an external service.

## Pending user information

“Webhook check” is ambiguous: the existing gateway sends signed callbacks to
developers and has no provider-status or incoming-provider-callback contract.
Provider credentials must not be sent to developer-controlled callback URLs.
The provider endpoint/authentication or incoming signature format is needed to
implement this remaining integration correctly. Exhaustion HTTP/error semantics
are also unspecified; no generic429/timeouts are interpreted as credit exhaustion.
