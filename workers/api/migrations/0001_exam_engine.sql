-- KP e-Exam Platform: Exam Engine Staging Phase 1
-- D1 / SQLite. Apply to the isolated Staging database only.
-- This migration adds the year-linked question model required by the exam UX.
-- It intentionally does not import questions or enable attempt write APIs.

CREATE TABLE IF NOT EXISTS exam_years (
  id INTEGER PRIMARY KEY,
  year_be INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subject_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  subject_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_gpa3 INTEGER NOT NULL DEFAULT 0 CHECK (is_gpa3 IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subject_group_id) REFERENCES subject_groups(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_year_id INTEGER NOT NULL,
  subcategory_id TEXT,
  question_text TEXT NOT NULL,
  passage TEXT,
  choices TEXT NOT NULL CHECK (json_valid(choices) AND json_type(choices) = 'array'),
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0 AND correct_index < json_array_length(choices)),
  explanation TEXT,
  difficulty TEXT CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
  source_round TEXT NOT NULL DEFAULT 'manual',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_year_id) REFERENCES exam_years(id) ON DELETE RESTRICT,
  FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_year_active
  ON questions(exam_year_id, is_active, id);
CREATE INDEX IF NOT EXISTS idx_questions_subcategory
  ON questions(subcategory_id, is_active);

-- Reserved for the authenticated Exam Engine phase. No write endpoints are
-- exposed in Phase 1. user_id must come from a verified server-side session.
CREATE TABLE IF NOT EXISTS user_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exam_year_id INTEGER NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count IN (10, 25, 50)),
  mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'simulation')),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'expired')),
  question_ids_json TEXT NOT NULL
    CHECK (json_valid(question_ids_json) AND json_type(question_ids_json) = 'array'),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  score INTEGER CHECK (score IS NULL OR score >= 0),
  FOREIGN KEY (exam_year_id) REFERENCES exam_years(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_user_attempts_user_started
  ON user_attempts(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS user_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  selected_index INTEGER NOT NULL CHECK (selected_index >= 0),
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attempt_id, question_id),
  FOREIGN KEY (attempt_id) REFERENCES user_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS kp_schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0001_exam_engine');
