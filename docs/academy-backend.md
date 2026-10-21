# Academy backend integration guide

The academy domain lives in `backend/product/academy/`. It reuses platform users,
organizations, verification challenges, JWT sessions and the WhatsApp provider.
All academy records belong to one Organization. No frontend pages were required
for this implementation; the generated API types are ready for their integration.

## Start and validate

`make migrate` applies the academy schema and the phone-login challenge choice.
`make check` checks Django configuration. Restart the backend, Celery worker and
Beat after deploying the code. Development bind mounts supply the new Python files;
production images must be rebuilt using the existing deployment process.

Commands from the repository root:

`docker compose exec backend python manage.py test product.academy.tests`

`make test-backend` runs the full suite. `make api-generate` regenerates
`backend/openapi.json` and `frontend/src/lib/api/generated.ts`; `make api-check`
checks contract drift. Swagger is available at `/api/docs/`.

## Authentication and workspace selection

- `POST /api/product/academy/auth/request-code/`: international `phone`, including
  the country code. Returns challenge ID, masked destination, expiry and resend
  timer. Repeat this request after the cooldown to obtain a new code. Unknown
  accounts have the same response shape. Requests are rate limited; codes have
  bounded attempts, expiry and single-use semantics.
- `POST /api/product/academy/auth/confirm-code/`: `challenge_id` and six-digit
  `code`. Returns the existing access/refresh token contract. Invited pending
  accounts become active only after proving phone ownership.
- `GET /api/product/academy/workspaces/`: available academies, branding, language,
  time zone, workspaces and action capabilities. Use the existing token refresh and
  logout endpoints to maintain/revoke the resulting session.
- `POST /api/product/academy/workspaces/`: create an academy using `name`,
  `slug`, `language` and IANA `timezone`; the caller becomes its owner.

Every remaining route uses:

`/api/product/academy/{organization_id}/`

Send `Authorization: Bearer <access-token>` and optionally
`X-Academy-Workspace: management|teacher|family`. The server checks membership
and the selected workspace on every request; changing a header cannot grant access.
An owner/admin defaults to management. A multi-role user can explicitly switch.

Owners/admins manage roles. Coordinators manage people, schedules and session
review but cannot read teacher rates, earnings or payroll. Accountants manage
money. Teachers see their own sessions, students and earnings. Family members
see linked children; an adult student's self-access does not reveal siblings.
Internal notes are omitted from family responses, including lesson reports.

## Screen-to-API map

All list endpoints return `count`, `next`, `previous` and `results` (50 rows
by default, configurable with `page_size` up to 200). Related record filters use
UUIDs. Supported filters where a model has the field: `status`, `student`,
`teacher`, `family`, `enrollment`, `session`, `payroll`, `currency`,
`visibility`, `is_active`, `entity`, `entity_id`. People and session lists
also support `search`. Primary records have list/detail routes; the schema
specifies allowed mutations. Financial ledgers and history have no direct edit or
delete routes. Django admin is intentionally read-only for academy records.

