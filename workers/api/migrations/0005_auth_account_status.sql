-- KP e-Exam Platform — account status and Auth audit query hardening.
-- Apply only to the isolated Staging D1 database after review.
-- Existing accounts remain active by default; disabled accounts cannot create
-- new sessions and existing sessions stop authenticating immediately.

ALTER TABLE profiles
  ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1
  CHECK (is_active IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_auth_audit_oauth_rate_limit
  ON auth_audit_log(event_type, event_detail, created_at);

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0005_auth_account_status');
