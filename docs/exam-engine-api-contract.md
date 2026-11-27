# Exam Engine API Contract (Frontend Integration)

This document defines the API contract required by `js/exam-engine.js`. It is an integration specification, **not proof that these endpoints are deployed**.

## Security requirements

- Require an authenticated server-side session for attempt creation and submission. The frontend currently has Google Login disabled; do not enable attempts for real accounts until Auth + Security is complete.
- Derive the user identity from the server session. Never accept a user ID or email supplied by the browser as authority.
- Enforce account active status, plan entitlements, question availability, and attempt ownership on every request.
- Select questions on the server and store the selected question IDs in the attempt. Do not accept client-provided question IDs as the authoritative exam set.
- Never return `correct_index`, answer keys, or explanations before submission.
- Score only on the server. Ignore any score, percentage, role, or user identity sent by the browser.
- Use a transaction for answer persistence and attempt completion; make submission idempotent.
- Validate question count against the allowed values (10, 25, 50), exam year active status, and available question count.
- Add rate limits and audit events for attempt creation and submission.
- Preview-only question reads require `APP_ENV=preview`, `QUESTION_PREVIEW_ENABLED=true`, and a server-held `QUESTION_PREVIEW_TOKEN`. This token is not a substitute for production Auth.

## v4 schema mapping and Phase 1 boundary

| KP-EXAM v4 concept | Staging Phase 1 representation | Status |
| --- | --- | --- |
| Exam year catalogue | `exam_years` | Added |
| Subject taxonomy | `subject_groups`, `subcategories` | Added; child reads are constrained by active parent |
| Question bank | `questions.exam_year_id`, `subcategory_id`, `choices`, `correct_index`, `explanation`, `source_round` | Year-linked subset |
| User identity / role | v4 `profiles.id`, `profiles.role` | Not created or duplicated by this migration; must be joined after Auth integration |
| Exam-set composition | `exam_sets`, `exam_set_sections`, `exam_set_questions` | Not part of this phase |
| Attempt / answer records | `user_attempts`, `user_answers` | Reserved tables; no write API |
| Audit / entitlement / verification | v4 audit, membership, and verification tables | Deferred to their owning modules |

`user_attempts.user_id` remains an opaque text identifier in this isolated phase because the v4 `profiles` table and Auth migration are not yet part of this branch's dependency chain. Before enabling attempt writes, a follow-up migration must add and validate the foreign-key relationship to `profiles.id` (or the final canonical user table). Do not treat the current reserved tables as Auth-complete.

Migration `0002_exam_engine_integrity.sql` adds SQLite triggers for choice structure, attempt question snapshots, score bounds, and answer membership/index validation. Apply migrations in order to Staging only.

## 1. Create an attempt

`POST /api/attempts`

Request:
```json
{
  "exam_year_id": 2567,
  "question_count": 10,
  "mode": "practice"
}
```

Success response (illustrative):
```json
{
  "data": {
    "attempt": {
      "id": "attempt-id",
      "exam_year_label": "พ.ศ. 2567",
      "started_at": "2026-11-10T16:00:00.000Z"
    },
    "questions": [
      {
        "id": 101,
        "question_text": "ตัวอย่างคำถาม",
        "passage": null,
        "choices": ["ตัวเลือก ก", "ตัวเลือก ข", "ตัวเลือก ค", "ตัวเลือก ง"],
        "subject_name": "คิดวิเคราะห์"
      }
    ]
  }
}
```

The question list must contain public fields only. Never include `correct_index` or `explanation`.

## 2. Submit an attempt

`POST /api/attempts/:attemptId/submit`

Request:
```json
{
  "answers": [
    { "question_id": 101, "selected_index": 2 }
  ]
}
```

Success response (illustrative):
```json
{
  "data": {
    "result": {
      "attempt_id": "attempt-id",
      "score": 8,
      "total": 10,
      "percentage": 80,
      "submitted_at": "2026-11-10T16:12:00.000Z"
    }
  }
}
```

The server must verify that every submitted question belongs to this attempt, reject invalid indexes and duplicate answers, persist answers, calculate the score against the database answer key, and return the result. Optional answer review data may be returned only after the attempt is submitted.

## Error responses

Use a consistent JSON shape, for example:
```json
{ "error": "ATTEMPT_NOT_FOUND", "message": "ไม่พบชุดข้อสอบนี้" }
```

Suggested status codes: 400 invalid input, 401 unauthenticated, 403 inactive/unauthorized, 404 missing attempt or exam year, 409 already submitted, 422 insufficient questions, 429 rate limited, 500 unexpected server error.

## Current integration status

The current repository contains the frontend adapter and UX flow only. Attempt creation and submission remain disabled in this phase. The legacy `schema.sql` uses an older `exams/exam_results` model and must not be applied to the current D1 database.
