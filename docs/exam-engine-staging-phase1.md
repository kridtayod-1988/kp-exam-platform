# Exam Engine — Staging Phase 1

## Scope and environment boundary

This branch is based on `feat/cloudflare-two-workers-staging`. Work in this phase is limited to the API Worker source, D1 migration files, tests, and implementation notes.

- Target database: `kp_exam_platform_staging` only.
- Production database and production Worker are out of scope.
- No production migration, production data write, or production deployment is part of this work.
- No attempt creation, answer persistence, scoring, or submission endpoint is enabled.
- No real question dataset is imported.
- Staging migrations `0001_exam_engine` and `0002_exam_engine_integrity` have been applied to D1 database `kp_exam_platform_staging` (ID `1c5fd65b-88d5-45da-90c0-543421f90576`).

## Data model and v4 boundary

The migrations add:

- `exam_years`: Buddhist exam-year catalogue.
- `subject_groups` and `subcategories`: subject taxonomy.
- `questions`: year-linked question bank; choices are JSON arrays; answer key and explanation remain server-only.
- `user_attempts` and `user_answers`: reserved schema for the authenticated phase. No Phase 1 API writes to these tables.
- `kp_schema_migrations`: applied migration tracking.

The explicit `questions.exam_year_id` relationship resolves the year-selection requirement. Migration 0002 adds triggers that validate question choices, attempt question snapshots, score bounds, answer membership, and selected-option bounds.

The v4 `profiles`, `exam_sets`, `exam_set_sections`, `exam_set_questions`, audit, membership, and verification modules are not duplicated or claimed as complete in this branch. `user_attempts.user_id` remains an opaque text identifier until the Auth migration can add the correct foreign-key relationship to the canonical v4 profile table. The legacy root `schema.sql` is not used because it describes an older `exams/exam_results` model.

## Read-only API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | D1 connectivity |
| GET | `/api/exam-years` | Active years and active-question counts |
| GET | `/api/catalog` | Active subject groups and subcategories |
| GET | `/api/exam-years/:id/questions?page=1&limit=25` | Safe question fields for an active year |

Question responses intentionally omit `correct_index` and `explanation`. The question-content endpoint requires all of the following: `APP_ENV=preview`, `QUESTION_PREVIEW_ENABLED=true`, and a server-side `QUESTION_PREVIEW_TOKEN` supplied as a Bearer token. It is disabled by default. Never place this token in frontend code or source control. Pagination is validated; page size is capped at 50. Unknown/inactive years return 404.

All non-GET API methods return 405 in this phase. This prevents the frontend adapter's attempt and submit calls from being treated as functional before authentication is implemented.

## CORS

- Browser origins are allowed only when listed in `CORS_ALLOWED_ORIGINS` as comma-separated exact origins.
- Preview config allowlists the current Frontend Preview origin only.
- Credentialed CORS explicitly returns `Access-Control-Allow-Credentials: true` and allows the required request headers for that origin.
- Wildcard origins are not used. CORS is not authentication and must not be treated as an authorization boundary.

## Tests and verification

From `workers/api`:

```sh
npm test
npm run test:integration
```

Node tests use a mocked D1 binding and cover health, catalogue, safe question projection, preview-token enforcement, pagination, unknown years, disabled write routes, CORS allowlisting, and credentialed preflight. GitHub Actions also runs a Wrangler dry run without deploying.

The optional integration test calls the actual API Preview URL and checks D1 health, the year catalogue, and Frontend Preview CORS. It is skipped unless `API_PREVIEW_URL` and `FRONTEND_PREVIEW_ORIGIN` are supplied as CI variables. Latest CI unit tests and Wrangler dry run passed; live Preview integration was skipped because those URLs are not configured in CI.

## Staging migration verification

Read-back verification confirmed migration records `0001_exam_engine` and `0002_exam_engine_integrity` and all six integrity triggers in the Staging D1 database. Temporary test rows were inserted to verify that malformed choices, scores above the question count, selected indexes outside choices, and answers outside the attempt are rejected. All temporary rows were deleted; Staging question and attempt counts returned to zero.

## Auth gate before Phase 2

Before enabling `POST /api/attempts` or `POST /api/attempts/:id/submit`, implement and test Google OAuth callback validation, signed server-side sessions, CSRF/origin protections, session revocation/expiry, identity derivation from the session, attempt ownership, server-side question selection, answer-key isolation, transactional scoring, idempotent submit, rate limits, and audit events.
