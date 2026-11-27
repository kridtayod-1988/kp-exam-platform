-- Production-only compatibility index.
-- The legacy schema had an index named idx_questions_year_active; renaming
-- legacy_questions preserves that index name, so migration 0001's IF NOT EXISTS
-- intentionally leaves it attached to the legacy table. This index serves the
-- new questions table without deleting the preserved legacy index.

CREATE INDEX IF NOT EXISTS idx_v4_questions_year_active
  ON questions(exam_year_id, is_active, id);

INSERT OR IGNORE INTO kp_production_migrations (id)
VALUES ('0001_production_questions_index_compat');
