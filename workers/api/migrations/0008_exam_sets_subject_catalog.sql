-- KP e-Exam Platform: database-backed exam-set catalogue and subject catalog.
-- Additive only. Apply to Staging first; do not apply to Production without separate approval.
CREATE TABLE IF NOT EXISTS exam_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_year_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  exam_date TEXT,
  session_label TEXT NOT NULL DEFAULT 'รวมรอบ',
  default_question_count INTEGER NOT NULL DEFAULT 50
    CHECK (default_question_count IN (10, 25, 50)),
  source_key TEXT NOT NULL UNIQUE,
  source_file_name TEXT NOT NULL,
  source_version TEXT NOT NULL,
  source_status TEXT NOT NULL DEFAULT 'user_supplied_unverified'
    CHECK (source_status IN ('user_supplied_unverified', 'verified', 'archived')),
  source_note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_year_id) REFERENCES exam_years(id) ON DELETE RESTRICT
);

ALTER TABLE questions ADD COLUMN exam_set_id INTEGER REFERENCES exam_sets(id) ON DELETE SET NULL;
ALTER TABLE questions ADD COLUMN source_question_ref TEXT;
ALTER TABLE user_attempts ADD COLUMN exam_set_id INTEGER REFERENCES exam_sets(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_exam_set_source_ref
  ON questions(exam_set_id, source_question_ref)
  WHERE source_question_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_questions_exam_set_active
  ON questions(exam_set_id, is_active);

CREATE INDEX IF NOT EXISTS idx_user_attempts_exam_set
  ON user_attempts(exam_set_id, started_at DESC);

CREATE TABLE IF NOT EXISTS question_import_notes (
  question_id INTEGER PRIMARY KEY,
  source_question_ref TEXT NOT NULL,
  source_round TEXT NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (quality_status IN ('ready', 'corrected', 'needs_review', 'duplicate')),
  editorial_note TEXT,
  duplicate_of_ref TEXT,
  source_file_name TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO subject_groups (id, name, slug, sort_order, is_active)
VALUES ('civil-service', 'กฎหมายและความรู้การเป็นข้าราชการที่ดี', 'civil-service', 4, 1);

INSERT OR IGNORE INTO subcategories (id, subject_group_id, name, slug, sort_order, is_active) VALUES
  ('numerical-sequences', 'numerical', 'อนุกรมตัวเลข', 'numerical-sequences', 2, 1),
  ('symbolic-conditions', 'numerical', 'เงื่อนไขสัญลักษณ์', 'symbolic-conditions', 3, 1),
  ('word-problems', 'numerical', 'โจทย์ปัญหาคณิตศาสตร์', 'word-problems', 4, 1),
  ('logical-reasoning', 'numerical', 'การคิดวิเคราะห์เชิงตรรกะ', 'logical-reasoning', 5, 1),
  ('thai-analogy', 'verbal', 'อุปมาอุปไมย', 'thai-analogy', 2, 1),
  ('sentence-ordering', 'verbal', 'การเรียงประโยค', 'sentence-ordering', 3, 1),
  ('reading-comprehension', 'verbal', 'การอ่านจับใจความ', 'reading-comprehension', 4, 1),
  ('thai-vocabulary', 'verbal', 'คำศัพท์และความสัมพันธ์ของคำ', 'thai-vocabulary', 5, 1),
  ('english-grammar', 'english', 'ไวยากรณ์ภาษาอังกฤษ', 'english-grammar', 2, 1),
  ('english-vocabulary', 'english', 'คำศัพท์ภาษาอังกฤษ', 'english-vocabulary', 3, 1),
  ('english-reading', 'english', 'การอ่านภาษาอังกฤษ', 'english-reading', 4, 1),
  ('admin-law', 'civil-service', 'กฎหมายระเบียบบริหารราชการแผ่นดิน', 'admin-law', 1, 1),
  ('admin-procedure', 'civil-service', 'กฎหมายวิธีปฏิบัติราชการทางปกครอง', 'admin-procedure', 2, 1),
  ('official-tort', 'civil-service', 'ความรับผิดทางละเมิดของเจ้าหน้าที่', 'official-tort', 3, 1),
  ('good-governance', 'civil-service', 'หลักเกณฑ์บริหารกิจการบ้านเมืองที่ดี', 'good-governance', 4, 1),
  ('civil-service-ethics', 'civil-service', 'จริยธรรมและมาตรฐานทางจริยธรรม', 'civil-service-ethics', 5, 1),
  ('public-service', 'civil-service', 'การบริการภาครัฐและการอำนวยความสะดวก', 'public-service', 6, 1);

INSERT OR IGNORE INTO kp_schema_migrations (id)
VALUES ('0008_exam_sets_subject_catalog');
