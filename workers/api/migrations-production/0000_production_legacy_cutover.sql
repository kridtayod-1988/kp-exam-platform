-- KP-EXAM Production cutover pre-migration.
-- Preserve the original empty schema under legacy_* names before applying
-- the canonical D1 Exam Engine/Auth migrations 0001-0006.
-- This migration is intentionally idempotent only via the migration ledger;
-- execute exactly once against kp_exam_platform_db after confirming the
-- source tables are empty and a D1 Time Travel bookmark/export exists.

CREATE TABLE IF NOT EXISTS kp_production_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE admin_audit_log RENAME TO legacy_admin_audit_log;
ALTER TABLE answers RENAME TO legacy_answers;
ALTER TABLE attempt_questions RENAME TO legacy_attempt_questions;
ALTER TABLE attempts RENAME TO legacy_attempts;
ALTER TABLE questions RENAME TO legacy_questions;
ALTER TABLE subjects RENAME TO legacy_subjects;
ALTER TABLE exam_years RENAME TO legacy_exam_years;
ALTER TABLE users RENAME TO legacy_users;

INSERT OR IGNORE INTO kp_production_migrations (id)
VALUES ('0000_production_legacy_cutover');
