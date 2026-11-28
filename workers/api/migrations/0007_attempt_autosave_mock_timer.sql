-- KP e-Exam Platform: persistent answer autosave and server-enforced Mock Exam timer.
-- Additive only; apply to Staging first after CI and migration review.
ALTER TABLE user_attempts ADD COLUMN time_limit_seconds INTEGER;
ALTER TABLE user_attempts ADD COLUMN deadline_at TEXT;

CREATE INDEX IF NOT EXISTS idx_user_attempts_owner_status_started
  ON user_attempts(user_id, status, started_at DESC);

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0007_attempt_autosave_mock_timer');
