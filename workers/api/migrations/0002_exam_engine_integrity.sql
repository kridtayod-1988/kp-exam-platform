-- KP-EXAM v4 compatibility hardening for the isolated staging schema.
-- Apply only to kp_exam_platform_staging after reviewing this migration.

CREATE TRIGGER IF NOT EXISTS trg_questions_validate_insert
BEFORE INSERT ON questions
BEGIN
  SELECT CASE
    WHEN json_array_length(NEW.choices) < 2
      THEN RAISE(ABORT, 'choices must contain at least two options')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.choices)
       WHERE type <> 'text' OR length(trim(value)) = 0
    )
      THEN RAISE(ABORT, 'every choice must be a non-empty string')
    WHEN NEW.correct_index >= json_array_length(NEW.choices)
      THEN RAISE(ABORT, 'correct_index is outside choices')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_questions_validate_update
BEFORE UPDATE OF choices, correct_index ON questions
BEGIN
  SELECT CASE
    WHEN json_array_length(NEW.choices) < 2
      THEN RAISE(ABORT, 'choices must contain at least two options')
    WHEN EXISTS (
      SELECT 1 FROM json_each(NEW.choices)
       WHERE type <> 'text' OR length(trim(value)) = 0
    )
      THEN RAISE(ABORT, 'every choice must be a non-empty string')
    WHEN NEW.correct_index >= json_array_length(NEW.choices)
      THEN RAISE(ABORT, 'correct_index is outside choices')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_attempts_validate_insert
BEFORE INSERT ON user_attempts
BEGIN
  SELECT CASE
    WHEN json_array_length(NEW.question_ids_json) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json count must match question_count')
    WHEN (
      SELECT COUNT(DISTINCT CAST(value AS INTEGER))
        FROM json_each(NEW.question_ids_json)
    ) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json must contain unique question ids')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.question_ids_json) selected
        LEFT JOIN questions q ON q.id = CAST(selected.value AS INTEGER)
       WHERE q.id IS NULL OR q.exam_year_id <> NEW.exam_year_id OR q.is_active <> 1
    )
      THEN RAISE(ABORT, 'all attempt questions must be active and belong to exam year')
    WHEN NEW.score IS NOT NULL AND NEW.score > NEW.question_count
      THEN RAISE(ABORT, 'score cannot exceed question_count')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_attempts_validate_update
BEFORE UPDATE OF question_count, question_ids_json, exam_year_id, score ON user_attempts
BEGIN
  SELECT CASE
    WHEN json_array_length(NEW.question_ids_json) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json count must match question_count')
    WHEN (
      SELECT COUNT(DISTINCT CAST(value AS INTEGER))
        FROM json_each(NEW.question_ids_json)
    ) <> NEW.question_count
      THEN RAISE(ABORT, 'question_ids_json must contain unique question ids')
    WHEN EXISTS (
      SELECT 1
        FROM json_each(NEW.question_ids_json) selected
        LEFT JOIN questions q ON q.id = CAST(selected.value AS INTEGER)
       WHERE q.id IS NULL OR q.exam_year_id <> NEW.exam_year_id OR q.is_active <> 1
    )
      THEN RAISE(ABORT, 'all attempt questions must be active and belong to exam year')
    WHEN NEW.score IS NOT NULL AND NEW.score > NEW.question_count
      THEN RAISE(ABORT, 'score cannot exceed question_count')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_answers_validate_insert
BEFORE INSERT ON user_answers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM user_attempts a, json_each(a.question_ids_json) selected
       WHERE a.id = NEW.attempt_id
         AND CAST(selected.value AS INTEGER) = NEW.question_id
    )
      THEN RAISE(ABORT, 'answer question is not part of this attempt')
    WHEN NEW.selected_index >= (
      SELECT json_array_length(q.choices)
        FROM questions q
       WHERE q.id = NEW.question_id
    )
      THEN RAISE(ABORT, 'selected_index is outside question choices')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_answers_validate_update
BEFORE UPDATE OF attempt_id, question_id, selected_index ON user_answers
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
        FROM user_attempts a, json_each(a.question_ids_json) selected
       WHERE a.id = NEW.attempt_id
         AND CAST(selected.value AS INTEGER) = NEW.question_id
    )
      THEN RAISE(ABORT, 'answer question is not part of this attempt')
    WHEN NEW.selected_index >= (
      SELECT json_array_length(q.choices)
        FROM questions q
       WHERE q.id = NEW.question_id
    )
      THEN RAISE(ABORT, 'selected_index is outside question choices')
  END;
END;

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0002_exam_engine_integrity');