| UI area | Resources/actions |
| --- | --- |
| Academy setup | `settings/`; PATCH the settings ID. Checklist keys: branding, policies, staff, teachers, families, packages, schedule, whatsapp |
| Workspace accounts | `members/` GET/POST, then `staff-roles/` for coordinator/accountant grants |
| Families | `families/`, `family-contacts/?family=...`, `students/?family=...` |
| Students | `students/`, `student-notes/?student=...`, `students/{id}/set-status/`, `students/{id}/archive/` |
| Teachers | `teachers/`, `availability/?teacher=...`, restricted `teacher-rates/?teacher=...` |
| Overview / Teacher Today / Family Home | `dashboard/overview/`, scoped by workspace; includes server time, next session, countdown, today's classes and attention-list filters |
| Calendar | `sessions/?starts_after=<ISO>&starts_before=<ISO>`; availability overlay from `availability/` |
| Recurring schedule | `schedules/preview/`, POST `schedules/`, `schedules/{id}/edit/` |
| Session detail and dialogs | `sessions/{id}/`, `sessions/{id}/transition/`, `sessions/bulk-transition/` |
| Teacher lesson report | `sessions/{id}/lesson-report/`, `lesson-preferences/` |
| Learning / Quran progress | `lesson-records/?session=...`, `progress/?student=...`, `student-notes/?student=...` |
| Family cancellation/rescheduling | Read `sessions/{id}/cancellation-policy/` before POST `session-requests/`; staff review at `session-requests/{id}/review/` |
| Packages / purchases / renewal | `packages/`, `enrollments/`; new purchase can reference `renewed_from` |
| Lesson balance ledger | `balance-entries/?enrollment=...`, `enrollments/{id}/adjust-balance/` |
| Payments and receipts | `payments/`, `payments/{id}/upload-receipt/`, authenticated `payments/{id}/receipt/`, `payments/{id}/review/` |
| Payroll | `payroll/`, `payroll/{id}/statement/?teacher=...`, `payroll/{id}/transition/` |
| Teacher earnings | `earnings/`, `earnings-issues/`; `earned_after` and `earned_before` filter local earned dates |
| Earnings corrections | `earnings/{id}/adjust/`, `earnings-issues/{id}/resolve/` |
| WhatsApp | `messages/`, `message-automations/`, `message-templates/`; connection state in settings/overview |
| Reports and export | `dashboard/reports/?from=YYYY-MM-DD&to=YYYY-MM-DD`, `dashboard/export-report/` with the same filters |
| Excel import | `imports/upload/`, `imports/{id}/validate/`, `imports/{id}/execute/`, `imports/{id}/error-report/` |
| Record history | `history/?entity=session&entity_id=...`; money-related history is restricted |

Status values are stable machine-readable codes. Render their translated text
alongside color. Language and IANA zone fields support Arabic/English presentation;
RTL layout remains a frontend responsibility.

## Account provisioning and family linking

An admin POSTs `email`, international `phone`, optional names and `role`
(`MEMBER` or `ADMIN`) to `members/`. Matching existing accounts are linked;
new accounts receive an unusable password and pending status. This operation does
not send a message. The person requests their own sign-in code to activate access.

Use the returned user UUID in a teacher profile, family contact, or adult student's
`user` field. A contact with parent/guardian relationship grants access to linked
children. An adult needs `is_adult=true` and a linked student user. Existing family
contacts should be PATCHed to link their account, rather than duplicated.

A new student must reference an existing `family` UUID. The UI should first search
families and offer linking; create a family only when a match does not exist.

## Confirmation protocol

Short destructive/financial actions use a two-request protocol at the same URL:

1. POST the action inputs without `preview_token`. The server returns
   `{data: <effects>, preview_token: <signed token>}` and makes no domain change.
2. Show the complete effects to the user. POST the same inputs with the token to
   confirm. Tokens expire after 15 minutes. Changes to records or effects invalidate
   the token and require a new preview. Permission checks run again at confirmation.

This applies to session transitions, bulk transitions, archival, balance and
teacher-earning adjustments, payment review, payroll transitions, recurring-series
edits, request reviews and import execution. Adjustment requests additionally use a
client-generated UUID `idempotency_key`; retries with the same payload return the
existing entry, while reusing a key for a different payload is rejected.

Session transition actions are `cancel`, `reschedule`, `substitute`,
`approve_report` and `correct_attendance`. Cancellation, report approval and
attendance correction require BOTH `deduct_student` and `pay_teacher` booleans,
plus a reason. These are independent decisions. Substitute previews show the new
teacher's effective rate only to authorized financial roles. Bulk confirmation
lists exact session IDs and combined enrollment balance effects; the whole request
rolls back if any action fails.

## Scheduling rules

Recurring input includes student, teacher, enrollment, `timezone`, `weekdays`
(0=Monday through 6=Sunday), `local_time`, `starts_on`, `ends_on`, duration and
optional meeting URL. The selected IANA zone is the “Keep this time fixed in…”
zone. Occurrences are stored as UTC instants. Previews contain academy, family and
teacher local times, including offsets. DST gaps and ambiguous times are rejected;
choose a different local time. Offset shifts across dates are flagged for review.

Conflicts, inactive participants, invalid enrollment dates and mismatched lesson
durations block saving. Availability and projected balance warnings require
`acknowledge_warnings=true`. Existing scheduled lessons count toward projected
balance. Recurrences are bounded to 366 days. Posting a schedule recalculates all
warnings under a tenant row lock, so stale client previews cannot double-book.

