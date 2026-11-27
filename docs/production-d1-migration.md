# Production D1 migration record

Date: 2026-11-28 (Asia/Bangkok)
Database: `kp_exam_platform_db`

## Safety and preservation

- Captured a Cloudflare D1 SQL export and a Time Travel bookmark before schema changes.
- Confirmed the original core tables had zero rows before cutover: `users`, `subjects`, `exam_years`, `questions`, `attempts`, `answers`, `attempt_questions`, and `admin_audit_log`.
- Renamed those original tables to `legacy_*` instead of dropping them.
- Preserved `app_settings` unchanged (4 rows).
- Verified `PRAGMA foreign_key_check` returned zero violations after the cutover.

## Applied migrations

Shared API schema migrations applied to Production:
- `0001_exam_engine.sql`
- `0002_exam_engine_integrity.sql`
- `0003_exam_engine_integer_question_ids.sql`
- `0004_auth_sessions.sql`
- `0005_auth_account_status.sql`
- `0006_user_seen_questions.sql`

Production-only cutover and index compatibility migrations are stored separately under `workers/api/migrations-production/` so they are not accidentally applied to Staging by the shared migrations directory:
- `0000_production_legacy_cutover.sql`
- `0001_production_questions_index_compat.sql`

The Wrangler `d1_migrations` ledger and application `kp_schema_migrations` ledger were populated with the six shared migration filenames/IDs to prevent a later Wrangler migration run from applying them again. Production-specific operations are recorded in `kp_production_migrations`.

## Read-back verification

- New Auth tables exist: `profiles`, `auth_sessions`, `auth_oauth_states`, `auth_audit_log`.
- New Exam Engine tables exist: `exam_years`, `subject_groups`, `subcategories`, `questions`, `user_attempts`, `user_answers`, `user_seen_questions`.
- Eight Auth/Exam validation triggers exist.
- Production `profiles` includes `is_active`.
- Production `questions` uses integer IDs and the JSON `choices` field expected by the Exam Engine.
- The new question lookup index is `idx_v4_questions_year_active`; the original legacy index remains attached to `legacy_questions`.
- All new application tables are empty; no sample questions or Staging data were copied to Production.
- `PRAGMA foreign_key_check` returned no rows.
- Cloudflare D1 denied `PRAGMA integrity_check` with `SQLITE_AUTH`; no claim is made that this specific check passed.

## Deployment boundary

This record covers database schema changes only. It does not deploy or modify either Production Worker, configure Production D1 bindings, or create/replace OAuth/session secrets. Those remain separate release steps.
