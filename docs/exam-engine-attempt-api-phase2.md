# D1 Exam Engine Attempt API — Phase 2 implementation

## Scope

This implementation adds the first authenticated attempt lifecycle on the existing Cloudflare Workers + D1 stack. It reuses the existing Google OAuth session tables and the existing `user_attempts` / `user_answers` schema. It does not add or execute a database migration.

This work is preview-only. The API returns `EXAM_ENGINE_NOT_ENABLED` outside `APP_ENV=preview` or when `AUTH_ENABLED` is not `true`.

## Endpoints

### Create an attempt

`POST /api/attempts`

Request fields:
- `exam_year_id`: active `exam_years.id`
- `question_count`: 10, 25, or 50
- `mode`: `practice` only (defaults to `practice`; simulation remains disabled until time-limit enforcement is implemented)

The Worker verifies the session and CSRF token, checks that the exam year is active, selects the question IDs on the server, applies a limit of 10 attempt starts per profile per hour, stores an immutable question-ID snapshot in `user_attempts`, and returns only public question fields. Answer keys and explanations are not included.

### Submit an attempt

`POST /api/attempts/:attemptId/submit`

Request:
```json
{
  "answers": [
    { "question_id": 101, "selected_index": 2 }
  ]
}
```

The Worker verifies ownership and attempt state, validates each question and selected option against the stored snapshot and D1 question rows, calculates the score from `questions.correct_index`, then atomically claims the in-progress attempt and writes submitted answers using D1 `batch()`.

Unanswered questions count as incorrect. Repeated submissions return the already stored result instead of awarding another submission.

### Read a submitted result

`GET /api/attempts/:attemptId/result`

Only the owning authenticated profile can read the result. Answer keys, correctness flags, and explanations are returned only after the attempt is submitted.

## Security controls

- Profile identity comes from the verified HttpOnly session cookie; no browser-supplied user ID is trusted.
- Mutating requests require an exact allowlisted Origin and the session-bound CSRF header/cookie/hash.
- Attempt ownership is checked on every read and write.
- The browser cannot select the authoritative question set.
- The browser cannot submit a score or correct answer.
- Question preview and attempt APIs remain Preview-only.
- Request body size is capped at 64 KiB.
- Public create-attempt responses omit `correct_index` and `explanation`.

## Tests

`workers/api/test/exam-engine.test.js` covers:
- missing authentication
- server-side question selection and answer-key redaction
- question-count validation
- server-side scoring and post-submit explanation visibility

The repository CI workflow was updated to run on this feature branch. The CI result must be green before this branch is considered ready for Staging.

## Known follow-up work

1. Persist in-progress answer changes before final submission (autosave endpoint and frontend integration).
2. Add attempt history and pagination.
3. Add server-enforced time limits and expiry policy for simulation mode.
4. Add membership/plan entitlements when the membership schema is ready.
5. Seed reviewed exam years, categories, and questions into Staging. Current Staging D1 read-only inspection found no exam-year or question records, so a live exam cannot yet be started.
6. Complete live Staging OAuth + D1 end-to-end tests after verifying Worker secrets and approved content import.

## Deployment boundary

No Staging or Production migration was executed. No Worker or Pages deployment was performed. No Production D1 database was changed. The draft pull request targets `feat/auth-security-hardening` for review and has not been merged.
