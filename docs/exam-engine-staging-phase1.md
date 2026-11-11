# Exam Engine — Staging Phase 1

## Scope and environment boundary

This branch is based on `feat/cloudflare-two-workers-staging`. Work in this phase is limited to the API Worker source, D1 migration files, tests, and this implementation note.

- Target database: `kp_exam_platform_staging` only.
- Production database and production Worker are out of scope.
- Do not run a migration against `kp_exam_platform_db`.
- Do not run a production deployment.
- No attempt creation, answer persistence, scoring, or submission endpoint is enabled.
- No real question dataset was present in the repository at implementation time; this migration creates schema only.

## Data model

The migration adds:

- `exam_years`: Buddhist exam-year catalogue.
- `subject_groups` and `subcategories`: subject taxonomy.
- `questions`: year-linked question bank; choices are JSON arrays; answer key and explanation remain server-only.
- `user_attempts` and `user_answers`: reserved schema for the authenticated phase. No Phase 1 API writes to these tables.

The explicit `questions.exam_year_id` relationship resolves the year-selection requirement. The legacy root `schema.sql` is not used because it describes an older `exams/exam_results` model.

## Read-only API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | D1 connectivity |
| GET | `/api/exam-years` | Active years and active-question counts |
| GET | `/api/catalog` | Active subject groups and subcategories |
| GET | `/api/exam-years/:id/questions?page=1&limit=25` | Safe question fields for an active year |

Question responses intentionally omit `correct_index` and `explanation`. Pagination is validated; page size is capped at 50. Unknown/inactive years return 404.

All non-GET API methods return 405 in this phase. This prevents the frontend adapter's attempt and submit calls from accidentally being treated as functional before authentication is implemented.

## CORS

Browser origins are allowed only when listed in the Worker variable `CORS_ALLOWED_ORIGINS` as a comma-separated exact-origin allowlist. Configure this separately for the Staging preview. CORS is not authentication and must not be treated as an authorization boundary.

## Test

From `workers/api`:

```sh
npm test
```

The tests use a mocked D1 binding and cover health, catalogue, safe question projection, pagination validation, unknown years, disabled write routes, and CORS allowlisting.

## Staging migration procedure

Review the SQL, then apply only to the Staging D1 database using its database name/ID. Do not use the production binding or run an unqualified migration command from the root. Verify the resulting table list and run the API tests before connecting a preview Worker.

## Auth gate before Phase 2

Before enabling `POST /api/attempts` or `POST /api/attempts/:id/submit`, implement and test Google OAuth callback validation, signed server-side sessions, CSRF/origin protections, session revocation/expiry, identity derivation from the session, attempt ownership, server-side question selection, answer-key isolation, transactional scoring, idempotent submit, rate limits, and audit events.
