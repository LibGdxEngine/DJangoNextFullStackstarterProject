
- Error normalization uses DRF's existing exception handler so rollback and WWW-Authenticate/Retry-After headers remain intact. Unexpected exceptions return None, reach Django's exception logging, then receive a safe JSON envelope in outer response middleware.
- Service-level Django ValidationError dictionaries use __all__; the public API maps that key to non_field_errors and flattens nested serializer paths with dots/numeric indexes.
- Verified error changes with 37 focused tests using the isolated Python runtime and PYTHONDONTWRITEBYTECODE=1; DEBUG True/False, legacy token routes, validation, headers/cookies, logs, business codes/context, webhook errors, and existing success flows passed.
- drf-spectacular ignores DELETE bodies and assumes a 204 response unless explicitly overridden. The account-deletion password challenge needs a narrow AutoSchema override plus an explicit 200 response annotation.
- Raw request schema dictionaries in extend_schema must be nested under a media type (application/json); bare dictionaries are interpreted as media-type maps.
- Schema generation is database-independent under core.settings.schema. api-check checks both generated artifacts independently and exports to temporary files before any writes.
- Concurrent observability changes made status checks read-only: celery is a string, beat is an object, and dependency failures return 503 through the shared error envelope. Updated generated contracts and explicitly documented plain Django health probes that spectacular does not discover.

Frontend API implementation:
- Backend calls now use domain wrappers; generated component aliases distinguish token users and profiles.
- NextAuth session expiry uses a failed-token conditional JWT update. Treat null/undefined update results as unsuccessful so later 401s can retry cleanup; only cache confirmed expiry.
- The request timeout also bounds session-token acquisition and body decoding; background session cleanup must not delay delivery of an API error.
- Concurrent observability work changed diagnostics to read-only heartbeat data. Preserve its UI behavior and use generated string celery/object beat fields.
