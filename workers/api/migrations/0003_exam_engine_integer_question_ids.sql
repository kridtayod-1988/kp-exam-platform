-- KP-EXAM Exam Engine integrity hardening.
-- Follow-up migration for Staging databases that already applied 0002.
-- Do not edit an already-applied migration; replace only the affected triggers.

DROP TRIGGER IF EXISTS trg_attempts_validate_insert;
DROP TRIGGER IF EXISTS trg_attempts_validate_update;
DROP TRIGGER IF EXISTS trg_answers_validate_insert;
DROP TRIGGER IF EXISTS trg_answers_validate_update;

CREATE TRIGGER trg_attempts_validate_insert
BEFORE INSERT ON user_attempts
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.question_ids_json)
       WHERE type <> 'integer' OR value <= 0
    )
      THEN RAISE(ABORT, 'question_ids_json must contain positive integer question ids')
    WHEN json_array_length(NEW.question_ids_json) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json count must match question_count')
    WHEN (
      SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.question_ids_json)
    ) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json must contain unique question ids')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.question_ids_json) selected
        LEFT JOIN questions q ON q.id = selected.value
       WHERE q.id IS NULL OR q.exam_year_id <> NEW.exam_year_id OR q.is_active <> 1
    )
      THEN RAISE(ABORT, 'all attempt questions must be active and belong to exam year')
    WHEN NEW.score IS NOT NULL AND NEW.score > NEW.question_count
      THEN RAISE(ABORT, 'score cannot exceed question_count')
  END;
END;

CREATE TRIGGER trg_attempts_validate_update
BEFORE UPDATE OF question_count, question_ids_json, exam_year_id, score ON user_attempts
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.question_ids_json)
       WHERE type <> 'integer' OR value <= 0
    )
      THEN RAISE(ABORT, 'question_ids_json must contain positive integer question ids')
    WHEN json_array_length(NEW.question_ids_json) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json count must match question_count')
    WHEN (
      SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.question_ids_json)
    ) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json must contain unique question ids')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.question_ids_json) selected
        LEFT JOIN questions q ON q.id = selected.value
       WHERE q.id IS NULL OR q.exam_year_id <> NEW.exam_year_id OR q.is_active <> 1
    )
      THEN RAISE(ABORT, 'all attempt questions must be active and belong to exam year')
    WHEN NEW.score IS NOT NULL AND NEW.score > NEW.question_count
      THEN RAISE(ABORT, 'score cannot exceed question_count')
  END;
END;

CREATE TRIGGER trg_answers_validate_insert
BEFORE INSERT ON user_answers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM user_attempts a, json_each(a.question_ids_json) selected
       WHERE a.id = NEW.attempt_id
         AND selected.type = 'integer'
         AND selected.value = NEW.question_id
    )
      THEN RAISE(ABORT, 'answer question is not part of this attempt')
    WHEN NEW.selected_index < 0 OR NEW.selected_index >= (
      SELECT json_array_length(q.choices)
        FROM questions q
       WHERE q.id = NEW.question_id
    )
      THEN RAISE(ABORT, 'selected_index is outside question choices')
  END;
END;

CREATE TRIGGER trg_answers_validate_update
BEFORE UPDATE OF attempt_id, question_id, selected_index ON user_answers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM user_attempts a, json_each(a.question_ids_json) selected
       WHERE a.id = NEW.attempt_id
         AND selected.type = 'integer'
         AND selected.value = NEW.question_id
    )
      THEN RAISE(ABORT, 'answer question is not part of this attempt')
    WHEN NEW.selected_index < 0 OR NEW.selected_index >= (
      SELECT json_array_length(q.choices)
        FROM questions q
       WHERE q.id = NEW.question_id
    )
      THEN RAISE(ABORT, 'selected_index is outside question choices')
  END;
END;

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0003_exam_engine_integer_question_ids');