Use the session reschedule transition for “this session.” Series edits accept
`whole_series` or `this_and_future` (with `from_session` and replacement start
date). Reported/completed/cancelled occurrences cannot be silently rewritten. Old
scheduled occurrences are retained as cancelled history; a replacement series owns
the new occurrences. Cancelling or moving a class invalidates queued reminders.

## Learning and money

Teacher reports store attendance, actual/late minutes, family-visible notes,
internal notes, homework and Quran references. References are validated against
locally stored chapter/ayah boundaries. A report moves a session to needs_review;
only staff approval completes the session and applies the two financial decisions.
Families see learning records after approval. Repeated approvals cannot deduct or
pay twice. Balance checks and all ledger changes occur in the same transaction.

Catalog packages are separate from purchased enrollments. Purchases snapshot price,
currency, lesson count, duration and expiry. Approved partial payments accumulate;
full payment activates the purchase and credits its lessons once. Free packages
activate on purchase. Renewal creates a new linked enrollment rather than resetting
an old ledger. Expired/low-balance flags are computed for display.

Receipts accept PDF/PNG/JPEG, up to 5 MB. Their bytes are stored privately in the
database and downloaded only through an authorized API; they never use public
media URLs. Matching receipt hashes/references produce duplicate warnings. An
accountant must explicitly acknowledge duplicates when approving. Overpayment and
currency mismatch are rejected.

Payroll proceeds Draft → Reviewed → Approved → Paid. Unresolved past session
reports and open earnings issues block closing. Statement totals are grouped by
teacher AND currency. Approved entries remain in their original statement;
corrections create new unassigned adjustments for a later payroll. Marking paid
requires a payment reference. This records external payment; it does not transfer
funds. Monetary reports never combine different currencies.

## Import format

Upload a UTF-8 CSV or XLSX (first worksheet), up to 5 MB / 5,000 data rows / 50
columns. Compressed XLSX content is bounded, and formulas must be replaced with
values. Map destination fields to source column names:

Required: `family_external_id`, `family_name`, `contact_name`, `phone`,
`student_external_id`, `student_name`.

Optional: `timezone`, `language`, `is_adult`.

Existing family external IDs link only when contact details match. Siblings share
one family. Existing student external IDs are rejected rather than overwritten.
Validation returns row numbers, errors, valid count and up to 100 preview rows.
Execution revalidates the entire file, applies it atomically and records its result;
retrying an imported job does not create duplicate students. CSV exports neutralize
spreadsheet formula prefixes.

## WhatsApp configuration

Two server-owned environment variables bind channels to academies:

`ACADEMY_WHATSAPP_CHANNELS={"academy-channel":{"channel_id":"<channel>","api_key":"<secret>"}}`

`ACADEMY_WHATSAPP_CONNECTIONS={"academy-slug":"academy-channel"}`

Keep values in ignored environment files/secret management. Compose passes these
variables to the backend and Celery services. Recreate services after changing
environment variables. OTP delivery uses the existing `HIREAGENTS_AUTH_CHANNEL_ID`,
`HIREAGENTS_AUTH_API_KEY` and `WHATSAPP_AUTH_TEMPLATE` configuration.

Create provider-approved templates, then enable the matching academy automations:
reminder, session_changed, low_balance, renewal. Delivery is disabled by default.
The Celery task `product.academy.tasks.process_academy_outbox` runs every minute,
queues due reminders and dispatches pending messages. Missing configuration and
uncertain provider results produce action_required and a visible connection state.
Sent means accepted by the provider; delivered/read callbacks are not implemented
in this academy outbox. An uncertain send is not automatically retried to avoid
sending duplicates; reconcile it with the provider first. Live channel/template
verification is still required before launch; automated tests use a mocked provider.

## Current boundaries

- The backend supports the specified operations; the UI still needs to bind its
  pages/dialogs to these APIs and translate status/error presentation.
- Organization isolation is enforced in queryset scoping, relation validation and
  model validation. PostgreSQL row locks serialize tenant-changing operations.
- Financial and history mutations go through services/API actions. Do not bypass
  them with manual ORM bulk updates or direct SQL.
- Payment gateways, actual bank payouts, custom-domain provisioning and live
  video-meeting creation are external integrations. This version stores/reviews
  payments, payout references, domain settings and meeting links.
- Imports add families/students; they do not silently overwrite existing students
  or provision user accounts. Link portal accounts through the explicit member flow.
