-- KP-EXAM Staging: per-profile question history for Anti-Repeat practice.
-- Apply only to kp_exam_platform_staging after review/approval.
-- Uses canonical profiles.xp from Migration 0004; no secrets or production data.

CREATE TABLE IF NOT EXISTS user_seen_questions (
  profile_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, question_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_seen_questions_question
  ON user_seen_questions(question_id);

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0006_user_seen_questions');
